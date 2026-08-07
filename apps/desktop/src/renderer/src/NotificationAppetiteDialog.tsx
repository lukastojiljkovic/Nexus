import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@nexus/ui";
import type { NotificationSource } from "../../shared/ipc.js";
import { NOTIFICATION_PRESETS } from "./notificationFormat.js";
import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface NotificationAppetiteDialogProps {
  profileId: string;
  /** Called once the answer has actually been recorded — the dialog stays up until then, so a failed write never loses the only ask there is. */
  onAnswered: () => void;
}

/**
 * The one-time "Koliko da te Nexus podseća?" question (NTF-008 / ADR-033),
 * shown at the first moment the scheduler is genuinely about to remind — and
 * only while the window can be seen, which is the main process's own gate
 * (`notifications.ts`), not this component's.
 *
 * **Every path answers.** The three presets, "Zadrži podrazumevano", Escape and
 * the backdrop all reach `answer`; the last three send `null`, which means
 * "keep the current settings" rather than "ask me again later". There is no
 * later: the question is asked once, ever, so a dialog that could be dismissed
 * without answering would silently spend the only chance the user gets. That is
 * the one place this parts company with the `RecurrenceScopeDialog` recipe it
 * otherwise follows verbatim — there, Escape genuinely cancels.
 *
 * No default: no primary among the choices and Enter picks nothing; focus lands
 * on the first choice so the whole thing is answerable from the keyboard
 * without any key already meaning something. House dialog recipe, tokens only,
 * no glow.
 */
export function NotificationAppetiteDialog({
  profileId,
  onAnswered,
}: NotificationAppetiteDialogProps) {
  const s = strings.notifications.appetite;
  const titleId = useId();
  const questionId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The in-flight guard is a ref, not the `saving` state: two clicks inside one
  // render (or a click and an Escape) would both read the same not-yet-flushed
  // `false` and answer twice.
  const savingRef = useRef(false);

  const answer = useCallback(
    async (sources: NotificationSource[] | null): Promise<void> => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        await window.nexus.answerNotificationAppetite(profileId, sources);
        onAnswered();
      } catch (failure) {
        setError(strings.notifications.appetite.saveError);
        console.error("Nexus: failed to record the notification appetite answer:", failure);
        // Left open, and answerable again: a failed write means the question is
        // still unanswered, and it is the only one there is.
        savingRef.current = false;
        setSaving(false);
      }
    },
    [profileId, onAnswered],
  );

  // Focus lands on the first preset, not on „Zadrži podrazumevano": answerable
  // from the keyboard without any key already meaning "keep the default" —
  // the trap's own default (the first tabbable descendant), since the presets
  // come before it. It also cycles Tab and hands focus back on close.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape is an ANSWER here ("keep what is configured"), not a cancel.
      if (event.key === "Escape") void answer(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [answer]);

  return createPortal(
    <div className="ntf__appetite-overlay">
      <div className="ntf__appetite-backdrop" onClick={() => void answer(null)} />
      <div
        ref={panelRef}
        className="ntf__appetite-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={questionId}
      >
        <h2 id={titleId} className="ntf__appetite-title">
          {s.title}
        </h2>
        <p id={questionId} className="ntf__appetite-question">
          {s.question}
        </p>
        <div className="ntf__appetite-choices">
          {NOTIFICATION_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              className="ntf__appetite-choice"
              disabled={saving}
              onClick={() => void answer(preset.sources)}
            >
              {strings.settings.notificationPresets[preset.key]}
            </Button>
          ))}
        </div>
        {error != null && <p className="ntf__settings-error">{error}</p>}
        <div className="ntf__appetite-actions">
          <Button
            className="ntf__appetite-keep"
            disabled={saving}
            onClick={() => void answer(null)}
          >
            {s.keepDefault}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
