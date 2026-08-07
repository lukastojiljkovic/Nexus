export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface SaveIndicatorProps {
  status: SaveStatus;
  /** Shown while a write is in flight. */
  savingLabel: string;
  /** Shown after a write lands. Compose the time into it at the call site — a bare „saved" goes stale on screen and stops being evidence. */
  savedLabel: string;
  /** Shown when the last write was refused. Required in practice: a surface that can fail and does not say so is the defect this component exists for. */
  errorLabel?: string;
}

/**
 * What an autosaving surface says about itself.
 *
 * The founder's fourth report on the first real install was that the canvas
 * „treba opciju za čuvanje table" — and the boards had been saving themselves
 * all along. That is the finding: **failures were said and success never was**,
 * so from the user's side the app was silent about their work either way and
 * silence reads as „nothing is being saved". A drawing you are not sure is
 * saved is a drawing you cannot leave.
 *
 * So the rule this component states, in one place for every surface that writes
 * without being asked: *if a screen saves by itself, it says when.* The saved
 * line carries a TIME rather than a bare „Sačuvano", because a label with no
 * clock on it is still true an hour after the last write and therefore proves
 * nothing.
 *
 * `role="status"` and not `aria-live="assertive"`: this is a background fact, and
 * interrupting somebody mid-sentence to tell them their sentence was saved is
 * its own kind of rude.
 */
export function SaveIndicator({
  status,
  savingLabel,
  savedLabel,
  errorLabel,
}: SaveIndicatorProps) {
  if (status === "idle") return null;
  const text = status === "saving" ? savingLabel : status === "saved" ? savedLabel : errorLabel;
  if (text == null) return null;
  return (
    <p
      className={status === "error" ? "nx-save-state nx-save-state--error" : "nx-save-state"}
      role="status"
    >
      {text}
    </p>
  );
}
