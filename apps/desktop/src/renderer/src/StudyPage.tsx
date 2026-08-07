import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  CLOZE_MASK,
  clozeNumbers,
  computeStreak,
  findClozeRuns,
  interleavePractice,
  phaseProgress,
  splitClozeSegments,
  splitProblemSteps,
  withClozeDeletion,
} from "@nexus/core";
import type { ClozeSegment } from "@nexus/core";
import { Button, Checkbox, Chip, EmptyState, ListRow, PageHeader, TextField } from "@nexus/ui";
import type {
  Card,
  CardFieldChanges,
  CardRating,
  CardState,
  Deck,
  DeckCounts,
  DeckFieldChanges,
  Exam,
  ExamFieldChanges,
  ExamTopic,
  ExamType,
  FocusSession,
  LinkedNote,
  NewCardFields,
  NewDeckFields,
  NewExamFields,
  NewPlanFields,
  NewSubjectFields,
  NoteMeta,
  PlanFieldChanges,
  PlanHealth,
  PreviewIntervals,
  ReviewQueueScope,
  RunningFocusSession,
  ScopeCutProposal,
  StudyBlock,
  StudyBlockStatus,
  StudyBlockWithExam,
  StudyLogDay,
  StudyPlan,
  StudyStats,
  Subject,
  SubjectAttachment,
  SubjectColor,
  SubjectFieldChanges,
} from "../../shared/ipc.js";
import { CARD_TEXT_MAX_LENGTH } from "../../shared/ipc.js";
import { AttachmentPreviewDialog } from "./attachmentPreview.js";
import { attachmentPreviewKind, type AttachmentPreviewKind } from "./attachmentPreviewKind.js";
import {
  daysUntilExam,
  examCountdownLabel,
  examCountdownVariant,
  formatExamDate,
  localTodayKey,
  shiftDayKey,
} from "./examDates.js";
import { focusSessionMinutes, formatDurationMinutes, formatElapsed, formatFocusSessionWhen } from "./focusFormat.js";
import { FocusDiscardDialog } from "./FocusDiscardDialog.js";
import { MathText } from "./MathText.js";
import { NotePopover } from "./notePopover.js";
import { scrollRevealedIntoView, useRevealedRow } from "./reveal.js";
import { intervalLabel, isDueWithinSession } from "./reviewIntervals.js";
import { countUnit, dayUnit, strings } from "./strings.js";
import { STUDY_LOG_WINDOW_DAYS, studyLogExamLabels, studyLogFacts } from "./studyLog.js";
import { useFocusTrap } from "./useFocusTrap.js";
import {
  blockKindChipLabel,
  cutTopicsLine,
  isExamWeekDay,
  parseWeekdayMinutes,
  planHealthLine,
  scopeCutRows,
  weekdayMinutesForSave,
} from "./studyPlanView.js";
import type { ScopeCutRow } from "./studyPlanView.js";
import { moduleName } from "./moduleName.js";

// --- Field orderings (renderer mirror of @nexus/db) -------------------------
//
// The renderer never imports DB/Node code (SEC-EL-02: the wire contract stays
// self-contained), so the option orders are redeclared here, matching
// SUBJECT_COLORS / EXAM_TYPES / CARD_RATINGS in @nexus/db. The Serbian labels
// live in strings.ts, applied at render time.
const SUBJECT_COLORS: readonly SubjectColor[] = [
  "jade",
  "gold",
  "bronze",
  "burgundy",
  "crimson",
  "graphite",
];
const EXAM_TYPES: readonly ExamType[] = ["pismeni", "usmeni", "kolokvijum"];

// --- Materijali (migration 035 / STUDY-001) ---------------------------------

/** Locale-aware one-decimal formatter for the KB/MB branches of `formatBytes` — the NOTE/TASK panels' own. */
const BYTES_FORMATTER = new Intl.NumberFormat("sr-Latn", { maximumFractionDigits: 1 });

/**
 * Human-readable file size for the Materijali rows: whole bytes under 1 KB,
 * otherwise KB/MB with at most one decimal. Copied from `TasksPage.tsx` (which
 * copied it from `NoteEditor.tsx`) rather than imported, on the reason that file
 * already states: the panels live in different pages with no shared module
 * between them, and a formatting helper is not worth a fourth one.
 */
