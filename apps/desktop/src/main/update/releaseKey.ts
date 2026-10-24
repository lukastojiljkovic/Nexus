/**
 * The Ed25519 public key that checks the signature on every Nexus release's
 * `SHA256SUMS.txt`.
 *
 * The private half lives only in `NEXUS_RELEASE_SIGNING_KEY`, a secret of the
 * repository's `release` environment (which admits `v*` tags only). The release
 * workflow signs with it and checks the signature against this key before it
 * uploads anything. An update check trusts a downloaded installer only when its
 * hash is listed in a `SHA256SUMS.txt` this key verifies. ADR-121 records the
 * 3.0.0 replacement of the original key; that release is the one-time manual
 * upgrade from installations that only trust the original key.
 */
export const RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvj/NbrP8XrnmIjrn/+A1B6egKYavpwZszFJntNS+OQM=
-----END PUBLIC KEY-----
`;

/**
 * The retired key remains a content-pack verifier for the manifests already
 * published under it. It is never consulted by the updater and never receives a
 * new signature. ADR-121 records why this compatibility boundary is narrower
 * than reusing the key for releases.
 */
export const LEGACY_PACK_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAatKmMRuiiEocwXINUthuLw68lNNl+QAkmGV8a0hxO0k=
-----END PUBLIC KEY-----
`;

/**
 * Content-pack verification accepts either key; the signed catalogue and every
 * update use `RELEASE_PUBLIC_KEY_PEM` alone.
 */
export const PACK_PUBLIC_KEYRING_PEM = `${RELEASE_PUBLIC_KEY_PEM}${LEGACY_PACK_PUBLIC_KEY_PEM}`;
