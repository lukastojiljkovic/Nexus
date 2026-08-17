/**
 * The profile's content key, as it crosses the wire: read every generation, and
 * mint the first one.
 *
 * ─── The server cannot mint this, and that decides the whole shape ──────────
 *
 * `sync-enable` mints MK inside an Edge Function because „exactly once per
 * account" is an atomic-singleton problem and a service role can solve it. CK is
 * not the same problem, and copying that answer would be wrong: the row stored
 * here is CK_p wrapped UNDER MK, and the server has never held MK and must never
 * hold it. Whatever writes this row has to be the party that can wrap — a
 * desktop — so the server's only remaining job is to accept the first wrap that
 * arrives for a slot and refuse every later one.
 *
 * `key_wraps_one_per_slot` is what refuses them, and that is a better arbiter
 * than a function would be: it is a unique index, so two desktops minting in the
 * same second cannot both win, and the loser is told `23505` rather than
 * discovering later that it sealed rows under a key nothing else has. The
 * outcome is named {@link ContentKeyFailureReason} `taken`, and the caller's
 * answer to it is to read the slot again and adopt what is there.
 *
 * ─── The order the caller must keep ─────────────────────────────────────────
 *
 * Read, then mint if empty, then seal. NEVER seal under a key whose wrap is not
 * already durable on the server: a row sealed under a CK no peer can fetch is a
 * row no peer can ever open, and no later repair can invent the key.
 *
 * ─── Every generation, not just the live one ────────────────────────────────
 *
 * {@link readContentKeyWraps} does not filter on `disabled_at`, because a device
 * pulling a log meets rows at whatever epoch they were sealed at — including
 * epochs a rotation has since retired. `disabled` says „do not seal anything NEW
 * under this", not „this cannot be opened", and a reader that dropped the
 * disabled rows would answer `no-key` to every row a finished rotation has not
 * re-encrypted yet.
 *
 * ─── Why this file carries three strings and not a `SealedKey` ──────────────
 *
 * `SealedKey` and `parseSealedKey` live in `wrap.ts`, which is absent from
 * `@nexus/sync-crypto/web` IN ITS ENTIRETY — a browser must not be one
 * `unwrapKey` call away from the master key, and `scripts/web-key-surface.mjs`
 * walks `@nexus/web`'s dependency closure to keep it that way. That closure does
 * not contain this package today and will the day the web app syncs, so an
 * import of `wrap.ts` here is not a mistake that would be caught: it is one that
 * would be PLANTED now and detonate months later, in a gate whose message names
 * `sync-crypto` rather than this file.
 *
 * So the wire layer carries what a wire layer can: `bytea` columns as unpadded
 * base64url. Turning three strings into a key is `parseSealedKey`'s job, and the
 * caller — a desktop, the only party that holds MK — must do it before using
 * one. That is not a weaker check, it is the same check at the layer that owns
 * the rule; what this file validates is what it can see, which is that a column
 * decoded as `bytea` at all.
 */

import { base64urlToBytea, byteaToBase64url } from "./bytea.js";
import {
  jsonHeaders,
  parseFailure,
  parseRows,
  postgrestPath,
  type HttpPort,
  type HttpRequest,
} from "./http.js";

/** The `key_wraps.kind` this module reads and writes, and the only one it may. */
export const CONTENT_KEY_KIND = "ck_under_mk";

/** The columns a content-key wrap is read back through. */
export const CONTENT_KEY_COLUMNS = "profile_id,epoch,nonce,wrapped,commit_tag,disabled_at";

/** The highest generation `key_wraps.epoch` and `sync_objects.ck_epoch` can hold. */
const MAX_EPOCH = 32_767;

/**
 * The three byte fields of a wrap, unpadded base64url.
 *
 * `SealedKey`'s shape minus `v` and `purpose`, which are not carried because
 * they are not stored: this slot is `ck/master-key` at v2 by definition, and a
 * server that could state either would be stating which key opens the row.
 * Hand this to `parseSealedKey` — with those two filled in — before use.
 */
