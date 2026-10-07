/**
 * The Ed25519 public key that checks the signature on every Nexus release's
 * `SHA256SUMS.txt`.
 *
 * The private half lives only in `NEXUS_RELEASE_SIGNING_KEY`, a secret of the
 * repository's `release` environment (which admits `v*` tags only), and in the
 * maintainer's offline backup. The release workflow signs with it and checks
 * the signature against this key before it uploads anything. An update
 * check trusts a downloaded installer only when its hash is listed in a
 * `SHA256SUMS.txt` this key verifies, so replacing the key is a release of its
 * own, recorded in an ADR.
 */
export const RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAatKmMRuiiEocwXINUthuLw68lNNl+QAkmGV8a0hxO0k=
-----END PUBLIC KEY-----
`;
