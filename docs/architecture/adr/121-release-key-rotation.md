# ADR-121 — Rotate the release key for 3.0.0

**Status:** Accepted · 2026-10-24. Amends [ADR-089](089-network-mode-and-update-check.md)
§3 and the signing-key implementation of [ADR-091](091-content-packs.md).

## Context

The original Ed25519 private key that signed Nexus releases and content-pack
manifests is no longer available. The public half remains in every released
client, but no future release or pack can be signed with the matching private
half.

Reusing an unavailable key would mean shipping artifacts that either cannot be
verified or bypass the verification already present in installed clients. The
3.0.0 release is therefore the trust-boundary change.

## Decision

1. Generate a new Ed25519 key pair locally. Keep the PKCS#8 private half only in
   the `release` environment secret `NEXUS_RELEASE_SIGNING_KEY`; never place it
   in the repository, release assets, logs or an agent transcript.
2. Compile the SubjectPublicKeyInfo PEM into
   `apps/desktop/src/main/update/releaseKey.ts`. Its SPKI SHA-256 fingerprint is
   `da00340566fbe5ab1c30ceaf4e618af63d4900c3d16a3b4f77947ee579767f90`.
3. Pin that fingerprint in the desktop suite, in addition to the release
   workflow's existing signature-versus-compiled-key check.
4. Restrict the `release` environment to `v*` tag deployments. The signing job
   verifies its signature against the compiled public key before uploading.
5. Sign the 3.0.0 installers, the rebuilt planet-texture and Whisper manifests,
   and the catalogue with the new key.

## Consequences

- A Nexus 2.5 installation cannot verify a 3.0.0 update: it trusts only the old
  key, whose private half is unavailable. The 3.0.0 release notes must say that
  users on 2.5.0 and earlier download 3.0.0 once by hand.
- Future 3.0.x updates verify against the new compiled key and use the ordinary
  in-app update path.
- Content packs signed with the retired key must be re-signed. Release and
  catalogue publication stay blocked until every published artifact verifies
  against the new key.
- Losing the new private key repeats the same manual-upgrade boundary. The
  maintainer keeps the offline backup described by ADR-089.

## Alternatives rejected

- **Trust both keys indefinitely.** The old private half cannot sign anything,
  and retaining it in the updater would expand the trust set without preserving
  a working upgrade path.
- **Publish a transitional 2.5.1 signed by the old key.** No matching private
  key exists, so this cannot be done.
- **Disable signature verification for one release.** That converts a key-loss
  event into a general downgrade of the update boundary.
