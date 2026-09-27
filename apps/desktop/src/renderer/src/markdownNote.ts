/**
 * The markdown-to-note path, as a module of its own so the shell can reach it
 * with `import()`.
 *
 * `Onboarding` writes one welcome note per profile, ever, and before this file
 * existed its static import of these two functions was the only reason Yjs and
 * the markdown importer sat in the chunk every session parses at startup —
 * about 270 kB of it, for a write that happens once. `@nexus/core` cannot be the
 * target of that `import()` itself: the shell already imports it statically, so
 * a dynamic import of the package resolves to the startup chunk and moves
 * nothing. A module that is imported ONLY dynamically is what gives the bundler
 * a boundary to put a chunk behind.
 *
 * `attachmentPreview.tsx` imports the same two statically, which is correct:
 * it is part of the note and file pages, which are loaded lazily already.
 */
export { buildNoteUpdate, parseMarkdownNote } from "@nexus/core";
