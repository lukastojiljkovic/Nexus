import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Button, Chip, EmptyState, ListRow, TextField } from "@nexus/ui";
import type {
  Exam,
  ExamFieldChanges,
  ExamType,
  NewExamFields,
  NewSubjectFields,
  Subject,
  SubjectColor,
  SubjectFieldChanges,
} from "../../shared/ipc.js";
import { daysUntilExam, examCountdownLabel, examCountdownVariant, formatExamDate } from "./examDates.js";
import { strings } from "./strings.js";

// --- Field orderings (renderer mirror of @nexus/db) -------------------------
//
// The renderer never imports DB/Node code (SEC-EL-02: the wire contract stays
// self-contained), so the option orders are redeclared here, matching
// SUBJECT_COLORS / EXAM_TYPES in @nexus/db. The Serbian labels live in
// strings.ts, applied at render time.
const SUBJECT_COLORS: readonly SubjectColor[] = [
  "jade",
  "gold",
  "bronze",
  "burgundy",
  "crimson",
  "graphite",
];
const EXAM_TYPES: readonly ExamType[] = ["pismeni", "usmeni", "kolokvijum"];

// Serbian Latin collation for subject names (mirrors @nexus/core's views engine
// collator) — plain "sr" resolves to the Cyrillic tailoring and misorders š/č/ć.
const collator = new Intl.Collator(["sr-Latn", "sr"]);

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
 * The STUDY module page (v0 basics): a subject hub. One form both adds and
 * edits subjects (name, colour, optional semester); each subject is a card
 * listing its exams (sorted soonest first) with a countdown chip, and its own
 * inline add/edit exam form. Archiving moves a subject into a collapsed
 * secondary section without deleting it; both subjects and exams support
 * delete-with-undo. Every write goes through the subjects:* / exams:* IPC
 * allowlist, so the store stays the single source of truth.
 */
export function StudyPage({ profileId }: StudyPageProps) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
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

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [nextSubjects, nextExams] = await Promise.all([
          window.nexus.listSubjects(profileId),
          window.nexus.listExams(profileId),
        ]);
        if (!active) return;
        setSubjects(nextSubjects);
        setExams(nextExams);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load study data:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function reloadSubjects(): Promise<void> {
    setSubjects(await window.nexus.listSubjects(profileId));
  }

  async function reloadExams(): Promise<void> {
    setExams(await window.nexus.listExams(profileId));
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
      // Never leave the subject form or an exam form bound to a gone subject.
      if (editingSubjectId === subject.id) resetSubjectForm();
      if (examFormSubjectId === subject.id) closeExamForm();
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

  const loading = subjects === null || exams === null;
  const sortedSubjects = subjects ? [...subjects].sort((a, b) => collator.compare(a.name, b.name)) : [];
  const activeSubjects = sortedSubjects.filter((s) => !s.archived);
  const archivedSubjects = sortedSubjects.filter((s) => s.archived);

  /** This subject's exams, soonest first (create appends optimistically). */
  function examsForSubject(subjectId: string): Exam[] {
    return (exams ?? [])
      .filter((exam) => exam.subjectId === subjectId)
      .sort((a, b) => a.examDate.localeCompare(b.examDate) || a.id.localeCompare(b.id));
  }

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
        </>
      )}
    </div>
  );
}
