export { NexusDatabase, openDatabase } from "./database.js";
export type { OpenDatabaseOptions } from "./database.js";

export {
  DatabaseError,
  DatabaseKeyError,
  DatabaseLockedError,
  SchemaVersionError,
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

export { uuidv7 } from "./ids.js";