export interface SealedBytes {
  readonly nonce: string;
  readonly ciphertext: string;
  readonly commitment: string;
}

export interface ContentKeyWrap {
  readonly profileId: string;
  readonly epoch: number;
  /** CK_p under MK. Opened with `unwrapKey` at purpose `ck/master-key`. */
  readonly sealed: SealedBytes;
  /** This generation has been retired: openable, never again sealable under. */
  readonly disabled: boolean;
}

export type ContentKeyFailureReason =
  /** 401/403/42501 — the session is dead, revoked, or is not a desktop. */
  | "forbidden"
  /** 23505 — another device wrote this slot first. Read it again and adopt it. */
  | "taken"
  /** 5xx, a transport error, a body that is not an array. Nothing was learned. */
  | "unavailable"
  /** The server served something that is not a wrap of this table. */
  | "malformed";

export interface ContentKeyFailure {
  readonly ok: false;
  readonly reason: ContentKeyFailureReason;
  readonly status: number;
  readonly sqlstate: string | null;
  readonly message: string | null;
}

export interface ContentKeyWraps {
  readonly ok: true;
  readonly wraps: readonly ContentKeyWrap[];
}

export type ContentKeyWrapsResult = ContentKeyWraps | ContentKeyFailure;

export interface ContentKeyMinted {
  readonly ok: true;
  readonly wrap: ContentKeyWrap;
}

export type ContentKeyMintResult = ContentKeyMinted | ContentKeyFailure;

export interface ContentKeyMintInput {
  /** The account the row belongs to. `key_wraps_owner_insert` refuses any other. */
  readonly userId: string;
  readonly profileId: string;
  readonly epoch: number;
  readonly sealed: SealedBytes;
}

/**
 * Every generation of one profile's content key.
 *
 * No `user_id` filter, for the reason `keyWrapReadbackRequest` gives: `key_wraps`
 * is under row level security and the select policy scopes to `auth.uid()`, so a
 * filter here would be a second opinion about identity taken from a token this
 * package does not hold. `kind` and `profile_id` are about which rows are
 * wanted, which is a different question.
 */
export function contentKeyWrapsRequest(profileId: string): HttpRequest {
  return {
    method: "GET",
    path: postgrestPath("key_wraps", [
      ["kind", `eq.${CONTENT_KEY_KIND}`],
      ["profile_id", `eq.${profileId}`],
      ["select", CONTENT_KEY_COLUMNS],
      ["order", "epoch.asc"],
    ]),
    headers: jsonHeaders(),
    body: null,
  };
}

/**
 * The insert that claims one slot.
 *
 * `kdf_salt` and `kdf_params` are absent rather than null, and that is what
 * `key_wraps_kdf_salt_presence` requires of this kind: the two password-derived
 * slots carry a salt because a password is not a key, and CK_p is wrapped under
 * MK, which is 32 bytes of entropy with nothing to stretch.
 */
export function mintContentKeyWrapRequest(input: ContentKeyMintInput): HttpRequest {
  return {
    method: "POST",
    path: postgrestPath("key_wraps", [["select", CONTENT_KEY_COLUMNS]]),
    headers: jsonHeaders("return=representation"),
    body: JSON.stringify([
      {
        user_id: input.userId,
        kind: CONTENT_KEY_KIND,
        profile_id: input.profileId,
        epoch: input.epoch,
        nonce: base64urlToBytea(input.sealed.nonce),
        wrapped: base64urlToBytea(input.sealed.ciphertext),
        commit_tag: base64urlToBytea(input.sealed.commitment),
      },
    ]),
  };
}

/**
 * One row's columns as a wrap, or `null` when they are not one.
 *
 * Everything checkable without `wrap.ts`: a profile, an epoch inside what a
 * `smallint` and the table's own CHECK allow, a nullable timestamp, and three
 * columns that decode as `bytea`. Length is deliberately NOT among them — see
 * the header: `parseSealedKey` owns that rule and the caller runs it.
 */
