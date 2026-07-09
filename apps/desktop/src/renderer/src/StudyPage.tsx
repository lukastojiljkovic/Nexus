import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Checkbox, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
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
  ExamType,
  NewCardFields,
  NewDeckFields,
  NewExamFields,
  NewPlanFields,
  NewSubjectFields,
  PlanFieldChanges,
  PreviewIntervals,
  ReviewQueueScope,
  StudyBlock,
  StudyBlockStatus,
  StudyBlockWithExam,
  StudyPlan,
  Subject,
  SubjectColor,
  SubjectFieldChanges,
} from "../../shared/ipc.js";
import {
  daysUntilExam,
  examCountdownLabel,
  examCountdownVariant,
  formatExamDate,
  localTodayKey,
} from "./examDates.js";
import { MathText } from "./MathText.js";
import { intervalLabel, isDueWithinSession } from "./reviewIntervals.js";
import { strings } from "./strings.js";

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
const CARD_RATINGS: readonly CardRating[] = [1, 2, 3, 4];
const RATING_KEYS: Record<CardRating, keyof typeof strings.study.rating> = {
  1: "again",
  2: "hard",
  3: "good",
  4: "easy",
};

/** Mirrors CardStore's MAX_TEXT_LENGTH — client-side parity with the store's own validation. */
const MAX_CARD_TEXT_LENGTH = 10000;

/** Mirrors PlanStore's daily-minutes bounds — client-side parity with the store's own validation. */
const MIN_PLAN_MINUTES = 15;
const MAX_PLAN_MINUTES = 480;

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
  return copy.generic;
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

export interface StudyPageProps {
  profileId: string;
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
export function StudyPage({ profileId }: StudyPageProps) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [deckCounts, setDeckCounts] = useState<DeckCounts[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

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
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [planFormVisible, setPlanFormVisible] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planExamId, setPlanExamId] = useState("");
  const [planStartDate, setPlanStartDate] = useState("");
  const [planMinutes, setPlanMinutes] = useState("60");
  const [planBoost, setPlanBoost] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [pendingUndoPlanId, setPendingUndoPlanId] = useState<string | null>(null);

  // Internal routing: the hub, a deck's card-management drill-in, or a review
  // session. No router — a discriminated union kept in component state.
  const [route, setRoute] = useState<
    { kind: "hub" } | { kind: "deck"; deckId: string } | { kind: "review"; scope: ReviewQueueScope }
  >({ kind: "hub" });
  const activeDeckId = route.kind === "deck" ? route.deckId : null;

