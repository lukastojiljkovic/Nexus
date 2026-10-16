/**
 * What an assistant location asks a drawer tool to open with: the fields it fills in.
 *
 * `drawer.open` sends `action: { name: "prefill", payload: { values } }` on the
 * drawer's own page. The shell reads the action here, and the tool's surface reads
 * the values on mount (`ToolPrefillProvider` in `toolSurfaces.tsx`). The payload was
 * validated by the tool that wrote it; this takes only the named fields, as the
 * strings a field's input holds, and ignores any other action.
 */

export type ToolPrefillValues = Readonly<Record<string, string>>;

/** The prefill an action carries, or `undefined` when it is another action or has none. */
export function toolPrefillOf(action: unknown): ToolPrefillValues | undefined {
  if (typeof action !== "object" || action === null) return undefined;
  const { name, payload } = action as { name?: unknown; payload?: unknown };
  if (name !== "prefill" || typeof payload !== "object" || payload === null) return undefined;
  const values = (payload as { values?: unknown }).values;
  if (typeof values !== "object" || values === null) return undefined;
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, String(value)]));
}
