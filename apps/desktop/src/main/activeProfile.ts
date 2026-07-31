/**
 * ADR-058 (NTF active-profile rule): which of the account's profiles the shell
 * is standing in, as MAIN resolves it. The renderer reports its landing over
 * `profiles:set-active` (at unlock and on every verified switch); this
 * function turns that report — which can be absent (nothing reported yet) or
 * stale (the profile was deleted, a restore replaced the database) — into a
 * live profile id the notification scheduler can serve.
 *
 * The fallback ladder mirrors the renderer's own `resolveActiveProfile`
 * (`profilePrefs.ts`) on purpose: the personal anchor is the default at
 * unlock, and the first profile is the defensive floor for a list with no
 * anchor. Null only for an empty list, which an unlocked session never has.
 */
export function resolveActiveProfileId(
  profiles: ReadonlyArray<{ readonly id: string; readonly kind: string }>,
  selectedId: string | null,
): string | null {
  if (selectedId !== null && profiles.some((profile) => profile.id === selectedId)) {
    return selectedId;
  }
  return profiles.find((profile) => profile.kind === "personal")?.id ?? profiles[0]?.id ?? null;
}
