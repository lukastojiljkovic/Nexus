/**
 * The one bound every identifier in this product lives under.
 *
 * **Why a bound exists at all.** An id is the field nobody thinks of as user
 * input, so it is the field that gets checked for emptiness and nothing else —
 * `nonEmptyStr(raw.profileId, "profileId")` in the archive reader,
 * `asNonEmptyString(payload.id, "id")` on the IPC wire. Both of those admit a
 * ten-megabyte string, and both hand it to a store that writes through prepared
 * statements: the value is bound rather than interpolated, so there is no
 * injection, but there is also no CHECK beyond `NOT NULL` on any id column in
 * any migration. A restore therefore writes the ten megabytes, every list query
 * that touches the row carries them, and no screen can display what it landed
 * on. The reader and the wire are the only bounds these values ever meet, which
 * is why they have to be bounds rather than shape checks.
 *
 * **Why 200 and not 36.** Most ids here are `uuidv7()` — 36 characters — but
 * not all of them are minted: a catalogue slug (`arduino-uno`, `D9`) is an id,
 * a registry key (`calendar:isticanja`) is an id, and the dashboard COMPOSES
 * one, `default:<profile uuid>:<set uuid>:<widget id>`, which runs to about a
 * hundred characters today. A bound tight enough to be interesting would break
 * that composition the first time a widget id grew; 200 is a ceiling nothing
 * legitimate approaches and is the whole job — this number exists to stop an
 * archive or a compromised renderer, not to describe the id space.
 *
 * **Why it is not a pattern.** `canvasRef.ts` pins the exact uuidv7 grammar,
 * and is right to: a reference there decides between a card this app draws and
 * an iframe it does not. Nothing of that kind hangs off a bare id, and a
 * grammar would refuse the slugs and composites above, so the general rule is
 * the length and the narrow rules stay where their narrowness is earned.
 */
export const MAX_ID_LENGTH = 200;
