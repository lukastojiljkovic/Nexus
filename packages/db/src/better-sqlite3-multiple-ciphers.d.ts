/**
 * `better-sqlite3-multiple-ciphers` is a drop-in fork of `better-sqlite3` that
 * ships no type declarations of its own. Its API is identical, so we alias it
 * to `@types/better-sqlite3` via an ambient re-export.
 *
 * Typing route: reuse `@types/better-sqlite3` (no hand-written surface).
 */
declare module "better-sqlite3-multiple-ciphers" {
  import Database = require("better-sqlite3");
  export = Database;
}