function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${BYTES_FORMATTER.format(kb)} KB`;
  return `${BYTES_FORMATTER.format(kb / 1024)} MB`;
}

/** sr-Latn collation for the link picker's note titles — plain "sr" mis-tailors Latin š/č/ć. */
const NOTE_TITLE_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** Shared empty lists, so a subject with neither materials nor linked notes allocates nothing per render. */
const NO_MATERIALS: readonly SubjectAttachment[] = [];
const NO_LINKED_NOTES: readonly LinkedNote[] = [];

/**
 * Which FORM the card editor is showing — deliberately NOT `CardKind` (ADR-046).
 * There are two kinds on the wire and in the schema, `basic` and `cloze`; there
 * are three forms here, because a problem card IS a basic card that also
 * carries a worked solution. Modelling the toggle as a kind would have needed a
 * third kind the ADR refuses, so the choice lives only in the renderer, where
 * it belongs: it is a question about which fields to show, not about what a row
 * is. `strings.study.cardForm` is indexed by this union, not by `CardKind`.
 */
type CardForm = "basic" | "cloze" | "problem";

/** The forms in toggle order: the two plain ones, then the one that adds steps to the first. */
const CARD_FORMS: readonly CardForm[] = ["basic", "cloze", "problem"];

/** The form an existing row edits in: its kind decides, and for a basic row its steps do (ADR-046). */
function formOfCard(card: Card): CardForm {
  if (card.kind === "cloze") return "cloze";
  return card.problemSteps === null ? "basic" : "problem";
}
const CARD_RATINGS: readonly CardRating[] = [1, 2, 3, 4];
const RATING_KEYS: Record<CardRating, keyof typeof strings.study.rating> = {
  1: "again",
  2: "hard",
  3: "good",
  4: "easy",
};

/** Mirrors PlanStore's daily-minutes bounds — client-side parity with the store's own validation. */
const MIN_PLAN_MINUTES = 15;
const MAX_PLAN_MINUTES = 480;

/** The weekday vector's per-day cap, mirroring the store's (a day may be free, never longer than 480). */
const MAX_WEEKDAY_INPUT = 480;

/**
 * The manual-confidence select's closed steps (ADR-063): Nepoznato plus five
 * coarse marks — a self-assessment is not a measurement, so the form offers
 * quarters rather than a 0-100 slider pretending precision. A value off the
 * steps (an import, a restore) keeps its own option so the select never lies.
 */
const CONFIDENCE_STEPS: readonly number[] = [0, 25, 50, 75, 100];

// Serbian Latin collation for subject/deck names (mirrors @nexus/core's views
// engine collator) — plain "sr" resolves to the Cyrillic tailoring and
// misorders š/č/ć.
const collator = new Intl.Collator(["sr-Latn", "sr"]);

/** Card-state chip label; Learning (1) and Relearning (3) share one label — both read as "in progress". */
function cardStateLabel(state: CardState): string {
  const labels = strings.study.cardState;
  if (state === 0) return labels.new;
  if (state === 2) return labels.review;
  return labels.learning;
}

/** Card-state chip variant: New is quiet, Learning/Relearning reads as needing attention (gold), Review as settled (jade). */
function cardStateVariant(state: CardState): "neutral" | "data" | "accent" {
  if (state === 0) return "neutral";
  if (state === 2) return "data";
  return "accent";
}

/** Deck badge chip variant: quiet at zero, the given accent once there is actually something to act on. */
function countVariant(count: number, whenPositive: "data" | "accent"): "neutral" | "data" | "accent" {
  return count > 0 ? whenPositive : "neutral";
}

/**
 * A practice session's renderer-only configuration (STUDY-010 / ADR-047).
 *
 * It travels beside the `ReviewQueueScope`, never inside it: the IPC payload
 * carries only what the QUEUE needs — which decks, problems only, how many New
 * cards — while the seed and the fact that this is practice at all are about
 * how the reviewer ORDERS and LABELS what came back. Neither belongs in main,
 * and neither would survive being invented there.
 */
interface PracticeConfig {
  /** Seeds `interleavePractice` once per session; re-rendering must never reshuffle a session in progress. */
  seed: number;
}

/** Absolute next-due date+time for a non-New card, Serbian Latin; degrades to the raw string on bad input. */
function formatCardDue(due: string): string {
  const date = new Date(due);
  return Number.isNaN(date.getTime())
    ? due
    : new Intl.DateTimeFormat("sr-Latn", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

/**
 * The segments the review surface renders a cloze card from, or null when this
 * row is not a usable cloze card — a basic card, or (defensively) a cloze row
 * whose template no longer holds its own ordinal. The caller then falls back
 * to the stored `front`/`back`, which are plain strings and always renderable.
 */
function clozeSegmentsOf(card: Card): ClozeSegment[] | null {
  if (card.kind !== "cloze" || card.clozeText === null || card.clozeOrdinal === null) return null;
  return splitClozeSegments(card.clozeText, card.clozeOrdinal);
}

/**
 * The cloze review surface (STUDY-006 / ADR-042): the card's template with
 * this row's deletion masked as a blank chip and every other run unwrapped —
 * and, once revealed, the SAME line with the answer in the blank's place,
 * emphasised typographically (accent + weight, never a glow). The context
 * never leaves the screen, which is the whole point of a cloze card.
 *
 * The segments are plain strings, so each one goes through `MathText`
 * afterwards — a `$…$` expression inside a cloze sentence renders exactly as
 * it does on a basic card.
 */
function ClozeLine({
  segments,
  revealed,
}: {
  segments: readonly ClozeSegment[];
  revealed: boolean;
}) {
  return (
    <span className="review__cloze">
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <MathText key={index} text={segment.value} />;
        }
        return revealed ? (
          <MathText key={index} text={segment.value} className="review__cloze-answer" />
        ) : (
          <span
            key={index}
            className="review__cloze-blank"
            aria-label={strings.study.clozeBlankLabel}
          >
            {CLOZE_MASK}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The cloze form's live line: "3 praznine → 3 kartice", or the nudge that
 * there is nothing to make a card from yet. Both nouns take the full
 * three-form Serbian agreement, hence `countUnit` rather than `dayUnit`.
 *
 * The two numbers are counted separately (ADR-068): blanks are `{{…}}` runs,
 * cards are distinct deletion NUMBERS, and „2 praznine → 1 kartica" is the
 * honest line for a template that hides the same thing twice.
 */
function clozeCountLabel(blanks: number, cards: number): string {
  const copy = strings.study.clozeCount;
  if (blanks === 0) return copy.none;
  const blankWord = countUnit(blanks, copy.blankOne, copy.blankFew, copy.blankMany);
  const cardWord = countUnit(cards, copy.cardOne, copy.cardFew, copy.cardMany);
  return `${blanks} ${blankWord} ${copy.arrow} ${cards} ${cardWord}`;
}

/**
 * The steps the review surface reveals one at a time, or null when this row is
 * not a problem card — including (defensively) one whose stored steps parse to
 * nothing. The caller then falls back to the stored `front`/`back`, which are
 * plain strings and always renderable.
 */
function problemStepsOf(card: Card): string[] | null {
  if (card.problemSteps === null) return null;
  const steps = splitProblemSteps(card.problemSteps);
  return steps.length > 0 ? steps : null;
}

/**
 * The problem form's live line: "3 koraka", or the nudge that there is nothing
 * to make a card from yet. Same recipe as `clozeCountLabel` — the counted noun
 * takes the full three-form Serbian agreement, hence `countUnit`.
 */
function problemStepCountLabel(steps: number): string {
  const copy = strings.study.problemStepCount;
  if (steps === 0) return copy.none;
  return `${steps} ${countUnit(steps, copy.stepOne, copy.stepFew, copy.stepMany)}`;
}

/** Returns `list` with the first card matching `id` removed (used to drop a requeued copy on undo). */
function removeFirst(list: Card[], id: string): Card[] {
  const index = list.findIndex((card) => card.id === id);
  if (index === -1) return list;
  const next = list.slice();
  next.splice(index, 1);
  return next;
}

/**
 * Study-block status chip variant: done reads as settled (jade/data), planned
 * and missed stay quiet — a missed row is additionally muted, mirroring the
 * past-exam affordance (never a glow, never a hand-rolled colour).
 */
function blockStatusVariant(status: StudyBlockStatus): "neutral" | "data" {
  return status === "done" ? "data" : "neutral";
}

/**
 * Block-date label for a plan's list — "sreda, 8. jul" (mirrors the calendar's
 * day headings); raw key on bad input. The key is a bare calendar day, so it is
 * parsed and formatted in UTC to avoid a negative-offset day shift.
 */
function formatBlockDay(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime())
    ? key
    : new Intl.DateTimeFormat("sr-Latn", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(date);
}

/** One row of the "minutes per subject" summary (STUDY stats, piece 4b). */
interface SubjectMinutesRow {
  id: string;
  label: string;
  minutes: number;
  muted: boolean;
}

/**
 * Joins the stats payload's `subjectMinutes` with the loaded subjects
 * client-side — an archived subject still resolves by name (its minutes still
 * count), while a subjectId matching no loaded subject (a hard-deleted or
 * foreign row, shouldn't happen but the renderer trusts nothing) rolls into
 * one muted `otherLabel` row instead of being silently dropped. Sorted by
 * minutes descending, ties broken sr-Latn by label.
 */
function joinSubjectMinutes(
  subjectMinutes: StudyStats["subjectMinutes"],
  subjectsById: Map<string, Subject>,
  otherLabel: string,
): SubjectMinutesRow[] {
  const rows: SubjectMinutesRow[] = [];
  let otherMinutes = 0;
  for (const entry of subjectMinutes) {
    const subject = subjectsById.get(entry.subjectId);
    if (subject) {
      rows.push({ id: entry.subjectId, label: subject.name, minutes: entry.minutes, muted: false });
    } else {
      otherMinutes += entry.minutes;
    }
  }
  if (otherMinutes > 0) {
    rows.push({ id: "__other__", label: otherLabel, minutes: otherMinutes, muted: true });
  }
  return rows.sort((a, b) => b.minutes - a.minutes || collator.compare(a.label, b.label));
}

/**
 * Plan adherence as a whole percent, or an em dash when nothing was due
 * (STUDY-013). The store hands back `null` for an empty denominator and the
 * dash is what that looks like: a period you were never asked to study in earns
 * no score, least of all a flattering 100%.
 */
function formatAdherence(ratio: number | null): string {
  return ratio === null ? strings.study.statsAdherenceNone : `${Math.round(ratio * 100)}%`;
}

/**
 * Maps a PlanStore/IPC failure onto the Serbian plan-form copy by matching the
 * store's known validation messages (they cross IPC inside the error text);
 * anything unrecognized falls back to the generic line. UX only — the store
 * remains the source of truth for what is rejected.
 */
function planErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const copy = strings.study.planError;
  if (
    message.includes("already has an active study plan") ||
    message.includes("another active plan already exists")
  ) {
    return copy.duplicate;
  }
  if (message.includes("must be strictly after today")) return copy.examPast;
  if (message.includes("must be strictly before the exam date")) return copy.startAfterExam;
  if (message.includes('"dailyMinutes"')) return copy.minutesRange;
  if (message.includes("weekdayMinutes")) return copy.weekdayRange;
  return copy.generic;
}

/**
 * Maps a failed plan restore onto the Serbian undo-toast error copy. Distinct
 * from `planErrorMessage` (a live form's validation): the only failure the
 * store can throw on restore is a collision with a newer active plan for the
 * same exam (`PlanValidationError`, "another active plan already exists");
 * anything else (shouldn't happen) falls back to the generic line.
 */
function planRestoreErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const copy = strings.study.planRestoreError;
  return message.includes("another active plan already exists") ? copy.duplicate : copy.generic;
}

/** A row of colour-dot toggle buttons over the six closed `SubjectColor` keys. */
function ColorPicker({
  value,
  onChange,
}: {
  value: SubjectColor;
  onChange: (color: SubjectColor) => void;
}) {
  return (
    <div className="study__color-picker" role="group" aria-label={strings.study.colorLabel}>
      {SUBJECT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="study__color-option"
          aria-pressed={value === color}
          aria-label={strings.study.color[color]}
          onClick={() => onChange(color)}
        >
          <span className={`study__dot study__dot--${color}`} />
        </button>
      ))}
    </div>
  );
}

/** A pending deep-link target (021-e global search): reveal one study entity. `parentId` is the exam's/deck's subject, or a card's deck — null for a subject. */
export type StudyIntent = {
  kind: "reveal";
  entity: "subject" | "exam" | "deck" | "card";
  id: string;
  parentId: string | null;
};

/** DOM id for any revealable study row, for `scrollRevealedIntoView`. Ids are UUIDv7 and globally unique across the four entity kinds, so one namespace serves all of them. */
function studyRowDomId(entityId: string): string {
  return `study-row-${entityId}`;
}

export interface StudyPageProps {
  profileId: string;
  /**
   * Opens a note in Beleške — backs the source-link control on a
   * note-generated card (ADR-017 / STUDY-008), the app's first cross-module
   * deep link. Optional: without it, the source control degrades to plain
   * muted text rather than a dead-end button.
   */
  onOpenNote?: (noteId: string) => void;
  intent?: StudyIntent | null;
  /** Reports that `intent` above has been acted on, so the caller (App.tsx) can clear it. */
  onIntentHandled?: () => void;
}

/**
 * The STUDY module page: a subject hub (subjects, exams, decks, study plans),
 * a deck drill-in for card management, and a keyboard-first review session —
 * one internal route, no router. Every write goes through the subjects:* /
 * exams:* / decks:* / cards:* / review:* / plans:* / blocks:* IPC allowlist,
 * so the store stays the single source of truth; `now`/`today` for FSRS
 * scheduling and block generation are always stamped by the main process
 * (`syncAllPlans` runs before every plan read so missed blocks are labelled).
 */
export function StudyPage({ profileId, onOpenNote, intent, onIntentHandled }: StudyPageProps) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [deckCounts, setDeckCounts] = useState<DeckCounts[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const { revealedId, reveal } = useRevealedRow();
  // Shared refusal line for the subject/exam/deck/focus-session/card delete
  // and undo actions below (plus the plan delete) — all plain delete-with-undo
  // writes with no validation of their own, so one slot covers all of them,
  // cleared before each new attempt (the HABIT `actionError` shape).
  const [actionError, setActionError] = useState<string | null>(null);

  // One form serves both add + edit; a non-null id means "editing that subject".
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [subjectColor, setSubjectColor] = useState<SubjectColor>("jade");
  const [subjectSemester, setSubjectSemester] = useState("");
  const [pendingUndoSubjectId, setPendingUndoSubjectId] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The exam form is an inline reveal scoped to one subject at a time; a
  // non-null editingExamId means "editing that exam" rather than adding.
  const [examFormSubjectId, setExamFormSubjectId] = useState<string | null>(null);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [examType, setExamType] = useState<ExamType>("pismeni");
  const [examDate, setExamDate] = useState("");
  const [examScope, setExamScope] = useState("");
  const [pendingUndoExamId, setPendingUndoExamId] = useState<string | null>(null);

  // Materijali + Povezane beleške (STUDY-001, migration 035). Both are kept
  // loaded for every ACTIVE subject, exactly as `blocksByPlan` is for every
  // plan: the hub draws each subject's panel inline, so a lazy per-subject fetch
  // would only mean the two sections flickering in under a card already on
  // screen. `profileNotes` backs the link picker — the profile's notes, read
  // once, re-read after a link changes nothing about them (a link is not a
  // note). One shared error line per section, cleared on the next attempt; the
  // study page has no toast slot for a panel.
  const [materialsBySubject, setMaterialsBySubject] = useState<
    Record<string, SubjectAttachment[]>
  >({});
  const [linkedNotesBySubject, setLinkedNotesBySubject] = useState<Record<string, LinkedNote[]>>(
    {},
  );
  const [profileNotes, setProfileNotes] = useState<NoteMeta[]>([]);
  const [materialError, setMaterialError] = useState<"generic" | "tooLarge" | null>(null);
  const [linkedNoteError, setLinkedNoteError] = useState(false);
  const [attaching, setAttaching] = useState(false);
  // „Pregledaj" (DOC / ADR-064): which material the in-app dialog is showing,
  // and as what. PDF rows never land here — their menu item opens the dedicated
  // window over IPC instead.
  const [materialPreview, setMaterialPreview] = useState<{
    subjectId: string;
    attachment: SubjectAttachment;
    kind: Exclude<AttachmentPreviewKind, "pdf">;
  } | null>(null);

  // „Dnevnik učenja" (STUDY-014). Unlike the two sections above it, this one is
  // NOT kept loaded for every subject: it is collapsed until asked for, and
  // only one subject's log is open at a time (the plan card's `expandedPlanId`
  // idiom). The panel is already long, and a log nobody opened is a query
  // nobody needed.
  //
  // `expandedLog` carries the whole request — which subject, and how far back.
  // „Prikaži još" moves `fromDay` and the effect below re-reads the WIDENED
  // window in one call, so there are no pages to stitch and what is on screen
  // is always exactly one store answer. `logRevision` is that same request
  // asked again, bumped by the writes that can move a log while it is open.
  const [expandedLog, setExpandedLog] = useState<{ subjectId: string; fromDay: string } | null>(
    null,
  );
  const [logRevision, setLogRevision] = useState(0);
  const [logDays, setLogDays] = useState<StudyLogDay[]>([]);
  const [logHasOlder, setLogHasOlder] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logFailed, setLogFailed] = useState(false);

  // The deck form mirrors the exam form's idiom exactly (inline reveal, one
  // subject at a time).
  const [deckFormSubjectId, setDeckFormSubjectId] = useState<string | null>(null);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [deckName, setDeckName] = useState("");
  const [pendingUndoDeckId, setPendingUndoDeckId] = useState<string | null>(null);

  // Study plans (Planovi učenja): every plan's blocks are kept loaded so each
  // card can show its progress; expansion is a pure UI toggle. The plan form is
  // one inline reveal (exam/deck idiom); a non-null editingPlanId means
  // "editing that plan" — its exam is fixed (PlanFieldChanges carries no examId).
  const [plans, setPlans] = useState<StudyPlan[] | null>(null);
  const [todayBlocks, setTodayBlocks] = useState<StudyBlockWithExam[] | null>(null);
  const [blocksByPlan, setBlocksByPlan] = useState<Record<string, StudyBlock[]>>({});
  // One honesty report per plan (ADR-063 invariant 5), from the same
  // `syncAllPlans` call that labels missed blocks — the health line's source.
  const [planHealthById, setPlanHealthById] = useState<Record<string, PlanHealth>>({});
  // The exams' topic lists (ADR-063), keyed by exam id: loaded for every plan's
  // exam (block rows name their topic; recall rows deep-link its deck) and for
  // whichever exam the plan form is showing. Every topics:* mutation answers
  // with the exam's fresh effective list, which lands back here.
  const [topicsByExam, setTopicsByExam] = useState<Record<string, ExamTopic[]>>({});
  const [topicActionFailed, setTopicActionFailed] = useState(false);
  const [topicName, setTopicName] = useState("");
  // The „Predlog skraćenja" dialog (STUDY-004): which plan, the fetched
  // proposal (null while in flight), and whether the fetch/accept failed.
  const [scopeCut, setScopeCut] = useState<{
    planId: string;
    proposal: ScopeCutProposal | null;
    failed: boolean;
  } | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [planFormVisible, setPlanFormVisible] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planExamId, setPlanExamId] = useState("");
  const [planStartDate, setPlanStartDate] = useState("");
  const [planMinutes, setPlanMinutes] = useState("60");
  const [planBoost, setPlanBoost] = useState(true);
  // The seven Mon..Sun inputs (ADR-063), or null while they still MIRROR
  // „Minuta dnevno" — the quiet idiom: no toggle, the inputs follow the scalar
  // until touched, and an all-equal week saves back as the scalar (NULL vector
  // = "svaki dan isto").
  const [planWeekdays, setPlanWeekdays] = useState<string[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [pendingUndoPlanId, setPendingUndoPlanId] = useState<string | null>(null);
  // Set when a plan restore fails — unlike the other restore paths, a stale
  // plan-undo offer can never succeed on retry (see `undoPlan`), so it is
  // cleared and replaced by a visible message in the same toast slot.
  const [planUndoError, setPlanUndoError] = useState<string | null>(null);

  // Study stats + focus timer (Statistika i fokus, STUDY piece 4b). `statsYear`
  // covers the last 365 days (streak only — a streak longer than that window
  // simply caps there); `statsRecent` covers the last 30 days and backs every
  // other summary. `focusRunning` is restored on mount via `focusStatus` (the
  // timer lives in the main process, so it survives navigation but not an app
  // restart); `focusElapsedMs` is a display-only tick derived from it.
  const [focusRunning, setFocusRunning] = useState<RunningFocusSession | null>(null);
  const [focusSubjectId, setFocusSubjectId] = useState("");
  const [focusElapsedMs, setFocusElapsedMs] = useState(0);
  const [statsYear, setStatsYear] = useState<StudyStats | null>(null);
  const [statsRecent, setStatsRecent] = useState<StudyStats | null>(null);
  const [focusSessions, setFocusSessions] = useState<FocusSession[] | null>(null);
  const [pendingUndoFocusId, setPendingUndoFocusId] = useState<string | null>(null);
  // „Odbaci" writes nothing at all and offers no undo afterwards — the same
  // running phase „Fokus" shows, so it asks the same confirm that page does.
  const [confirmingFocusDiscard, setConfirmingFocusDiscard] = useState(false);

  // Internal routing: the hub, a deck's card-management drill-in, or a review
  // session. No router — a discriminated union kept in component state. A
  // review arm carries the wire scope AND, for a practice session, the
  // renderer-only config the scope cannot express (ADR-047).
  const [route, setRoute] = useState<
    | { kind: "hub" }
    | { kind: "deck"; deckId: string }
    | { kind: "review"; scope: ReviewQueueScope; practice: PracticeConfig | null }
  >({ kind: "hub" });
  const activeDeckId = route.kind === "deck" ? route.deckId : null;
  /** Which subject's „Vežbaj" dialog is open, or null (ADR-047). */
  const [practiceSubjectId, setPracticeSubjectId] = useState<string | null>(null);

  const [cards, setCards] = useState<Card[] | null>(null);
  const [cardsFailed, setCardsFailed] = useState(false);
  const [cardFormVisible, setCardFormVisible] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardFront, setCardFront] = useState("");
  const [cardBack, setCardBack] = useState("");
  const [cardDeckId, setCardDeckId] = useState("");
  // Which form the card editor is showing (ADR-042 / ADR-046). Free to switch
  // while adding. While EDITING, a cloze card's form is pinned — a card cannot
  // change kind, because its FSRS history belongs to the question it has been
  // asking — but Osnovna and Zadatak may be switched between freely: both are
  // kind `basic`, so adding or dropping a worked solution changes what the row
  // shows, never what it is.
  const [cardForm, setCardForm] = useState<CardForm>("basic");
  const [clozeText, setClozeText] = useState("");
  // The cloze field itself, and the selection „Dodaj prazninu" wants restored
  // once React has written the new template into it (see `addClozeBlank`).
  const clozeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingClozeSelection = useRef<{ from: number; to: number } | null>(null);
  const [problemSteps, setProblemSteps] = useState("");
  // Inline, in-form failure text (the store's refusal to drop this card's own
  // deletion, or any other save failure) — the study page has no toast slot
  // for a form, and a silent console error would look like a dead button.
  const [cardFormError, setCardFormError] = useState<string | null>(null);
  const [pendingUndoCardId, setPendingUndoCardId] = useState<string | null>(null);
  // What the cloze text currently makes, read by the SAME grammar the store
  // derives the rows with, so the live line can never promise a count the store
  // would not produce. Blanks and cards are two numbers since ADR-068: two runs
  // carrying one number are one card with two blanks.
  const clozeRuns = findClozeRuns(clozeText.trim());
  const clozeBlankCount = clozeRuns.length;
  const clozeCardNumbers = clozeNumbers(clozeRuns);
  // Likewise for the problem form: the SAME grammar the store derives `back`
  // with, so the live count and preview can never promise a card the store
  // would refuse.
  const problemStepList = splitProblemSteps(problemSteps);
  const problemStepCount = problemStepList.length;
  // Lazily loaded id -> title map backing the note-source link control
  // (ADR-017); stays empty, and unfetched, for a deck with no generated cards.
  const [noteTitles, setNoteTitles] = useState<Map<string, string>>(new Map());

  // Puts the caret back on the answer „Dodaj prazninu" just wrapped, once the
  // new template is actually in the field. No dependency array on purpose: the
  // ref is a one-shot handoff, cleared the moment it is honoured.
  useLayoutEffect(() => {
    const pending = pendingClozeSelection.current;
    const field = clozeTextareaRef.current;
    if (pending === null || field === null) return;
    pendingClozeSelection.current = null;
    field.focus();
    field.setSelectionRange(pending.from, pending.to);
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Sync every plan before any read so past blocks are already labelled
        // `missed` when the today strip and the plan lists render; the same
        // call answers each plan's honesty report (ADR-063 invariant 5).
        const nextHealths = await window.nexus.syncAllPlans(profileId);
        const today = localTodayKey();
        const [
          nextSubjects,
          nextExams,
          nextDecks,
          nextCounts,
          nextPlans,
          nextTodayBlocks,
          nextFocusRunning,
          nextStatsYear,
          nextStatsRecent,
          nextFocusSessions,
        ] = await Promise.all([
          window.nexus.listSubjects(profileId),
          window.nexus.listExams(profileId),
          window.nexus.listDecks(profileId),
          window.nexus.cardCounts(profileId),
          window.nexus.listPlans(profileId),
          window.nexus.listBlocksInRange(profileId, today, today),
          window.nexus.focusStatus(profileId),
          // 365-day window for the streak only — a streak longer than that caps at it.
          window.nexus.studyStats(profileId, shiftDayKey(today, -365), today),
          window.nexus.studyStats(profileId, shiftDayKey(today, -29), today),
          window.nexus.listFocusRange(profileId, shiftDayKey(today, -6), today),
        ]);
        // Both fan-outs wait on the list they key off — plans for their blocks,
        // active subjects for their materials and linked notes (STUDY-001).
        // Archived subjects are skipped: the hub draws them as flat rows with no
        // panel, so their two sections have nowhere to appear.
        const openSubjects = nextSubjects.filter((subject) => !subject.archived);
        const [blockLists, topicLists, materialLists, linkedLists, nextNotes] = await Promise.all([
          Promise.all(nextPlans.map((plan) => window.nexus.listBlocksByPlan(profileId, plan.id))),
          // Each plan exam's topics (ADR-063): block rows name their topic, and
          // a recall row deep-links its topic's deck.
          Promise.all(nextPlans.map((plan) => window.nexus.listExamTopics(profileId, plan.examId))),
          Promise.all(
            openSubjects.map((subject) =>
              window.nexus.listSubjectAttachments(profileId, subject.id),
            ),
          ),
          Promise.all(
            openSubjects.map((subject) =>
              window.nexus.listSubjectLinkedNotes(profileId, subject.id),
            ),
          ),
          window.nexus.listNotes(profileId),
        ]);
        if (!active) return;
        setSubjects(nextSubjects);
        setMaterialsBySubject(
          Object.fromEntries(
            openSubjects.map((subject, index) => [subject.id, materialLists[index] ?? []]),
          ),
        );
        setLinkedNotesBySubject(
          Object.fromEntries(
            openSubjects.map((subject, index) => [subject.id, linkedLists[index] ?? []]),
          ),
        );
        setProfileNotes(nextNotes);
        setExams(nextExams);
        setDecks(nextDecks);
        setDeckCounts(nextCounts);
        setPlans(nextPlans);
        setTodayBlocks(nextTodayBlocks);
        setBlocksByPlan(
          Object.fromEntries(nextPlans.map((plan, index) => [plan.id, blockLists[index] ?? []])),
        );
        setPlanHealthById(
          Object.fromEntries(nextHealths.map((health) => [health.planId, health])),
        );
        setTopicsByExam(
          Object.fromEntries(nextPlans.map((plan, index) => [plan.examId, topicLists[index] ?? []])),
        );
        setFocusRunning(nextFocusRunning);
        setStatsYear(nextStatsYear);
        setStatsRecent(nextStatsRecent);
        setFocusSessions(nextFocusSessions);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load study data:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // Consumes a pending deep-link (021-e): reveals one study entity that a
  // global-search result pointed at. Keyed on the intent plus every list and
  // piece of navigation state the branches below read, rather than mount, so
  // a search fired while STUDY is already open retriggers this exactly like
  // one that switches modules here does, and a load race (the target arrives
  // before the relevant list has fetched, or before a route/section switch
  // has taken effect) resolves itself once that state changes instead of
  // being dropped.
  useEffect(() => {
    if (!intent) return;

    if (intent.entity === "card") {
      // A card only exists inside its deck's drill-in.
      if (intent.parentId === null) {
        onIntentHandled?.(); // nothing to navigate into
        return;
      }
      if (route.kind !== "deck" || route.deckId !== intent.parentId) {
        setRoute({ kind: "deck", deckId: intent.parentId });
        return; // re-runs once the drill-in has switched; the card-loading effect fetches `cards`
      }
      if (cards === null) return; // still loading — wait rather than deciding it's missing
      const card = cards.find((c) => c.id === intent.id);
      if (!card) {
        onIntentHandled?.(); // deleted between indexing and clicking
        return;
      }
      reveal(card.id);
      scrollRevealedIntoView(studyRowDomId(card.id));
      onIntentHandled?.();
      return;
    }

    // subject / exam / deck all live on the hub.
    if (route.kind !== "hub") {
      setRoute({ kind: "hub" });
      return;
    }
    if (subjects === null) return; // still loading — wait rather than deciding it's missing

    if (intent.entity === "subject") {
      const subject = subjects.find((s) => s.id === intent.id);
      if (!subject) {
        onIntentHandled?.(); // deleted between indexing and clicking
        return;
      }
      if (subject.archived && !archivedOpen) {
        setArchivedOpen(true);
        return; // re-runs once the archived section is open
      }
      reveal(subject.id);
      scrollRevealedIntoView(studyRowDomId(subject.id));
      onIntentHandled?.();
      return;
    }

    if (intent.entity === "exam") {
      if (exams === null) return; // still loading — wait rather than deciding it's missing
      const exam = exams.find((e) => e.id === intent.id);
      if (!exam) {
        onIntentHandled?.(); // deleted between indexing and clicking
        return;
      }
      // An exam only renders inside its subject's ACTIVE card — an archived
      // subject renders as a flat row with no exams — so unlike the subject
      // branch above, opening the archived section cannot make this exam
      // appear. The hub is still the right landing spot; there is just
      // nothing to reveal.
      const parentSubject = subjects.find((s) => s.id === intent.parentId);
      if (parentSubject?.archived) {
        onIntentHandled?.();
        return;
      }
      reveal(exam.id);
      scrollRevealedIntoView(studyRowDomId(exam.id));
      onIntentHandled?.();
      return;
    }

    // deck — same shape as exam above (a deck of an archived subject has
    // nothing to reveal either, for the same reason).
    if (decks === null) return; // still loading — wait rather than deciding it's missing
    const deck = decks.find((d) => d.id === intent.id);
    if (!deck) {
      onIntentHandled?.(); // deleted between indexing and clicking
      return;
    }
    const parentSubject = subjects.find((s) => s.id === intent.parentId);
    if (parentSubject?.archived) {
      onIntentHandled?.();
      return;
    }
    reveal(deck.id);
    scrollRevealedIntoView(studyRowDomId(deck.id));
    onIntentHandled?.();
  }, [intent, subjects, exams, decks, cards, route, archivedOpen, reveal, onIntentHandled]);

  // Live elapsed readout for a running focus timer: ticks once a second,
  // display-only (the store never sees this value). Restarts whenever a fresh
  // timer starts and clears on stop/unmount.
  //
  // Through `phaseProgress` rather than off `startedAt` since UTIL slice b: the
  // running phase can be PAUSED now (from „Fokus", which shares this timer), and
  // a clock that kept climbing through a pause would be reporting attention
  // nobody was paying. The engine freezes it at `pausedAt` for free.
  useEffect(() => {
    if (!focusRunning) {
      setFocusElapsedMs(0);
      return;
    }
    const read = (): void => {
      setFocusElapsedMs(phaseProgress(focusRunning, new Date().toISOString()).elapsedSeconds * 1000);
    };
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, [focusRunning]);

  // The plan form's topics editor needs ITS exam's list even when no plan
  // exists yet (a new plan's exam has no cached entry) — fetched once per
  // exam and kept; the `topicsByExam[examId]` guard is what stops the
  // set-state from re-triggering this effect into a loop.
  const formExamId = planFormVisible
    ? editingPlanId != null
      ? (plans?.find((plan) => plan.id === editingPlanId)?.examId ?? "")
      : planExamId
    : "";
  useEffect(() => {
    if (formExamId === "" || topicsByExam[formExamId] !== undefined) return;
    let active = true;
    void (async () => {
      try {
        const list = await window.nexus.listExamTopics(profileId, formExamId);
        if (active) setTopicsByExam((previous) => ({ ...previous, [formExamId]: list }));
      } catch (error) {
        console.error("Nexus: failed to load exam topics:", error);
        if (active) setTopicActionFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [formExamId, topicsByExam, profileId]);

  // The open subject's „Dnevnik učenja" (STUDY-014). Keyed on the request's own
  // fields rather than the object holding them, so only a real change re-reads.
  // The rows already on screen are deliberately left up while a widened window
  // loads — „Prikaži još" must extend the list, not blank it — and the range
  // always ends TODAY: the log is what has happened, and everything ahead of
  // now already has the countdown chips and the plan cards above it.
  const logSubjectId = expandedLog?.subjectId ?? null;
  const logFromDay = expandedLog?.fromDay ?? null;
  useEffect(() => {
    if (logSubjectId === null || logFromDay === null) return;
    let active = true;
    setLogLoading(true);
    setLogFailed(false);
    void (async () => {
      try {
        const log = await window.nexus.subjectStudyLog(
          profileId,
          logSubjectId,
          logFromDay,
          localTodayKey(),
        );
        if (!active) return;
        setLogDays(log.days);
        setLogHasOlder(log.hasOlder);
      } catch (error) {
        if (active) setLogFailed(true);
        console.error("Nexus: failed to load the study log:", error);
      } finally {
        if (active) setLogLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, logSubjectId, logFromDay, logRevision]);

  useEffect(() => {
    if (activeDeckId == null) return;
    let active = true;
    setCards(null);
    setCardsFailed(false);
    void (async () => {
      try {
        const list = await window.nexus.listCardsByDeck(profileId, activeDeckId);
        // Note titles for the source-link control, fetched only when this deck
        // actually holds a note-sourced card — so a profile with no generated
        // cards never pays for the query — and resolved BEFORE the rows are
        // handed to render, so a generated card never flashes "(nedostupna)"
        // in the gap between the two reads. A failed fetch keeps the previous
        // map: derived, read-only data, never an error banner.
        if (list.some((card) => card.sourceNoteId !== null)) {
          try {
            const notes = await window.nexus.listNotes(profileId);
            if (active) setNoteTitles(new Map(notes.map((note) => [note.id, note.title])));
          } catch (error) {
            console.error("Nexus: failed to load note titles:", error);
          }
        }
        if (active) setCards(list);
      } catch (error) {
        if (active) setCardsFailed(true);
        console.error("Nexus: failed to load cards:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, activeDeckId]);

  /**
   * The subject list plus the two panels that hang off it. Both are re-read
   * because the only caller is the delete-undo: a restored subject comes back
   * still carrying its materials and its note links (migration 035 keeps both
   * through a soft delete), and a list refresh alone would draw it with two
   * empty sections.
   */
  async function reloadSubjects(): Promise<void> {
    const nextSubjects = await window.nexus.listSubjects(profileId);
    setSubjects(nextSubjects);
    const openSubjects = nextSubjects.filter((subject) => !subject.archived);
    const [materialLists, linkedLists] = await Promise.all([
      Promise.all(
        openSubjects.map((subject) => window.nexus.listSubjectAttachments(profileId, subject.id)),
      ),
      Promise.all(
        openSubjects.map((subject) => window.nexus.listSubjectLinkedNotes(profileId, subject.id)),
      ),
    ]);
    setMaterialsBySubject(
      Object.fromEntries(
        openSubjects.map((subject, index) => [subject.id, materialLists[index] ?? []]),
      ),
    );
    setLinkedNotesBySubject(
      Object.fromEntries(
        openSubjects.map((subject, index) => [subject.id, linkedLists[index] ?? []]),
      ),
    );
  }

  async function reloadExams(): Promise<void> {
    setExams(await window.nexus.listExams(profileId));
  }

  async function reloadDecks(): Promise<void> {
    setDecks(await window.nexus.listDecks(profileId));
  }

  async function reloadDeckCounts(): Promise<void> {
    setDeckCounts(await window.nexus.cardCounts(profileId));
  }

  async function reloadCards(deckId: string): Promise<void> {
    setCards(await window.nexus.listCardsByDeck(profileId, deckId));
  }

  function resetSubjectForm(): void {
    setEditingSubjectId(null);
    setSubjectName("");
    setSubjectColor("jade");
    setSubjectSemester("");
  }

  function startEditSubject(subject: Subject): void {
    setEditingSubjectId(subject.id);
    setSubjectName(subject.name);
    setSubjectColor(subject.color);
    setSubjectSemester(subject.semester ?? "");
    nameRef.current?.focus();
  }

  async function submitSubjectForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedName = subjectName.trim();
    if (trimmedName.length === 0) return;
    const trimmedSemester = subjectSemester.trim();

    try {
      if (editingSubjectId != null) {
        const changes: SubjectFieldChanges = {
          name: trimmedName,
          color: subjectColor,
          semester: trimmedSemester.length > 0 ? trimmedSemester : null,
        };
        const updated = await window.nexus.updateSubject(profileId, editingSubjectId, changes);
        setSubjects((prev) => prev && prev.map((s) => (s.id === updated.id ? updated : s)));
        resetSubjectForm();
      } else {
        const fields: NewSubjectFields = { name: trimmedName, color: subjectColor };
        // Only send semester when present (exactOptionalPropertyTypes).
        if (trimmedSemester.length > 0) fields.semester = trimmedSemester;
        const created = await window.nexus.createSubject(profileId, fields);
        setSubjects((prev) => (prev ? [...prev, created] : [created]));
        resetSubjectForm();
        nameRef.current?.focus();
      }
    } catch (error) {
      console.error("Nexus: failed to save subject:", error);
    }
  }

  async function toggleArchived(subject: Subject): Promise<void> {
    try {
      const updated = await window.nexus.updateSubject(profileId, subject.id, {
        archived: !subject.archived,
      });
      setSubjects((prev) => prev && prev.map((s) => (s.id === updated.id ? updated : s)));
      // Coming BACK from the archive needs its two panels, which the initial
      // load deliberately skipped (an archived subject draws none) — without
      // this the restored card would show empty sections for a subject that
      // actually holds materials and linked notes.
      if (!updated.archived) {
        await Promise.all([reloadMaterials(updated.id), reloadLinkedNotes(updated.id)]);
      }
    } catch (error) {
      console.error("Nexus: failed to (un)archive subject:", error);
    }
  }

  async function removeSubject(subject: Subject): Promise<void> {
    setActionError(null);
    try {
      await window.nexus.deleteSubject(profileId, subject.id);
      setSubjects((prev) => prev && prev.filter((s) => s.id !== subject.id));
      // Never leave a form, or the deck view, bound to a gone subject.
      if (editingSubjectId === subject.id) resetSubjectForm();
      if (examFormSubjectId === subject.id) closeExamForm();
      if (deckFormSubjectId === subject.id) closeDeckForm();
      if (route.kind === "deck") {
        const openDeck = decks?.find((d) => d.id === route.deckId);
        if (openDeck?.subjectId === subject.id) setRoute({ kind: "hub" });
      }
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoSubjectId(subject.id);
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to delete subject:", error);
    }
  }

  async function undoSubject(): Promise<void> {
    if (!pendingUndoSubjectId) return;
    setActionError(null);
    try {
      await window.nexus.restoreSubject(profileId, pendingUndoSubjectId);
      setPendingUndoSubjectId(null);
      await reloadSubjects();
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to restore subject:", error);
    }
  }

  // --- Materijali + Povezane beleške (STUDY-001, migration 035) -------------
  //
  // The TASK page's „Prilozi" recipe, one module over: every write is
  // await-then-refetch (the house style) and MAIN owns the file dialog — the
  // renderer never sees a path or a byte. Only the touched subject is re-read,
  // since nothing a write here does can change another subject's rows.

  async function reloadMaterials(subjectId: string): Promise<void> {
    const rows = await window.nexus.listSubjectAttachments(profileId, subjectId);
    setMaterialsBySubject((prev) => ({ ...prev, [subjectId]: rows }));
  }

  async function reloadLinkedNotes(subjectId: string): Promise<void> {
    const rows = await window.nexus.listSubjectLinkedNotes(profileId, subjectId);
    setLinkedNotesBySubject((prev) => ({ ...prev, [subjectId]: rows }));
  }

  /**
   * Opens the native picker and attaches whatever comes back. A canceled dialog
   * changes nothing and says nothing; files refused for size are reported, since
   * a picker that silently dropped one would look like a bug.
   */
  async function attachMaterials(subjectId: string): Promise<void> {
    if (attaching) return;
    setAttaching(true);
    setMaterialError(null);
    try {
      const result = await window.nexus.attachSubjectFiles(profileId, subjectId);
      if (result.canceled) return;
      if (result.skippedTooLarge > 0) setMaterialError("tooLarge");
      await reloadMaterials(subjectId);
    } catch (error) {
      setMaterialError("generic");
      console.error("Nexus: failed to attach subject materials:", error);
    } finally {
      setAttaching(false);
    }
  }

  /** The PDF half of „Pregledaj" (ADR-064): asks main to open the dedicated preview window — the renderer names ids only. */
  async function previewPdfMaterial(subjectId: string, attachmentId: string): Promise<void> {
    try {
      await window.nexus.previewAttachment(profileId, "subject", subjectId, attachmentId);
    } catch (error) {
      setMaterialError("generic");
      console.error("Nexus: failed to preview subject material:", error);
    }
  }

  async function openMaterial(subjectId: string, attachmentId: string): Promise<void> {
    try {
      await window.nexus.openSubjectAttachment(profileId, subjectId, attachmentId);
    } catch (error) {
      setMaterialError("generic");
      console.error("Nexus: failed to open subject material:", error);
    }
  }

  async function saveMaterialAs(subjectId: string, attachmentId: string): Promise<void> {
    try {
      await window.nexus.saveSubjectAttachmentAs(profileId, subjectId, attachmentId);
    } catch (error) {
      setMaterialError("generic");
      console.error("Nexus: failed to save subject material:", error);
    }
  }

  async function removeMaterial(subjectId: string, attachmentId: string): Promise<void> {
    setMaterialError(null);
    try {
      await window.nexus.removeSubjectAttachment(profileId, subjectId, attachmentId);
      await reloadMaterials(subjectId);
    } catch (error) {
      setMaterialError("generic");
      console.error("Nexus: failed to remove subject material:", error);
    }
  }

  async function linkNote(subjectId: string, noteId: string): Promise<void> {
    setLinkedNoteError(false);
    try {
      await window.nexus.linkSubjectNote(profileId, subjectId, noteId);
      await reloadLinkedNotes(subjectId);
    } catch (error) {
      setLinkedNoteError(true);
      console.error("Nexus: failed to link note to subject:", error);
    }
  }

  async function unlinkNote(subjectId: string, noteId: string): Promise<void> {
    setLinkedNoteError(false);
    try {
      await window.nexus.unlinkSubjectNote(profileId, subjectId, noteId);
      await reloadLinkedNotes(subjectId);
    } catch (error) {
      setLinkedNoteError(true);
      console.error("Nexus: failed to unlink note from subject:", error);
    }
  }

  function closeExamForm(): void {
    setExamFormSubjectId(null);
    setEditingExamId(null);
    setExamType("pismeni");
    setExamDate("");
    setExamScope("");
  }

  function startAddExam(subjectId: string): void {
    setExamFormSubjectId(subjectId);
    setEditingExamId(null);
    setExamType("pismeni");
    setExamDate("");
    setExamScope("");
  }

  function startEditExam(exam: Exam): void {
    setExamFormSubjectId(exam.subjectId);
    setEditingExamId(exam.id);
    setExamType(exam.examType);
    setExamDate(exam.examDate.slice(0, 10));
    setExamScope(exam.scope ?? "");
  }

  async function submitExamForm(
    event: FormEvent<HTMLFormElement>,
    subjectId: string,
  ): Promise<void> {
    event.preventDefault();
    if (examDate.length === 0) return;
    const trimmedScope = examScope.trim();

    try {
      if (editingExamId != null) {
        const changes: ExamFieldChanges = {
          examType,
          examDate,
          scope: trimmedScope.length > 0 ? trimmedScope : null,
        };
        const updated = await window.nexus.updateExam(profileId, editingExamId, changes);
        setExams((prev) => prev && prev.map((e) => (e.id === updated.id ? updated : e)));
      } else {
        const fields: NewExamFields = { subjectId, examType, examDate };
        // Only send scope when present (exactOptionalPropertyTypes).
        if (trimmedScope.length > 0) fields.scope = trimmedScope;
        const created = await window.nexus.createExam(profileId, fields);
        setExams((prev) => (prev ? [...prev, created] : [created]));
      }
      closeExamForm();
    } catch (error) {
      console.error("Nexus: failed to save exam:", error);
    }
  }

  async function removeExam(exam: Exam): Promise<void> {
    setActionError(null);
    try {
      await window.nexus.deleteExam(profileId, exam.id);
      setExams((prev) => prev && prev.filter((e) => e.id !== exam.id));
      if (editingExamId === exam.id) closeExamForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoExamId(exam.id);
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to delete exam:", error);
    }
  }

  async function undoExam(): Promise<void> {
    if (!pendingUndoExamId) return;
    setActionError(null);
    try {
      await window.nexus.restoreExam(profileId, pendingUndoExamId);
      setPendingUndoExamId(null);
      await reloadExams();
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to restore exam:", error);
    }
  }

  function closeDeckForm(): void {
    setDeckFormSubjectId(null);
    setEditingDeckId(null);
    setDeckName("");
  }

  function startAddDeck(subjectId: string): void {
    setDeckFormSubjectId(subjectId);
    setEditingDeckId(null);
    setDeckName("");
  }

  function startEditDeck(deck: Deck): void {
    setDeckFormSubjectId(deck.subjectId);
    setEditingDeckId(deck.id);
    setDeckName(deck.name);
  }

  async function submitDeckForm(
    event: FormEvent<HTMLFormElement>,
    subjectId: string,
  ): Promise<void> {
    event.preventDefault();
    const trimmedName = deckName.trim();
    if (trimmedName.length === 0) return;

    try {
      if (editingDeckId != null) {
        const changes: DeckFieldChanges = { name: trimmedName };
        const updated = await window.nexus.updateDeck(profileId, editingDeckId, changes);
        setDecks((prev) => prev && prev.map((d) => (d.id === updated.id ? updated : d)));
      } else {
        const fields: NewDeckFields = { subjectId, name: trimmedName };
        const created = await window.nexus.createDeck(profileId, fields);
        setDecks((prev) => (prev ? [...prev, created] : [created]));
        await reloadDeckCounts();
      }
      closeDeckForm();
    } catch (error) {
      console.error("Nexus: failed to save deck:", error);
    }
  }

  async function removeDeck(deck: Deck): Promise<void> {
    setActionError(null);
    try {
      await window.nexus.deleteDeck(profileId, deck.id);
      setDecks((prev) => prev && prev.filter((d) => d.id !== deck.id));
      if (editingDeckId === deck.id) closeDeckForm();
      if (route.kind === "deck" && route.deckId === deck.id) setRoute({ kind: "hub" });
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoDeckId(deck.id);
      await reloadDeckCounts();
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to delete deck:", error);
    }
  }

  async function undoDeck(): Promise<void> {
    if (!pendingUndoDeckId) return;
    setActionError(null);
    try {
      await window.nexus.restoreDeck(profileId, pendingUndoDeckId);
      setPendingUndoDeckId(null);
      await Promise.all([reloadDecks(), reloadDeckCounts()]);
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to restore deck:", error);
    }
  }

  /**
   * Re-syncs every plan (missed labelling + fresh health reports), then
   * re-fetches plans, the today strip, each plan's blocks and each plan
   * exam's topics. Topic lists are MERGED over the cache rather than
   * replacing it, so an exam the form is showing for a not-yet-created plan
   * keeps its loaded list.
   */
  async function refreshPlans(): Promise<void> {
    const nextHealths = await window.nexus.syncAllPlans(profileId);
    const today = localTodayKey();
    const [nextPlans, nextTodayBlocks] = await Promise.all([
      window.nexus.listPlans(profileId),
      window.nexus.listBlocksInRange(profileId, today, today),
    ]);
    const [blockLists, topicLists] = await Promise.all([
      Promise.all(nextPlans.map((plan) => window.nexus.listBlocksByPlan(profileId, plan.id))),
      Promise.all(nextPlans.map((plan) => window.nexus.listExamTopics(profileId, plan.examId))),
    ]);
    setPlans(nextPlans);
    setTodayBlocks(nextTodayBlocks);
    setBlocksByPlan(
      Object.fromEntries(nextPlans.map((plan, index) => [plan.id, blockLists[index] ?? []])),
    );
    setPlanHealthById(Object.fromEntries(nextHealths.map((health) => [health.planId, health])));
    setTopicsByExam((previous) => ({
      ...previous,
      ...Object.fromEntries(
        nextPlans.map((plan, index) => [plan.examId, topicLists[index] ?? []]),
      ),
    }));
  }

  function closePlanForm(): void {
    setPlanFormVisible(false);
    setEditingPlanId(null);
    setPlanExamId("");
    setPlanStartDate("");
    setPlanMinutes("60");
    setPlanBoost(true);
    setPlanWeekdays(null);
    setPlanError(null);
    setTopicName("");
    setTopicActionFailed(false);
  }

  function startAddPlan(firstExamId: string): void {
    setPlanFormVisible(true);
    setEditingPlanId(null);
    setPlanExamId(firstExamId);
    setPlanStartDate(localTodayKey());
    setPlanMinutes("60");
    setPlanBoost(true);
    setPlanWeekdays(null);
    setPlanError(null);
    setTopicName("");
    setTopicActionFailed(false);
  }

  function startEditPlan(plan: StudyPlan): void {
    setPlanFormVisible(true);
    setEditingPlanId(plan.id);
    setPlanExamId(plan.examId);
    setPlanStartDate(plan.startDate.slice(0, 10));
    setPlanMinutes(String(plan.dailyMinutes));
    setPlanBoost(plan.examWeekBoost);
    // A stored vector opens materialized; without one the inputs keep
    // mirroring „Minuta dnevno" until touched.
    setPlanWeekdays(plan.weekdayMinutes === null ? null : plan.weekdayMinutes.map(String));
    setPlanError(null);
    setTopicName("");
    setTopicActionFailed(false);
  }

  async function submitPlanForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (planStartDate.length === 0) return;
    const dailyMinutes = Number(planMinutes);
    // Client-side parity with PlanStore's 15–480 range (UX only; main revalidates).
    if (
      !Number.isInteger(dailyMinutes) ||
      dailyMinutes < MIN_PLAN_MINUTES ||
      dailyMinutes > MAX_PLAN_MINUTES
    ) {
      setPlanError(strings.study.planError.minutesRange);
      return;
    }
    // Untouched inputs never send a vector; touched ones must parse under the
    // store's own rule, and an all-equal week collapses back onto the scalar.
    let weekdayMinutes: number[] | null | undefined;
    if (planWeekdays !== null) {
      const vector = parseWeekdayMinutes(planWeekdays);
      if (vector === null) {
        setPlanError(strings.study.planError.weekdayRange);
        return;
      }
      weekdayMinutes = weekdayMinutesForSave(vector, dailyMinutes);
    }

    try {
      if (editingPlanId != null) {
        const changes: PlanFieldChanges = {
          dailyMinutes,
          startDate: planStartDate,
          examWeekBoost: planBoost,
        };
        if (weekdayMinutes !== undefined) changes.weekdayMinutes = weekdayMinutes;
        await window.nexus.updatePlan(profileId, editingPlanId, changes);
      } else {
        if (planExamId.length === 0) return;
        const fields: NewPlanFields = {
          examId: planExamId,
          dailyMinutes,
          startDate: planStartDate,
          examWeekBoost: planBoost,
        };
        if (weekdayMinutes !== undefined) fields.weekdayMinutes = weekdayMinutes;
        await window.nexus.createPlan(profileId, fields);
      }
      closePlanForm();
      await refreshPlans();
    } catch (error) {
      console.error("Nexus: failed to save study plan:", error);
      setPlanError(planErrorMessage(error));
    }
  }

  async function removePlan(planId: string): Promise<void> {
    setActionError(null);
    try {
      await window.nexus.deletePlan(profileId, planId);
      if (editingPlanId === planId) closePlanForm();
      if (expandedPlanId === planId) setExpandedPlanId(null);
      // One pending undo at a time — a fresh delete replaces the previous offer
      // (and any error left over from a previous restore attempt).
      setPendingUndoPlanId(planId);
      setPlanUndoError(null);
      await refreshPlans();
    } catch (error) {
      // Unlike a failed RESTORE (`undoPlan`), a failed delete has no
      // duplicate-collision cause of its own, so it shares the generic slot
      // rather than `planRestoreError`'s specific copy.
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to delete study plan:", error);
    }
  }

  async function undoPlan(): Promise<void> {
    if (!pendingUndoPlanId) return;
    try {
      await window.nexus.restorePlan(profileId, pendingUndoPlanId);
      setPendingUndoPlanId(null);
      setPlanUndoError(null);
      await refreshPlans();
    } catch (error) {
      // Unlike the other restore paths, this offer can never succeed on a
      // retry — the typical cause is a collision with a newer active plan for
      // the same exam (PlanValidationError) — so the offer is cleared and a
      // visible message takes its place instead of leaving a dead button up.
      console.error("Nexus: failed to restore study plan:", error);
      setPendingUndoPlanId(null);
      setPlanUndoError(planRestoreErrorMessage(error));
    }
  }

  /**
   * Done ↔ planned toggle for a block (a missed block marked done is a late
   * completion). Beyond the optimistic local update, a toggle that changes the
   * plan's missed-minutes backlog — flipping a `missed` block, or reversing a
   * late completion (a `done` block dated before today) — also re-fetches via
   * `refreshPlans()`, so the catch-up replan's redistribution onto future
   * blocks shows immediately instead of waiting for the next mount. A plain
   * future-block toggle never touches the backlog, so it keeps the cheap
   * local-only update.
   */
  async function toggleBlockDone(block: StudyBlock, done: boolean): Promise<void> {
    const previousStatus = block.status;
    try {
      const updated = await window.nexus.setBlockStatus(profileId, block.id, done ? "done" : "planned");
      setTodayBlocks(
        (prev) =>
          prev &&
          prev.map((existing) =>
            existing.id === updated.id
              ? { ...existing, status: updated.status, updatedAt: updated.updatedAt }
              : existing,
          ),
      );
      setBlocksByPlan((prev) => {
        const list = prev[updated.planId];
        if (!list) return prev;
        return {
          ...prev,
          [updated.planId]: list.map((existing) => (existing.id === updated.id ? updated : existing)),
        };
      });
      const reversedLateCompletion = previousStatus === "done" && block.blockDate < localTodayKey();
      if (previousStatus === "missed" || reversedLateCompletion) {
        await refreshPlans();
      }
    } catch (error) {
      console.error("Nexus: failed to set block status:", error);
    }
  }

  /**
   * Pin ↔ unpin toggle for a future block (ADR-063): a pinned block survives
   * regeneration exactly as done/missed rows do. Local-only update — pinning
   * changes what the NEXT sync keeps, never what is on screen now, and sync is
   * idempotent over an unpinned row nothing else moved.
   */
  async function toggleBlockPinned(block: StudyBlock): Promise<void> {
    try {
      const updated = await window.nexus.setBlockPinned(profileId, block.id, !block.pinned);
      setTodayBlocks(
        (prev) =>
          prev &&
          prev.map((existing) =>
            existing.id === updated.id
              ? { ...existing, pinned: updated.pinned, updatedAt: updated.updatedAt }
              : existing,
          ),
      );
      setBlocksByPlan((prev) => {
        const list = prev[updated.planId];
        if (!list) return prev;
        return {
          ...prev,
          [updated.planId]: list.map((existing) => (existing.id === updated.id ? updated : existing)),
        };
      });
    } catch (error) {
      console.error("Nexus: failed to set block pin:", error);
    }
  }

  /**
   * The one „the plan changed" landing: put an exam's fresh EFFECTIVE topic
   * list in the cache, then re-sync the plans so the regenerated blocks and the
   * fresh health arrive with it. Every path that can move a topic's weight in
   * the schedule — the topics editor's writes, the accepted scope cut and its
   * „Vrati u plan" inverse — goes through here, so there is one code path for
   * "the plan changed", not two.
   */
  async function landTopics(examId: string, next: ExamTopic[]): Promise<void> {
    setTopicsByExam((previous) => ({ ...previous, [examId]: next }));
    await refreshPlans();
  }

  /**
   * Runs one topics:* mutation and lands its answer — the exam's fresh
   * effective list — back in the cache, then re-syncs the plans: the exam's
   * schedule is generated FROM its topics, so every topic write can move
   * blocks (a rename cannot, but one uniform path beats a taxonomy of which
   * writes regenerate). One shared error line, cleared on the next attempt.
   */
  async function mutateTopics(examId: string, action: () => Promise<ExamTopic[]>): Promise<void> {
    setTopicActionFailed(false);
    try {
      await landTopics(examId, await action());
    } catch (error) {
      console.error("Nexus: topic action failed:", error);
      setTopicActionFailed(true);
    }
  }

  async function addTopic(examId: string): Promise<void> {
    const trimmed = topicName.trim();
    if (trimmed.length === 0) return;
    await mutateTopics(examId, () => window.nexus.createExamTopic(profileId, examId, trimmed));
    setTopicName("");
  }

  /** Commits an inline rename if the field actually changed; an emptied field quietly restores the name. */
  async function commitTopicRename(topic: ExamTopic, value: string): Promise<void> {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === topic.name) return;
    await mutateTopics(topic.examId, () =>
      window.nexus.renameExamTopic(profileId, topic.id, trimmed),
    );
  }

  /**
   * Opens the „Predlog skraćenja" dialog and fetches the plan's proposal — a
   * pure read (STUDY-004); nothing is cut until the user accepts.
   */
  async function openScopeCut(planId: string): Promise<void> {
    setScopeCut({ planId, proposal: null, failed: false });
    try {
      const proposal = await window.nexus.scopeCutProposal(profileId, planId);
      setScopeCut((current) =>
        current?.planId === planId ? { planId, proposal, failed: false } : current,
      );
    } catch (error) {
      console.error("Nexus: failed to load scope-cut proposal:", error);
      setScopeCut((current) =>
        current?.planId === planId ? { planId, proposal: null, failed: true } : current,
      );
    }
  }

  /** The explicit acceptance — the only path that ever cuts a topic. Re-reads the exam's topics (their `cut` flags moved) and the plans. */
  async function confirmScopeCut(): Promise<void> {
    if (scopeCut === null || scopeCut.proposal === null || scopeCut.proposal.topicIds.length === 0) {
      return;
    }
    const { planId, proposal } = scopeCut;
    const examId = plans?.find((plan) => plan.id === planId)?.examId;
    try {
      await window.nexus.acceptScopeCut(profileId, planId, proposal.topicIds);
      setScopeCut(null);
      if (examId === undefined) {
        await refreshPlans();
      } else {
        await landTopics(examId, await window.nexus.listExamTopics(profileId, examId));
      }
    } catch (error) {
      console.error("Nexus: failed to accept scope cut:", error);
      setScopeCut((current) => (current ? { ...current, failed: true } : current));
    }
  }

  /** Re-fetches both stats windows and the last-7-days focus session list — called after every write that can move them (stop, delete, restore). */
  async function refreshStats(): Promise<void> {
    const today = localTodayKey();
    const [nextStatsYear, nextStatsRecent, nextFocusSessions] = await Promise.all([
      window.nexus.studyStats(profileId, shiftDayKey(today, -365), today),
      window.nexus.studyStats(profileId, shiftDayKey(today, -29), today),
      window.nexus.listFocusRange(profileId, shiftDayKey(today, -6), today),
    ]);
    setStatsYear(nextStatsYear);
    setStatsRecent(nextStatsRecent);
    setFocusSessions(nextFocusSessions);
    // A focus session that just started, ended or came back changes a day of
    // the open study log too (STUDY-014); a closed one has nothing to re-read.
    setLogRevision((revision) => revision + 1);
  }

  /**
   * Opens one subject's „Dnevnik učenja" at the most recent window, or closes
   * the open one. Opening a second subject replaces the first: one log at a
   * time, so the rows on screen always belong to exactly one course.
   */
  function toggleStudyLog(subjectId: string): void {
    setLogDays([]);
    setLogHasOlder(false);
    setLogFailed(false);
    setExpandedLog(
      expandedLog?.subjectId === subjectId
        ? null
        : { subjectId, fromDay: shiftDayKey(localTodayKey(), -(STUDY_LOG_WINDOW_DAYS - 1)) },
    );
  }

  /** Widens the open log by one more window; the effect re-reads the whole range. */
  function extendStudyLog(): void {
    setExpandedLog((current) =>
      current === null
        ? current
        : { ...current, fromDay: shiftDayKey(current.fromDay, -STUDY_LOG_WINDOW_DAYS) },
    );
  }

  /**
   * STUDY's timer, unchanged in BEHAVIOUR and moved onto the unified phase
   * (UTIL slice b): an open-ended, subject-scoped `work` phase — no plan, no
   * cycle, no label. That is exactly the shape `focus:start` had before the
   * channel was widened, spelled out now instead of implied by the payload's
   * silence, and it is why this page needs no other change: the same channel,
   * the same store, the same history.
   *
   * There is deliberately no plan here. „Uči dok ne staneš" is what a study
   * timer is; a Pomodoro is what „Fokus" is for, and putting a plan on this
   * button would quietly make them the same feature with two front doors.
   */
  async function beginFocus(subjectId: string): Promise<void> {
    if (subjectId.length === 0) return;
    setActionError(null);
    try {
      setFocusRunning(await window.nexus.startFocus(profileId, { subjectId, kind: "work" }));
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to start focus timer:", error);
    }
  }

  async function endFocus(): Promise<void> {
    setActionError(null);
    try {
      const result = await window.nexus.stopFocus(profileId);
      setFocusRunning(null);
      if (result != null) await refreshStats();
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to stop focus timer:", error);
    }
  }

  async function discardFocus(): Promise<void> {
    setActionError(null);
    try {
      await window.nexus.cancelFocus(profileId);
      // Only on success: a rejected cancel leaves the phase running in main,
      // and clearing it here regardless (the previous `finally`) would show an
      // idle card over a phase still ticking, unreachable until the page
      // remounts or `focus:status` catches up.
      setFocusRunning(null);
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to discard focus timer:", error);
    }
  }

  async function removeFocusSession(id: string): Promise<void> {
    setActionError(null);
    try {
      await window.nexus.deleteFocus(profileId, id);
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoFocusId(id);
      await refreshStats();
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to delete focus session:", error);
    }
  }

  async function undoFocusSession(): Promise<void> {
    if (!pendingUndoFocusId) return;
    setActionError(null);
    try {
      await window.nexus.restoreFocus(profileId, pendingUndoFocusId);
      setPendingUndoFocusId(null);
      await refreshStats();
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to restore focus session:", error);
    }
  }

  function closeCardForm(): void {
    setCardFormVisible(false);
    setEditingCardId(null);
    setCardFront("");
    setCardBack("");
    setCardDeckId("");
    setCardForm("basic");
    setClozeText("");
    setProblemSteps("");
    setCardFormError(null);
  }

  function startAddCard(deckId: string): void {
    closeCardForm();
    setCardFormVisible(true);
    setCardDeckId(deckId);
  }

  function startEditCard(card: Card): void {
    closeCardForm();
    setCardFormVisible(true);
    setEditingCardId(card.id);
    setCardDeckId(card.deckId);
    // The row decides which form opens; a cloze row then stays in it, while a
    // basic row may be switched between Osnovna and Zadatak (ADR-046).
    setCardForm(formOfCard(card));
    setCardFront(card.front);
    setCardBack(card.back);
    setClozeText(card.clozeText ?? "");
    setProblemSteps(card.problemSteps ?? "");
  }

  async function submitCardForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCardFormError(null);
    try {
      const saved =
        cardForm === "cloze"
          ? await submitClozeCard()
          : cardForm === "problem"
            ? await submitProblemCard()
            : await submitBasicCard();
      if (!saved) return;
      closeCardForm();
      await reloadDeckCounts();
    } catch (error) {
      console.error("Nexus: failed to save card:", error);
      setCardFormError(
        clozeOrdinalGone() ? strings.study.clozeOrdinalMissing : strings.study.saveCardError,
      );
    }
  }

  /**
   * Whether the save failed because the new template no longer contains the
   * deletion this card asks about — the one refusal worth naming in the form
   * (ADR-042). Read off the row's own NUMBER against the numbers the text
   * currently carries (ADR-068), never against the blank count: with explicit
   * labels a three-blank text may carry the numbers 1, 4 and 9, and a card
   * asking 4 is perfectly alive in it.
   */
  function clozeOrdinalGone(): boolean {
    if (cardForm !== "cloze" || editingCardId == null) return false;
    const ordinal = cards?.find((card) => card.id === editingCardId)?.clozeOrdinal;
    return ordinal != null && !clozeCardNumbers.includes(ordinal);
  }

  /**
   * „Dodaj prazninu": wraps the textarea's selection — or, with none, its caret
   * — in a new deletion, numbered by the same `withClozeDeletion` the note
   * editor's own Mod-Shift-C uses (ADR-068), and puts the selection back on the
   * answer so the author can keep typing. A no-op when the selection overlaps a
   * deletion already there, since one cannot nest inside another.
   */
  function addClozeBlank(): void {
    const field = clozeTextareaRef.current;
    if (!field) return;
    const next = withClozeDeletion(field.value, field.selectionStart, field.selectionEnd);
    if (next === null) return;
    setClozeText(next.text);
    // Handed to the layout effect below rather than set here: the field still
    // holds the OLD value at this point, and a range set against it would land
    // somewhere else entirely once React writes the new one.
    pendingClozeSelection.current = { from: next.from, to: next.to };
  }

  /** Creates or updates a plain front/back card. Returns false when the form is not yet submittable. */
  async function submitBasicCard(): Promise<boolean> {
    const trimmedFront = cardFront.trim();
    const trimmedBack = cardBack.trim();
    if (trimmedFront.length === 0 || trimmedBack.length === 0) return false;
    if (trimmedFront.length > CARD_TEXT_MAX_LENGTH || trimmedBack.length > CARD_TEXT_MAX_LENGTH) {
      return false;
    }

    if (editingCardId != null) {
      // `problemSteps: null` is what makes Zadatak → Osnovna a real switch: it
      // clears the worked solution, leaving the derived answer as an ordinary
      // hand-edited back. Harmless on a card that never had one.
      const changes: CardFieldChanges = {
        deckId: cardDeckId,
        front: trimmedFront,
        back: trimmedBack,
        problemSteps: null,
      };
      applyUpdatedCard(await window.nexus.updateCard(profileId, editingCardId, changes));
    } else {
      const fields: NewCardFields = { deckId: cardDeckId, front: trimmedFront, back: trimmedBack };
      const created = await window.nexus.createCard(profileId, fields);
      setCards((prev) => (prev ? [...prev, created] : [created]));
    }
    return true;
  }

  /**
   * Creates or updates a problem card: a BASIC card carrying the worked
   * solution its back is derived from (ADR-046). Only the statement and the
   * steps go over the wire — the store derives the back, so `back` is never
   * sent alongside them.
   */
  async function submitProblemCard(): Promise<boolean> {
    const trimmedFront = cardFront.trim();
    const trimmedSteps = problemSteps.trim();
    if (trimmedFront.length === 0 || trimmedSteps.length === 0) return false;
    if (trimmedFront.length > CARD_TEXT_MAX_LENGTH || trimmedSteps.length > CARD_TEXT_MAX_LENGTH) {
      return false;
    }
    if (problemStepCount === 0) return false;

    if (editingCardId != null) {
      const changes: CardFieldChanges = {
        deckId: cardDeckId,
        front: trimmedFront,
        problemSteps: trimmedSteps,
      };
      applyUpdatedCard(await window.nexus.updateCard(profileId, editingCardId, changes));
    } else {
      const created = await window.nexus.createProblemCard(
        profileId,
        cardDeckId,
        trimmedFront,
        trimmedSteps,
      );
      setCards((prev) => (prev ? [...prev, created] : [created]));
    }
    return true;
  }

  /**
   * Creates N sibling cards from one template, or edits an existing cloze
   * card's template in place. Only the template goes over the wire — the store
   * derives every side (ADR-042).
   */
  async function submitClozeCard(): Promise<boolean> {
    const trimmed = clozeText.trim();
    if (trimmed.length === 0 || trimmed.length > CARD_TEXT_MAX_LENGTH) return false;
    // An edit may legitimately reach zero blanks — the store's refusal is the
    // message the user needs, so it is submitted and reported, not blocked.
    if (editingCardId == null && clozeBlankCount === 0) return false;

    if (editingCardId != null) {
      const changes: CardFieldChanges = { deckId: cardDeckId, clozeText: trimmed };
      applyUpdatedCard(await window.nexus.updateCard(profileId, editingCardId, changes));
    } else {
      const created = await window.nexus.createClozeCards(profileId, cardDeckId, trimmed);
      setCards((prev) => (prev ? [...prev, ...created] : created));
    }
    return true;
  }

  /** Replaces one card in the drill-in's list, or drops it when the edit moved it to another deck. */
  function applyUpdatedCard(updated: Card): void {
    setCards((prev) => {
      if (!prev) return prev;
      if (activeDeckId != null && updated.deckId !== activeDeckId) {
        return prev.filter((c) => c.id !== updated.id);
      }
      return prev.map((c) => (c.id === updated.id ? updated : c));
    });
  }

  async function removeCard(card: Card): Promise<void> {
    setActionError(null);
    try {
      await window.nexus.deleteCard(profileId, card.id);
      setCards((prev) => prev && prev.filter((c) => c.id !== card.id));
      if (editingCardId === card.id) closeCardForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoCardId(card.id);
      await reloadDeckCounts();
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to delete card:", error);
    }
  }

  async function undoCard(): Promise<void> {
    if (!pendingUndoCardId || activeDeckId == null) return;
    setActionError(null);
    try {
      await window.nexus.restoreCard(profileId, pendingUndoCardId);
      setPendingUndoCardId(null);
      await Promise.all([reloadCards(activeDeckId), reloadDeckCounts()]);
    } catch (error) {
      setActionError(strings.study.actionError);
      console.error("Nexus: failed to restore card:", error);
    }
  }

  function startReview(scope: ReviewQueueScope, practice: PracticeConfig | null = null): void {
    setRoute({ kind: "review", scope, practice });
  }

  /**
   * Starts an interleaved practice session over the chosen špilovi (ADR-047).
   * The seed is drawn HERE, once, as the session begins — not inside the
   * reviewer, which re-renders on every reveal and every grade.
   */
  function startPractice(deckIds: readonly string[], problemsOnly: boolean): void {
    setPracticeSubjectId(null);
    startReview({ deckIds, problemsOnly }, { seed: Math.floor(Math.random() * 0x100000000) });
  }

  function exitReview(): void {
    setRoute({ kind: "hub" });
    void reloadDeckCounts();
    // Grades just landed in `review_log`, which is a column of today's study
    // log row (STUDY-014) — re-read it if one is open behind this session.
    setLogRevision((revision) => revision + 1);
  }

  const loading =
    subjects === null ||
    exams === null ||
    decks === null ||
    deckCounts === null ||
    plans === null ||
    todayBlocks === null ||
    statsYear === null ||
    statsRecent === null ||
    focusSessions === null;
  const sortedSubjects = subjects ? [...subjects].sort((a, b) => collator.compare(a.name, b.name)) : [];
  const activeSubjects = sortedSubjects.filter((s) => !s.archived);
  const archivedSubjects = sortedSubjects.filter((s) => s.archived);

  /** This subject's exams, soonest first (create appends optimistically). */
  function examsForSubject(subjectId: string): Exam[] {
    return (exams ?? [])
      .filter((exam) => exam.subjectId === subjectId)
      .sort((a, b) => a.examDate.localeCompare(b.examDate) || a.id.localeCompare(b.id));
  }

  /** This subject's decks, sr-Latn sorted (create appends optimistically). */
  function decksForSubject(subjectId: string): Deck[] {
    return (decks ?? [])
      .filter((deck) => deck.subjectId === subjectId)
      .sort((a, b) => collator.compare(a.name, b.name));
  }

  function countsFor(deckId: string): DeckCounts {
    return deckCounts?.find((c) => c.deckId === deckId) ?? { deckId, newCount: 0, dueCount: 0 };
  }

  /** True once at least one of this subject's decks has a new or due card ("Uči sve"). */
  function subjectHasStudiable(subjectId: string): boolean {
    return decksForSubject(subjectId).some((deck) => {
      const counts = countsFor(deck.id);
      return counts.newCount > 0 || counts.dueCount > 0;
    });
  }

  // --- Study-plan joins (client-side, over the already-loaded exams/subjects) --
  const examsById = new Map((exams ?? []).map((exam) => [exam.id, exam] as const));
  const subjectsById = new Map((subjects ?? []).map((subject) => [subject.id, subject] as const));

  /** Active plans joined with exam + subject, soonest exam first; an orphaned plan (exam/subject gone) is skipped like an orphaned exam. */
  const planEntries = (plans ?? [])
    .flatMap((plan) => {
      const exam = examsById.get(plan.examId);
      const subject = exam ? subjectsById.get(exam.subjectId) : undefined;
      return exam && subject ? [{ plan, exam, subject }] : [];
    })
    .sort(
      (a, b) =>
        a.exam.examDate.localeCompare(b.exam.examDate) || a.plan.id.localeCompare(b.plan.id),
    );

  /** Today's blocks joined the same way, sr-Latn by subject name (orphans skipped). */
  const todayEntries = (todayBlocks ?? [])
    .flatMap((block) => {
      const exam = examsById.get(block.examId);
      const subject = exam ? subjectsById.get(exam.subjectId) : undefined;
      return exam && subject ? [{ block, exam, subject }] : [];
    })
    .sort(
      (a, b) =>
        collator.compare(a.subject.name, b.subject.name) || a.block.id.localeCompare(b.block.id),
    );

  /** Future exams with no active plan — the create-select's option set, soonest first. */
  const plannedExamIds = new Set((plans ?? []).map((plan) => plan.examId));
  const plannableExams = (exams ?? [])
    .flatMap((exam) => {
      const subject = subjectsById.get(exam.subjectId);
      return subject && !plannedExamIds.has(exam.id) && daysUntilExam(exam.examDate) > 0
        ? [{ exam, subject }]
        : [];
    })
    .sort(
      (a, b) => a.exam.examDate.localeCompare(b.exam.examDate) || a.exam.id.localeCompare(b.exam.id),
    );

  /** The plan being edited, resolved for the form's static exam label. */
  const editingPlanEntry =
    editingPlanId != null
      ? planEntries.find((entry) => entry.plan.id === editingPlanId)
      : undefined;

  // --- Study stats + focus timer (Statistika i fokus, piece 4b) --------------
  const today = localTodayKey();

  // --- Topic-aware plan form + scope-cut dialog derivations (ADR-063) --------
  /** What the seven Mon..Sun inputs show: the touched vector, or the scalar mirrored. */
  const weekdayInputValues = planWeekdays ?? Array.from({ length: 7 }, () => planMinutes);
  /** The form exam's topics, or null while they load (the effect above fetches missing entries). */
  const formTopics = formExamId === "" ? null : (topicsByExam[formExamId] ?? null);
  /** Every live deck as a topic-link option, sr-Latn sorted; the subject name disambiguates. */
  const topicDeckOptions = [...(decks ?? [])].sort((a, b) => collator.compare(a.name, b.name));
  const scopeCutExamId =
    scopeCut !== null ? (plans?.find((plan) => plan.id === scopeCut.planId)?.examId ?? "") : "";
  const scopeCutDialogRows =
    scopeCut !== null && scopeCut.proposal !== null
      ? scopeCutRows(
          scopeCut.proposal.topicIds,
          topicsByExam[scopeCutExamId] ?? [],
          blocksByPlan[scopeCut.planId] ?? [],
          today,
        )
      : [];

  // The idle timer's select falls back to the sr-Latn-first active subject
  // once the current pick is missing or no longer active/loaded.
  const resolvedFocusSubjectId = activeSubjects.some((s) => s.id === focusSubjectId)
    ? focusSubjectId
    : (activeSubjects[0]?.id ?? "");

  const streak = statsYear ? computeStreak(statsYear.activityDays, today) : null;

  const subjectMinutesRows = statsRecent
    ? joinSubjectMinutes(statsRecent.subjectMinutes, subjectsById, strings.study.statsOtherSubject)
    : [];
  const maxSubjectMinutes = Math.max(1, ...subjectMinutesRows.map((row) => row.minutes));
  const statsAllZero =
    subjectMinutesRows.length === 0 &&
    (statsRecent?.reviews.total ?? 0) === 0 &&
    (statsRecent?.blocks.done ?? 0) === 0 &&
    (statsRecent?.blocks.missed ?? 0) === 0;

  /**
   * Last-7-days focus sessions joined with their subject (orphans skipped, like
   * the plan/today joins); the store's own newest-first order is kept.
   *
   * Since migration 057 one table holds every focus phase, so a subjectless
   * Pomodoro phase reaches this list too. It is skipped by the same rule that
   * skips an orphan: this is STUDY's page, and a row it cannot attribute to a
   * subject has nothing to say here. The phases are not lost — they are the
   * „Fokus" page's own history.
   */
  const focusSessionEntries = (focusSessions ?? []).flatMap((session) => {
    const subject = session.subjectId === null ? undefined : subjectsById.get(session.subjectId);
    return subject ? [{ session, subject }] : [];
  });

  // --- Review session route --------------------------------------------------
  if (route.kind === "review") {
    return (
      <ReviewSession
        profileId={profileId}
        scope={route.scope}
        practice={route.practice}
        decks={decks ?? []}
        onExit={exitReview}
      />
    );
  }

  // --- Deck drill-in route (card management) ---------------------------------
  if (route.kind === "deck") {
    const deck = decks?.find((d) => d.id === route.deckId);
    const deckSubject = deck ? subjects?.find((s) => s.id === deck.subjectId) : undefined;
    const deckOptions = deck ? decksForSubject(deck.subjectId) : [];
    // Which forms the toggle offers: all three when adding; none for a cloze
    // card being edited (it cannot change kind); Osnovna and Zadatak for a
    // basic one, which are two forms of the same kind (ADR-046).
    const formOptions: readonly CardForm[] =
      editingCardId == null ? CARD_FORMS : cardForm === "cloze" ? [] : ["basic", "problem"];

    /**
     * The trailing control for a note-sourced card (ADR-017 "STUDY: one
     * source of truth"): STUDY withdraws edit/delete for a card whose text is
     * owned by a note block, offering a link to that note instead. An id
     * missing from `noteTitles` reads as unresolvable — a soft-deleted or
     * trashed note, which by design (ADR-017) leaves its cards alone — and
     * renders muted and inert, exactly like an unresolvable wiki-link chip.
     * Degrades to plain muted text if the page was mounted without
     * `onOpenNote`, rather than offering a button that goes nowhere.
     */
    function cardSourceControl(sourceNoteId: string) {
      const title = noteTitles.get(sourceNoteId);
      const resolvable = title !== undefined;
      const label = resolvable
        ? `${strings.study.cardSourcePrefix}${title || strings.notes.untitled}`
        : strings.study.cardSourceMissing;

      if (!onOpenNote) {
        return <span className="study__card-source">{label}</span>;
      }

      return (
        <Button
          size="sm"
          className="study__card-source"
          disabled={!resolvable}
          title={strings.study.cardSourceLabel}
          aria-label={strings.study.cardSourceLabel}
          onClick={resolvable ? () => onOpenNote(sourceNoteId) : undefined}
        >
          {label}
        </Button>
      );
    }

    return (
      <div className="study">
        <div className="study__deck-view-header">
          <Button size="sm" className="study__back" onClick={() => setRoute({ kind: "hub" })}>
            {strings.study.cardsBack}
          </Button>
          {deck && (
            <span className="study__deck-view-heading">
              <span className="study__deck-view-name">{deck.name}</span>
              {deckSubject && <span className="study__deck-view-subject">{deckSubject.name}</span>}
            </span>
          )}
        </div>

        {pendingUndoCardId != null && (
          <div className="study__undo" role="status">
            <span className="study__undo-text">{strings.study.deletedCardNotice}</span>
            <Button size="sm" className="study__undo-action" onClick={() => void undoCard()}>
              {strings.study.undo}
            </Button>
            <Button
              size="sm"
              className="study__undo-dismiss"
              aria-label={strings.study.dismiss}
              onClick={() => setPendingUndoCardId(null)}
            >
              ×
            </Button>
          </div>
        )}

        {actionError != null && (
          <div className="study__undo study__undo--error" role="alert">
            <span className="study__undo-text">{actionError}</span>
            <Button
              size="sm"
              className="study__undo-dismiss"
              aria-label={strings.study.dismiss}
              onClick={() => setActionError(null)}
            >
              ×
            </Button>
          </div>
        )}

        {cardsFailed ? (
          <EmptyState title={strings.study.cardsEmptyTitle} description={strings.study.loadCardsError} />
        ) : cards === null ? (
          <p className="app__muted">{strings.app.loading}</p>
        ) : (
          <>
            {cards.length === 0 ? (
              <EmptyState
                title={strings.study.cardsEmptyTitle}
                description={strings.study.cardsEmptyDescription}
              />
            ) : (
              <div className="study__cards">
                {cards.map((card) => (
                  <ListRow
                    key={card.id}
                    trailing={
                      <span className="study__card-actions">
                        <Chip variant={cardStateVariant(card.state)}>{cardStateLabel(card.state)}</Chip>
                        {card.state !== 0 && (
                          // A bare date in a chip row says nothing about which
                          // date it is. Named the way SearchPage names its own
                          // date column — a tooltip, because the row is dense
                          // and a visible label here would cost more than it
                          // explains. `cardDueLabel` was written for this and
                          // rendered nowhere.
                          <span className="study__card-due" title={strings.study.cardDueLabel}>
                            {formatCardDue(card.due)}
                          </span>
                        )}
                        {card.sourceNoteId !== null ? (
                          cardSourceControl(card.sourceNoteId)
                        ) : (
                          <>
                            <Button
                              size="sm"
                              className="study__edit"
                              aria-label={strings.study.editCardLabel}
                              onClick={() => startEditCard(card)}
                            >
                              ✎
                            </Button>
                            <Button
                              size="sm"
                              className="study__delete"
                              aria-label={strings.study.deleteCardLabel}
                              onClick={() => void removeCard(card)}
                            >
                              ×
                            </Button>
                          </>
                        )}
                      </span>
                    }
                  >
                    <span
                      id={studyRowDomId(card.id)}
                      className={revealedId === card.id ? "nx-revealed" : undefined}
                    >
                      <MathText text={card.front} className="study__card-front" />
                    </span>
                  </ListRow>
                ))}
              </div>
            )}

            {cardFormVisible ? (
              <form className="study__card-form" onSubmit={(e) => void submitCardForm(e)}>
                {/* All three forms are offered when ADDING. While editing, a
                    cloze card has no toggle at all — it cannot change kind
                    (ADR-042) — but a basic card offers Osnovna and Zadatak,
                    which are two forms of the same kind (ADR-046). */}
                {formOptions.length > 0 && (
                  <div
                    className="study__segmented"
                    role="group"
                    aria-label={strings.study.cardKindLabel}
                  >
                    {formOptions.map((form) => (
                      <Button
                        key={form}
                        type="button"
                        size="sm"
                        variant={cardForm === form ? "primary" : "ghost"}
                        aria-pressed={cardForm === form}
                        onClick={() => {
                          setCardForm(form);
                          setCardFormError(null);
                        }}
                      >
                        {strings.study.cardForm[form]}
                      </Button>
                    ))}
                  </div>
                )}

                {cardForm === "cloze" ? (
                  <div className="study__card-field">
                    <textarea
                      ref={clozeTextareaRef}
                      className="nx-textfield__input study__textarea"
                      value={clozeText}
                      placeholder={strings.study.clozePlaceholder}
                      aria-label={strings.study.clozeLabel}
                      maxLength={CARD_TEXT_MAX_LENGTH}
                      autoFocus
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        setClozeText(event.target.value)
                      }
                    />
                    <div className="study__cloze-actions">
                      <Button size="sm" onClick={addClozeBlank}>
                        {strings.study.clozeAddBlank}
                      </Button>
                      <p
                        className={
                          clozeBlankCount === 0
                            ? "study__cloze-count study__cloze-count--empty"
                            : "study__cloze-count"
                        }
                        aria-live="polite"
                      >
                        {clozeCountLabel(clozeBlankCount, clozeCardNumbers.length)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* The statement: the same `front` a basic card has, named
                        for what it is in a problem card. */}
                    <div className="study__card-field">
                      <textarea
                        className="nx-textfield__input study__textarea"
                        value={cardFront}
                        placeholder={
                          cardForm === "problem"
                            ? strings.study.problemStatementPlaceholder
                            : strings.study.frontPlaceholder
                        }
                        aria-label={
                          cardForm === "problem"
                            ? strings.study.problemStatementLabel
                            : strings.study.frontLabel
                        }
                        maxLength={CARD_TEXT_MAX_LENGTH}
                        autoFocus
                        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCardFront(event.target.value)}
                      />
                      {cardFront.trim().length > 0 && (
                        <div className="study__math-preview">
                          <MathText text={cardFront} />
                        </div>
                      )}
                    </div>
                    {cardForm === "problem" ? (
                      <div className="study__card-field">
                        <textarea
                          className="nx-textfield__input study__textarea"
                          value={problemSteps}
                          placeholder={strings.study.problemStepsPlaceholder}
                          aria-label={strings.study.problemStepsLabel}
                          maxLength={CARD_TEXT_MAX_LENGTH}
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                            setProblemSteps(event.target.value)
                          }
                        />
                        {/* The preview reads the steps through the SAME grammar
                            the store does, so it shows them as the reviewer
                            will: one per line, markers gone. */}
                        {problemStepCount > 0 && (
                          <div className="study__math-preview study__step-preview">
                            {problemStepList.map((step, index) => (
                              <MathText key={index} text={step} />
                            ))}
                          </div>
                        )}
                        <p
                          className={
                            problemStepCount === 0
                              ? "study__step-count study__step-count--empty"
                              : "study__step-count"
                          }
                          aria-live="polite"
                        >
                          {problemStepCountLabel(problemStepCount)}
                        </p>
                      </div>
                    ) : (
                      <div className="study__card-field">
                        <textarea
                          className="nx-textfield__input study__textarea"
                          value={cardBack}
                          placeholder={strings.study.backPlaceholder}
                          aria-label={strings.study.backLabel}
                          maxLength={CARD_TEXT_MAX_LENGTH}
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCardBack(event.target.value)}
                        />
                        {cardBack.trim().length > 0 && (
                          <div className="study__math-preview">
                            <MathText text={cardBack} />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                {/* The math hint applies to a cloze template too — a `$…$`
                    expression inside one renders exactly as on a basic card. */}
                {cardForm === "cloze" && (
                  <p className="study__math-hint">{strings.study.clozeHint}</p>
                )}
                {cardForm === "problem" && (
                  <p className="study__math-hint">{strings.study.problemStepsHint}</p>
                )}
                <p className="study__math-hint">{strings.study.mathHint}</p>
                {cardFormError !== null && (
                  <p className="study__card-form-error" role="alert">
                    {cardFormError}
                  </p>
                )}
                {editingCardId != null && (
                  <select
                    className="study__select"
                    value={cardDeckId}
                    aria-label={strings.study.deckSelectLabel}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => setCardDeckId(event.target.value)}
                  >
                    {deckOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="study__card-form-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    // Creating at zero blanks would make zero cards, and a
                    // problem card with no step has nothing to reveal, so the
                    // button says so instead of failing after the click. A
                    // stepless solution is not a dead end while editing: the
                    // Osnovna toggle beside it drops the steps entirely.
                    disabled={
                      (cardForm === "cloze" && editingCardId == null && clozeBlankCount === 0) ||
                      (cardForm === "problem" && problemStepCount === 0)
                    }
                  >
                    {editingCardId != null ? strings.study.saveCard : strings.study.addCard}
                  </Button>
                  <Button type="button" size="sm" className="study__cancel" onClick={closeCardForm}>
                    {strings.study.cancelCard}
                  </Button>
                </div>
              </form>
            ) : (
              deck && (
                <Button size="sm" className="study__add-exam" onClick={() => startAddCard(deck.id)}>
                  {strings.study.addCard}
                </Button>
              )
            )}
          </>
        )}
      </div>
    );
  }

  /**
   * The „Materijali" section of one subject's panel: the „Dodaj materijal"
   * button, then one row per file — the name, a human-readable size, and the
   * open/save-as/remove menu. The TASK form's „Prilozi" recipe verbatim, with
   * one difference the hub imposes: it carries an empty state, because a subject
   * panel is always on screen and a section that vanished when it held nothing
   * would read as a missing feature rather than an empty one.
   *
   * No thumbnail: a subject's materials are skripte and slides rather than
   * inline images, and a panel that sometimes grew a picture row would make the
   * subject cards jump about at different heights for no information gained.
   */
  function renderMaterials(subjectId: string) {
    const copy = strings.study.materials;
    const rows = materialsBySubject[subjectId] ?? NO_MATERIALS;
    return (
      <div className="study__materials">
        <div className="study__materials-header">
          <h3 className="study__materials-title">
            {copy.title}
            {rows.length > 0 ? ` (${rows.length})` : ""}
          </h3>
          <Button
            size="sm"
            className="study__add-material"
            disabled={attaching}
            onClick={() => void attachMaterials(subjectId)}
          >
            {copy.add}
          </Button>
        </div>
        {materialError !== null && (
          <p className="study__material-error" role="status">
            {materialError === "tooLarge" ? copy.tooLarge : copy.actionError}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="study__materials-empty">{copy.empty}</p>
        ) : (
          rows.map((material) => {
            // „Pregledaj" is offered only where the stored mime (plus the
            // ADR-064 extension reading for pre-sniff text rows) says the app
            // can render the file itself.
            const previewKind = attachmentPreviewKind(
              material.mime,
              material.fileName,
              material.sizeBytes,
            );
            return (
              <div key={material.id} className="study__material">
                <span className="study__material-name">{material.fileName}</span>
                <span className="study__material-size">{formatBytes(material.sizeBytes)}</span>
                <NotePopover label={copy.menuLabel} triggerClassName="study__material-menu">
                  {(close) => (
                    <>
                      {previewKind !== null && (
                        <button
                          type="button"
                          className="note__menu-item"
                          role="menuitem"
                          onClick={() => {
                            if (previewKind === "pdf") {
                              void previewPdfMaterial(subjectId, material.id);
                            } else {
                              setMaterialPreview({ subjectId, attachment: material, kind: previewKind });
                            }
                            close();
                          }}
                        >
                          {copy.preview}
                        </button>
                      )}
                      <button
                        type="button"
                        className="note__menu-item"
                        role="menuitem"
                        onClick={() => {
                          void openMaterial(subjectId, material.id);
                          close();
                        }}
                      >
                        {copy.open}
                      </button>
                      <button
                        type="button"
                        className="note__menu-item"
                        role="menuitem"
                        onClick={() => {
                          void saveMaterialAs(subjectId, material.id);
                          close();
                        }}
                      >
                        {copy.saveAs}
                      </button>
                      <div className="note__menu-sep" role="separator" />
                      <button
                        type="button"
                        className="note__menu-item note__menu-item--danger"
                        role="menuitem"
                        onClick={() => {
                          void removeMaterial(subjectId, material.id);
                          close();
                        }}
                      >
                        {copy.remove}
                      </button>
                    </>
                  )}
                </NotePopover>
              </div>
            );
          })
        )}
      </div>
    );
  }

  /**
   * The „Povezane beleške" section: one chip per linked note, each opening it
   * through the SAME `onOpenNote` route a note-generated card's source control
   * uses (ADR-017 / STUDY-008) — one way into Beleške from STUDY, not two. A
   * page mounted without `onOpenNote` draws plain muted titles rather than
   * buttons that go nowhere, exactly as `cardSourceControl` does.
   *
   * The add-picker is a `NotePopover` rather than a dialog: the choice is one
   * item from a list with nothing to type and nothing to confirm, and a modal
   * would take the whole screen away from a panel the user is reading. The
   * already-linked notes are filtered out — offering one that changes nothing
   * (the store's insert is an idempotent no-op) would be a dead menu item.
   */
  function renderLinkedNotes(subjectId: string) {
    const copy = strings.study.linkedNotes;
    const rows = linkedNotesBySubject[subjectId] ?? NO_LINKED_NOTES;
    const linkedIds = new Set(rows.map((row) => row.id));
    const candidates = profileNotes
      .filter((note) => !linkedIds.has(note.id))
      .sort((a, b) => NOTE_TITLE_COLLATOR.compare(a.title, b.title));

    return (
      <div className="study__linked-notes">
        <div className="study__linked-header">
          <h3 className="study__linked-title">
            {copy.title}
            {rows.length > 0 ? ` (${rows.length})` : ""}
          </h3>
          <NotePopover
            label={copy.pickerLabel}
            triggerClassName="study__link-note"
            triggerContent={copy.add}
          >
            {(close) =>
              candidates.length === 0 ? (
                <p className="study__linked-picker-empty">{copy.pickerEmpty}</p>
              ) : (
                candidates.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className="note__menu-item"
                    role="menuitem"
                    onClick={() => {
                      void linkNote(subjectId, note.id);
                      close();
                    }}
                  >
                    {note.title || strings.notes.untitled}
                  </button>
                ))
              )
            }
          </NotePopover>
        </div>
        {linkedNoteError && (
          <p className="study__linked-error" role="status">
            {copy.actionError}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="study__linked-empty">{copy.empty}</p>
        ) : (
          <div className="study__linked-list">
            {rows.map((note) => (
              <span key={note.id} className="study__linked-chip">
                {onOpenNote ? (
                  <button
                    type="button"
                    className="study__linked-open"
                    title={copy.openLabel}
                    onClick={() => onOpenNote(note.id)}
                  >
                    {note.title || strings.notes.untitled}
                  </button>
                ) : (
                  <span className="study__linked-open study__linked-open--inert">
                    {note.title || strings.notes.untitled}
                  </span>
                )}
                <button
                  type="button"
                  className="study__linked-unlink"
                  aria-label={copy.unlink}
                  title={copy.unlink}
                  onClick={() => void unlinkNote(subjectId, note.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  /**
   * The „Dnevnik učenja" section (STUDY-014): a read-only, day-grouped record
   * of what this course actually took — its ponavljanja, its fokus time, what
   * its plans asked for, and the exams it hit — newest day first. Nothing here
   * is new data; it is the four things the app already stores, composed.
   *
   * COLLAPSED by default, and it is the only section of the panel that is. The
   * two above it are short and always relevant; this one is a query per subject
   * over sixty days of history, sitting under exams, materials, notes and (just
   * below) špilovi. So it opens on request, one subject at a time — and the
   * toggle names what it opens rather than saying "Prikaži", which on a panel
   * of five sections would say nothing.
   *
   * Each day is one quiet line: the date, the day's facts run together with
   * „·", and an exam as an accent Chip — the same milestone treatment the exam
   * rows above use, because a chip is what an exam looks like on this page.
   */
  function renderStudyLog(subjectId: string) {
    const copy = strings.study.log;
    const open = expandedLog?.subjectId === subjectId;
    // Only the OPEN subject's exams are indexed: a closed section resolves no
    // names, so it should build no map either.
    const examTypes = open
      ? new Map(examsForSubject(subjectId).map((exam) => [exam.id, exam.examType]))
      : new Map<string, ExamType>();

    return (
      <div className="study__log">
        <div className="study__log-header">
          <h3 className="study__log-title">{copy.title}</h3>
          <Button size="sm" className="study__log-toggle" onClick={() => toggleStudyLog(subjectId)}>
            {open ? copy.hide : copy.show}
          </Button>
        </div>
        {open &&
          (logFailed ? (
            <p className="study__log-error" role="status">
              {copy.loadError}
            </p>
          ) : logDays.length === 0 ? (
            <p className="study__log-empty">{logLoading ? strings.app.loading : copy.empty}</p>
          ) : (
            <>
              <div className="study__log-list">
                {logDays.map((entry) => {
                  const facts = studyLogFacts(entry);
                  return (
                    <div key={entry.day} className="study__log-day">
                      {/* `formatExamDate` despite the name: a log day is a bare
                          calendar date, which is exactly what it renders ("8.
                          jul 2026."). The year is the reason it, and not the
                          plan list's weekday heading, is the right formatter —
                          a log scrolls back through semesters. */}
                      <span className="study__log-date">{formatExamDate(entry.day)}</span>
                      {facts.length > 0 && (
                        <span className="study__log-facts">{facts.join(" · ")}</span>
                      )}
                      {studyLogExamLabels(entry.examIds, examTypes).map((exam) => (
                        <Chip key={exam.id} variant="accent">
                          {exam.label}
                        </Chip>
                      ))}
                    </div>
                  );
                })}
              </div>
              {/* The honest bound: offered only while the subject actually HAS
                  something older than the window on screen — the store answers
                  that, so a quiet summer between two semesters never reads as
                  the end of the history. */}
              {logHasOlder && (
                <Button
                  size="sm"
                  className="study__log-more"
                  disabled={logLoading}
                  onClick={extendStudyLog}
                >
                  {copy.showMore}
                </Button>
              )}
            </>
          ))}
      </div>
    );
  }

  // --- Hub route (subjects, exams, decks) -------------------------------------
  return (
    <div className="study">
      <PageHeader title={moduleName("study")} />

      <form className="study__subject-form" onSubmit={(e) => void submitSubjectForm(e)}>
        <input
          ref={nameRef}
          className="nx-textfield__input study__name-input"
          value={subjectName}
          placeholder={strings.study.namePlaceholder}
          aria-label={strings.study.nameLabel}
          autoFocus
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSubjectName(event.target.value)}
        />
        <ColorPicker value={subjectColor} onChange={setSubjectColor} />
        <input
          className="nx-textfield__input study__semester-input"
          value={subjectSemester}
          placeholder={strings.study.semesterPlaceholder}
          aria-label={strings.study.semesterLabel}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSubjectSemester(event.target.value)}
        />
        <Button type="submit" variant="primary">
          {editingSubjectId != null ? strings.study.save : strings.study.add}
        </Button>
        {editingSubjectId != null && (
          <Button type="button" className="study__cancel" onClick={resetSubjectForm}>
            {strings.study.cancel}
          </Button>
        )}
      </form>

      {pendingUndoSubjectId != null && (
        <div className="study__undo" role="status">
          <span className="study__undo-text">{strings.study.deletedNotice}</span>
          <Button size="sm" className="study__undo-action" onClick={() => void undoSubject()}>
            {strings.study.undo}
          </Button>
          <Button
            size="sm"
            className="study__undo-dismiss"
            aria-label={strings.study.dismiss}
            onClick={() => setPendingUndoSubjectId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {pendingUndoExamId != null && (
        <div className="study__undo" role="status">
          <span className="study__undo-text">{strings.study.deletedExamNotice}</span>
          <Button size="sm" className="study__undo-action" onClick={() => void undoExam()}>
            {strings.study.undo}
          </Button>
          <Button
            size="sm"
            className="study__undo-dismiss"
            aria-label={strings.study.dismiss}
            onClick={() => setPendingUndoExamId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {pendingUndoDeckId != null && (
        <div className="study__undo" role="status">
          <span className="study__undo-text">{strings.study.deletedDeckNotice}</span>
          <Button size="sm" className="study__undo-action" onClick={() => void undoDeck()}>
            {strings.study.undo}
          </Button>
          <Button
            size="sm"
            className="study__undo-dismiss"
            aria-label={strings.study.dismiss}
            onClick={() => setPendingUndoDeckId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {pendingUndoPlanId != null && (
        <div className="study__undo" role="status">
          <span className="study__undo-text">{strings.study.deletedPlanNotice}</span>
          <Button size="sm" className="study__undo-action" onClick={() => void undoPlan()}>
            {strings.study.undo}
          </Button>
          <Button
            size="sm"
            className="study__undo-dismiss"
            aria-label={strings.study.dismiss}
            onClick={() => setPendingUndoPlanId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {planUndoError != null && (
        <div className="study__undo study__undo--error" role="alert">
          <span className="study__undo-text">{planUndoError}</span>
          <Button
            size="sm"
            className="study__undo-dismiss"
            aria-label={strings.study.dismiss}
            onClick={() => setPlanUndoError(null)}
          >
            ×
          </Button>
        </div>
      )}

      {actionError != null && (
        <div className="study__undo study__undo--error" role="alert">
          <span className="study__undo-text">{actionError}</span>
          <Button
            size="sm"
            className="study__undo-dismiss"
            aria-label={strings.study.dismiss}
            onClick={() => setActionError(null)}
          >
            ×
          </Button>
        </div>
      )}

      {pendingUndoFocusId != null && (
        <div className="study__undo" role="status">
          <span className="study__undo-text">{strings.study.deletedFocusSessionNotice}</span>
          <Button size="sm" className="study__undo-action" onClick={() => void undoFocusSession()}>
            {strings.study.undo}
          </Button>
          <Button
            size="sm"
            className="study__undo-dismiss"
            aria-label={strings.study.dismiss}
            onClick={() => setPendingUndoFocusId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {failed ? (
        <EmptyState title={strings.study.emptyTitle} description={strings.study.loadError} />
      ) : loading ? (
        <p className="app__muted">{strings.app.loading}</p>
      ) : sortedSubjects.length === 0 ? (
        <EmptyState title={strings.study.emptyTitle} description={strings.study.emptyDescription} />
      ) : (
        <>
          <div className="study__subjects">
            {activeSubjects.map((subject) => {
              const subjectExams = examsForSubject(subject.id);
              const subjectDecks = decksForSubject(subject.id);
              return (
                <div
                  key={subject.id}
                  id={studyRowDomId(subject.id)}
                  className={
                    revealedId === subject.id
                      ? "study__subject-card nx-revealed"
                      : "study__subject-card"
                  }
                >
                  <div className="study__subject-header">
                    <span
                      className={`study__dot study__dot--${subject.color}`}
                      aria-hidden="true"
                    />
                    <h2 className="study__subject-name">{subject.name}</h2>
                    {subject.semester && (
                      <span className="study__subject-semester">{subject.semester}</span>
                    )}
                    <span className="study__subject-actions">
                      <Button
                        size="sm"
                        className="study__edit"
                        aria-label={strings.study.editLabel}
                        onClick={() => startEditSubject(subject)}
                      >
                        ✎
                      </Button>
                      <Button size="sm" className="study__archive" onClick={() => void toggleArchived(subject)}>
                        {strings.study.archiveLabel}
                      </Button>
                      <Button
                        size="sm"
                        className="study__delete"
                        aria-label={strings.study.deleteLabel}
                        onClick={() => void removeSubject(subject)}
                      >
                        ×
                      </Button>
                    </span>
                  </div>

                  <div className="study__exams">
                    {subjectExams.length === 0 ? (
                      <p className="study__exams-empty">{strings.study.noExams}</p>
                    ) : (
                      subjectExams.map((exam) => {
                        const days = daysUntilExam(exam.examDate);
                        return (
                          <ListRow
                            key={exam.id}
                            muted={days < 0}
                            trailing={
                              <span className="study__exam-actions">
                                <Chip variant={examCountdownVariant(days)}>
                                  {examCountdownLabel(days)}
                                </Chip>
                                <Button
                                  size="sm"
                                  className="study__edit"
                                  aria-label={strings.study.editExamLabel}
                                  onClick={() => startEditExam(exam)}
                                >
                                  ✎
                                </Button>
                                <Button
                                  size="sm"
                                  className="study__delete"
                                  aria-label={strings.study.deleteExamLabel}
                                  onClick={() => void removeExam(exam)}
                                >
                                  ×
                                </Button>
                              </span>
                            }
                          >
                            <span
                              id={studyRowDomId(exam.id)}
                              className={
                                revealedId === exam.id
                                  ? "study__exam-item nx-revealed"
                                  : "study__exam-item"
                              }
                            >
                              <span className="study__exam-heading">
                                <span className="study__exam-type">
                                  {strings.study.examType[exam.examType]}
                                </span>
                                {exam.scope && <Chip variant="data">{exam.scope}</Chip>}
                              </span>
                              <span className="study__exam-date">{formatExamDate(exam.examDate)}</span>
                            </span>
                          </ListRow>
                        );
                      })
                    )}
                  </div>

                  {examFormSubjectId === subject.id ? (
                    <form
                      className="study__exam-form"
                      onSubmit={(e) => void submitExamForm(e, subject.id)}
                    >
                      <select
                        className="study__select"
                        value={examType}
                        aria-label={strings.study.examTypeLabel}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                          setExamType(event.target.value as ExamType)
                        }
                      >
                        {EXAM_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {strings.study.examType[type]}
                          </option>
                        ))}
                      </select>
                      <TextField
                        type="date"
                        value={examDate}
                        required
                        aria-label={strings.study.examDateLabel}
                        onChange={(event) => setExamDate(event.target.value)}
                      />
                      <input
                        className="nx-textfield__input study__scope-input"
                        value={examScope}
                        placeholder={strings.study.examScopePlaceholder}
                        aria-label={strings.study.examScopeLabel}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setExamScope(event.target.value)
                        }
                      />
                      <Button type="submit" variant="primary" size="sm">
                        {editingExamId != null ? strings.study.saveExam : strings.study.addExam}
                      </Button>
                      <Button type="button" size="sm" className="study__cancel" onClick={closeExamForm}>
                        {strings.study.cancelExam}
                      </Button>
                    </form>
                  ) : (
                    <Button size="sm" className="study__add-exam" onClick={() => startAddExam(subject.id)}>
                      {strings.study.addExam}
                    </Button>
                  )}

                  {renderMaterials(subject.id)}
                  {renderLinkedNotes(subject.id)}
                  {renderStudyLog(subject.id)}

                  <div className="study__decks">
                    <div className="study__decks-header">
                      <h3 className="study__decks-title">{strings.study.decksTitle}</h3>
                      {subjectHasStudiable(subject.id) && (
                        <span className="study__decks-actions">
                          <Button size="sm" onClick={() => setPracticeSubjectId(subject.id)}>
                            {strings.study.practice.open}
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => startReview({ subjectId: subject.id })}
                          >
                            {strings.study.studyAll}
                          </Button>
                        </span>
                      )}
                    </div>
                    {subjectDecks.length === 0 ? (
                      <p className="study__decks-empty">{strings.study.noDecks}</p>
                    ) : (
                      subjectDecks.map((deck) => {
                        const counts = countsFor(deck.id);
                        const canStudy = counts.newCount > 0 || counts.dueCount > 0;
                        return (
                          <ListRow
                            key={deck.id}
                            trailing={
                              <span className="study__deck-actions">
                                <Chip variant={countVariant(counts.newCount, "data")}>
                                  {counts.newCount} {strings.study.newCount}
                                </Chip>
                                <Chip variant={countVariant(counts.dueCount, "accent")}>
                                  {counts.dueCount} {strings.study.dueCount}
                                </Chip>
                                <Button
                                  size="sm"
                                  className="study__edit"
                                  aria-label={strings.study.editDeckLabel}
                                  onClick={() => startEditDeck(deck)}
                                >
                                  ✎
                                </Button>
                                <Button
                                  size="sm"
                                  className="study__delete"
                                  aria-label={strings.study.deleteDeckLabel}
                                  onClick={() => void removeDeck(deck)}
                                >
                                  ×
                                </Button>
                                <Button size="sm" onClick={() => setRoute({ kind: "deck", deckId: deck.id })}>
                                  {strings.study.openCards}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  disabled={!canStudy}
                                  onClick={() => startReview({ deckId: deck.id })}
                                >
                                  {strings.study.studyDeck}
                                </Button>
                              </span>
                            }
                          >
                            <span
                              id={studyRowDomId(deck.id)}
                              className={
                                revealedId === deck.id
                                  ? "study__deck-name nx-revealed"
                                  : "study__deck-name"
                              }
                            >
                              {deck.name}
                            </span>
                          </ListRow>
                        );
                      })
                    )}
                  </div>

                  {deckFormSubjectId === subject.id ? (
                    <form
                      className="study__deck-form"
                      onSubmit={(e) => void submitDeckForm(e, subject.id)}
                    >
                      <input
                        className="nx-textfield__input study__deck-name-input"
                        value={deckName}
                        placeholder={strings.study.deckNamePlaceholder}
                        aria-label={strings.study.deckNameLabel}
                        autoFocus
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setDeckName(event.target.value)}
                      />
                      <Button type="submit" variant="primary" size="sm">
                        {editingDeckId != null ? strings.study.saveDeck : strings.study.addDeck}
                      </Button>
                      <Button type="button" size="sm" className="study__cancel" onClick={closeDeckForm}>
                        {strings.study.cancelDeck}
                      </Button>
                    </form>
                  ) : (
                    <Button size="sm" className="study__add-exam" onClick={() => startAddDeck(subject.id)}>
                      {strings.study.addDeck}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {archivedSubjects.length > 0 && (
            <div className="study__archived">
              <Button size="sm" onClick={() => setArchivedOpen((open) => !open)}>
                {archivedOpen ? strings.study.hideArchived : strings.study.showArchived} (
                {archivedSubjects.length})
              </Button>
              {archivedOpen && (
                <div className="study__archived-list">
                  {archivedSubjects.map((subject) => (
                    <ListRow
                      key={subject.id}
                      muted
                      leading={
                        <span
                          className={`study__dot study__dot--${subject.color}`}
                          aria-hidden="true"
                        />
                      }
                      trailing={
                        <span className="study__subject-actions">
                          <Button size="sm" onClick={() => void toggleArchived(subject)}>
                            {strings.study.unarchiveLabel}
                          </Button>
                          <Button
                            size="sm"
                            className="study__delete"
                            aria-label={strings.study.deleteLabel}
                            onClick={() => void removeSubject(subject)}
                          >
                            ×
                          </Button>
                        </span>
                      }
                    >
                      <span
                        id={studyRowDomId(subject.id)}
                        className={
                          revealedId === subject.id
                            ? "study__subject-name nx-revealed"
                            : "study__subject-name"
                        }
                      >
                        {subject.name}
                      </span>
                      {subject.semester && (
                        <span className="study__subject-semester">{subject.semester}</span>
                      )}
                    </ListRow>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="study__plans">
            <h2 className="study__plans-title">{strings.study.plansTitle}</h2>

            <div className="study__today">
              <h3 className="study__today-heading">{strings.study.todayTitle}</h3>
              {todayEntries.length === 0 ? (
                <p className="study__today-empty">{strings.study.todayEmpty}</p>
              ) : (
                <div className="study__today-list">
                  {todayEntries.map(({ block, exam, subject }) => {
                    const topic =
                      block.topicId === null
                        ? undefined
                        : topicsByExam[block.examId]?.find((t) => t.id === block.topicId);
                    const kindLabel = blockKindChipLabel(block.kind);
                    const examWeek = isExamWeekDay(exam.examDate, block.blockDate);
                    // A recall block whose topic drills from a špil deep-links
                    // straight into the reviewer, scoped to that deck (ADR-063).
                    const practiceDeckId =
                      block.kind === "recall" ? (topic?.deckId ?? null) : null;
                    return (
                      <ListRow
                        key={block.id}
                        className={examWeek ? "study__block-row--exam-week" : undefined}
                        trailing={
                          <span className="study__block-meta">
                            {practiceDeckId !== null && (
                              <Button
                                size="sm"
                                variant="primary"
                                title={strings.study.blockPracticeTitle}
                                onClick={() => startReview({ deckIds: [practiceDeckId] })}
                              >
                                {strings.study.practice.open}
                              </Button>
                            )}
                            <span className="study__block-minutes">
                              {block.minutes} {strings.study.minutesUnit}
                            </span>
                          </span>
                        }
                      >
                        <Checkbox
                          checked={block.status === "done"}
                          done={block.status === "done"}
                          onChange={(event) => void toggleBlockDone(block, event.target.checked)}
                        >
                          <span title={examWeek ? strings.study.examWeekTitle : undefined}>
                            {subject.name} — {strings.study.examType[exam.examType]}
                            {topic && <span className="study__block-topic">{topic.name}</span>}
                            {kindLabel !== null && (
                              <Chip className="study__block-kind">{kindLabel}</Chip>
                            )}
                          </span>
                        </Checkbox>
                      </ListRow>
                    );
                  })}
                </div>
              )}
            </div>

            {planEntries.length === 0 ? (
              <p className="study__plans-empty">{strings.study.plansEmpty}</p>
            ) : (
              planEntries.map(({ plan, exam, subject }) => {
                const blocks = blocksByPlan[plan.id] ?? [];
                const doneCount = blocks.filter((block) => block.status === "done").length;
                const days = daysUntilExam(exam.examDate);
                const expanded = expandedPlanId === plan.id;
                const health = planHealthById[plan.id];
                const healthLine = planHealthLine(health);
                const examTopics = topicsByExam[plan.examId] ?? [];
                const topicsById = new Map(examTopics.map((topic) => [topic.id, topic]));
                const scopeLine = cutTopicsLine(examTopics);
                return (
                  <div key={plan.id} className="study__plan-card">
                    <div className="study__plan-header">
                      <span
                        className={`study__dot study__dot--${subject.color}`}
                        aria-hidden="true"
                      />
                      <span className="study__plan-title">
                        {subject.name} — {strings.study.examType[exam.examType]}
                      </span>
                      <Chip variant={examCountdownVariant(days)}>{examCountdownLabel(days)}</Chip>
                      <span className="study__plan-actions">
                        <Button size="sm" className="study__edit" onClick={() => startEditPlan(plan)}>
                          {strings.study.planEdit}
                        </Button>
                        <Button
                          size="sm"
                          className="study__delete"
                          onClick={() => void removePlan(plan.id)}
                        >
                          {strings.study.planDelete}
                        </Button>
                      </span>
                    </div>
                    <div className="study__plan-meta">
                      <span>
                        {plan.dailyMinutes} {strings.study.planPerDay}
                        {plan.examWeekBoost && ` · ${strings.study.planBoostSummary}`}
                      </span>
                      <span>
                        {doneCount} {strings.study.planProgressOf} {blocks.length}{" "}
                        {strings.study.planProgressDone}
                      </span>
                    </div>
                    {/* The honesty line (ADR-063 invariant 5): what the capped
                        replan could not fit, or what a passed exam will never
                        absorb — with the scope-cut conversation's opener on
                        the first (STUDY-004). */}
                    {healthLine !== null && (
                      <p
                        className={
                          (health?.overflowMinutes ?? 0) > 0
                            ? "study__plan-health"
                            : "study__plan-health study__plan-health--passed"
                        }
                        role="status"
                      >
                        {healthLine}
                        {(health?.overflowMinutes ?? 0) > 0 && (
                          <Button
                            size="sm"
                            className="study__plan-cut-open"
                            onClick={() => void openScopeCut(plan.id)}
                          >
                            {strings.study.scopeCut.open}
                          </Button>
                        )}
                      </p>
                    )}
                    {/* How much of the syllabus the user has taken out of this
                        plan (STUDY-004) — a fact beside the health sentence,
                        undone one row at a time by „Vrati u plan". */}
                    {scopeLine !== null && <p className="study__plan-scope">{scopeLine}</p>}
                    <Button
                      size="sm"
                      className="study__plan-toggle"
                      onClick={() => setExpandedPlanId(expanded ? null : plan.id)}
                    >
                      {expanded ? strings.study.planHideBlocks : strings.study.planShowBlocks}
                    </Button>
                    {expanded && (
                      <div className="study__plan-blocks">
                        {blocks.map((block) => {
                          const topic =
                            block.topicId === null ? undefined : topicsById.get(block.topicId);
                          const kindLabel = blockKindChipLabel(block.kind);
                          const examWeek = isExamWeekDay(exam.examDate, block.blockDate);
                          const future = block.blockDate >= today;
                          const practiceDeckId =
                            block.kind === "recall" ? (topic?.deckId ?? null) : null;
                          return (
                            <ListRow
                              key={block.id}
                              muted={block.status === "missed"}
                              className={examWeek ? "study__block-row--exam-week" : undefined}
                              trailing={
                                <span className="study__block-meta">
                                  {practiceDeckId !== null && (
                                    <Button
                                      size="sm"
                                      variant="primary"
                                      title={strings.study.blockPracticeTitle}
                                      onClick={() => startReview({ deckIds: [practiceDeckId] })}
                                    >
                                      {strings.study.practice.open}
                                    </Button>
                                  )}
                                  {future && (
                                    <Button
                                      size="sm"
                                      className="study__pin"
                                      aria-pressed={block.pinned}
                                      title={
                                        block.pinned
                                          ? strings.study.blockUnpinTitle
                                          : strings.study.blockPinTitle
                                      }
                                      onClick={() => void toggleBlockPinned(block)}
                                    >
                                      {block.pinned
                                        ? strings.study.blockUnpin
                                        : strings.study.blockPin}
                                    </Button>
                                  )}
                                  <span className="study__block-minutes">
                                    {block.minutes} {strings.study.minutesUnit}
                                  </span>
                                  <Chip variant={blockStatusVariant(block.status)}>
                                    {strings.study.blockStatus[block.status]}
                                  </Chip>
                                </span>
                              }
                            >
                              <Checkbox
                                checked={block.status === "done"}
                                done={block.status === "done"}
                                aria-label={strings.study.blockDoneLabel}
                                onChange={(event) =>
                                  void toggleBlockDone(block, event.target.checked)
                                }
                              >
                                <span
                                  title={examWeek ? strings.study.examWeekTitle : undefined}
                                >
                                  {formatBlockDay(block.blockDate)}
                                  {topic && (
                                    <span className="study__block-topic">{topic.name}</span>
                                  )}
                                  {kindLabel !== null && (
                                    <Chip className="study__block-kind">{kindLabel}</Chip>
                                  )}
                                </span>
                              </Checkbox>
                            </ListRow>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {planFormVisible ? (
              <form className="study__plan-form" onSubmit={(e) => void submitPlanForm(e)}>
                {editingPlanId != null ? (
                  <span className="study__plan-form-exam">
                    {editingPlanEntry
                      ? `${editingPlanEntry.subject.name} — ${
                          strings.study.examType[editingPlanEntry.exam.examType]
                        }`
                      : ""}
                  </span>
                ) : (
                  <select
                    className="study__select"
                    value={planExamId}
                    aria-label={strings.study.planExamLabel}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setPlanExamId(event.target.value)
                    }
                  >
                    {plannableExams.map(({ exam, subject }) => (
                      <option key={exam.id} value={exam.id}>
                        {subject.name} — {strings.study.examType[exam.examType]} —{" "}
                        {formatExamDate(exam.examDate)}
                      </option>
                    ))}
                  </select>
                )}
                <TextField
                  type="date"
                  value={planStartDate}
                  required
                  aria-label={strings.study.planStartLabel}
                  onChange={(event) => setPlanStartDate(event.target.value)}
                />
                <TextField
                  type="number"
                  className="study__minutes-input"
                  value={planMinutes}
                  required
                  min={MIN_PLAN_MINUTES}
                  max={MAX_PLAN_MINUTES}
                  aria-label={strings.study.planMinutesLabel}
                  onChange={(event) => setPlanMinutes(event.target.value)}
                />
                <Checkbox checked={planBoost} onChange={(event) => setPlanBoost(event.target.checked)}>
                  {strings.study.planBoostLabel}
                </Checkbox>
                {/* Per-weekday minutes (ADR-063): no toggle — the inputs mirror
                    „Minuta dnevno" until touched, and an all-equal week saves
                    back as the scalar (NULL vector = "svaki dan isto"). */}
                <div
                  className="study__weekdays"
                  role="group"
                  aria-label={strings.study.weekdayMinutesLabel}
                >
                  <span className="study__weekdays-label">
                    {strings.study.weekdayMinutesLabel}
                  </span>
                  {strings.recurrence.weekdayShort.map((dayLabel, index) => (
                    <label key={dayLabel} className="study__weekday">
                      <span className="study__weekday-name">{dayLabel}</span>
                      <TextField
                        type="number"
                        className="study__weekday-input"
                        min={0}
                        max={MAX_WEEKDAY_INPUT}
                        value={weekdayInputValues[index] ?? ""}
                        aria-label={`${strings.study.weekdayMinutesLabel} — ${dayLabel}`}
                        onChange={(event) => {
                          const next = [...weekdayInputValues];
                          next[index] = event.target.value;
                          setPlanWeekdays(next);
                        }}
                      />
                    </label>
                  ))}
                  <p className="study__weekdays-hint">{strings.study.weekdayMinutesHint}</p>
                </div>
                {/* The exam's topics (ADR-063): name rows in rank order —
                    curriculum order AND scope-cut priority. Every edit writes
                    through immediately (the plan regenerates from topics), so
                    this block needs no save of its own. */}
                {formExamId !== "" && (
                  <div className="study__topics">
                    <h4 className="study__topics-heading">{strings.study.topics.title}</h4>
                    <p className="study__topics-hint">{strings.study.topics.hint}</p>
                    {formTopics === null ? (
                      <p className="app__muted">{strings.app.loading}</p>
                    ) : (
                      <>
                        {formTopics.length === 0 ? (
                          <p className="study__topics-empty">{strings.study.topics.empty}</p>
                        ) : (
                          formTopics.map((topic, index) => (
                            <div key={topic.id} className="study__topic-row">
                              <span className="study__topic-rank">{index + 1}.</span>
                              <TextField
                                key={`${topic.id}:${topic.updatedAt}`}
                                className="study__topic-name"
                                defaultValue={topic.name}
                                aria-label={strings.study.topics.nameLabel}
                                onBlur={(event) =>
                                  void commitTopicRename(topic, event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                              <select
                                className="study__select study__topic-confidence"
                                value={topic.confidence === null ? "" : String(topic.confidence)}
                                aria-label={strings.study.topics.confidenceLabel}
                                onChange={(event) =>
                                  void mutateTopics(topic.examId, () =>
                                    window.nexus.setExamTopicConfidence(
                                      profileId,
                                      topic.id,
                                      event.target.value === ""
                                        ? null
                                        : Number(event.target.value),
                                    ),
                                  )
                                }
                              >
                                <option value="">
                                  {strings.study.topics.confidenceUnknown}
                                </option>
                                {topic.confidence !== null &&
                                  !CONFIDENCE_STEPS.includes(topic.confidence) && (
                                    <option value={topic.confidence}>{topic.confidence}</option>
                                  )}
                                {CONFIDENCE_STEPS.map((step) => (
                                  <option key={step} value={step}>
                                    {step}
                                  </option>
                                ))}
                              </select>
                              {topic.confidence === null &&
                                topic.effectiveConfidence !== null && (
                                  <span className="study__topic-derived">
                                    {strings.study.topics.derivedPrefix}{" "}
                                    {topic.effectiveConfidence}
                                  </span>
                                )}
                              <select
                                className="study__select study__topic-deck"
                                value={topic.deckId ?? ""}
                                aria-label={strings.study.topics.deckLabel}
                                onChange={(event) =>
                                  void mutateTopics(topic.examId, () =>
                                    window.nexus.setExamTopicDeck(
                                      profileId,
                                      topic.id,
                                      event.target.value === "" ? null : event.target.value,
                                    ),
                                  )
                                }
                              >
                                <option value="">{strings.study.topics.deckNone}</option>
                                {/* The stale link keeps its own option so the
                                    picker shows what is stored — „Bez špila"
                                    right beside it is the one click that
                                    clears it (setDeck(id, null)). */}
                                {topic.deckMissing && topic.deckId !== null && (
                                  <option value={topic.deckId}>
                                    {strings.study.topics.deckMissing}
                                  </option>
                                )}
                                {topicDeckOptions.map((deck) => (
                                  <option key={deck.id} value={deck.id}>
                                    {deck.name}
                                    {subjectsById.get(deck.subjectId)
                                      ? ` (${subjectsById.get(deck.subjectId)?.name})`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                              {/* A link whose deck was deleted after it was
                                  made: the store derives nothing from it, so
                                  the „izvedeno" hint above is absent — this
                                  chip is what says why, rather than letting
                                  the weakness column go quiet unexplained. */}
                              {topic.deckMissing && (
                                <Chip
                                  className="study__topic-stale-deck"
                                  title={strings.study.topics.deckMissingTitle}
                                >
                                  {strings.study.topics.deckMissing}
                                </Chip>
                              )}
                              {topic.cut && (
                                <>
                                  <Chip className="study__topic-cut">
                                    {strings.study.topics.cutChip}
                                  </Chip>
                                  {/* The inverse of an accepted scope cut —
                                      the only affordance that clears `cut`,
                                      landing through the same refresh every
                                      other topic write runs. */}
                                  <Button
                                    size="sm"
                                    title={strings.study.topics.uncutTitle}
                                    onClick={() =>
                                      void mutateTopics(topic.examId, () =>
                                        window.nexus.restoreExamTopicToPlan(profileId, topic.id),
                                      )
                                    }
                                  >
                                    {strings.study.topics.uncut}
                                  </Button>
                                </>
                              )}
                              <span className="study__topic-actions">
                                <Button
                                  size="sm"
                                  aria-label={strings.study.topics.moveUp}
                                  disabled={index === 0}
                                  onClick={() =>
                                    void mutateTopics(topic.examId, () =>
                                      window.nexus.moveExamTopic(profileId, topic.id, "up"),
                                    )
                                  }
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="sm"
                                  aria-label={strings.study.topics.moveDown}
                                  disabled={index === formTopics.length - 1}
                                  onClick={() =>
                                    void mutateTopics(topic.examId, () =>
                                      window.nexus.moveExamTopic(profileId, topic.id, "down"),
                                    )
                                  }
                                >
                                  ↓
                                </Button>
                                <Button
                                  size="sm"
                                  className="study__delete"
                                  aria-label={strings.study.topics.remove}
                                  onClick={() =>
                                    void mutateTopics(topic.examId, () =>
                                      window.nexus.deleteExamTopic(profileId, topic.id),
                                    )
                                  }
                                >
                                  ×
                                </Button>
                              </span>
                            </div>
                          ))
                        )}
                        <div className="study__topic-add">
                          <TextField
                            className="study__topic-name"
                            value={topicName}
                            placeholder={strings.study.topics.addPlaceholder}
                            aria-label={strings.study.topics.addPlaceholder}
                            onChange={(event) => setTopicName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void addTopic(formExamId);
                              }
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={topicName.trim().length === 0}
                            onClick={() => void addTopic(formExamId)}
                          >
                            {strings.study.topics.add}
                          </Button>
                        </div>
                        {topicActionFailed && (
                          <p className="study__topic-error" role="alert">
                            {strings.study.topics.actionError}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                <Button type="submit" variant="primary" size="sm">
                  {editingPlanId != null ? strings.study.savePlan : strings.study.addPlan}
                </Button>
                <Button type="button" size="sm" className="study__cancel" onClick={closePlanForm}>
                  {strings.study.cancelPlan}
                </Button>
                {planError != null && (
                  <p className="study__plan-error" role="alert">
                    {planError}
                  </p>
                )}
              </form>
            ) : plannableExams.length > 0 ? (
              <Button
                size="sm"
                className="study__add-exam"
                onClick={() => startAddPlan(plannableExams[0]?.exam.id ?? "")}
              >
                {strings.study.newPlan}
              </Button>
            ) : (
              <p className="study__plans-empty">{strings.study.noPlannableExams}</p>
            )}
          </div>

          <div className="study__stats">
            <h2 className="study__stats-title">{strings.study.statsTitle}</h2>

            <div className="study__focus-card">
              <h3 className="study__focus-heading">{strings.study.focusTitle}</h3>
              {focusRunning ? (
                <div className="study__focus-running">
                  {/* The running phase may now be somebody ELSE'S — „Fokus"
                      starts subjectless phases on the same timer — so a null
                      subject reads as „bez predmeta" rather than as an unknown
                      one. The card still says truthfully what is running. */}
                  <span className="study__focus-subject">
                    {focusRunning.subjectId === null
                      ? strings.study.focusNoSubject
                      : (subjectsById.get(focusRunning.subjectId)?.name ??
                        strings.study.focusUnknownSubject)}
                  </span>
                  <span className="study__focus-elapsed">{formatElapsed(focusElapsedMs)}</span>
                  <span className="study__focus-actions">
                    <Button size="sm" variant="primary" onClick={() => void endFocus()}>
                      {strings.study.focusStop}
                    </Button>
                    {/* Same act as „Fokus"'s own „Odbaci": writes nothing, offers
                        no undo, so it asks first and stays visually subordinate
                        to „Završi" (danger-outline vs. filled primary). */}
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setConfirmingFocusDiscard(true)}
                    >
                      {strings.study.focusDiscard}
                    </Button>
                  </span>
                  {confirmingFocusDiscard && (
                    <FocusDiscardDialog
                      onConfirm={() => {
                        setConfirmingFocusDiscard(false);
                        void discardFocus();
                      }}
                      onCancel={() => setConfirmingFocusDiscard(false)}
                    />
                  )}
                </div>
              ) : activeSubjects.length === 0 ? (
                <p className="study__focus-empty">{strings.study.focusNoSubjects}</p>
              ) : (
                <div className="study__focus-idle">
                  <select
                    className="study__select"
                    value={resolvedFocusSubjectId}
                    aria-label={strings.study.focusSubjectLabel}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setFocusSubjectId(event.target.value)
                    }
                  >
                    {activeSubjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void beginFocus(resolvedFocusSubjectId)}
                  >
                    {strings.study.focusStart}
                  </Button>
                </div>
              )}
            </div>

            <div className="study__stats-streak">
              <span className="study__stats-streak-current">
                {streak && streak.current > 0
                  ? `${strings.study.streakLabel}: ${streak.current} ${dayUnit(
                      streak.current,
                      strings.study.streakUnitOne,
                      strings.study.streakUnitMany,
                    )}`
                  : strings.study.streakZero}
              </span>
              {streak && streak.best > 0 && (
                <span className="study__stats-streak-best">
                  {strings.study.streakBestLabel}: {streak.best}
                </span>
              )}
            </div>

            <div className="study__stats-section">
              <h3 className="study__stats-subheading">{strings.study.statsRecentTitle}</h3>
              {statsAllZero ? (
                <p className="study__stats-empty">{strings.study.statsEmpty}</p>
              ) : (
                <>
                  {subjectMinutesRows.length > 0 && (
                    <div className="study__stats-bars">
                      <h4 className="study__stats-bars-heading">{strings.study.statsMinutesTitle}</h4>
                      {subjectMinutesRows.map((row) => (
                        <div key={row.id} className="study__stats-bar-row">
                          <span
                            className={`study__stats-bar-label${
                              row.muted ? " study__stats-bar-label--muted" : ""
                            }`}
                          >
                            {row.label}
                          </span>
                          <span className="study__stats-bar-track">
                            <span
                              className={`study__stats-bar-fill${
                                row.muted ? " study__stats-bar-fill--muted" : ""
                              }`}
                              style={{ width: `${(row.minutes / maxSubjectMinutes) * 100}%` }}
                            />
                          </span>
                          <span className="study__stats-bar-value">
                            {formatDurationMinutes(row.minutes)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="study__stats-line">
                    {strings.study.statsReviewsLabel}: {statsRecent?.reviews.total ?? 0}
                  </p>
                  <p className="study__stats-line">
                    {strings.study.statsBlocksLabel}: {statsRecent?.blocks.done ?? 0}{" "}
                    {strings.study.statsBlocksDone} ·{" "}
                    <span className="study__stats-muted">
                      {statsRecent?.blocks.missed ?? 0} {strings.study.statsBlocksMissed}
                    </span>
                  </p>
                  {/*
                    The two named STUDY-013 metrics, read off `statsRecent` — the
                    30-day window — and not `statsYear`. A year of adherence
                    averages away the semester you are actually in; thirty days is
                    the stretch a student can still recognise as "lately", and it
                    is the same window every other line in this section already
                    reports, so „Poslednjih 30 dana" above labels the period once
                    for all of them. The bracketed maturity total is the one live
                    figure here and is written as such („ukupno … zrelih"), so it
                    cannot be misread as another 30-day count.
                  */}
                  <p className="study__stats-line">
                    {strings.study.statsMaturedLabel}: {statsRecent?.matured.inRange ?? 0}{" "}
                    <span className="study__stats-muted">
                      ({strings.study.statsMaturedTotalPrefix} {statsRecent?.matured.total ?? 0}{" "}
                      {strings.study.statsMaturedTotalSuffix})
                    </span>
                  </p>
                  <p className="study__stats-line">
                    {strings.study.statsAdherenceLabel}:{" "}
                    {formatAdherence(statsRecent?.adherence.ratio ?? null)}
                  </p>
                </>
              )}
            </div>

            <div className="study__focus-sessions">
              <h3 className="study__focus-sessions-heading">{strings.study.focusSessionsTitle}</h3>
              {focusSessionEntries.length === 0 ? (
                <p className="study__focus-sessions-empty">{strings.study.focusSessionsEmpty}</p>
              ) : (
                <div className="study__focus-sessions-list">
                  {focusSessionEntries.map(({ session, subject }) => (
                    <ListRow
                      key={session.id}
                      trailing={
                        <span className="study__focus-session-actions">
                          <Chip variant="data">
                            {formatDurationMinutes(focusSessionMinutes(session))}
                          </Chip>
                          <Button
                            size="sm"
                            className="study__delete"
                            aria-label={strings.study.deleteFocusSessionLabel}
                            onClick={() => void removeFocusSession(session.id)}
                          >
                            ×
                          </Button>
                        </span>
                      }
                    >
                      <span className="study__focus-session-info">
                        <span className="study__focus-session-subject">{subject.name}</span>
                        <span className="study__focus-session-time">
                          {formatFocusSessionWhen(session.startedAt)}
                        </span>
                      </span>
                    </ListRow>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {practiceSubjectId !== null && (
        <PracticeDialog
          decks={decksForSubject(practiceSubjectId)}
          countsFor={countsFor}
          onStart={startPractice}
          onClose={() => setPracticeSubjectId(null)}
        />
      )}

      {scopeCut !== null && (
        <ScopeCutDialog
          proposal={scopeCut.proposal}
          rows={scopeCutDialogRows}
          failed={scopeCut.failed}
          onAccept={() => void confirmScopeCut()}
          onClose={() => setScopeCut(null)}
        />
      )}

      {materialPreview !== null && (
        <AttachmentPreviewDialog
          profileId={profileId}
          module="subject"
          ownerId={materialPreview.subjectId}
          attachment={materialPreview.attachment}
          kind={materialPreview.kind}
          onClose={() => setMaterialPreview(null)}
        />
      )}
    </div>
  );
}

// --- Interleaved practice (STUDY-010 / ADR-047) -------------------------

interface PracticeDialogProps {
  /** The subject's špilovi, in the order the hub lists them. */
  decks: readonly Deck[];
  countsFor: (deckId: string) => DeckCounts;
  onStart: (deckIds: readonly string[], problemsOnly: boolean) => void;
  onClose: () => void;
}

/**
 * „Vežbaj" — which špilovi one interleaved practice session draws from, and
 * whether it asks only zadaci (ADR-047).
 *
 * Every deck starts CHECKED: the question the dialog asks is "anything you'd
 * rather leave out?", not "what would you like to study?" — the subject header
 * already answered the second one. „Samo zadaci" starts unchecked for the
 * mirror-image reason: it removes cards, so it is the user's to ask for.
 *
 * The house dialog recipe, shared outright with the recurrence-scope question,
 * the shortcuts reference and the widget gallery: backdrop and panel as
 * siblings, Escape and the backdrop close, focus lands inside and returns where
 * it came from, no glow.
 */
function PracticeDialog({ decks, countsFor, onStart, onClose }: PracticeDialogProps) {
  const s = strings.study.practice;
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(decks.map((deck) => deck.id)),
  );
  const [problemsOnly, setProblemsOnly] = useState(false);
  const titleId = useId();

  // Focus lands on the first špil, not on „Počni": the selection is what there
  // is to answer here, and „Počni" is disabled the moment nothing is checked —
  // the trap's own default (the first tabbable descendant), since the deck
  // checkboxes come before the actions row. It also cycles Tab within the
  // panel and hands focus back on close.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function toggleDeck(deckId: string): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(deckId)) next.add(deckId);
      return next;
    });
  }

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="recur-dialog__panel study-practice__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.title}
        </h2>
        <p className="recur-dialog__question">{s.decksLabel}</p>

        <div className="study-practice__body">
          {decks.map((deck) => {
            const counts = countsFor(deck.id);
            return (
              <div key={deck.id} className="study-practice__row">
                <Checkbox
                  className="study-practice__deck"
                  checked={selected.has(deck.id)}
                  onChange={() => toggleDeck(deck.id)}
                >
                  {deck.name}
                </Checkbox>
                <span className="study-practice__counts">
                  <Chip variant={countVariant(counts.newCount, "data")}>
                    {counts.newCount} {strings.study.newCount}
                  </Chip>
                  <Chip variant={countVariant(counts.dueCount, "accent")}>
                    {counts.dueCount} {strings.study.dueCount}
                  </Chip>
                </span>
              </div>
            );
          })}
        </div>

        <Checkbox
          className="study-practice__problems"
          checked={problemsOnly}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setProblemsOnly(event.target.checked)
          }
        >
          {s.problemsOnly}
        </Checkbox>

        <div className="recur-dialog__actions study-practice__actions">
          <Button className="recur-dialog__cancel" onClick={onClose}>
            {s.close}
          </Button>
          <Button
            variant="primary"
            disabled={selected.size === 0}
            onClick={() => onStart([...selected], problemsOnly)}
          >
            {s.start}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// --- Scope-cut proposal (ADR-063 / STUDY-004) ----------------------------

interface ScopeCutDialogProps {
  /** The fetched proposal, or null while it loads. */
  proposal: ScopeCutProposal | null;
  /** The proposal's topics joined with rank + remaining minutes (see `scopeCutRows`). */
  rows: readonly ScopeCutRow[];
  failed: boolean;
  onAccept: () => void;
  onClose: () => void;
}

/**
 * „Predlog skraćenja" — the scope-cut conversation (STUDY-004): the store's
 * computed proposal, listed topic by topic (rank, remaining minutes), with
 * accept/decline. Accepting is the only act that ever cuts a topic; declining
 * changes nothing.
 *
 * The house dialog recipe, shared outright with `PracticeDialog`: backdrop and
 * panel as siblings, Escape and the backdrop close, focus lands inside and
 * returns where it came from, no glow. Focus lands on „Odustani": a cut is a
 * deliberate act, not a default Enter should reach first.
 */
function ScopeCutDialog({ proposal, rows, failed, onAccept, onClose }: ScopeCutDialogProps) {
  const s = strings.study.scopeCut;
  const titleId = useId();

  // Focus lands on „Odustani" — the panel's first button — so Enter cannot
  // reach the cut before the user has read what it takes. That is also the
  // trap's own default (the first tabbable descendant): the rows above it are
  // plain text, never inputs. It also cycles Tab and hands focus back on close.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const acceptable = proposal !== null && proposal.topicIds.length > 0;

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="recur-dialog__panel study-cut__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.title}
        </h2>
        {failed ? (
          <p className="study__topic-error" role="alert">
            {s.loadError}
          </p>
        ) : proposal === null ? (
          <p className="app__muted">{strings.app.loading}</p>
        ) : !acceptable ? (
          <p className="app__muted">{s.empty}</p>
        ) : (
          <>
            <p className="recur-dialog__question">{s.intro}</p>
            <div className="study-cut__rows">
              {rows.map((row) => (
                <div key={row.id} className="study-cut__row">
                  <span className="study-cut__row-name">
                    {row.rank + 1}. {row.name}
                  </span>
                  <span className="study-cut__row-minutes">
                    {row.remainingMinutes} {s.minutesSuffix}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="recur-dialog__actions study-cut__actions">
          <Button className="recur-dialog__cancel" onClick={onClose}>
            {s.decline}
          </Button>
          <Button variant="primary" disabled={!acceptable || failed} onClick={onAccept}>
            {s.accept}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// --- Review session -----------------------------------------------------

interface ReviewSessionProps {
  profileId: string;
  scope: ReviewQueueScope;
  /** Non-null for an interleaved practice session (ADR-047); null for the ordinary reviewer. */
  practice: PracticeConfig | null;
  /** The profile's špilovi, for the per-card deck chip's client-side join. The `Card` contract does not carry a deck name. */
  decks: readonly Deck[];
  onExit: () => void;
}

interface GradeHistoryEntry {
  cardId: string;
  /** Whether grading this card requeued it at the end of the session (vs. leaving permanently). */
  requeued: boolean;
  /** Which button was pressed — kept so undo can take the grade back out of the session's tally (STUDY-009). */
  rating: CardRating;
}

/** How many times each button was pressed this session (STUDY-009). Grades, not cards: a requeued card graded twice is two presses, which is what a breakdown of ratings means. */
type RatingTally = Record<CardRating, number>;

const EMPTY_RATING_TALLY: RatingTally = { 1: 0, 2: 0, 3: 0, 4: 0 };

/**
 * A keyboard-first review session over `reviewQueue(profileId, scope)`,
 * fetched once. Grading a Learning/Relearning card whose next due is within
 * 15 minutes re-queues it at the end of the session queue; anything else
 * leaves permanently. A session-local stack of graded card ids backs
 * multi-level undo: it pops one grade at a time, rolling the DB back via
 * `undoReview` and dropping any requeued copy from the queue.
 *
 * Given a `practice` config it is the same reviewer with a different ORDER
 * (ADR-047): the fetched queue goes through `interleavePractice` exactly once,
 * right here, before it ever becomes `queue` — everything after that (requeue,
 * undo's unshift) works the materialized array, so a session in progress is
 * never reshuffled under the user.
 */
function ReviewSession({ profileId, scope, practice, decks, onExit }: ReviewSessionProps) {
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [total, setTotal] = useState(0);
  // Whether the fetched session actually drew from more than one špil — the
  // read that decides the per-card deck chip. Taken once, from the initial
  // queue: derived from `queue` it would go false as the session emptied out.
  const [spansDecks, setSpansDecks] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  // How much of the current card is uncovered (ADR-046). A basic or cloze card
  // has exactly ONE step, so 0 and 1 are precisely the old hidden/revealed
  // booleans and their behaviour is bit-identical; a problem card simply has
  // more of them, revealed one press at a time.
  const [revealedSteps, setRevealedSteps] = useState(0);
  const [preview, setPreview] = useState<PreviewIntervals | null>(null);
  // STUDY-009's summary state. The tally counts button presses and undo takes
  // one back out, so what the completion screen reports is always exactly the
  // session that stands — never a graded card the user has since rolled back.
  const [ratings, setRatings] = useState<RatingTally>(EMPTY_RATING_TALLY);
  // Whether the profile's daily review cap truncated THIS queue (STUDY-007) —
  // read once, from the fetch, because it is a fact about what was handed over.
  const [capReached, setCapReached] = useState(false);
  // Start and finish of the session as wall-clock ms. `startedAt` is the moment
  // the reviewer mounted (the fetch is part of the session, not before it);
  // `finishedAt` is set when the queue empties and cleared when an undo refills
  // it, so a resumed session is re-measured rather than reporting a stale span.
  const startedAtRef = useRef(Date.now());
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const historyRef = useRef<GradeHistoryEntry[]>([]);
  const scopeRef = useRef(scope);
  const practiceRef = useRef(practice);
  // Guards against a held-down grade key (auto-repeat) or a double-click firing
  // a second gradeReview for the same card before the first one lands — state
  // (`revealedSteps`) only changes after the await, so it can't serve as the guard.
  const gradingRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const fetched = await window.nexus.reviewQueue(profileId, scopeRef.current);
        if (!active) return;
        const config = practiceRef.current;
        // The single application of the interleave, before the queue exists.
        const initial = config
          ? interleavePractice(fetched.cards, (card) => card.deckId, config.seed)
          : fetched.cards;
        setQueue(initial);
        setTotal(initial.length);
        setCapReached(fetched.capReached);
        setSpansDecks(new Set(initial.map((card) => card.deckId)).size > 1);
      } catch (error) {
        console.error("Nexus: failed to load review queue:", error);
        if (active) {
          setQueue([]);
          setTotal(0);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  const current = queue && queue.length > 0 ? queue[0] : null;
  // A problem card's steps, or null for every other card — which then has the
  // single step every card has always had.
  const currentSteps = current ? problemStepsOf(current) : null;
  const totalSteps = currentSteps?.length ?? 1;
  const fullyRevealed = revealedSteps >= totalSteps;

  async function reveal(): Promise<void> {
    if (!current || fullyRevealed) return;
    const next = revealedSteps + 1;
    setRevealedSteps(next);
    // The intervals belong to grading, and grading only opens once the LAST
    // step is on screen — so the preview is fetched exactly then, on a problem
    // card as on any other.
    if (next < totalSteps) return;
    try {
      setPreview(await window.nexus.previewReview(profileId, current.id));
    } catch (error) {
      console.error("Nexus: failed to preview review intervals:", error);
      setPreview(null);
    }
  }

  async function grade(rating: CardRating): Promise<void> {
    if (!current || !fullyRevealed || !queue || gradingRef.current) return;
    gradingRef.current = true;
    try {
      const now = new Date().toISOString();
      const graded = await window.nexus.gradeReview(profileId, current.id, rating);
      const requeue = (graded.state === 1 || graded.state === 3) && isDueWithinSession(now, graded.due);

      historyRef.current.push({ cardId: current.id, requeued: requeue, rating });
      const rest = queue.slice(1);
      setQueue(requeue ? [...rest, graded] : rest);
      if (!requeue) setCompletedCount((n) => n + 1);
      setRatings((tally) => ({ ...tally, [rating]: tally[rating] + 1 }));
      setRevealedSteps(0);
      setPreview(null);
    } catch (error) {
      console.error("Nexus: failed to grade review:", error);
    } finally {
      gradingRef.current = false;
    }
  }

  async function undoLast(): Promise<void> {
    const entry = historyRef.current.pop();
    if (!entry) return;
    try {
      const restored = await window.nexus.undoReview(profileId, entry.cardId);
      setQueue((prev) => {
        const base = prev ?? [];
        const withoutRequeuedCopy = entry.requeued ? removeFirst(base, restored.id) : base;
        return [restored, ...withoutRequeuedCopy];
      });
      if (!entry.requeued) setCompletedCount((n) => Math.max(0, n - 1));
      setRatings((tally) => ({ ...tally, [entry.rating]: Math.max(0, tally[entry.rating] - 1) }));
      // Back to nothing uncovered — the restored card is asked again from its
      // statement, however many steps it has.
      setRevealedSteps(0);
      setPreview(null);
    } catch (error) {
      console.error("Nexus: failed to undo review:", error);
      // The undo did not take effect — put the entry back so a retry is possible.
      historyRef.current.push(entry);
    }
  }

  // The moment the session ended, stamped once (STUDY-009). An undo that puts a
  // card back clears it, so the summary a resumed-then-finished session shows
  // measures the whole thing rather than the first time it happened to empty.
  useEffect(() => {
    if (queue === null) return;
    setFinishedAt(queue.length === 0 ? Date.now() : null);
  }, [queue]);

  // Keyboard is the primary interface here — no inputs exist in this view, so
  // no target-type filtering is needed. Re-subscribing every render keeps the
  // closures (queue/revealedSteps/current) fresh without threading everything
  // through refs.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onExit();
        return;
      }
      if (event.key === "u" || event.key === "U") {
        event.preventDefault();
        void undoLast();
        return;
      }
      // Space/Enter uncovers the next step; on a one-step card that is the
      // whole answer, exactly as before.
      if ((event.key === " " || event.key === "Enter") && !fullyRevealed) {
        event.preventDefault();
        void reveal();
        return;
      }
      // The grade keys stay inert until the LAST step is on screen — grading a
      // problem card halfway through its solution would be grading a question
      // the user has not finished being asked.
      if (fullyRevealed && (event.key === "1" || event.key === "2" || event.key === "3" || event.key === "4")) {
        event.preventDefault();
        void grade(Number(event.key) as CardRating);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (queue === null) {
    return (
      <div className="review">
        <p className="app__muted">{strings.app.loading}</p>
      </div>
    );
  }

  // A practice selection that yielded nothing is not an accomplishment: the
  // user chose špilovi (and possibly „Samo zadaci") and there was nothing in
  // them, which the celebratory „Sve obnovljeno za sada." would misreport. The
  // empty selection is deliberately left exactly as it was — there is no
  // session to summarize.
  if (practice !== null && total === 0) {
    return (
      <div className="review review--complete">
        <p className="review__complete-title">{strings.study.practice.empty}</p>
        <div className="review__complete-actions">
          <Button variant="primary" onClick={onExit}>
            {strings.study.reviewBack}
          </Button>
        </div>
      </div>
    );
  }

  if (current == null) {
    const summary = strings.study.summary;
    const gradeCount = CARD_RATINGS.reduce((sum, rating) => sum + ratings[rating], 0);
    return (
      <div className="review review--complete">
        <p className="review__complete-title">{strings.study.reviewCompleteTitle}</p>
        <p className="review__complete-count">
          {strings.study.reviewCompleteLabel}: {completedCount}
        </p>
        {/* The detail only exists once something was actually graded — a queue
            that was empty on arrival has nothing to break down. */}
        {gradeCount > 0 && (
          <div className="review__summary">
            {/* The four labels ARE the row's own caption — „Ponovo 3 · Teško 1"
                needs no heading above it to say what it is. */}
            <dl className="review__summary-ratings">
              {CARD_RATINGS.map((rating) => (
                <div key={rating} className="review__summary-rating">
                  <dt className="review__summary-rating-label">
                    {strings.study.rating[RATING_KEYS[rating]]}
                  </dt>
                  <dd className="review__summary-rating-count">{ratings[rating]}</dd>
                </div>
              ))}
            </dl>
            {finishedAt !== null && (
              <p className="review__summary-duration">
                {summary.durationLabel}: {formatElapsed(finishedAt - startedAtRef.current)}
              </p>
            )}
          </div>
        )}
        {/* STUDY-007: said out loud, because "nothing left" and "today's ceiling
            is spent" are different reasons for the same empty queue. */}
        {capReached && <p className="review__summary-cap">{summary.capReached}</p>}
        <div className="review__complete-actions">
          {historyRef.current.length > 0 && (
            <Button onClick={() => void undoLast()}>{strings.study.reviewUndo}</Button>
          )}
          <Button variant="primary" onClick={onExit}>
            {strings.study.reviewBack}
          </Button>
        </div>
      </div>
    );
  }

  const now = new Date().toISOString();
  const clozeSegments = clozeSegmentsOf(current);
  // Which špil this card came from — a client-side join over the already-loaded
  // deck list (the ExamsWidget idiom), shown only when the session actually
  // spans more than one, where "which topic is this?" is a real question.
  const deckNames = new Map(decks.map((deck) => [deck.id, deck.name] as const));
  const deckName = spansDecks ? deckNames.get(current.deckId) : undefined;

  return (
    <div className="review">
      <div className="review__topbar">
        <span className="review__title">
          {practice !== null ? strings.study.practice.title : strings.study.reviewTitle}
        </span>
        <span className="review__progress">
          {Math.min(completedCount + 1, total)} / {total}
        </span>
        <Button size="sm" className="review__exit" onClick={onExit}>
          {strings.study.reviewExit}
        </Button>
      </div>

      <div className="review__card">
        {deckName !== undefined && (
          // `title`, not `aria-label`: the accessible name must stay the špil's
          // own name — the label only says what kind of thing that name is.
          <Chip variant="data" className="review__deck" title={strings.study.practice.deckChipLabel}>
            {deckName}
          </Chip>
        )}
        {clozeSegments !== null ? (
          // One line, two states: the blank fills in where it stood, and the
          // sentence around it never moves (ADR-042). No divider and no
          // separate back — there is nothing to separate.
          <div className="review__front">
            <ClozeLine segments={clozeSegments} revealed={fullyRevealed} />
          </div>
        ) : currentSteps !== null ? (
          // A problem card: the STATEMENT never leaves the screen, and the
          // solution grows under it one step per press (ADR-046). No separate
          // back — the steps are the back.
          <>
            <div className="review__front">
              <MathText text={current.front} />
            </div>
            {revealedSteps > 0 && (
              <>
                <div className="review__divider" />
                <ol className="review__steps">
                  {currentSteps.slice(0, revealedSteps).map((step, index) => (
                    <li key={index} className="review__step">
                      <MathText text={step} />
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        ) : (
          <>
            <div className="review__front">
              <MathText text={current.front} />
            </div>
            {fullyRevealed && (
              <>
                <div className="review__divider" />
                <div className="review__back">
                  <MathText text={current.back} />
                </div>
              </>
            )}
          </>
        )}
      </div>

      {!fullyRevealed ? (
        <Button variant="primary" className="review__reveal" onClick={() => void reveal()}>
          {currentSteps === null ? strings.study.revealAnswer : strings.study.revealNextStep}
        </Button>
      ) : (
        <div className="review__grades">
          {CARD_RATINGS.map((rating) => {
            const key = RATING_KEYS[rating];
            return (
              <Button
                key={rating}
                variant={rating === 1 ? "danger" : "ghost"}
                className={`review__grade review__grade--${key}`}
                onClick={() => void grade(rating)}
              >
                <span className="review__grade-label">{strings.study.rating[key]}</span>
                {preview && <span className="review__grade-interval">{intervalLabel(now, preview[key])}</span>}
              </Button>
            );
          })}
        </div>
      )}

      <div className="review__footer">
        {historyRef.current.length > 0 && (
          <Button size="sm" className="review__undo" onClick={() => void undoLast()}>
            {strings.study.reviewUndo}
          </Button>
        )}
        <p className="review__hint">{strings.study.reviewHint}</p>
      </div>
    </div>
  );
}