export function contentKeyWrapOf(value: unknown): ContentKeyWrap | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;

  const profileId = row["profile_id"];
  const epoch = row["epoch"];
  const disabledAt = row["disabled_at"];
  if (typeof profileId !== "string" || profileId === "") return null;
  if (typeof epoch !== "number" || !Number.isInteger(epoch)) return null;
  if (epoch < 1 || epoch > MAX_EPOCH) return null;
  if (disabledAt !== null && typeof disabledAt !== "string") return null;

  const nonce = byteaToBase64url(row["nonce"]);
  const ciphertext = byteaToBase64url(row["wrapped"]);
  const commitment = byteaToBase64url(row["commit_tag"]);
  if (nonce === null || ciphertext === null || commitment === null) return null;

  return {
    profileId,
    epoch,
    sealed: { nonce, ciphertext, commitment },
    disabled: disabledAt !== null,
  };
}

/** Every row of a 200, or `null` when any one of them is not a wrap. */
export function parseContentKeyWraps(body: string): readonly ContentKeyWrap[] | null {
  const raw = parseRows(body);
  if (raw === null) return null;
  const wraps: ContentKeyWrap[] = [];
  for (const row of raw) {
    const wrap = contentKeyWrapOf(row);
    // The whole response fails rather than the row being skipped — the same
    // choice `pullPage` makes, and for a sharper reason: a partial read of this
    // table looks exactly like „this profile has no content key", and the
    // caller's answer to that is to MINT one.
    if (wrap === null) return null;
    wraps.push(wrap);
  }
  return wraps;
}

function failureOf(status: number, body: string): ContentKeyFailure {
  const failure = parseFailure(body);
  const forbidden = status === 401 || status === 403 || failure.code === "42501";
  const taken = status === 409 || failure.code === "23505";
  return {
    ok: false,
    reason: forbidden ? "forbidden" : taken ? "taken" : "unavailable",
    status,
    sqlstate: failure.code,
    message: failure.message,
  };
}

export async function readContentKeyWraps(
  http: HttpPort,
  profileId: string,
): Promise<ContentKeyWrapsResult> {
  const response = await http(contentKeyWrapsRequest(profileId));
  if (response.status !== 200) return failureOf(response.status, response.body);

  const wraps = parseContentKeyWraps(response.body);
  if (wraps === null) {
    return {
      ok: false,
      reason: "malformed",
      status: response.status,
      sqlstate: null,
      message: "a 200 from key_wraps was not a list of content-key wraps",
    };
  }
  return { ok: true, wraps };
}

/**
 * Claim the slot, and answer with what the SERVER stored.
 *
 * The returned wrap is parsed out of the representation rather than echoed from
 * the input, because those are two different claims and only one of them is
 * evidence. A row that came back saying something else — a truncated `bytea`, an
 * epoch the server rewrote — must not be sealed under, and the only way to know
 * is to read what is actually there.
 */
export async function mintContentKeyWrap(
  http: HttpPort,
  input: ContentKeyMintInput,
): Promise<ContentKeyMintResult> {
  const response = await http(mintContentKeyWrapRequest(input));
  if (response.status !== 200 && response.status !== 201) {
    return failureOf(response.status, response.body);
  }

  const wraps = parseContentKeyWraps(response.body);
  const stored = wraps?.[0];
  if (wraps === null || wraps.length !== 1 || stored === undefined) {
    return {
      ok: false,
      reason: "malformed",
      status: response.status,
      sqlstate: null,
      message: "the insert did not return exactly one content-key wrap",
    };
  }
  if (
    stored.profileId !== input.profileId ||
    stored.epoch !== input.epoch ||
    stored.sealed.nonce !== input.sealed.nonce ||
    stored.sealed.ciphertext !== input.sealed.ciphertext ||
    stored.sealed.commitment !== input.sealed.commitment
  ) {
    return {
      ok: false,
      reason: "malformed",
      status: response.status,
      sqlstate: null,
      message: "the stored content-key wrap is not the one that was sent",
    };
  }
  return { ok: true, wrap: stored };
}