  const [cards, setCards] = useState<Card[] | null>(null);
  const [cardsFailed, setCardsFailed] = useState(false);
  const [cardFormVisible, setCardFormVisible] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardFront, setCardFront] = useState("");
  const [cardBack, setCardBack] = useState("");
  const [cardDeckId, setCardDeckId] = useState("");
  const [pendingUndoCardId, setPendingUndoCardId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Sync every plan before any read so past blocks are already labelled
        // `missed` when the today strip and the plan lists render.
        await window.nexus.syncAllPlans(profileId);
        const today = localTodayKey();
        const [nextSubjects, nextExams, nextDecks, nextCounts, nextPlans, nextTodayBlocks] =
          await Promise.all([
            window.nexus.listSubjects(profileId),
            window.nexus.listExams(profileId),
            window.nexus.listDecks(profileId),
            window.nexus.cardCounts(profileId),
            window.nexus.listPlans(profileId),
            window.nexus.listBlocksInRange(profileId, today, today),
          ]);
        const blockLists = await Promise.all(
          nextPlans.map((plan) => window.nexus.listBlocksByPlan(profileId, plan.id)),
        );
        if (!active) return;
        setSubjects(nextSubjects);
        setExams(nextExams);
        setDecks(nextDecks);
        setDeckCounts(nextCounts);
        setPlans(nextPlans);
        setTodayBlocks(nextTodayBlocks);
        setBlocksByPlan(
          Object.fromEntries(nextPlans.map((plan, index) => [plan.id, blockLists[index] ?? []])),
        );
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load study data:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  useEffect(() => {
    if (activeDeckId == null) return;
    let active = true;
    setCards(null);
    setCardsFailed(false);
    void (async () => {
      try {
        const list = await window.nexus.listCardsByDeck(profileId, activeDeckId);
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

  async function reloadSubjects(): Promise<void> {
    setSubjects(await window.nexus.listSubjects(profileId));
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
    } catch (error) {
      console.error("Nexus: failed to (un)archive subject:", error);
    }
  }

  async function removeSubject(subject: Subject): Promise<void> {
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
      console.error("Nexus: failed to delete subject:", error);
    }
  }

  async function undoSubject(): Promise<void> {
    if (!pendingUndoSubjectId) return;
    try {
      await window.nexus.restoreSubject(profileId, pendingUndoSubjectId);
      setPendingUndoSubjectId(null);
      await reloadSubjects();
    } catch (error) {
      console.error("Nexus: failed to restore subject:", error);
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
    try {
      await window.nexus.deleteExam(profileId, exam.id);
      setExams((prev) => prev && prev.filter((e) => e.id !== exam.id));
      if (editingExamId === exam.id) closeExamForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoExamId(exam.id);
    } catch (error) {
      console.error("Nexus: failed to delete exam:", error);
    }
  }

  async function undoExam(): Promise<void> {
    if (!pendingUndoExamId) return;
    try {
      await window.nexus.restoreExam(profileId, pendingUndoExamId);
      setPendingUndoExamId(null);
      await reloadExams();
    } catch (error) {
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
    try {
      await window.nexus.deleteDeck(profileId, deck.id);
      setDecks((prev) => prev && prev.filter((d) => d.id !== deck.id));
      if (editingDeckId === deck.id) closeDeckForm();
      if (route.kind === "deck" && route.deckId === deck.id) setRoute({ kind: "hub" });
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoDeckId(deck.id);
      await reloadDeckCounts();
    } catch (error) {
      console.error("Nexus: failed to delete deck:", error);
    }
  }

  async function undoDeck(): Promise<void> {
    if (!pendingUndoDeckId) return;
    try {
      await window.nexus.restoreDeck(profileId, pendingUndoDeckId);
      setPendingUndoDeckId(null);
      await Promise.all([reloadDecks(), reloadDeckCounts()]);
    } catch (error) {
      console.error("Nexus: failed to restore deck:", error);
    }
  }

  /** Re-syncs every plan (missed labelling), then re-fetches plans, the today strip and each plan's blocks. */
  async function refreshPlans(): Promise<void> {
    await window.nexus.syncAllPlans(profileId);
    const today = localTodayKey();
    const [nextPlans, nextTodayBlocks] = await Promise.all([
      window.nexus.listPlans(profileId),
      window.nexus.listBlocksInRange(profileId, today, today),
    ]);
    const blockLists = await Promise.all(
      nextPlans.map((plan) => window.nexus.listBlocksByPlan(profileId, plan.id)),
    );
    setPlans(nextPlans);
    setTodayBlocks(nextTodayBlocks);
    setBlocksByPlan(
      Object.fromEntries(nextPlans.map((plan, index) => [plan.id, blockLists[index] ?? []])),
    );
  }

  function closePlanForm(): void {
    setPlanFormVisible(false);
    setEditingPlanId(null);
    setPlanExamId("");
    setPlanStartDate("");
    setPlanMinutes("60");
    setPlanBoost(true);
    setPlanError(null);
  }

  function startAddPlan(firstExamId: string): void {
    setPlanFormVisible(true);
    setEditingPlanId(null);
    setPlanExamId(firstExamId);
    setPlanStartDate(localTodayKey());
    setPlanMinutes("60");
    setPlanBoost(true);
    setPlanError(null);
  }

  function startEditPlan(plan: StudyPlan): void {
    setPlanFormVisible(true);
    setEditingPlanId(plan.id);
    setPlanExamId(plan.examId);
    setPlanStartDate(plan.startDate.slice(0, 10));
    setPlanMinutes(String(plan.dailyMinutes));
    setPlanBoost(plan.examWeekBoost);
    setPlanError(null);
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

    try {
      if (editingPlanId != null) {
        const changes: PlanFieldChanges = {
          dailyMinutes,
          startDate: planStartDate,
          examWeekBoost: planBoost,
        };
        await window.nexus.updatePlan(profileId, editingPlanId, changes);
      } else {
        if (planExamId.length === 0) return;
        const fields: NewPlanFields = {
          examId: planExamId,
          dailyMinutes,
          startDate: planStartDate,
          examWeekBoost: planBoost,
        };
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
    try {
      await window.nexus.deletePlan(profileId, planId);
      if (editingPlanId === planId) closePlanForm();
      if (expandedPlanId === planId) setExpandedPlanId(null);
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoPlanId(planId);
      await refreshPlans();
    } catch (error) {
      console.error("Nexus: failed to delete study plan:", error);
    }
  }

  async function undoPlan(): Promise<void> {
    if (!pendingUndoPlanId) return;
    try {
      await window.nexus.restorePlan(profileId, pendingUndoPlanId);
      setPendingUndoPlanId(null);
      await refreshPlans();
    } catch (error) {
      // Mirrors the other restore paths. A collision with a newer active plan
      // for the same exam (PlanValidationError) lands here; the offer stays up.
      console.error("Nexus: failed to restore study plan:", error);
    }
  }

  /** Done ↔ planned toggle for a block (a missed block marked done is a late completion). */
  async function toggleBlockDone(blockId: string, done: boolean): Promise<void> {
    try {
      const updated = await window.nexus.setBlockStatus(profileId, blockId, done ? "done" : "planned");
      setTodayBlocks(
        (prev) =>
          prev &&
          prev.map((block) =>
            block.id === updated.id
              ? { ...block, status: updated.status, updatedAt: updated.updatedAt }
              : block,
          ),
      );
      setBlocksByPlan((prev) => {
        const list = prev[updated.planId];
        if (!list) return prev;
        return {
          ...prev,
          [updated.planId]: list.map((block) => (block.id === updated.id ? updated : block)),
        };
      });
    } catch (error) {
      console.error("Nexus: failed to set block status:", error);
    }
  }

  function closeCardForm(): void {
    setCardFormVisible(false);
    setEditingCardId(null);
    setCardFront("");
    setCardBack("");
    setCardDeckId("");
  }

  function startAddCard(deckId: string): void {
    setCardFormVisible(true);
    setEditingCardId(null);
    setCardFront("");
    setCardBack("");
    setCardDeckId(deckId);
  }

  function startEditCard(card: Card): void {
    setCardFormVisible(true);
    setEditingCardId(card.id);
    setCardFront(card.front);
    setCardBack(card.back);
    setCardDeckId(card.deckId);
  }

  async function submitCardForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedFront = cardFront.trim();
    const trimmedBack = cardBack.trim();
    if (trimmedFront.length === 0 || trimmedBack.length === 0) return;
    if (trimmedFront.length > MAX_CARD_TEXT_LENGTH || trimmedBack.length > MAX_CARD_TEXT_LENGTH) return;

    try {
      if (editingCardId != null) {
        const changes: CardFieldChanges = { deckId: cardDeckId, front: trimmedFront, back: trimmedBack };
        const updated = await window.nexus.updateCard(profileId, editingCardId, changes);
        setCards((prev) => {
          if (!prev) return prev;
          // Moved to a different deck: it leaves this drill-in's list.
          if (activeDeckId != null && updated.deckId !== activeDeckId) {
            return prev.filter((c) => c.id !== updated.id);
          }
          return prev.map((c) => (c.id === updated.id ? updated : c));
        });
      } else {
        const fields: NewCardFields = { deckId: cardDeckId, front: trimmedFront, back: trimmedBack };
        const created = await window.nexus.createCard(profileId, fields);
        setCards((prev) => (prev ? [...prev, created] : [created]));
      }
      closeCardForm();
      await reloadDeckCounts();
    } catch (error) {
      console.error("Nexus: failed to save card:", error);
    }
  }

  async function removeCard(card: Card): Promise<void> {
    try {
      await window.nexus.deleteCard(profileId, card.id);
      setCards((prev) => prev && prev.filter((c) => c.id !== card.id));
      if (editingCardId === card.id) closeCardForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoCardId(card.id);
      await reloadDeckCounts();
    } catch (error) {
      console.error("Nexus: failed to delete card:", error);
    }
  }

  async function undoCard(): Promise<void> {
    if (!pendingUndoCardId || activeDeckId == null) return;
    try {
      await window.nexus.restoreCard(profileId, pendingUndoCardId);
      setPendingUndoCardId(null);
      await Promise.all([reloadCards(activeDeckId), reloadDeckCounts()]);
    } catch (error) {
      console.error("Nexus: failed to restore card:", error);
    }
  }

  function startReview(scope: ReviewQueueScope): void {
    setRoute({ kind: "review", scope });
  }

  function exitReview(): void {
    setRoute({ kind: "hub" });
    void reloadDeckCounts();
  }

  const loading =
    subjects === null ||
    exams === null ||
    decks === null ||
    deckCounts === null ||
    plans === null ||
    todayBlocks === null;
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

  // --- Review session route --------------------------------------------------
  if (route.kind === "review") {
    return <ReviewSession profileId={profileId} scope={route.scope} onExit={exitReview} />;
  }

  // --- Deck drill-in route (card management) ---------------------------------
  if (route.kind === "deck") {
    const deck = decks?.find((d) => d.id === route.deckId);
    const deckSubject = deck ? subjects?.find((s) => s.id === deck.subjectId) : undefined;
    const deckOptions = deck ? decksForSubject(deck.subjectId) : [];

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
                          <span className="study__card-due">{formatCardDue(card.due)}</span>
                        )}
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
                      </span>
                    }
                  >
                    <MathText text={card.front} className="study__card-front" />
                  </ListRow>
                ))}
              </div>
            )}

            {cardFormVisible ? (
              <form className="study__card-form" onSubmit={(e) => void submitCardForm(e)}>
                <div className="study__card-field">
                  <textarea
                    className="nx-textfield__input study__textarea"
                    value={cardFront}
                    placeholder={strings.study.frontPlaceholder}
                    aria-label={strings.study.frontLabel}
                    maxLength={MAX_CARD_TEXT_LENGTH}
                    autoFocus
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCardFront(event.target.value)}
                  />
                  {cardFront.trim().length > 0 && (
                    <div className="study__math-preview">
                      <MathText text={cardFront} />
                    </div>
                  )}
                </div>
                <div className="study__card-field">
                  <textarea
                    className="nx-textfield__input study__textarea"
                    value={cardBack}
                    placeholder={strings.study.backPlaceholder}
                    aria-label={strings.study.backLabel}
                    maxLength={MAX_CARD_TEXT_LENGTH}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCardBack(event.target.value)}
                  />
                  {cardBack.trim().length > 0 && (
                    <div className="study__math-preview">
                      <MathText text={cardBack} />
                    </div>
                  )}
                </div>
                <p className="study__math-hint">{strings.study.mathHint}</p>
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
                  <Button type="submit" variant="primary" size="sm">
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

  // --- Hub route (subjects, exams, decks) -------------------------------------
  return (
    <div className="study">
      <h1 className="study__title">{strings.study.title}</h1>

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
                <div key={subject.id} className="study__subject-card">
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
                            <span className="study__exam-item">
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

                  <div className="study__decks">
                    <div className="study__decks-header">
                      <h3 className="study__decks-title">{strings.study.decksTitle}</h3>
                      {subjectHasStudiable(subject.id) && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => startReview({ subjectId: subject.id })}
                        >
                          {strings.study.studyAll}
                        </Button>
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
                            <span className="study__deck-name">{deck.name}</span>
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
                      <span className="study__subject-name">{subject.name}</span>
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
                  {todayEntries.map(({ block, exam, subject }) => (
                    <ListRow
                      key={block.id}
                      trailing={
                        <span className="study__block-minutes">
                          {block.minutes} {strings.study.minutesUnit}
                        </span>
                      }
                    >
                      <Checkbox
                        checked={block.status === "done"}
                        done={block.status === "done"}
                        onChange={(event) => void toggleBlockDone(block.id, event.target.checked)}
                      >
                        {subject.name} — {strings.study.examType[exam.examType]}
                      </Checkbox>
                    </ListRow>
                  ))}
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
                    <Button
                      size="sm"
                      className="study__plan-toggle"
                      onClick={() => setExpandedPlanId(expanded ? null : plan.id)}
                    >
                      {expanded ? strings.study.planHideBlocks : strings.study.planShowBlocks}
                    </Button>
                    {expanded && (
                      <div className="study__plan-blocks">
                        {blocks.map((block) => (
                          <ListRow
                            key={block.id}
                            muted={block.status === "missed"}
                            trailing={
                              <span className="study__block-meta">
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
                                void toggleBlockDone(block.id, event.target.checked)
                              }
                            >
                              {formatBlockDay(block.blockDate)}
                            </Checkbox>
                          </ListRow>
                        ))}
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
        </>
      )}
    </div>
  );
}

