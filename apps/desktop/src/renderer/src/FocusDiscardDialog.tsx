import { ConfirmDialog } from "@nexus/ui";
import { strings } from "./strings.js";

export interface FocusDiscardDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * „Odbaci" (UTIL slice b), asked before it runs. Discarding a running focus
 * phase writes nothing at all — unlike „Završi", which the row survives as
 * history, a discard loses the elapsed time outright and there is no undo to
 * offer afterwards. That asymmetry is exactly why this one asks first.
 *
 * The shared `ConfirmDialog` with `destructive`, so the opening focus lands on
 * Otkaži and a key pressed without reading changes nothing.
 *
 * Shared by FocusPage and StudyPage — one running phase, one discard act,
 * whichever page is showing it.
 */
export function FocusDiscardDialog({ onConfirm, onCancel }: FocusDiscardDialogProps) {
  const s = strings.focus.running.discardDialog;
  return (
    <ConfirmDialog
      title={s.title}
      question={s.question}
      confirmLabel={s.confirm}
      cancelLabel={s.cancel}
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
