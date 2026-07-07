export { NexusDatabase, openDatabase } from "./database.js";
export type { OpenDatabaseOptions } from "./database.js";

export {
  DatabaseError,
  DatabaseKeyError,
  DatabaseLockedError,
  DocumentNotFoundError,
  DocumentValidationError,
  EventNotFoundError,
  EventValidationError,
  ExamNotFoundError,
  ExamValidationError,
  SchemaVersionError,
  SubjectNotFoundError,
  SubjectValidationError,
  TaskNotFoundError,
  TaskValidationError,
} from "./errors.js";

export { MIGRATIONS, runMigrations } from "./migrations/migrations.js";
export type { Migration } from "./migrations/migrations.js";

export { SqliteFlagStore } from "./flags/sqliteFlagStore.js";

export { TaskStore, TASK_PRIORITIES, TASK_STATUSES } from "./tasks/taskStore.js";
export type {
  CreateTaskInput,
  Task,
  TaskPriority,
  TaskStatus,
  UpdateTaskFields,
} from "./tasks/taskStore.js";

export { EventStore } from "./events/eventStore.js";
export type { CreateEventInput, Event, UpdateEventFields } from "./events/eventStore.js";

export {
  DocumentStore,
  DOCUMENT_TYPES,
  DEFAULT_REMINDER_LADDERS,
} from "./documents/documentStore.js";
export type {
  CreateDocumentInput,
  DocumentRenewal,
  DocumentStatus,
  DocumentType,
  TrackedDocument,
  UpdateDocumentFields,
} from "./documents/documentStore.js";

export { SubjectStore, SUBJECT_COLORS } from "./study/subjectStore.js";
export type {
  CreateSubjectInput,
  Subject,
  SubjectColor,
  UpdateSubjectFields,
} from "./study/subjectStore.js";

export { ExamStore, EXAM_TYPES } from "./study/examStore.js";
export type {
  CreateExamInput,
  Exam,
  ExamType,
  UpdateExamFields,
} from "./study/examStore.js";

export { uuidv7 } from "./ids.js";