// --- Review session -----------------------------------------------------

interface ReviewSessionProps {
  profileId: string;
  scope: ReviewQueueScope;
  onExit: () => void;
}

interface GradeHistoryEntry {
  cardId: string;
  /** Whether grading this card requeued it at the end of the session (vs. leaving permanently). */
  requeued: boolean;
}

/**
 * A keyboard-first review session over `reviewQueue(profileId, scope)`,
 * fetched once. Grading a Learning/Relearning card whose next due is within
 * 15 minutes re-queues it at the end of the session queue; anything else
 * leaves permanently. A session-local stack of graded card ids backs
 * multi-level undo: it pops one grade at a time, rolling the DB back via
 * `undoReview` and dropping any requeued copy from the queue.
 */
function ReviewSession({ profileId, scope, onExit }: ReviewSessionProps) {
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [preview, setPreview] = useState<PreviewIntervals | null>(null);
  const historyRef = useRef<GradeHistoryEntry[]>([]);
  const scopeRef = useRef(scope);
  // Guards against a held-down grade key (auto-repeat) or a double-click firing
  // a second gradeReview for the same card before the first one lands — state
  // (`revealed`) only flips after the await, so it can't serve as the guard.
  const gradingRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const initial = await window.nexus.reviewQueue(profileId, scopeRef.current);
        if (!active) return;
        setQueue(initial);
        setTotal(initial.length);
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

  async function reveal(): Promise<void> {
    if (!current || revealed) return;
    setRevealed(true);
    try {
      setPreview(await window.nexus.previewReview(profileId, current.id));
    } catch (error) {
      console.error("Nexus: failed to preview review intervals:", error);
      setPreview(null);
    }
  }

  async function grade(rating: CardRating): Promise<void> {
    if (!current || !revealed || !queue || gradingRef.current) return;
    gradingRef.current = true;
    try {
      const now = new Date().toISOString();
      const graded = await window.nexus.gradeReview(profileId, current.id, rating);
      const requeue = (graded.state === 1 || graded.state === 3) && isDueWithinSession(now, graded.due);

      historyRef.current.push({ cardId: current.id, requeued: requeue });
      const rest = queue.slice(1);
      setQueue(requeue ? [...rest, graded] : rest);
      if (!requeue) setCompletedCount((n) => n + 1);
      setRevealed(false);
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
      setRevealed(false);
      setPreview(null);
    } catch (error) {
      console.error("Nexus: failed to undo review:", error);
      // The undo did not take effect — put the entry back so a retry is possible.
      historyRef.current.push(entry);
    }
  }

  // Keyboard is the primary interface here — no inputs exist in this view, so
  // no target-type filtering is needed. Re-subscribing every render keeps the
  // closures (queue/revealed/current) fresh without threading everything
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
      if ((event.key === " " || event.key === "Enter") && !revealed) {
        event.preventDefault();
        void reveal();
        return;
      }
      if (revealed && (event.key === "1" || event.key === "2" || event.key === "3" || event.key === "4")) {
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

  if (current == null) {
    return (
      <div className="review review--complete">
        <p className="review__complete-title">{strings.study.reviewCompleteTitle}</p>
        <p className="review__complete-count">
          {strings.study.reviewCompleteLabel}: {completedCount}
        </p>
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

  return (
    <div className="review">
      <div className="review__topbar">
        <span className="review__title">{strings.study.reviewTitle}</span>
        <span className="review__progress">
          {Math.min(completedCount + 1, total)} / {total}
        </span>
        <Button size="sm" className="review__exit" onClick={onExit}>
          {strings.study.reviewExit}
        </Button>
      </div>

      <div className="review__card">
        <div className="review__front">
          <MathText text={current.front} />
        </div>
        {revealed && (
          <>
            <div className="review__divider" />
            <div className="review__back">
              <MathText text={current.back} />
            </div>
          </>
        )}
      </div>

      {!revealed ? (
        <Button variant="primary" className="review__reveal" onClick={() => void reveal()}>
          {strings.study.revealAnswer}
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
