/**
 * Pure builder for the IMEX full-export archive (PRD 14 IMEX-001, ADR-009's
 * container layout). Takes plain data arrays plus everything time/version-ish
 * the caller already knows (`createdAt`, `appVersion`, a `hash` function) and
 * returns the archive's text files as an in-memory map, plus a DECLARED
 * inventory of its binary entries — no clock reads, no file IO, no `node:`
 * imports. `apps/desktop`'s main process is the only caller: it gathers rows
 * from `@nexus/db`'s stores, stamps `createdAt`/`appVersion`, injects a real
 * sha256 `hash`, and streams the result into a `.nexus.zip` with `yazl`,
 * resolving each declared binary entry (reading and decrypting attachment
 * blobs one at a time) as it goes — see `ExportBinaryEntry`.
 *
 * Row shapes are declared as minimal structural interfaces (only the fields
 * this module serializes) rather than imported from `@nexus/db` — `@nexus/core`
 * must stay platform-neutral and dependency-free of `@nexus/db`. TypeScript's
 * structural typing means the caller's real store rows (which carry these
 * fields and more) satisfy these interfaces without adapting. The field list
 * and order of each interface IS the interchange contract (ADR-009: "the
 * interchange schema becomes the de-facto public API of Nexus data") — changed
 * deliberately, not incidentally.
 *
 * IMEX-003 lets the caller name WHICH modules ride (`ExportArchiveInput.modules`,
 * absent = all). The result is a real archive of fewer modules, not a partial
 * one: see `filterProfileData` for the module↔collection mapping and the three
 * cross-module references it repairs so nothing in a subset archive dangles.
 */

import type { FocusOutcome, FocusPhaseKind } from "../focus/focusSession.js";
import type { FoodMacros, FoodServing } from "../fitness/food.js";
import type {
  ActivityLevel,
  BodyCircumferences,
  BodySex,
  MuscleReading,
} from "../fitness/body.js";
import type {
  ExerciseEquipment,
  ExerciseMetric,
  MovementPattern,
  MuscleGroup,
} from "../fitness/exercise.js";
import type { SetKind } from "../fitness/training.js";
import type { CanvasScene } from "../canvas/canvasScene.js";
import type { HabitSchedule } from "../habits/habitSchedule.js";
import type { RecurrenceRule } from "../recurrence/recurrence.js";
import type { TaskViewConfig } from "../tasks/taskViewConfig.js";
import { base64ToBytes } from "../bytes.js";
import { claimUniqueName, sanitizePathSegment, UNTITLED_NOTE_NAME } from "./archivePaths.js";
import { toCsv } from "./csv.js";
import { buildIcsCalendar } from "./icsExport.js";
import { renderNoteMarkdown } from "./noteMarkdown.js";
import type { NoteMarkdownAttachment, NoteMarkdownContext } from "./noteMarkdown.js";

/**
 * IMEX-004: the archive's own semver. NOT bumped by `data/calendar.ics`
 * (CAL-008): the archive gained a FILE, not a record type. Nothing parses it on
 * the way back in — `archiveReader.ts`'s allowlist ignores every entry that is
 * not the manifest, a `DATA_FILES` NDJSON, a `.ydoc` or a blob, and
 * `parseImportArchive` walks only `DATA_FILES` ∪ the manifest's own checksums —
 * so it is a convenience copy for the user's other calendar, exactly as
 * `tables/*.csv` is for their spreadsheet, and it is checksummed by neither. An
 * older reader handed a newer archive is therefore no worse off for its
 * presence, which is precisely what a version bump would otherwise be claiming.
 *
 * `1.41.0` adds the MACHINE a circuit is the electronics of (ADR-085 E4c,
 * migration 068): one record type — `circuit-chassis` — riding in the
 * `data/electronics.ndjson` the module already has, immediately after the
 * circuits and before the parts, plus an OPTIONAL `mount` on `circuit-part`.
 *
 * **The chassis is keyed by its CIRCUIT and carries no id of its own**, because
 * a circuit has at most one machine (migration 068's primary key). Its bucket
 * is therefore keyed on `circuitId` — `fin-recurring`'s composite-key idiom,
 * one column short, exactly as `fit-measurement` keys on `(profileId, day)` —
 * which makes a second chassis for one circuit the ORDINARY `duplicate-id`
 * problem every keyless row already produces rather than a rule of its own.
 *
 * **All nine measurements are required, and that is the contract rather than
 * strictness for its own sake.** A chassis is nine numbers or it is no row at
 * all; the alternative is a NULL that every reader downstream has to turn into
 * a default, which is a dimension nobody measured in a file a simulator treats
 * as measured. They travel in the units the user typed — CENTIMETRES and GRAMS
 * — because that is what the column holds; the conversion to metres and
 * kilograms happens in the URDF generator, where it is a fact about that format
 * and not about this file.
 *
 * `mount` is one of five named faces or absent, and absent means „not on the
 * machine" — which is what every part in every earlier archive was, so it needs
 * no `ArchiveEra` flag (the ADR-028 rule). The record type needs none either,
 * by the whole-absent-type rule below.
 *
 * The bump is owed twice over, and the FIELD is the sharper half: an older
 * reader handed this archive would refuse `circuit-chassis` as an unrecognised
 * type AND refuse `mount` as an unknown member of a `circuit-part` it otherwise
 * understands — one baffling line-error per sensor on somebody's robot. The
 * version gate turns both into one true sentence about the build.
 *
 * `1.40.0` adds the ELEC module's circuits (ELEC slice E1, migration 067):
 * THREE record types — `circuit`, `circuit-part` and `circuit-wire` — riding in
 * their own `data/electronics.ndjson`, a new `DATA_FILES` entry checksummed
 * like the eleven before it, plus a new `electronics` member in
 * `ARCHIVE_MODULE_IDS`. A module of its own for `1.32.0`'s reason exactly: one
 * module↔collection mapping serves both `countProfileModules` and
 * `filterProfileData`, and filing a circuit under (say) notes would make a
 * notes-only export carry somebody's schematics.
 *
 * **The CATALOGUE is not exported, and that is the fact about this module a
 * reader must not have to rediscover** — the same fact `1.35.0` records about
 * the food catalogue, and for a stronger reason. The 153 components the app
 * ships are constants in `@nexus/core`, versioned with the application because
 * a fact about a part number is what they are. A part row therefore carries a
 * `componentId` and nothing else about the component, and a build that no
 * longer ships that entry resolves it to `undefined` — which `circuitProblems`
 * turns into a placeholder on the canvas and a line in the margin, never a
 * circuit that will not open. Exporting the catalogue would freeze a corrected
 * datasheet into every backup ever taken.
 *
 * Three types rather than one, and in this order: a part names its circuit, a
 * wire names its circuit AND both of its parts, so parents precede children
 * here exactly as `taskLists` precede `tasks`. A wire's ends are real foreign
 * keys in the database it lands in, so the order is not a courtesy.
 *
 * No `ArchiveEra` flag: the whole-absent-type rule covers it, and a
 * pre-`1.40.0` archive simply carries no circuits, which is indistinguishable
 * from a profile that drew none.
 *
 * `1.39.0` renames the ordering key of `task`, `task-list`, `task-section`,
 * `dashboard-set` and `dashboard-widget` from `position` to `rank`, and changes
 * what its value IS: a sparse integer becomes a fractional rank string
 * (migration 062, `@nexus/core`'s `rankBetween`). Not additive, which is why the
 * reader gets an era flag rather than a default — `ArchiveEra.writesOrderRanks`.
 * An archive written by 1.38.0 or earlier carries the integer, and
 * `rankForInteger` converts it EXACTLY and row-locally on the way in, because a
 * rank's integer part is itself a signed base-36 number: `rankForInteger(n) <
 * rankForInteger(m)` precisely when `n < m`. So an old backup restores its order
 * byte for byte rather than approximately. `fit-routine-item` and
 * `fit-workout-set` keep their integer `position` deliberately — it indexes a
 * parent's array rather than ordering a scope the user drags in (ADR-082 §2).
 *
 * `1.38.0` adds four targets to `fit-routine-item` (migration 061):
 * `targetSeconds`, `targetWeightKg`, `targetDistanceM` and `restSeconds`. A
 * PURELY ADDITIVE change, hence the minor bump — `1.37.0` shipped a routine
 * item that could prescribe sets and reps and nothing else, which left three of
 * the seven exercise metrics (`time`, `weight_time`, `distance_time`) unable to
 * state the only number they have. An archive written by 1.37.0 carries none of
 * the four properties at all, and `parseFitRoutineItem` reads their ABSENCE as
 * „this routine said nothing about a hold" rather than refusing the record —
 * the same treatment every earlier additive field got, and the reason a reader
 * one version behind is no worse off than it was.
 *
 * `1.37.0` adds FIT's training and body half (ADR-081 slice b, migration 060):
 * seven record types — `fit-exercise`, `fit-routine`, `fit-routine-item`,
 * `fit-workout`, `fit-workout-set`, `fit-measurement`, `fit-body-profile` — all
 * riding in the EXISTING `data/fitness.ndjson`, under the EXISTING `fitness`
 * member of `ARCHIVE_MODULE_IDS`. Deliberately NOT a file or a module of its
 * own, unlike `1.36.0`'s CANV entry just above: FIT is ONE module with a
 * nutrition half and a training half, not two modules that happen to share a
 * name, and a fitness-only export that carried the food diary but not the
 * training log would be a module choice (IMEX-003) silently lying about what
 * "fitness" means. `countProfileModules` and `filterProfileData` fold all ten
 * FIT collections into the one `fitness` bucket for exactly that reason.
 *
 * **The EXERCISE CATALOGUE is not exported, on `1.35.0`'s food-catalogue
 * argument exactly.** The several hundred exercises the app ships with live as
 * JSON inside `@nexus/core` (`fitness/exercise.ts`), not as rows — see migration
 * 060. `fit-exercise` carries ONLY the exercises the user added themselves, and
 * a `fit-routine-item`/`fit-workout-set`'s `exerciseRef` is provenance beside a
 * required `label` snapshot rather than something this archive resolves —
 * `catalogue:<slug>` names data that is not a row anywhere, and `user:<uuid>`
 * may name an exercise this profile has since deleted while the routine or the
 * logged set stays true. Same for `routineRef` on `fit-workout`: a plain routine
 * id with no grammar, naming a `fit-routine` that may not have survived to this
 * archive. Neither gets a reference rule; both are validated for SHAPE alone
 * (`parseExerciseRef`, a length bound) and left otherwise untouched, on
 * `foodRef`'s exact reasoning.
 *
 * **`fit-routine-item.routineId` and `fit-workout-set.workoutId` ARE real
 * foreign keys, unlike the two references above, and this archive treats them
 * as such.** Migration 060 declares both `ON DELETE CASCADE`, so a routine or a
 * workout that is IN this archive must be named correctly by every item or set
 * that is a child of it, or the restore's raw `INSERT` fails partway through a
 * transaction the rest of this file exists to prevent. A dangling one is
 * therefore refused exactly as `subject-attachment.subjectId` is — the same
 * `onDangling: "drop"` machinery, one table over. Written PARENTS BEFORE
 * CHILDREN in the NDJSON, the `data/habits.ndjson` idiom: a routine before its
 * items, a workout before its sets.
 *
 * **Two invariants the SCHEMA enforces that a hand-edited archive could break,
 * and both are refused AT PARSE TIME rather than surfacing as a raw SQLite
 * error mid-restore.** `fit_workouts_profile_open`'s UNIQUE partial index — at
 * most one `fit-workout` per profile with `endedAt: null` — is checked the way
 * `note-folder.isCaptureDefault`'s per-profile singleton is (ADR-036): every
 * open workout past the first is refused, and import mode drops it, which
 * cascades its sets away through the ordinary child-drop rule above. The
 * `fit_measurements` PRIMARY KEY — at most one `fit-measurement` per
 * `(profileId, day)` — costs nothing new at all: the row carries no id of its
 * own, so keying its bucket on `profileId,day` (`fin-recurring`'s composite-key
 * idiom, one column short) makes a second reading of one day the ORDINARY
 * `duplicate-id` problem every other keyless row already produces.
 *
 * **`fit-measurement.muscle` and `.circumferences` are nested objects, on
 * `habit.schedule`'s reason exactly: the interchange is JSON.** `muscle` is
 * `@nexus/core`'s own `MuscleReading` — a unit and a value, never normalised
 * into one or the other at the boundary — and `circumferences` is `@nexus/core`'s
 * `BodyCircumferences`, the six tape sites `CIRCUMFERENCE_SITES` names, each
 * independently nullable because a scale gives some of these numbers and a tape
 * measure gives the rest.
 *
 * None of the seven needs an `ArchiveEra` flag: every field is required from
 * this version's first release, and the whole-absent-type rule below covers the
 * types themselves — a pre-`1.37.0` archive simply carries no training rows,
 * indistinguishable from a profile that trains outside the app, which is what
 * `data/fitness.ndjson` already meant for every profile before migration 060
 * existed. The bump is owed for the reason every one below was: an older reader
 * handed this archive would refuse `fit-exercise` (and the six beside it) as
 * unrecognised types, and the version gate turns that into one honest sentence
 * about the build instead of one baffling line-error per exercise, per routine
 * and per logged set in somebody's training history.
 *
 * `1.36.0` adds the CANV module's boards (CANV slice a, migration 059): ONE
 * record type — `canvas-board` — riding in its own `data/canvas.ndjson`, a new
 * `DATA_FILES` entry checksummed like the ten before it, plus a new `canvas`
 * member in `ARCHIVE_MODULE_IDS`. A module of its own for `1.32.0`'s reason
 * exactly: one module↔collection mapping serves both `countProfileModules` and
 * `filterProfileData`, and filing a drawing under (say) notes would make a
 * notes-only export carry somebody's boards.
 *
 * **The DRAWING travels whole, as the editor's own document, and that is the
 * fact about this module a reader must not have to rediscover.** `scene` is
 * Excalidraw's `serializeAsJSON` output kept verbatim (`canvas/canvasScene.ts`),
 * a nested OBJECT rather than a JSON string for the reason a task's `recurrence`
 * is one: the interchange is JSON, and a string here would be a second encoding
 * nobody can read in the file. What the reader validates is the ENVELOPE alone —
 * `type`, `version`, `source` and the three containers — never the elements,
 * because a schema of our own for a seventy-field element union would fall
 * behind the editor that defines it, and the first field we failed to carry
 * would be a drawing that came back wrong.
 *
 * An embedded image rides INSIDE `scene.files`, as the base64 data URL the
 * editor put there, and is deliberately NOT lifted into `blobs/` the way a note
 * attachment is. A note attachment is a file the user chose and can point at
 * again; an image pasted into a diagram is part of the diagram, referenced by an
 * id only the scene knows. Content-addressing it would buy deduplication of
 * something that is almost never duplicated, at the cost of a scene that no
 * longer restores from its own line.
 *
 * No `ArchiveEra` flag: the whole-absent-type rule below covers it, and a
 * pre-`1.36.0` archive simply carries no boards, which is indistinguishable from
 * a profile that drew none.
 *
 * `1.35.0` adds the FIT module's nutrition half (FIT slice a, migration 058):
 * three record types — `fit-food`, `fit-meal-item` and `fit-target` — riding in
 * their OWN `data/fitness.ndjson`, a new `DATA_FILES` entry checksummed like the
 * nine before it, plus a new `fitness` member in `ARCHIVE_MODULE_IDS` so the
 * module can be counted, filtered and chosen exactly as the eight it joins. A
 * module of its own for `1.32.0`'s reason exactly: one module↔collection mapping
 * serves both `countProfileModules` and `filterProfileData`, and filing meals
 * under (say) habits would make a habits-only export carry somebody's food
 * diary.
 *
 * **The CATALOGUE is not exported, and that is the fact about this module a
 * reader must not have to rediscover.** The several hundred foods the app ships
 * with live as JSON inside `@nexus/core` (`fitness/data/catalogue.json`), not as
 * rows — see migration 058. Exporting them would put app data in an archive of
 * USER data and restore it as though somebody had typed it, and it would ship a
 * copy of a dataset whose values a later build legitimately corrects. `fit-food`
 * carries ONLY the foods the user added themselves.
 *
 * The archive is complete on its own terms all the same, because a `fit-meal-item`
 * carries the food's `label` and the seven per-100 g values it was logged with
 * IN THE ROW. A restore into a build whose catalogue has moved on — or which
 * never had that entry — reproduces the day exactly as it was eaten, and
 * `foodRef` rides beside as provenance rather than as something to resolve.
 *
 * That is also why `foodRef` gets no reference rule in `importArchive.ts`'s
 * table: `catalogue:<id>` names something that is not a row anywhere, and
 * `user:<uuid>` names a row the user may already have deleted while the meal
 * stayed true. The column is text with no foreign key on purpose (migration
 * 057), so a dangling one is an ordinary state rather than a broken archive.
 *
 * `fit-target` is zero or one row, `study-settings`' arrangement: four
 * independently nullable goals where NULL is „no goal" and 0 is „a goal of
 * zero", two claims this interchange keeps apart because collapsing them would
 * restore a calorie goal nobody set.
 * `1.34.0` grows the `focus-session` row into the ONE focus timer (migration
 * 057). Seven optional fields — `kind`, `plannedMinutes`, `pausedSeconds`,
 * `outcome`, `cycleIndex`, `taskId`, `label` — and one field that WIDENS:
 * `subjectId` becomes nullable, because a Pomodoro phase usually belongs to no
 * subject at all.
 *
 * **This is a merge, not a new record type, and that IS the contract.** The
 * founder's rule is that the product has one timer („nećemo da imamo više
 * tajmera, mislim da je to loše"), so a study session and a Pomodoro phase are
 * one row shape with a `kind` — a second record type here would be the two-timer
 * incoherence written into the interchange, where it would outlive any decision
 * to undo it. A pre-`1.34.0` session reads as exactly what it was: a `work`
 * phase, unplanned, unpaused, subject-scoped. No `ArchiveEra` flag is needed for
 * that, on `block.kind`'s terms — absent means one specific thing an older
 * writer could only have meant, and a PRESENT value is validated strictly in
 * every era.
 *
 * The bump is owed for the sharpest reason on this list: `subjectId` changed
 * DOMAIN. A `1.33.0` reader demands a non-empty string there and would throw one
 * `invalid-record` per Pomodoro phase in somebody's history — and, worse, would
 * silently read a break as study time if it did not, which is precisely the lie
 * `StatsStore`'s work-only scope exists to prevent. `1.26.0`'s entry made the
 * same argument for a field that only changed meaning.
 *
 * `1.33.0` widens ONE enum, in the two places the interchange spells it (HABIT
 * slice c, migration 056): `"habit"` joins `notification.source` and the
 * manifest's `settings.notifications.enabledSources`. Nothing was added to any
 * row's SHAPE — no record type, no field — and the bump is owed all the same,
 * for the reason `1.26.0`'s was when a field only changed MEANING: a domain is
 * part of the contract, and a reader's whole job at an enum is to refuse what it
 * does not recognise. A `1.32.0` reader handed this archive would accept the
 * manifest, then throw one `invalid-record` per delivered habit reminder in
 * somebody's ledger and refuse their whole notification appetite besides — a
 * pile of baffling line-errors over a perfectly honest file. The version gate
 * turns that into one true sentence about the build, which is the entire reason
 * it exists.
 *
 * Deliberately NOT an `ArchiveEra` flag. An era flag answers „what did an older
 * WRITER mean by this", and an older writer meant nothing by `"habit"` — it
 * could not produce one. The absence of habit notifications in a pre-`1.33.0`
 * archive is not ambiguous: that profile had no habit reminders, which is the
 * same thing a profile that keeps none has today.
 *
 * `1.32.0` adds the HABIT module (HABIT slice a, migration 055): two record
 * types — `habit` and `habit-entry` — riding in their OWN `data/habits.ndjson`, a
 * new `DATA_FILES` entry checksummed like the eight before it, plus a new
 * `habits` member in `ARCHIVE_MODULE_IDS` so the module can be counted, filtered
 * and chosen exactly as the seven it joins. A whole new module rather than rows
 * filed under an existing one, for `1.28.0`'s reason exactly: one
 * module↔collection mapping serves both `countProfileModules` and
 * `filterProfileData`, and filing habits under (say) tasks would make a
 * tasks-only export carry somebody's habit history — a mapping that says
 * something untrue.
 *
 * **The one fact about this module that IS the interchange contract: a habit's
 * `schedule` is HABIT's own two-kind vocabulary, deliberately NOT the
 * `recurrence` every other scheduled row here carries.** The reader runs it
 * through `validateHabitSchedule` and never through `validateRecurrenceRule` —
 * see `packages/core/src/habits/habitSchedule.ts` for the argument, which is that
 * a streak over „every 3rd Tuesday until March" is not a concept anyone can
 * defend. A writer that put an ADR-024 rule in this field is refused, in every
 * era, exactly as a writer that put a habit schedule in a task's would be.
 *
 * `archivedAt` travels beside the row's soft delete as two independent facts,
 * exactly as `pausedAt` does one module over (migration 054): a restore of an
 * archived habit puts back an archived habit, and nothing in the interchange has
 * to arbitrate between them. The ENTRIES travel as their own record type rather
 * than as an array inside the habit, because they ARE rows — one per habit per
 * day, uniqueness the schema's — and a nested array would turn a five-year
 * history into one NDJSON line nothing could stream or diff.
 *
 * Neither type needs an `ArchiveEra` flag: the whole-absent-type rule below
 * covers them both, exactly as it covered `fin-account` and `note-category`. A
 * pre-`1.32.0` archive simply carries no habits, which is indistinguishable from
 * a profile that keeps none, because those mean the same thing. The bump is owed
 * for the reason every one below was: an older reader handed this archive would
 * refuse `habit` as an unrecognised type, and the version gate turns that into
 * one honest sentence about the build instead of one baffling line-error per day
 * of somebody's history.
 *
 * `1.31.0` adds the SUBSCRIPTION PAUSE (ADR-074, migration 054): one nullable
 * `pausedAt` on `fin-recurring`, the moment its owner said „ne naplaćuj me" —
 * null while it charges. It travels for the sharpest reason any field here
 * does: a `1.30.0` reader handed this archive would drop the pause, and a
 * restore would then start charging a subscription its owner had deliberately
 * stopped, silently and monthly. Losing a label is salvage; resuming somebody's
 * billing is not.
 *
 * No `ArchiveEra` flag, and not merely by the ADR-028 rule: an archive written
 * before this bump carries no `pausedAt`, an absent one parses to `null`, and
 * `null` IS „not paused". That is the CORRECT reading of an older archive rather
 * than a lossy guess about it — a subscription that existed before the pause
 * existed was, in every sense the app had, charging.
 *
 * `pausedAt` and the row's soft delete stay two independent facts here exactly
 * as they are two independent columns (migration 054): a restore of a paused
 * subscription puts back a paused subscription, and nothing in the interchange
 * has to arbitrate between them.
 *
 * `1.30.0` adds FIN SUBSCRIPTIONS (FIN slice d, migration 053): the
 * `fin-recurring` record type — one row per recurring charge, riding in
 * `data/finance.ndjson` AFTER the accounts and categories it points at and
 * BEFORE the transactions that point back at it — plus an OPTIONAL `recurringId`
 * on `fin-transaction` (absent means null, which is what every transaction in
 * every earlier archive was, so no `ArchiveEra` flag: the ADR-028 rule).
 *
 * A subscription carries a `recurrence` in exactly the shape `task` and `event`
 * already carry one (ADR-024's canonical JSON), which is the whole reason this
 * bump costs one field and one type rather than a schedule grammar of its own —
 * the reader re-runs `validateRecurrenceRule`, the same function those two rows
 * go through. `nextRun` travels with it and is nullable: a cursor, not a
 * promise, and a spent series says so with a null rather than a sentinel. It
 * must travel, because a restore that reset it to the start date would re-charge
 * a year of Netflix into a restored profile — the transactions are in the same
 * archive, so cursor and rows have to arrive together or contradict each other.
 *
 * The bump is owed for the reason every one below was: an older reader handed
 * this archive would refuse `fin-recurring` as an unrecognised type, and the
 * version gate turns that into one honest sentence about the build instead of
 * one baffling line-error per subscription somebody keeps.
 *
 * `1.29.0` adds the IMPORT FINGERPRINT to `fin-transaction` (FIN slice e,
 * migration 052): one nullable `importKey` field, absent on every row the user
 * typed and present on every row a bank-statement CSV brought in. It is carried
 * for one concrete reason — a profile restored from an archive that dropped its
 * fingerprints would re-import the same statement as a second copy of itself,
 * which is exactly what the fingerprint exists to prevent — so parser, restore
 * and foreign import all agree on it or none of them does. No `ArchiveEra` flag:
 * an archive written before this bump simply carries no key, and a row with no
 * key is a row no import has ever recognised, which is what those rows were. The
 * bump is owed for the field rather than a record type, unlike `1.28.0`'s: an
 * older reader would refuse `importKey` as an unknown member of a row it
 * otherwise understands, and the version gate turns that into one honest
 * sentence about the build instead of one line-error per transaction.
 *
 * `1.28.0` adds the FINANCE module (FIN slice a, migration 051): four record
 * types — `fin-account`, `fin-category`, `fin-transaction`, `fin-budget` —
 * riding in their OWN `data/finance.ndjson`, a new `DATA_FILES` entry
 * checksummed like the seven before it, plus a new `finance` member in
 * `ARCHIVE_MODULE_IDS` so the module can be counted, filtered and chosen
 * exactly as the six it joins. A whole new module rather than rows filed under
 * an existing one, deliberately: `countProfileModules` and `filterProfileData`
 * share one module↔collection mapping, and filing a ledger under (say) the
 * dashboard would make a dashboard-only export carry someone's bank accounts —
 * a mapping that says something untrue, which is precisely the reason the
 * profile picture is a manifest fact rather than a collection.
 *
 * Two facts about the money are the interchange contract, not implementation
 * detail. Every amount is an INTEGER of minor units — `openingBalance`,
 * `amount` on a transaction, `amount` on a budget — so a reader that turned one
 * into a float would be reading a different file than this one wrote. And
 * currency lives on the ACCOUNT, with no rate anywhere in the archive: a
 * transfer's two sides are guaranteed to share a currency (the store refuses
 * otherwise), so nothing that reads this file ever needs to convert, and
 * nothing in it could tell them how.
 *
 * A transfer is ONE row (`counterAccountId` filled, `categoryId` null), which
 * is the whole reason the interchange needs no transfer-pair rule: there is no
 * second row to lose, to duplicate, or to disagree with. None of the four types
 * needs an `ArchiveEra` flag — the whole-absent-type rule below covers them all,
 * exactly as it covered `note-category` and `exam-topic`. The bump is owed for
 * the same reason every one below was: an older reader handed this archive
 * would refuse `fin-account` as an unrecognised type, and the version gate is
 * what turns that into one honest sentence about the build instead of one
 * baffling line-error per row of somebody's ledger.
 *
 * `1.27.0` adds note CATEGORIES (NOTE-002, migration 049): the `note-category`
 * record type, riding in `data/notes.ndjson` beside the folders and tags it is
 * the third axis to, plus a `categoryId` on every `note` row. The record type
 * needs no `ArchiveEra` flag (an older archive simply carries none, exactly as
 * a profile that never made one does) and neither does the field, whose absence
 * means `null` — which is what every note in every archive written before this
 * bump actually was. The bump is still owed, and for the record type rather
 * than the field: an older reader handed this archive would refuse
 * `note-category` as an unrecognised type — the version gate is what makes that
 * refusal happen at the manifest instead, with a sentence about the build
 * rather than about a line in a file.
 *
 * `1.26.0` changes what a cloze card's `clozeOrdinal` MEANS (ADR-068, migration
 * 047): the field carried the deletion's 0-based POSITION in `clozeText` and
 * now carries its 1-based NUMBER — the `{{cN::…}}` label a run declares, or its
 * position + 1 when it declares none. Nothing was added and nothing removed, so
 * a MINOR bump is the strongest signal available; the reader's own
 * `writesClozeNumbers` era flag is what turns that number back into whichever
 * of the two an archive actually holds. An older reader handed this archive
 * would restore every cloze card asking the deletion one to the right of the
 * one it was written for — the version gate refuses it instead, which is the
 * whole reason the bump exists.
 *
 * `1.25.0` adds exam topics and the honest planner (ADR-063, STUDY-003/004/005,
 * migration 046): the `exam-topic` record type — one row per entry of an exam's
 * ranked curriculum, riding in `data/study.ndjson` AHEAD of the plans whose
 * blocks name it — plus an OPTIONAL `weekdayMinutes` on `plan` (absent or null
 * = "every day = dailyMinutes", which is every earlier archive's plan exactly)
 * and three OPTIONAL members on `block`: `topicId`, `kind` and `pinned`
 * (absent = NULL / `"coverage"` / unpinned — what every block in every earlier
 * archive was, so no `ArchiveEra` flag for any of them; the ADR-028 rule). A
 * MINOR bump by the same honesty every entry below made: an older reader
 * handed this archive would restore a profile whose curriculum — the ranked
 * topic list its owner built by hand, the confidences they assessed, the
 * scope cuts they accepted — is simply gone, and every block's topic
 * assignment with it.
 *
 * `1.24.0` adds a task list's kanban column arrangement (ADR-060): two OPTIONAL
 * members INSIDE the `task-list` row's existing `viewConfig` object —
 * `kanban.hiddenColumns` and `kanban.columnOrder`, both absent meaning "every
 * column drawn, in natural order", which is what every earlier archive's boards
 * were. Not a new record type, not even a new top-level field — and a MINOR
 * bump all the same, because the interchange does NOT carry the stored JSON
 * verbatim: the exporter serializes the config from the store's PARSED,
 * leniently-read form (`TaskListStore` reads the column through
 * `parseStoredTaskViewConfig`, which drops what it does not recognize), and the
 * reader re-validates it STRICTLY against its own grammar
 * (`parseTaskList` → `validateTaskViewConfig`, which refuses what it does not
 * recognize). An older build handed this archive would therefore not round-trip
 * the arrangement blind — it would refuse the row as a malformed `viewConfig`,
 * a baffling field error on a perfectly honest file. The version gate turns
 * that into the truthful answer an older reader owes a newer archive, exactly
 * as `1.16.0` did when `viewConfig` itself arrived.
 *
 * `1.23.0` adds private notes (PRIV v1, ADR-057 §6): the record types
 * `private-note` and `private-note-version`, riding in their OWN
 * `data/private-notes.ndjson` — a new `DATA_FILES` entry, checksummed like the
 * six before it — each carrying the DECRYPTED envelope (`ExportPrivateNote`):
 * the archive's own passphrase is the protection, the same trust everything
 * else in it already rides on, and a sealed-forever export would be unreadable
 * the moment the profile's Recovery Kit is regenerated. Private attachment
 * BYTES travel decrypted as `private-blobs/<attachment id>` entries — their own
 * zip directory, deliberately NOT the content-addressed `blobs/` union, because
 * no sha256 identity exists for a private attachment by design (`privEnvelope.ts`'s
 * no-existence-oracle rule) — and are listed in the manifest's `privateBlobs`
 * exactly as the blob list is. Markdown mirrors live under
 * `notes-private/<id>.md`, keyed by ID and never by title (see the mirror loop's
 * comment). Neither record type needs an `ArchiveEra` flag (the parser's own
 * precedent: a whole absent type is never ambiguous — an older archive simply
 * carries none). Whether private notes ride AT ALL is the writer's gate, not
 * this builder's: main supplies `ExportArchiveInput.privateNotes` only while
 * the PRIV section is unlocked and the export is encrypted (NXA1) — a locked
 * section or a plaintext export excludes them with a named skip in the export
 * result. A MINOR bump by the same honesty every entry below made: an older
 * reader handed an archive carrying someone's most private notes would restore
 * a profile in which they are simply gone.
 *
 * `1.22.0` adds the profile's `kind` (ADR-058, business profiles): one field on
 * the manifest's own `profile` object, ALWAYS written — what kind of profile an
 * archive is OF is never something a reader should infer. A manifest fact
 * rather than a record for `1.18.0`'s reason: the kind is the profile's
 * identity, exactly as its name and picture are. A MINOR bump by the same
 * honesty every entry below made: an older reader handed a business profile's
 * archive would restore it into a personal profile as if the two were the same
 * thing — and refusing is the truthful answer to a file whose identity it
 * cannot read. On the way back in the field is OPTIONAL with the default
 * `"personal"` (the ADR-028 rule): the only kind any earlier archive could be
 * of, so its absence is never ambiguous.
 *
 * `1.21.0` adds named dashboards (DASH-008 / ADR-055, migration 043): the
 * `dashboard-set` record type — one row per named board, riding in
 * `data/dashboard.ndjson` between the settings row and the widgets — plus an
 * OPTIONAL `setId` on `dashboard-widget` (absent = the default board, which is
 * what every widget in every earlier archive was) and an OPTIONAL `activeSetId`
 * on `dashboard-settings` (absent = the default board is showing). A MINOR
 * bump by the same honesty every entry below made: an older reader handed this
 * archive would restore a profile whose named boards are simply gone —
 * arrangements their owner built by hand and nothing else in the archive can
 * reconstruct.
 *
 * `1.20.0` adds the `calendar-settings` record type (CAL-010 / ADR-054,
 * migration 042): the profile's fixed semester dates, zero-or-one row riding
 * FIRST in `data/calendar.ndjson` exactly as `study-settings` leads its own
 * file. A MINOR bump by the same honesty every settings row below made: an
 * older reader handed this archive would restore a profile whose Semestar view
 * silently slid back to the current four months, losing the term its owner
 * anchored it to — and refusing is the truthful answer to a file it cannot
 * fully read.
 *
 * `1.19.0` adds the profile's default snooze preset (NTF-009, migration 041):
 * one field in the manifest's `settings.notifications` object, beside the quiet
 * hours it is a sibling preference of. Optional-with-a-default on the way in
 * (absence means „10 min“, which is what every earlier build's snooze button
 * did), and a MINOR bump all the same, by the honesty every entry below made:
 * an older reader handed this archive would restore the profile with a snooze
 * default it silently reset, and refusing is the truthful answer to a file it
 * cannot fully read. The same reasoning `1.17.0` made for a folder's default
 * view — a small preference is still the user's choice.
 *
 * `1.18.0` adds a profile's picture (SET-001, migration 040): three fields on
 * the manifest's own `profile` object, declaring a blob that travels in the
 * `blobs/` union like any other. The manifest rather than a record, because the
 * picture is a fact about the PROFILE — precisely what `profile.name` beside it
 * already is — and every `ProfileData` collection belongs to exactly one archive
 * MODULE, which a profile's own identity does not; filing it under `dashboard`
 * (its nearest neighbour) would mean a tasks-only export loses the user's
 * picture while a dashboard-only export carries it, which is a mapping that says
 * something untrue. Being a manifest fact, it is also not subject to the module
 * choice (IMEX-003), on the same terms as `settings` below.
 *
 * `1.17.0` adds a note folder's `defaultView` — the shape its notes are drawn in
 * (NOTE-002, migration 039) — after
 * `1.16.0` added a task list's `viewConfig` — what it remembers about each of its
 * four views (ADR-050, migration 038) — after
 * `1.15.0` added the `event-template` record type — a saved SHAPE of one event
 * (CAL-009, migration 036), riding in the data file the CAL module already had —
 * after `1.14.0` added the `subject-attachment` and `subject-note-link` record
 * types — a subject's materials and the notes filed under it (STUDY-001,
 * migration 035) — after `1.13.0` added the `study-settings` record
 * type — the profile's FSRS target retention and its two daily caps (STUDY-007,
 * migration 034) — after `1.12.0` added a card's `problemSteps` —
 * the worked solution a problem card's `back` is derived from (ADR-046) —
 * after `1.11.0` added the `dashboard-widget` record type — the profile's
 * dashboard layout (DASH-002 / ADR-045, migration 032) — `1.10.0` a card's
 * `kind` and, for a cloze card, the `clozeText`/`clozeOrdinal` it is derived
 * from (STUDY-006 / ADR-042), `1.9.0` the `dashboard-settings` record type (SET-006
 * / ADR-041), `1.8.0` the `task-dependency` record type (migration 029 /
 * ADR-037), `1.5.0`-`1.7.0` task attachments, task templates and the NOTE
 * folder preferences (each landing on its own lane), `1.4.0` the
 * `task-tag`/`task-tag-link` types (migration 023), `1.3.0` the
 * `task-list`/`task-section` types and the `listId`/`sectionId`/`rank` a
 * task carries into them (TASK-004 / ADR-029), `1.2.0` a task's
 * `reminderOffsets` (ADR-028) and `1.1.0` the `person` record type (CAL-007 /
 * ADR-026). Additive, so a MINOR bump by the same honesty each of those made
 * one: an archive this build writes is refused by an older reader, which would
 * otherwise restore a profile with every list and every folder opening on the
 * wrong shape, every
 * event template simply gone and every
 * course material missing — shapes their owner built by hand and files nothing
 * else in the archive can reconstruct; the same honesty `1.14.0` owed the
 * subject materials, `1.13.0` owed the study preferences, `1.12.0` owed every
 * problem card's steps, `1.11.0` owed the arranged dashboard and `1.10.0` owed
 * every cloze template. Kept in step
 * with `INTERCHANGE_SCHEMA_VERSION` (`importArchive.ts`) — two constants
 * rather than one import, since the reader already imports from this module
 * and the cycle would be worse than the duplication; `importArchive.test.ts`
 * pins them equal.
 *
 */
/**
 * `1.42.0` adds the MODULE KIT's section (ADR-090): a new
 * `data/modules.ndjson` carrying one `module-data` record per discovered module
 * that has something to say.
 *
 * A MINOR bump, by the same honesty every entry above made: an older reader
 * refuses the record type outright, and it would refuse it for a reason that
 * has nothing to do with a damaged file - a kit module's payload would be
 * silently missing from a restore that reported success. The record type is
 * additive in this build's own direction (nothing above changed), which is why
 * the bump is minor and not major.
 */
const SCHEMA_VERSION = "1.42.0";

// --- Row shapes (the interchange contract; see file header) -----------------

/**
 * A task list (TASK-004 / ADR-029): the nestable container tasks live in, with
 * `isInbox` marking the one every profile always has. Rides in
 * `data/tasks.ndjson` ahead of the tasks that reference it.
 */
export interface ExportTaskList {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  isInbox: boolean;
  defaultView: string;
  /**
   * What this list remembers about each of its four views — grouping, sort and
   * filters (ADR-050, migration 038). OPTIONAL with a default, like a card's
   * `problemSteps`: absent or null means "no preferences", which is exactly what
   * every list in every archive written before this field had, so no
   * `ArchiveEra` flag is involved. A nested object rather than a JSON STRING,
   * for the reason a task's `recurrence` is one: the interchange is JSON, and a
   * string here would be a second encoding nobody can read in the file.
   */
  viewConfig?: TaskViewConfig | null;
  /**
   * Where this row sits in its scope: a fractional rank, compared as a plain
   * string (`@nexus/core`'s `rankBetween`). Never an index — it is not
   * contiguous and nothing counts it. An archive written before `1.39.0`
   * carries a sparse INTEGER `position` here instead, which the reader
   * converts row-locally and losslessly through `rankForInteger`
   * (`ArchiveEra.writesOrderRanks`).
   */
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/** A heading inside one list. No `profileId`: a section is scoped through its list, exactly as a renewal is through its document. */
export interface ExportTaskSection {
  id: string;
  listId: string;
  name: string;
  /**
   * Where this row sits in its scope: a fractional rank, compared as a plain
   * string (`@nexus/core`'s `rankBetween`). Never an index — it is not
   * contiguous and nothing counts it. An archive written before `1.39.0`
   * carries a sparse INTEGER `position` here instead, which the reader
   * converts row-locally and losslessly through `rankForInteger`
   * (`ArchiveEra.writesOrderRanks`).
   */
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A task tag (migration 023): a per-profile label, unique by (profile, name).
 * Field for field `ExportNoteTag` — task tags are that feature applied to
 * tasks, so the interchange row is the same row with a different owner. Rides in
 * `data/tasks.ndjson` ahead of the tasks that carry it.
 */
export interface ExportTaskTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One task-tag attachment — `ExportNoteTagLink` with a task on the other end. */
export interface ExportTaskTagLink {
  taskId: string;
  tagId: string;
}

/**
 * A file hanging off a task (migration 024): the index row only, exactly as
 * `ExportNoteAttachment` is, with the bytes declared as a binary entry and
 * content-addressed by `sha256`. The two tables share ONE `blobs/<sha256>`
 * namespace in the archive, because they share one blob store on disk — a file
 * attached to both a task and a note travels once. Its `extracted_text` does not
 * travel either; see `ExportNoteAttachment` for why.
 */
export interface ExportTaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/**
 * The task-shaped body a template carries (ADR-035 / TASK-010) — the interchange
 * twin of `@nexus/db`'s `TaskTemplatePayload`, declared structurally here for
 * the reason every row shape in this file is (see the file header).
 *
 * A nested object rather than eight flattened `payload*` keys: the payload is
 * one value in one column, it is validated as a unit on both sides, and
 * flattening it would put eight task-ish field names at the top level of a row
 * that is NOT a task — where the next reader would reasonably expect them to
 * mean what they mean on a `task` row, which they do not (`dueOffsetDays` is
 * relative, `tagNames` are names, `subtaskTitles` are not rows).
 */
export interface ExportTaskTemplatePayload {
  title: string;
  description: string | null;
  priority: string;
  /**
   * Whole days from the day the template is APPLIED to the created task's due
   * date, or null for no due date. Relative on purpose: an absolute date in a
   * template rots the day after it is saved (ADR-035).
   */
  dueOffsetDays: number | null;
  /** Whole days before the computed due date, ascending; empty unless `dueOffsetDays` is set. */
  reminderOffsets: number[];
  /** The rule the created task advances by, or null; non-null only with a `dueOffsetDays` to phase from. */
  recurrence: RecurrenceRule | null;
  /**
   * Tag NAMES, never `task_tags` ids — which is what lets a template survive the
   * deletion of a tag it was captured with, and restore into a profile whose tag
   * ids are entirely different. Apply re-resolves each through get-or-create.
   */
  tagNames: string[];
  /** Titles of the direct subtasks the template creates. Duplicates are legal — two identical chores are two chores. */
  subtaskTitles: string[];
}

/**
 * A task template (migration 027 / ADR-035). Rides in `data/tasks.ndjson`.
 * Deliberately last among the TASK types there: it references nothing — not a
 * list, not a section, not a tag ROW — so it constrains no ordering, and putting
 * it after the join keeps the "everything a row points at came before it"
 * reading of that file intact.
 *
 * No `tables/*.csv` mirror, for `ExportPerson`'s reason: those are a curated
 * subset for a human with a spreadsheet, and a nested payload is precisely what
 * a flat table cannot show. The NDJSON is the lossless layer (ADR-009).
 */
export interface ExportTaskTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: ExportTaskTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

/**
 * One dependency edge (migration 029 / ADR-037): `blockerId` must finish before
 * `blockedId` can be worked on. Two ids and nothing else, like the tag link
 * above — an edge has no identity of its own to name and no moment to
 * time-stamp; it is either there or it is not.
 *
 * DIRECTED, and that direction is the whole record: the reverse pair is a
 * different edge, and an archive carrying both is a cycle, which the reader
 * refuses outright (`importArchive.ts`). Rides in `data/tasks.ndjson` after the
 * tasks, since it needs BOTH ends resolved.
 */
export interface ExportTaskDependency {
  blockerId: string;
  blockedId: string;
}

export interface ExportTask {
  id: string;
  profileId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  done: boolean;
  dueDate: string | null;
  startDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /**
   * The rule this task advances by when an occurrence is completed (ADR-024),
   * or null for a one-off. Required, like every field above: a recurring task
   * restored without its rule is a task the user would silently stop being
   * reminded of, and a required field makes forgetting it a type error rather
   * than a quiet omission.
   */
  recurrence: RecurrenceRule | null;
  /**
   * Whole DAYS before `dueDate` at which the user is reminded (ADR-028),
   * ascending; always empty when `dueDate` is null. Days rather than an event's
   * minutes because a task's deadline is a day, not an instant. Required, for
   * exactly the reason the rule above is: a task restored without its ladder
   * goes quiet, and quiet is the one failure a reminder feature cannot report.
   */
  reminderOffsets: number[];
  /**
   * The list this task lives in (TASK-004 / ADR-029). `null` ONLY when the
   * archive predates `1.3.0` and the reader defaulted it (see `ArchiveEra`) — a
   * writer at `1.3.0` or later always names a list, and a `1.3` archive that
   * carries `null` here is refused rather than quietly re-filed. A restore maps
   * an era-defaulted `null` onto the target profile's Inbox, which is where
   * those tasks were before lists existed.
   */
  listId: string | null;
  /** The section of `listId` this task sits under, or null for the list body. Era-defaults to null. */
  sectionId: string | null;
  /**
   * Where the task sits in its (list, section) scope: a fractional rank,
   * compared as a plain string. An archive written before `1.39.0` carries a
   * sparse INTEGER `position` here, converted on the way in by
   * `rankForInteger`; one written before `1.3.0` carries neither, and
   * era-defaults to the first rank — which a restore then re-spaces in the
   * archive's own row order, because a task from before lists existed has no
   * scope to be ordered within.
   */
  rank: string;
}

export interface ExportEvent {
  id: string;
  profileId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  /** The rule that makes this row a series master the calendar expands (ADR-024), or null for a one-off. Required, for the same reason as a task's. */
  recurrence: RecurrenceRule | null;
  /** Bare `YYYY-MM-DD` occurrence dates removed from the series, ascending; always empty when `recurrence` is null. */
  recurrenceExdates: string[];
  /**
   * Whole minutes before an occurrence's start at which the user is reminded
   * (CAL-006), ascending. Required, like every field above: an event restored
   * without its ladder is an event the user would silently stop being reminded
   * of — and a required member makes a forgotten gather a type error rather
   * than a quiet omission.
   */
  reminderOffsets: number[];
}

/**
 * The event-shaped body a template carries (CAL-009) — the interchange twin of
 * `@nexus/db`'s `EventTemplatePayload`, declared structurally here for the
 * reason every row shape in this file is (see the file header).
 *
 * A nested object rather than nine flattened `payload*` keys, exactly as
 * `ExportTaskTemplatePayload` is: the payload is one value in one column, it is
 * validated as a unit on both sides, and flattening it would put nine event-ish
 * field names at the top level of a row that is NOT an event — where the next
 * reader would reasonably expect `startTime` to be an instant and a duration to
 * be an end.
 */
export interface ExportEventTemplatePayload {
  title: string;
  allDay: boolean;
  /**
   * Wall-clock `HH:MM` the created event starts at, or null on an all-day
   * template. Relative on purpose, like every field here: a template carries a
   * time of day and a length, never a date — an absolute start rots the morning
   * after it is saved (CAL-009).
   */
  startTime: string | null;
  /** Whole minutes the created event lasts, or null for one with no end. Timed templates only, and always ending inside its own day. */
  durationMinutes: number | null;
  location: string | null;
  description: string | null;
  category: string | null;
  /** Whole minutes before the created event's start at which to remind (CAL-006), ascending. */
  reminderOffsets: number[];
  /** The rule the created event's series runs on (ADR-024), or null. UNANCHORED — apply phases it from the day the template is applied to. */
  recurrence: RecurrenceRule | null;
}

/**
 * An event template (migration 036 / CAL-009). Rides in
 * `data/calendar.ndjson`, deliberately last among the CAL types there: it
 * references nothing — not an event, not a person — so it constrains no
 * ordering, and putting it after the rows that DO reference each other keeps the
 * "everything a row points at came before it" reading of that file intact. The
 * same placement `task-template` has in `data/tasks.ndjson`.
 *
 * No `tables/*.csv` mirror, for `ExportTaskTemplate`'s reason: those are a
 * curated subset for a human with a spreadsheet, and a nested payload is
 * precisely what a flat table cannot show. The NDJSON is the lossless layer
 * (ADR-009).
 */
export interface ExportEventTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: ExportEventTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

/** Only the persisted fields — `status`/`daysUntilExpiry` are derived at read time, never stored, so they are not part of the interchange row. */
export interface ExportDocument {
  id: string;
  profileId: string;
  docType: string;
  label: string;
  expiryDate: string;
  reminderOffsets: readonly number[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportRenewal {
  id: string;
  documentId: string;
  previousExpiry: string;
  renewedAt: string;
}

/**
 * A birthday or anniversary (CAL-007 / ADR-026). `month`/`day` travel as the
 * two integers the column holds rather than as a date string, for the reason
 * migration 020 gives: the recurring fact has no year, and inventing one to
 * fill a date's slot would put a lie in the interchange contract. `year` is
 * the separately-known birth/start year, null when unknown.
 *
 * No `tables/*.csv` mirror: those are a curated subset for a human opening the
 * archive in a spreadsheet (renewals have none either), and the NDJSON is the
 * lossless layer (ADR-009).
 */
export interface ExportPerson {
  id: string;
  profileId: string;
  name: string;
  kind: string;
  month: number;
  day: number;
  year: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One profile's fixed semester dates (CAL-010 / ADR-054, migration 042): the
 * closed day range the Semestar view anchors to, or both null for "no term
 * set". Rides in `data/calendar.ndjson`, FIRST — it references nothing and
 * nothing references it, so its position is readability (the term the rest of
 * the module is read under, before the rows), exactly as `study-settings`
 * leads its own file.
 *
 * Both bare `YYYY-MM-DD` day keys, both-or-neither (the store's rule,
 * re-checked by the reader — migration 042's table tolerates a half so one
 * upsert can stage it), and never start > end.
 */
export interface ExportCalendarSettings {
  profileId: string;
  semesterStart: string | null;
  semesterEnd: string | null;
}

export interface ExportSubject {
  id: string;
  profileId: string;
  name: string;
  color: string;
  semester: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A file hanging off a subject (STUDY-001, migration 035): the index row only,
 * exactly as `ExportTaskAttachment` and `ExportNoteAttachment` are, with the
 * bytes declared as a binary entry and content-addressed by `sha256`. All three
 * tables share ONE `blobs/<sha256>` namespace in the archive, because they share
 * one blob store on disk — a file attached to a subject, a task AND a note
 * travels once. Rides in `data/study.ndjson` after the subjects it hangs off.
 */
export interface ExportSubjectAttachment {
  id: string;
  subjectId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/**
 * One subject↔note link (STUDY-001, migration 035): the pair, plus when it was
 * made — the order the subject panel lists its notes in, and the only field a
 * pair-keyed row has of its own. `ExportTaskDependency`'s shape with a
 * timestamp, and pair-identified for the same reason (migration 035's PRIMARY
 * KEY). Rides in `data/study.ndjson` after the subjects, and needs the NOTES of
 * `data/notes.ndjson` too — which the reader resolves across files, since
 * nothing here constrains the writing order of the other file.
 */
export interface ExportSubjectNoteLink {
  subjectId: string;
  noteId: string;
  createdAt: string;
}

export interface ExportExam {
  id: string;
  profileId: string;
  subjectId: string;
  examType: string;
  examDate: string;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportDeck {
  id: string;
  profileId: string;
  subjectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Full FSRS scheduling state — the NDJSON is the lossless layer (ADR-009); the CSV mirror below drops these fields deliberately. */
export interface ExportCard {
  id: string;
  profileId: string;
  deckId: string;
  front: string;
  back: string;
  /**
   * The note that generated this card, and the block key it reconciles
   * against (NOTE-006/ADR-017) — both null for a hand-made card, and never
   * one without the other.
   *
   * Declared late (this contract shipped without them) because a card's
   * origin is not decoration: `syncFromNote` reconciles a note's cards by
   * `sourceBlockKey`, so a restore that dropped these would leave every
   * note-sourced card orphaned, and the next time the user opened that note
   * it would generate a second card per block — the original's FSRS history
   * stranded on a row nothing points at any more.
   */
  sourceNoteId: string | null;
  sourceBlockKey: string | null;
  /**
   * What kind of card this is (STUDY-006 / ADR-042). OPTIONAL with a default:
   * absent means `"basic"`, which is exactly what every archive written before
   * this field existed contained, so it needs no `ArchiveEra` flag (the ADR-028
   * rule — an era flag exists only for a field whose absence is ambiguous). A
   * key that IS present is validated strictly, in every era.
   */
  kind?: string;
  /**
   * A cloze card's raw `{{…}}` template and the deletion this row asks.
   * Required together exactly when `kind` is `"cloze"`, absent or null
   * otherwise — the same pair rule the `cards` CHECK constraints enforce, and
   * the reader additionally re-runs the `{{…}}` grammar to confirm the ordinal
   * is actually IN the template. Without them a restored cloze card would keep
   * its rendered sides but lose the only text its owner can edit.
   *
   * Since `1.26.0` (ADR-068) `clozeOrdinal` is the deletion's 1-based NUMBER,
   * not its 0-based position; the reader upgrades an older archive's value by
   * +1 off its own `writesClozeNumbers` era flag, since nothing in the row
   * itself can tell the two apart.
   */
  clozeText?: string | null;
  clozeOrdinal?: number | null;
  /**
   * A problem card's worked solution in the `--` grammar of `problemSteps.ts`,
   * the SOURCE its `back` is derived from (ADR-046). OPTIONAL with a default,
   * like `kind`: absent or null means "no worked solution", which is what every
   * card in every archive written before this field contained, so no
   * `ArchiveEra` flag is involved. Only a `"basic"` card may carry it — a
   * problem card is a basic card with steps, not a third kind — and the reader
   * refuses it on a cloze card, whose `back` already has a source.
   */
  problemSteps?: string | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportReviewLogEntry {
  id: string;
  profileId: string;
  cardId: string;
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  review: string;
  createdAt: string;
}

/**
 * One entry of an exam's ranked curriculum (ADR-063, migration 046). Rides in
 * `data/study.ndjson` after the decks it may link (`deckId`) and AHEAD of the
 * plans — a plan's blocks name topics, so the file keeps its "everything a row
 * points at came before it" reading. `sortOrder` is the user's RANK: 0 = the
 * list's top = most important, contiguous per exam (`TopicStore`'s invariant).
 * `cut` travels because it is a decision the user made (STUDY-004's accepted
 * scope cut), and a restore that forgot it would quietly put dropped topics
 * back on the schedule.
 */
export interface ExportExamTopic {
  id: string;
  profileId: string;
  examId: string;
  name: string;
  sortOrder: number;
  /** The user's own 0-100 self-assessment, or null for unknown (the planner then derives one from the deck). */
  confidence: number | null;
  /** The flashcard deck this topic is drilled from, or null. Detached when the deck is not in the archive — decoration, not substance. */
  deckId: string | null;
  cut: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExportStudyPlan {
  id: string;
  profileId: string;
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
  /**
   * The Mon..Sun capacity vector (ADR-063, migration 046). OPTIONAL with a
   * default, like a card's `kind`: absent or null means "every day =
   * dailyMinutes", which is exactly what every plan in every archive written
   * before this field existed was, so no `ArchiveEra` flag is involved. A
   * PRESENT vector is validated strictly (7 integers 0-480, at least one
   * positive) — the store's own rule, re-checked on the way in.
   */
  weekdayMinutes?: readonly number[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportStudyBlock {
  id: string;
  planId: string;
  profileId: string;
  blockDate: string;
  minutes: number;
  status: string;
  /**
   * The topic this block serves (ADR-063), naming an `exam-topic` row of this
   * archive, or null on an undifferentiated block. OPTIONAL with a default —
   * absent means null, which is what every block in every pre-`1.25.0`
   * archive was — so no `ArchiveEra` flag (the ADR-028 rule). A dangling id
   * detaches TO NULL rather than costing the block: the row is real study
   * time either way.
   */
  topicId?: string | null;
  /** What the block is for: `coverage`, `revision` or `recall` (migration 046's CHECK). OPTIONAL — absent means `"coverage"`, every earlier block's only kind. */
  kind?: string;
  /** Whether the user pinned this block against regeneration. OPTIONAL — absent means unpinned, which every earlier block was. */
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One profile's study-scheduling preferences (STUDY-007, migration 034): the
 * FSRS target retention plus the two daily caps. Rides in `data/study.ndjson`,
 * FIRST — it references nothing and nothing references it, so its position is
 * readability (the settings the rest of the module is studied under, before the
 * rows), exactly as `dashboard-settings` leads its own file.
 *
 * `maxReviewsPerDay` is `null` for "no cap at all", never 0 — the distinction
 * the column itself makes, carried through the interchange rather than
 * flattened into a sentinel a reader would have to know about.
 */
export interface ExportStudySettings {
  profileId: string;
  targetRetention: number;
  newPerDay: number;
  maxReviewsPerDay: number | null;
}

/**
 * One FINISHED focus session (migration 058) — the single row shape behind the
 * one focus timer this product has. STUDY's open-ended study session and a
 * Pomodoro phase are the same row: „a period of deliberate attention, optionally
 * planned, optionally attached to a subject or a task."
 *
 * A RUNNING session is never here, because it is never a row anywhere
 * (migration 008's decision, upheld): it lives as main-process runtime state, so
 * a crash loses the in-progress timer honestly rather than persisting a duration
 * nobody observed. Which is why `outcome` has no „abandoned" — every row in this
 * file is time somebody actually spent.
 *
 * `subjectId` is nullable from `1.34.0`, and every field below it is new there.
 * A pre-`1.34.0` row carries none of them and means exactly one thing: a `work`
 * phase, unplanned, unpaused, of the subject it names.
 *
 * `taskId` is a bare id with NO reference rule, deliberately — the time was
 * spent whether or not the task still exists — and `label` is what the session
 * was CALLED at the time, so the row stays readable once its task is gone.
 */
export interface ExportFocusSession {
  id: string;
  profileId: string;
  /** The subject studied, or null — a Pomodoro phase usually belongs to none. */
  subjectId: string | null;
  startedAt: string;
  endedAt: string;
  kind: FocusPhaseKind;
  /** Minutes the phase was set for, or null for an open-ended session. */
  plannedMinutes: number | null;
  /** Seconds of the span that were paused; never more than the span itself. */
  pausedSeconds: number;
  /** How it ended, or null when nothing was recorded (every pre-`1.34.0` row). */
  outcome: FocusOutcome | null;
  cycleIndex: number;
  /** What was being worked on. Never reference-checked — see the interface doc. */
  taskId: string | null;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportNotification {
  id: string;
  profileId: string;
  source: string;
  entityId: string;
  occurrenceKey: string;
  title: string;
  body: string;
  status: string;
  snoozedUntil: string | null;
  deliveredAt: string;
  createdAt: string;
  updatedAt: string;
}

/** A note's metadata row (ADR-022 section 3 / NOTE). */
export interface ExportNote {
  id: string;
  profileId: string;
  title: string;
  folderId: string | null;
  /**
   * What KIND of note this is (NOTE-002, migration 049) — a `note-category`
   * row's id, or null when uncategorized. REQUIRED here, like the `folderId`
   * and `cardDeckId` beside it, rather than optional the way a folder's
   * `defaultView` is: the reader always produces a value for it (a pre-`1.27.0`
   * archive carries no key at all and parses to `null`, which is exactly what
   * every note in one was), so nothing downstream should have to spell a
   * fallback for a field that is never absent by the time it is read.
   */
  categoryId: string | null;
  pinned: boolean;
  cardDeckId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The note's merged Yjs state, or null when it has never been edited. Emitted as `data/notes/<id>.ydoc`; stripped from the NDJSON row (bytes are not JSON) and used as the Markdown mirror's source. */
  snapshot: Uint8Array | null;
}

export interface ExportNoteFolder {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  /**
   * The template a note created in this folder opens with (ADR-036). A
   * built-in template's constant id or a `note_templates` row's id — the two
   * are indistinguishable here on purpose, exactly as in the column (migration
   * 028 deliberately declares no foreign key), and a dangling id quietly means
   * "no template" rather than refusing to create the note.
   */
  defaultTemplateId: string | null;
  /** Whether a context-free "Nova beleška" (the palette's) files into this folder. At most one folder per profile carries it. */
  isCaptureDefault: boolean;
  /**
   * The shape this folder's notes are drawn in — `"list"` or `"cards"`
   * (NOTE-002, migration 039). OPTIONAL with a default, like a task list's
   * `viewConfig`: absent means `"list"`, which is what every folder in every
   * archive written before this field actually opened as, so no `ArchiveEra`
   * flag is involved. A PRESENT value is validated strictly against the closed
   * set, in every era.
   */
  defaultView?: "list" | "cards";
  createdAt: string;
  updatedAt: string;
}

export interface ExportNoteTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/**
 * A note category (NOTE-002, migration 049) — what KIND of note something is:
 * sastanak, ideja, dnevnik, recept. The third organizational axis, and
 * deliberately NOT a fourth spelling of the other two: a folder is a place (one
 * per note, hierarchical), a tag is a subject (many per note, flat), a category
 * is a type (exactly one per note, optional, FLAT).
 *
 * Flat is the whole shape: there is no `parentId` here because a hierarchy of
 * categories would be a folder tree, and this archive already carries one.
 * `color` is a folder swatch key, from the very same closed palette — the store
 * validates both against one list, so the interchange carries one plain string
 * rather than two enums that could drift apart.
 */
export interface ExportNoteCategory {
  id: string;
  profileId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One note-tag attachment. */
export interface ExportNoteTagLink {
  noteId: string;
  tagId: string;
}

/** `content` is a JSON-encoded ProseMirror document (ADR-016) — a template is not a note and carries no Yjs state. */
export interface ExportNoteTemplate {
  id: string;
  profileId: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The index row only; the bytes are declared as a binary entry,
 * content-addressed by `sha256`.
 *
 * Deliberately WITHOUT the row's `extracted_text` (SRCH-008 / migration 048),
 * and the same goes for `ExportTaskAttachment`. That column is *derived* from
 * the very bytes travelling beside it in `blobs/`, so carrying it would ship a
 * second copy of content the archive already holds — one that can disagree with
 * the first, since an older writer's extraction restored into a newer reader is
 * a stale answer nothing would ever recompute. A restored row therefore arrives
 * with nothing extracted, which is exactly the honest "not attempted yet" state
 * the column's NULL means, and main runs a bounded extraction pass at the end
 * of every restore and import apply. Nothing to add to the schema version:
 * neither the reader nor the writer gains or loses a field.
 */
export interface ExportNoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ExportNoteVersion {
  noteId: string;
  coveredSeq: number;
  title: string;
  createdAt: string;
  /** The checkpoint's Yjs state — emitted as `data/note-versions/<noteId>/<coveredSeq>.ydoc`, stripped from the NDJSON row. */
  snapshot: Uint8Array;
}

/**
 * One profile's dashboard background choice and dim (SET-006 / ADR-041).
 *
 * A record rather than a manifest section, unlike the flags and notification
 * preferences below, because it names a BLOB: the image travels in the
 * archive's `blobs/` union exactly as a note attachment does, and a row that
 * points at one belongs where the other blob-bearing rows are — in the NDJSON,
 * checksummed, one line per profile.
 *
 * `backgroundHash`/`backgroundMime`/`backgroundSizeBytes` are all null or all
 * set (migration 030's CHECK): a hash with no mime is a blob nothing can decide
 * how to serve, and a hash with no size would make the manifest's blob
 * inventory only partly true. The mime is whatever main sniffed from the file's
 * own bytes at pick time (SEC-FILE-02), never a guess from its name.
 */
export interface ExportDashboardSettings {
  profileId: string;
  backgroundHash: string | null;
  backgroundMime: string | null;
  backgroundSizeBytes: number | null;
  backgroundDim: number;
  /**
   * The named board the profile is currently looking at (DASH-008 / ADR-055),
   * naming a `dashboard-set` row of this archive, or null for the default
   * board. OPTIONAL with a default, like a card's `kind`: absent means null,
   * which is the only board any archive written before `1.21.0` could have
   * been showing, so no `ArchiveEra` flag is involved. A PRESENT id is
   * reference-checked against the archive's own sets.
   */
  activeSetId?: string | null;
}

/**
 * One named dashboard („tabla“, DASH-008 / ADR-055, migration 043). Rides in
 * `data/dashboard.ndjson` between the settings row and the widgets: after the
 * preferences that lead the file (the `study-settings` idiom), before the rows
 * whose `setId` names it — so the file still reads as "everything a row points
 * at came before it", with the one exception of the settings row's own
 * `activeSetId`, which the reader resolves in the reference pass exactly as it
 * resolves a `subject-note-link` across files.
 *
 * The DEFAULT board is deliberately NOT among these rows: `set_id NULL` is the
 * default dashboard, named „Početna“ in copy only, so an archive of a profile
 * that never made a named board carries no `dashboard-set` at all — which is
 * also what every pre-`1.21.0` archive is.
 */
export interface ExportDashboardSet {
  id: string;
  profileId: string;
  name: string;
  /**
   * Where this board sits among the profile's boards: a fractional rank,
   * compared as a plain string. An archive written before `1.39.0` carries a
   * sparse INTEGER `position` here, converted on the way in by
   * `rankForInteger`.
   */
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One placed widget of a profile's dashboard layout (DASH-002 / ADR-045,
 * migration 032). Rides in `data/dashboard.ndjson` beside `dashboard-settings`,
 * after it — the two share a module and reference each other not at all.
 *
 * `widgetId` is a `moduleId:widgetId` slug a module's MANIFEST publishes: a code
 * constant, in no table (migration 032 declares no foreign key for it, on
 * migration 028's argument). It is carried across unchanged by every path here,
 * including a foreign import, precisely because it does not name a row.
 *
 * `rank` is a fractional sort key, not an index: it is never assumed
 * contiguous, and the ORDER it expresses is the layout. `config`
 * is per-widget JSON text, opaque — no widget publishes a config schema yet, so
 * the reader checks only that a non-null value parses as JSON at all.
 */
export interface ExportDashboardWidget {
  instanceId: string;
  profileId: string;
  widgetId: string;
  size: string;
  /**
   * Where this row sits in its scope: a fractional rank, compared as a plain
   * string (`@nexus/core`'s `rankBetween`). Never an index — it is not
   * contiguous and nothing counts it. An archive written before `1.39.0`
   * carries a sparse INTEGER `position` here instead, which the reader
   * converts row-locally and losslessly through `rankForInteger`
   * (`ArchiveEra.writesOrderRanks`).
   */
  rank: string;
  config: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The named board this placement belongs to (DASH-008 / ADR-055), naming a
   * `dashboard-set` row of this archive, or null for the default board.
   * OPTIONAL with a default, like a card's `kind` (the ADR-028 rule — no
   * `ArchiveEra` flag): absent means null, because the default board is the
   * only one any widget in any pre-`1.21.0` archive could have been on. A
   * PRESENT id is reference-checked against the archive's own sets.
   */
  setId?: string | null;
}

// --- FIN (the finance module, migration 051) --------------------------------
//
// Money is an INTEGER of MINOR UNITS on every row below, and the interchange
// carries it exactly as the schema stores it: no decimal string, no scale
// field, no float anywhere. 1234 in an RSD account is 12,34 RSD; which
// separator that renders with is a display fact, and the archive deliberately
// says nothing about it. Currency lives on the ACCOUNT, and nothing in this
// interchange converts between two of them — there is no rate here because
// there is no honest source for one.

/**
 * One account (migration 051). `openingBalance` is minor units and never
 * changes as money moves; a BALANCE is derived from it plus the transactions
 * and is deliberately not carried — an archive that shipped a stored balance
 * would ship a number that can disagree with the rows beside it.
 */
export interface ExportFinAccount {
  id: string;
  profileId: string;
  name: string;
  /** `cash` | `current` | `card` | `savings` — migration 051's closed CHECK domain. */
  kind: string;
  /** ISO-4217, upper-case. The one place a currency is decided. */
  currency: string;
  openingBalance: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One flat category with its income/expense kind (migration 051, ADR-072's
 * argument). There is no `parentId` and there never will be: a category tree IS
 * a folder tree, and one tree per app is enough. Rides in
 * `data/finance.ndjson` ahead of the transactions whose `categoryId` names it.
 */
export interface ExportFinCategory {
  id: string;
  profileId: string;
  name: string;
  /** `income` | `expense`. */
  kind: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One movement of money — and a TRANSFER between the user's own accounts is
 * this same row with `counterAccountId` filled, never a pair. `amount` is
 * signed from `accountId`'s point of view, so the counter account receives
 * `-amount`; that is what lets one row carry both halves without them ever
 * falling out of step. A transfer's `categoryId` is always null (migration
 * 051's CHECK, re-validated by the reader): it is neither income nor expense.
 */
export interface ExportFinTransaction {
  id: string;
  profileId: string;
  accountId: string;
  counterAccountId: string | null;
  categoryId: string | null;
  /** The LOCAL day as a bare `YYYY-MM-DD`, the way this interchange already carries bare dates. */
  date: string;
  /** Minor units, INTEGER, never zero. */
  amount: number;
  payee: string | null;
  note: string | null;
  /**
   * The row's IMPORT FINGERPRINT (migration 052, `1.29.0`), or null for a row
   * the user typed. It must travel: a profile restored from an archive whose
   * ledger arrived without its fingerprints would re-import the very same bank
   * statement as a second copy of itself, which is the one failure the
   * fingerprint exists to prevent. Composed by `finImportKey` over the row's own
   * facts — day, signed minor units, payee, note, and the occurrence number that
   * keeps two identical coffees on one day two coffees — and deliberately NOT
   * over the account, which the row names in a column of its own.
   */
  importKey: string | null;
  /**
   * The `fin-recurring` row that generated this charge (FIN slice d, migration
   * 053), or null for a typed one. OPTIONAL with a default: absent means null,
   * which is what every transaction in every pre-`1.30.0` archive was, so no
   * `ArchiveEra` flag is involved (the ADR-028 rule). A dangling id DETACHES to
   * null rather than costing the row — the charge is money that actually moved,
   * and losing it over a lost provenance link would make every total wrong.
   */
  recurringId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One recurring charge — a transaction TEMPLATE plus an ADR-024 schedule
 * (migration 053). The schedule is the SAME `recurrence` object a `task` or an
 * `event` carries, canonical JSON and all, because FIN has no rule language of
 * its own; the template half is the `fin-transaction` each charge will be, field
 * for field, with `amount` signed identically.
 *
 * `nextRun` is a CURSOR — the first occurrence not yet charged — and it travels
 * so a restore cannot re-charge history that is in the very same archive.
 * Nullable: a series past its `until`/`count` end has no next one, and a
 * sentinel date would sort into the middle of real ones.
 *
 * `pausedAt` (`1.31.0`) is the moment its owner stopped the charging, null while
 * it charges — a fact about the subscription, independent of the soft delete it
 * outlives, and the one field here whose loss would make a restore start taking
 * somebody's money again.
 *
 * There is no `counterAccountId`: a subscription is never a transfer.
 */
export interface ExportFinRecurring {
  id: string;
  profileId: string;
  accountId: string;
  categoryId: string | null;
  name: string;
  /** Minor units, INTEGER, never zero. Negative leaves `accountId`, positive arrives in it. */
  amount: number;
  payee: string | null;
  note: string | null;
  /** ADR-024's rule, exactly as `task.recurrence` carries one. */
  recurrence: RecurrenceRule;
  /** The bare day the rule phases from, and the series' first possible charge. */
  startDate: string;
  /** The first occurrence not yet charged, or null once the series is spent. */
  nextRun: string | null;
  /** Whole days before a charge to remind, or null for no reminder. */
  reminderDays: number | null;
  /** When the charging was paused (ADR-074), or null while it charges. */
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One category's monthly allowance in ONE currency (migration 051). Per
 * currency because there is no FX to fold two of them with, and only ever on an
 * EXPENSE category — a budget is a spending limit, and an income category would
 * want a target, which compares the other way.
 */
export interface ExportFinBudget {
  id: string;
  profileId: string;
  categoryId: string;
  currency: string;
  /** Minor units, INTEGER, positive. */
  amount: number;
  createdAt: string;
  updatedAt: string;
}

// --- HABIT (the habits module, migration 055) -------------------------------
//
// The module's whole subject is a STREAK, and a streak is a fact derived from
// the two row types below and nothing else. Neither the current run nor the best
// one travels: an archive that shipped a stored streak would ship a number that
// can disagree with the days beside it — the same reason no account carries a
// balance, one module over.

/**
 * One habit (migration 055). Rides in `data/habits.ndjson` ahead of the entries
 * that name it.
 *
 * `schedule` is HABIT's OWN vocabulary — `{ kind: "days", weekdays }` or
 * `{ kind: "quota", perWeek }` — and deliberately not the `recurrence` a `task`,
 * an `event` and a `fin-recurring` carry. That is the module's central decision
 * and it is the interchange's too: see `SCHEMA_VERSION`'s `1.32.0` entry, and
 * `habitSchedule.ts` for the argument in full. A nested object rather than a JSON
 * STRING, for the reason a task's `recurrence` is one: the interchange is JSON,
 * and a string here would be a second encoding nobody can read in the file.
 *
 * `target` is the single nullable field that makes „teretana" and „8 čaša vode"
 * one model: null is a binary habit whose entries carry a `value` of 1, non-null
 * is a count a day must reach. `unit` names what it counts and is never set
 * without it (migration 055's own pair CHECK, re-validated by the reader).
 *
 * `archivedAt` is when the user finished with this habit, or null while it is
 * current — a fact INDEPENDENT of the soft delete it outlives, exactly as a
 * subscription's `pausedAt` is. It must travel: a restore that dropped it would
 * put every retired habit back into today's list, and the point of archiving one
 * is that its history survives without cluttering the page.
 */
export interface ExportHabit {
  id: string;
  profileId: string;
  name: string;
  /** A `note_folders` swatch key, from the very same closed palette — one palette, one string. */
  color: string | null;
  schedule: HabitSchedule;
  /** Whole units a day must reach to count, or null for a binary habit. */
  target: number | null;
  /** What `target` counts, or null. Never non-null while `target` is null. */
  unit: string | null;
  /** Wall-clock `HH:MM`, or null for no reminder. */
  reminderTime: string | null;
  /** When the habit was archived, or null while it is current. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One day's tick (migration 055). Rides in `data/habits.ndjson` AFTER the habits,
 * which is the ordering the file's „everything a row points at came before it"
 * reading requires — an entry names nothing else.
 *
 * No `profileId`: an entry is scoped through its habit, exactly as a
 * `note-attachment` is through its note and a `task-section` through its list.
 *
 * `value` is a POSITIVE INTEGER, always — 1 for a binary habit, the count for a
 * targeted one. Never zero and never a float: an untouched day is the ABSENCE of
 * a row (migration 055's CHECK refuses both), so „nisam" and „nula" are the same
 * thing and the interchange has exactly one way to say it.
 */
export interface ExportHabitEntry {
  id: string;
  habitId: string;
  /** The LOCAL day as a bare `YYYY-MM-DD`, the way this interchange already carries bare dates. */
  date: string;
  value: number;
  createdAt: string;
  updatedAt: string;
}

// --- FIT (nutrition, migration 058) -----------------------------------------
//
// THE CATALOGUE IS NOT HERE, and its absence is the module's first decision
// rather than an omission — see `SCHEMA_VERSION`'s `1.35.0` entry. The several
// hundred foods the app ships with are JSON inside `@nexus/core`, so an archive
// carries only what the user added themselves plus what they actually logged.
// Nothing is lost by that, because a meal item carries its own snapshot.

/**
 * One food the USER added (migration 058). Rides in `data/fitness.ndjson` ahead
 * of the meal items, though nothing requires it: a meal item's `foodRef` is
 * provenance rather than a reference this archive resolves.
 *
 * `per100g` is a nested object rather than seven flat fields, for the reason a
 * habit's `schedule` is one: the interchange is JSON, this is one thing with
 * seven parts, and it is the exact shape the catalogue's own file uses — so a
 * user food and a catalogue entry read identically wherever both appear.
 *
 * It carries no `source`, unlike a catalogue entry, and the absence is
 * deliberate: the app must cite a url for a number it asserts, while a user's
 * own food is their claim about their own food.
 */
export interface ExportFitFood {
  id: string;
  profileId: string;
  name: string;
  /** One of `FOOD_CATEGORIES`, the same closed list the catalogue uses — re-validated by the reader. */
  category: string;
  per100g: FoodMacros;
  /** Household measures, possibly empty — brašno is weighed, and inventing „1 komad" for it would be inventing data. */
  servings: readonly FoodServing[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One logged item (migration 058). There is deliberately no `fit-meal` record:
 * a meal is a `(date, slot)` grouping rather than a row, so an archive that
 * carried meal containers would carry empty ones nothing could ever show.
 *
 * **`per100g` is a SNAPSHOT and it is why this archive is complete without the
 * catalogue.** It is what the food carried at the moment it was logged — copied
 * in then, never re-read since. A restore into a build whose catalogue has moved
 * on reproduces the day exactly as it was eaten, which is the only honest thing
 * a food diary can do.
 *
 * `label` travels for the same reason: the item must read with nothing to
 * resolve. `foodRef` (`catalogue:<id>` or `user:<uuid>`) is provenance beside
 * them, and the reader gives it NO reference rule — the first names something
 * that is not a row anywhere, and the second may name a food already deleted.
 */
export interface ExportFitMealItem {
  id: string;
  profileId: string;
  /** The LOCAL day as a bare `YYYY-MM-DD`. */
  date: string;
  /** One of the five slots — `dorucak`, `uzina1`, `rucak`, `uzina2`, `vecera`. */
  slot: string;
  foodRef: string;
  label: string;
  /** What was eaten, in grams; strictly positive (migration 058's CHECK) and deliberately not whole — 87.5 g is a real portion. */
  grams: number;
  per100g: FoodMacros;
  createdAt: string;
  updatedAt: string;
}

/**
 * The profile's daily nutrition goals (migration 058) — zero or one row, the
 * `study-settings` arrangement.
 *
 * All four are INDEPENDENTLY NULLABLE, and null means „no goal" rather than
 * zero. The two are different claims: a restore that read a missing goal as 0
 * would give somebody a calorie target of nothing, and one that read 0 as
 * missing would quietly discard a decision. The interchange keeps them apart
 * because the column does.
 */
export interface ExportFitTarget {
  profileId: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  updatedAt: string;
}

// --- FIT training & body (ADR-081 slice b, migration 060) -------------------
//
// Seven record types riding in the SAME `data/fitness.ndjson` as the three
// above — see `SCHEMA_VERSION`'s `1.37.0` entry for why this is one module's
// two halves rather than a module of its own.

/**
 * One exercise the USER added (migration 060). The app's own catalogue ships as
 * JSON inside `@nexus/core` and is NOT exported — `SCHEMA_VERSION`'s `1.37.0`
 * entry, `1.35.0`'s food-catalogue argument one table over.
 *
 * `primaryMuscles`/`secondaryMuscles` are JSON arrays re-validated against
 * `MUSCLE_GROUPS`, exactly as `equipment`/`pattern`/`metric` are re-validated
 * against their own closed lists — none of the four is backed by a SQL CHECK
 * (migration 060's own doc: they are JSON, or a label nothing computes on), so
 * an archive is the one way a bad value could reach the column unchecked.
 */
export interface ExportFitExercise {
  id: string;
  profileId: string;
  name: string;
  /** Empty is ordinary — a user's own accessory movement need not carry an English name. */
  nameEn: string;
  primaryMuscles: readonly MuscleGroup[];
  secondaryMuscles: readonly MuscleGroup[];
  equipment: ExerciseEquipment;
  pattern: MovementPattern;
  unilateral: boolean;
  metric: ExerciseMetric;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A routine is the SHAPE of a session and holds nothing about when it runs
 * (migration 060's own doc, ADR-035's task templates one module over). Rides in
 * `data/fitness.ndjson` AHEAD of the `fit-routine-item` rows that name it —
 * parents before children, the `data/habits.ndjson` idiom.
 */
export interface ExportFitRoutine {
  id: string;
  profileId: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One line of a routine (migration 060). `routineId` is a REAL foreign key
 * (`ON DELETE CASCADE`) and IS reference-checked — see `SCHEMA_VERSION`'s
 * `1.37.0` entry — unlike `exerciseRef`, which is text with no foreign key by
 * design and gets shape validation only (`parseExerciseRef`), never a lookup:
 * it may name the app's catalogue (not a row anywhere) or a user exercise this
 * profile has since deleted, and `label` is what keeps the line readable either
 * way. The three targets are independently nullable — "bench, as many sets as
 * it takes" is a real prescription, and `null` is "no target", never a target of
 * zero.
 */
export interface ExportFitRoutineItem {
  id: string;
  profileId: string;
  routineId: string;
  position: number;
  exerciseRef: string;
  label: string;
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  /**
   * Migration 061's targets — the ones a rep range cannot express. Added in
   * interchange `1.38.0`; an archive written before it simply has no such
   * properties, and the reader turns their absence into `null` rather than
   * refusing the record.
   */
  targetSeconds: number | null;
  targetWeightKg: number | null;
  targetDistanceM: number | null;
  restSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One logged session (migration 060). `endedAt` is `null` exactly while the
 * session was open at export time — a fact this archive reproduces rather than
 * closes, and one the reader's own invariant refuses to let a second row of
 * (see `SCHEMA_VERSION`'s `1.37.0` entry: at most one open workout per profile,
 * the schema's own `fit_workouts_profile_open` index). `routineRef` is a bare
 * routine id with NO grammar and no reference rule — it may be soft-deleted or
 * simply not in this archive, and `routineLabel` is what the session was called
 * at the time, so it reads without the routine either way. Rides AHEAD of the
 * `fit-workout-set` rows that name it.
 */
export interface ExportFitWorkout {
  id: string;
  profileId: string;
  day: string;
  startedAt: string;
  endedAt: string | null;
  routineRef: string | null;
  routineLabel: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One logged set (migration 060). `metric` and `primaryMuscles` are SNAPSHOTTED
 * with the set — the same decision `fit-meal-item`'s `per100g` makes one module
 * over, and for the identical reason: an exercise edited tonight must not
 * re-interpret arithmetic performed on tonight's lift as though it had always
 * meant that. `workoutId` is a real foreign key and IS reference-checked, on
 * `routineId`'s exact terms above; `exerciseRef` is shape-checked only, on
 * `fit-routine-item`'s. The four numeric fields are independently nullable —
 * which of them mean anything is exactly what `metric` decides.
 */
export interface ExportFitWorkoutSet {
  id: string;
  profileId: string;
  workoutId: string;
  position: number;
  exerciseRef: string;
  label: string;
  metric: ExerciseMetric;
  primaryMuscles: readonly MuscleGroup[];
  kind: SetKind;
  /** Kilograms. Total load for `weight_reps`/`weight_time`, ADDED load for `weighted_reps`, SUBTRACTED assistance for `assisted_reps`. */
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
  distanceM: number | null;
  /** Reps in reserve, 0-5, or null. */
  rir: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One reading, one day (migration 060) — the table's PRIMARY KEY is
 * `(profileId, day)`, which is why this row carries no id of its own: a second
 * reading for a day this archive already carries is the ordinary `duplicate-id`
 * problem, keyed on the pair (`SCHEMA_VERSION`'s `1.37.0` entry).
 *
 * `muscle` is `@nexus/core`'s own `MuscleReading` — a unit and a value kept
 * VERBATIM, never normalised into the other unit — and `circumferences` is its
 * `BodyCircumferences`, the six tape sites `CIRCUMFERENCE_SITES` names. Both
 * nested objects rather than flattened columns, for the reason a habit's
 * `schedule` is one: the interchange is JSON.
 */
export interface ExportFitMeasurement {
  profileId: string;
  day: string;
  weightKg: number;
  bodyFatPercent: number | null;
  muscle: MuscleReading | null;
  waterPercent: number | null;
  circumferences: BodyCircumferences;
  createdAt: string;
  updatedAt: string;
}

/**
 * The profile's own body facts (migration 060) — zero or one row, `fit-target`'s
 * arrangement: keyed by `profileId` alone, so a second row is `duplicate-id`.
 *
 * `birthDate` travels rather than an age, on migration 060's own reasoning:
 * storing "30" once means being wrong from the next birthday onward, silently,
 * inside a BMR nobody re-checks. `sex: null` means "not given", never "unknown,
 * assume male" — its absence closes the Mifflin-St Jeor tier, and a reader that
 * coerced it to a value would be inventing a demographic.
 */
export interface ExportFitBodyProfile {
  profileId: string;
  sex: BodySex | null;
  birthDate: string;
  heightCm: number;
  activity: ActivityLevel;
  createdAt: string;
  updatedAt: string;
}

// --- CANV (canvas boards, migration 059) ------------------------------------
//
// One record type, because a board IS its drawing: there is nothing else about
// it to carry beyond a name and the usual timestamps.

/**
 * One board (migration 059). Rides alone in `data/canvas.ndjson`; it names
 * nothing and nothing names it, so the file has no ordering to keep.
 *
 * `scene` is the EDITOR's own document, kept verbatim — see `SCHEMA_VERSION`'s
 * `1.36.0` entry for why it travels whole rather than re-modelled into rows, and
 * `canvas/canvasScene.ts` for what „whole" means. A nested object rather than a
 * JSON string, exactly as a habit's `schedule` and a task's `recurrence` are
 * nested: the interchange is JSON, and a string here would be a second encoding
 * nobody can read in the file.
 *
 * There is no `archivedAt` beside the soft delete, unlike a habit's: nothing is
 * derived from a board over time, so „gotov sam s ovim" and „obriši ovo" are the
 * same act here (migration 059).
 */
export interface ExportCanvasBoard {
  id: string;
  profileId: string;
  name: string;
  /** Excalidraw's `serializeAsJSON` document. The reader validates its envelope and never its elements. */
  scene: CanvasScene;
  createdAt: string;
  updatedAt: string;
}

/**
 * One circuit (migration 067). Rides in `data/electronics.ndjson` with the two
 * types below, and comes first in it: a part names its circuit and a wire names
 * both, so parents precede children here as `taskLists` precede `tasks`.
 *
 * Nothing about the COMPONENTS travels. The catalogue ships inside the app —
 * see `SCHEMA_VERSION`'s `1.40.0` entry — so a part carries a `componentId` and
 * the reader resolves it against whatever build opens the archive.
 */
export interface ExportCircuit {
  id: string;
  profileId: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** One component placed on a circuit's canvas (migration 067). */
export interface ExportCircuitPart {
  id: string;
  circuitId: string;
  /** Into the app's catalogue, or into a component the user defined. Never resolved here. */
  componentId: string;
  /** The user's name for this one. Empty is ordinary: the canvas falls back to the component's. */
  label: string;
  x: number;
  y: number;
  rotation: number;
  /** Present only for a component that takes a value — a resistor's ohms. */
  value?: number;
  /**
   * Which face of the machine this part is bolted to (migration 068) — one of
   * `front`, `rear`, `left`, `right`, `top`. ABSENT means „not on the machine",
   * which is what every part in every pre-`1.41.0` archive was.
   */
  mount?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The machine one circuit is the electronics of (ADR-085 E4c, migration 068).
 *
 * **No id of its own**: a circuit has at most one machine, so `circuitId` IS the
 * key — which also makes a second chassis for one circuit the ordinary
 * `duplicate-id` problem rather than an invariant of its own (see
 * `SCHEMA_VERSION`'s `1.41.0` entry).
 *
 * Every measurement is required. A chassis is nine numbers or it is no row at
 * all, and the units are the ones the user typed: CENTIMETRES for the seven
 * lengths, GRAMS for the two masses.
 */
export interface ExportCircuitChassis {
  circuitId: string;
  /** `diff-rover` or `four-wheel-rover` — the shapes the generator has geometry for. */
  shape: string;
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  wheelRadius: number;
  wheelWidth: number;
  wheelTrack: number;
  wheelBase: number;
  bodyMass: number;
  wheelMass: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One wire between two pins (migration 067).
 *
 * Both ends are foreign keys in the database this lands in, which is why the
 * wires come last in the file: a wire whose parts have not been written yet is
 * refused by the restore, not merely out of order.
 */
export interface ExportCircuitWire {
  id: string;
  circuitId: string;
  fromPartId: string;
  fromPinId: string;
  toPartId: string;
  toPinId: string;
  /** One of the nine jumper colours by name, never a CSS colour. */
  colour: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Everything the manifest's "settings" section carries (founder decision #11:
 * flags + NTF settings ship with the export).
 *
 * NOT subject to a module choice (IMEX-003), and deliberately so: this is a
 * MANIFEST section, not rows — `countProfileModules` counts none of it, so it
 * has no module home in the one mapping that exists, and inventing one for it
 * would be the second mapping this whole arrangement avoids. The three
 * settings-SHAPED things that ARE rows do have homes and are filtered by them:
 * `studySettings` into study, `dashboardSettings` and `dashboardWidgets` into
 * dashboard. Note the resulting split on notifications, which is the honest one:
 * the `notifications` module is the delivered LEDGER, while the quiet hours and
 * per-source toggles below are preferences, and a user who unticks „Obaveštenja“
 * is asking not to export a history of what was shown — not to forget when they
 * like being disturbed.
 */
export interface ExportSettings {
  flags: Record<string, boolean>;
  notifications: {
    quietFrom: string | null;
    quietTo: string | null;
    morningHour: string;
    enabledSources: readonly string[];
    /**
     * Which snooze preset the notification center's plain „Odloži“ button means
     * (NTF-009, migration 041). Always WRITTEN, and OPTIONAL on the way back in
     * — an archive from before `1.19.0` simply has no key here and reads as
     * `"10m"`, which is what that button did in every one of those builds.
     */
    snoozeDefault: string;
  };
}

/**
 * One kit module's section of an archive (ADR-090): which module, and the
 * versioned payload that module handed over.
 *
 * `moduleId` is the module's own manifest id (`timers`), which is also the
 * prefix of every channel it declares — one name for one module, so an archive
 * that names an id this build does not know is answerable with a sentence
 * rather than a guess. The row rides as `module-data` in
 * `data/modules.ndjson`.
 */
export interface ExportModuleData {
  moduleId: string;
  /**
   * The module's own export value, exactly as its `exportData()` returned it
   * (or as its `importData()` will validate it back). Deliberately `unknown`:
   * see `ProfileData.modules` for why core carries this without reading it.
   */
  payload: unknown;
}

/**
 * Every non-derived row of one profile: what an archive carries, what the
 * exporter gathers, and what a restore writes. One shape, deliberately shared
 * by all three, so a module that one of them forgets is a type error in the
 * other two rather than a silent omission.
 */
export interface ProfileData {
  tasks: readonly ExportTask[];
  // Required, like `tasks` itself: a task names the list it lives in, so an
  // archive that carried the tasks but not the lists would restore a profile
  // whose every task points at a container that is not there.
  taskLists: readonly ExportTaskList[];
  taskSections: readonly ExportTaskSection[];
  // Required for the same reason, one step further along: a link names a tag,
  // so an archive carrying the links but not the tags would restore a profile
  // whose every label points at a row that is not there.
  taskTags: readonly ExportTaskTag[];
  taskTagLinks: readonly ExportTaskTagLink[];
  // Required, and for the sharpest reason of the three: an attachment row is
  // the ONLY thing that names a blob, so an archive that forgot them would not
  // merely lose the index — it would leave the user's files out of the zip
  // entirely, with nothing in the manifest to say they ever existed.
  taskAttachments: readonly ExportTaskAttachment[];
  // Required like every field above (ADR-035): a template is the only record of
  // a shape the user built by hand, and nothing else in the archive can be used
  // to reconstruct it — an export that quietly omitted them would restore a
  // profile whose templates are simply gone.
  taskTemplates: readonly ExportTaskTemplate[];
  // Required, like every field around it: a dependency is the ORDER the user put
  // their work in, and an archive that dropped it would restore a plan whose
  // "do this first" is gone with nothing on screen to say so.
  taskDependencies: readonly ExportTaskDependency[];
  events: readonly ExportEvent[];
  // Required, for `taskTemplates`' reason exactly (CAL-009): a template is the
  // only record of a shape the user built by hand, and nothing else in the
  // archive can be used to reconstruct it — an export that quietly omitted them
  // would restore a profile whose event templates are simply gone.
  eventTemplates: readonly ExportEventTemplate[];
  documents: readonly ExportDocument[];
  renewals: readonly ExportRenewal[];
  people: readonly ExportPerson[];
  /**
   * Zero or one row (CAL-010 / ADR-054) — the profile's fixed semester dates.
   * Required, like every field above and for the same reason: a module the
   * caller forgets must be a type error, not a quiet omission. An EMPTY array
   * is the honest shape for "this archive carries no such row", which is
   * exactly what every pre-`1.20.0` archive is, and what a restore then reads
   * as "leave the profile with no term set".
   */
  calendarSettings: readonly ExportCalendarSettings[];
  subjects: readonly ExportSubject[];
  // Required, for `taskAttachments`' sharpest-of-reasons: a material row is the
  // ONLY thing that names its blob, so an archive that forgot them would not
  // merely lose the index — it would leave the user's course files out of the
  // zip entirely, with nothing in the manifest to say they ever existed.
  subjectAttachments: readonly ExportSubjectAttachment[];
  // Required like every field around it: a link is which note belongs to which
  // course, and an archive that dropped it would restore a subject panel whose
  // notes are simply gone with nothing on screen to say so.
  subjectNoteLinks: readonly ExportSubjectNoteLink[];
  exams: readonly ExportExam[];
  decks: readonly ExportDeck[];
  cards: readonly ExportCard[];
  reviewLog: readonly ExportReviewLogEntry[];
  // Required like every field around it (ADR-063): a topic list is the ranked
  // curriculum its owner built by hand — the order, the confidences, the
  // accepted cuts — and nothing else in the archive can reconstruct it. An
  // export that quietly omitted them would restore a planner gone blind.
  examTopics: readonly ExportExamTopic[];
  plans: readonly ExportStudyPlan[];
  blocks: readonly ExportStudyBlock[];
  focusSessions: readonly ExportFocusSession[];
  /**
   * Zero or one row (STUDY-007) — the profile's target retention and daily
   * caps. Required, like every field above and for the same reason: a module
   * the caller forgets must be a type error, not a quiet omission. An EMPTY
   * array is the honest shape for "this archive carries no such row", which is
   * exactly what every pre-`1.13.0` archive is, and what a restore then reads as
   * "leave the profile on the store's own defaults".
   */
  studySettings: readonly ExportStudySettings[];
  notifications: readonly ExportNotification[];
  // Required, like every field above, and deliberately so: this archive
  // shipped for two weeks writing zero notes because the export simply had
  // no place to put them and nobody's compiler ever said a word. A module
  // the caller forgets must be a type error, not a quiet omission.
  notes: readonly ExportNote[];
  noteFolders: readonly ExportNoteFolder[];
  noteTags: readonly ExportNoteTag[];
  /**
   * The profile's note categories (NOTE-002, migration 049). Required like
   * every field around it and for the same reason: a module the caller forgets
   * must be a type error, not a quiet omission. EMPTY both for a pre-`1.27.0`
   * archive and for a profile that never made a category — indistinguishable on
   * purpose, because they mean the same thing.
   */
  noteCategories: readonly ExportNoteCategory[];
  noteTagLinks: readonly ExportNoteTagLink[];
  noteTemplates: readonly ExportNoteTemplate[];
  noteAttachments: readonly ExportNoteAttachment[];
  noteVersions: readonly ExportNoteVersion[];
  /**
   * Zero or one row (SET-006 / ADR-041) — the profile's dashboard background
   * and dim. Required, like every field above and for the same reason: a module
   * the caller forgets must be a type error, not a quiet omission. An EMPTY
   * array is the honest shape for "this archive carries no such row", which is
   * exactly what every pre-`1.9.0` archive is, and what a restore then reads as
   * "leave the profile on the store's own defaults".
   */
  dashboardSettings: readonly ExportDashboardSettings[];
  /**
   * The profile's named boards (DASH-008 / ADR-055), in board order. Required,
   * like every field above and for the same reason: a module the caller forgets
   * must be a type error, not a quiet omission. EMPTY both for a pre-`1.21.0`
   * archive and for a profile that never made a named board — indistinguishable
   * on purpose, because they mean the same thing: only „Početna“, which is not
   * a row and therefore not carried.
   */
  dashboardSets: readonly ExportDashboardSet[];
  /**
   * The profile's dashboard layouts (DASH-002 / ADR-045; per-board since
   * ADR-055) — one row per placed widget, each naming its board, in position
   * order. Required, like every field above and for the same
   * reason: a module the caller forgets must be a type error, not a quiet
   * omission.
   *
   * EMPTY is a meaningful value here, not merely the pre-`1.11.0` shape: a
   * profile that has never rearranged its dashboard stores no rows at all
   * (`DashboardWidgetStore` is get-or-default), so an empty array says "this
   * profile is on the default arrangement" — which is exactly what a restore
   * then leaves the target on.
   */
  dashboardWidgets: readonly ExportDashboardWidget[];
  /**
   * The FIN module's four collections (migration 051). Required like every
   * field above and for the same reason: a module the caller forgets must be a
   * type error, not a quiet omission — which is exactly the failure this whole
   * shape was written to repair. EMPTY both for a pre-`1.28.0` archive and for a
   * profile that keeps no ledger, indistinguishable on purpose, because they
   * mean the same thing.
   */
  finAccounts: readonly ExportFinAccount[];
  finCategories: readonly ExportFinCategory[];
  /**
   * The profile's recurring charges (FIN slice d, migration 053). Required like
   * every field around it: a module the caller forgets must be a type error.
   * EMPTY both for a pre-`1.30.0` archive and for a profile that keeps no
   * subscription, indistinguishable on purpose, because they mean the same
   * thing.
   */
  finRecurring: readonly ExportFinRecurring[];
  finTransactions: readonly ExportFinTransaction[];
  finBudgets: readonly ExportFinBudget[];
  /**
   * The HABIT module's two collections (migration 055). Required like every
   * field above and for the same reason: a module the caller forgets must be a
   * type error, not a quiet omission. EMPTY both for a pre-`1.32.0` archive and
   * for a profile that keeps no habits, indistinguishable on purpose, because
   * they mean the same thing.
   *
   * `habitEntries` is where a habit's whole point lives — the streak is derived
   * from these rows and nothing else — so an export that carried the habits but
   * not their days would restore a profile whose every run reads zero, which is
   * the one number a habit tracker must never invent.
   */
  habits: readonly ExportHabit[];
  habitEntries: readonly ExportHabitEntry[];
  /**
   * The FIT module's three collections (migration 058). Required like every
   * field above and for the same reason: a module the caller forgets must be a
   * type error, not a quiet omission. EMPTY both for a pre-`1.35.0` archive and
   * for a profile that logs no food, indistinguishable on purpose, because they
   * mean the same thing.
   *
   * `fitFoods` is ONLY the user's own foods — the catalogue ships inside the app
   * and is not rows (see `SCHEMA_VERSION`'s `1.35.0` entry). `fitMealItems` is
   * the diary itself, each row carrying the snapshot that makes it readable
   * without any food at all. `fitTargets` is zero or one row.
   */
  fitFoods: readonly ExportFitFood[];
  fitMealItems: readonly ExportFitMealItem[];
  fitTargets: readonly ExportFitTarget[];
  /**
   * FIT's training and body half (ADR-081 slice b, migration 060) — the other
   * seven collections the SAME `fitness` bucket carries (`SCHEMA_VERSION`'s
   * `1.37.0` entry). Required like every field above and for the same reason.
   * EMPTY both for a pre-`1.37.0` archive and for a profile that trains outside
   * the app, indistinguishable on purpose, because they mean the same thing.
   *
   * `fitExercises` is ONLY the user's own exercises — the catalogue ships inside
   * the app. `fitRoutineItems`/`fitWorkoutSets` are the children whose parent
   * `fitRoutines`/`fitWorkouts` come before them in every collection here, on
   * `taskLists`'/`tasks`' arrangement. `fitBodyProfile` is zero or one row, the
   * `fitTargets` shape.
   */
  fitExercises: readonly ExportFitExercise[];
  fitRoutines: readonly ExportFitRoutine[];
  fitRoutineItems: readonly ExportFitRoutineItem[];
  fitWorkouts: readonly ExportFitWorkout[];
  fitWorkoutSets: readonly ExportFitWorkoutSet[];
  fitMeasurements: readonly ExportFitMeasurement[];
  fitBodyProfile: readonly ExportFitBodyProfile[];
  /**
   * The CANV module's boards (migration 059). Required like every field above:
   * a module the caller forgets must be a type error, not a quiet omission.
   * EMPTY both for a pre-`1.36.0` archive and for a profile that drew nothing,
   * indistinguishable on purpose, because they mean the same thing.
   *
   * Every row carries its whole drawing — including any embedded image, which
   * rides inside `scene.files` rather than in `blobs/` (see `SCHEMA_VERSION`'s
   * `1.36.0` entry). So this collection alone is what a board is; there is no
   * second file to keep in step with it.
   */
  canvasBoards: readonly ExportCanvasBoard[];
  /**
   * The ELEC module's circuits (migration 067). Required like every field
   * above: a module the caller forgets must be a type error, not a quiet
   * omission. EMPTY both for a pre-`1.40.0` archive and for a profile that drew
   * no circuits, indistinguishable on purpose, because they mean the same
   * thing.
   *
   * Parents before children, on `taskLists`'/`tasks`' arrangement — and here it
   * is load-bearing rather than tidy: a part's `circuitId` and BOTH of a wire's
   * ends are real foreign keys in the database a restore writes into, so a wire
   * written before its parts is refused rather than merely out of order.
   *
   * No component collection, and there will not be one: the 153 the app ships
   * are constants versioned with the application, so a part carries only its
   * `componentId` and the build that opens the archive resolves it.
   */
  circuits: readonly ExportCircuit[];
  /**
   * The machines, at most one per circuit and usually none — a breadboard is
   * not a robot. Between the circuits and the parts for the same reason the
   * parts come before the wires: `circuitId` is a real foreign key.
   */
  circuitChassis: readonly ExportCircuitChassis[];
  circuitParts: readonly ExportCircuitPart[];
  circuitWires: readonly ExportCircuitWire[];
  /**
   * The MODULE KIT's section (ADR-090): one entry per discovered module that
   * has something to say, keyed by that module's own id.
   *
   * **Why this one member is not an array of rows with its own bucket.** Every
   * field above is a collection this package knows the shape of, and that is
   * what lets `countProfileModules` and `filterProfileData` share one
   * module↔collection mapping. A kit module's payload is the opposite kind of
   * thing by design: its shape belongs to the module, versioned by the module,
   * read back only by the module that wrote it (`ModuleContext.exportData`).
   * Core carries it and never looks inside — so it stays `unknown`, and the
   * type says out loud what the alternative (`any`, or a shape invented here)
   * would hide.
   *
   * **It belongs to no archive module** (IMEX-003), exactly as `settings` and
   * the private section belong to none: a subset export filters the collections
   * above, and this rides whole with every archive, because a module's data has
   * no bucket a subset could be expressed against. The one thing an archive
   * DOES say about it is which modules it names, and a build that does not know
   * one of them refuses the archive rather than dropping the section
   * (`main/restore.ts`), because a backup that silently loses rows is the
   * failure this whole reader exists to prevent.
   *
   * Required like every field above, and for the same reason: a caller that
   * forgets it must be a type error, not a quiet omission. EMPTY is the honest
   * shape for "this archive carries no kit module data", which is also every
   * archive written before `1.42.0` — indistinguishable on purpose.
   */
  modules: readonly ExportModuleData[];
}

// --- Private notes (PRIV v1, ADR-057 §6) ------------------------------------

/**
 * One private attachment's reference as the interchange carries it — the
 * decrypted envelope's own `PrivAttachmentRef` (`priv/privEnvelope.ts`), field
 * for field. `id` is the random id the sealed blob was named by on disk AND the
 * name of the archive's decrypted `private-blobs/<id>` entry; it is NOT a
 * content address, by design (no sha256 identity exists for a private
 * attachment — `privEnvelope.ts`'s no-existence-oracle rule), and a restore
 * re-seals the bytes under an entirely fresh id anyway.
 */
export interface ExportPrivateAttachment {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

/**
 * One private note, DECRYPTED (ADR-057 §6): the envelope's own fields plus the
 * row's cleartext timestamps. Rides as a `private-note` record in
 * `data/private-notes.ndjson` — and ONLY when the writer's gate lets private
 * notes into the archive at all (see `SCHEMA_VERSION`'s `1.23.0` entry). The
 * archive's passphrase is the protection: inside the container this row enjoys
 * exactly the trust every other record does, and carrying the envelope sealed
 * instead would make the export unreadable after any kit regeneration.
 */
export interface ExportPrivateNote {
  id: string;
  title: string;
  /** The note's whole Yjs state, base64 (`base64ToBytes` is the codec both sides use). */
  yjsState: string;
  /** The flat text mirror the in-memory private search folds at unlock. */
  plaintext: string;
  attachments: readonly ExportPrivateAttachment[];
  createdAt: string;
  updatedAt: string;
}

/**
 * One surviving version of a private note: the decrypted envelope it holds,
 * at the sequence its container was sealed under — a restore re-seals it at
 * that same `seq`, so the live row's `maxSeq + 1` arithmetic survives the trip.
 */
export interface ExportPrivateNoteVersion {
  noteId: string;
  seq: number;
  title: string;
  yjsState: string;
  plaintext: string;
  attachments: readonly ExportPrivateAttachment[];
  createdAt: string;
}

/** The private section's whole interchange payload — what `ExportArchiveInput.privateNotes` supplies and `parseImportArchive` reads back. */
export interface ExportPrivateNotes {
  notes: readonly ExportPrivateNote[];
  versions: readonly ExportPrivateNoteVersion[];
}

/** The empty section every export without private notes writes — one shared value, never mutated. */
const EMPTY_PRIVATE_NOTES: ExportPrivateNotes = { notes: [], versions: [] };

/**
 * The interchange's base64 codec for `yjsState`, re-exported from `../bytes.ts`
 * rather than written here — it was the fourth hand-written copy in this
 * package.
 *
 * It keeps this name and this home because `importArchive.ts` and the `.` barrel
 * both reach for it here, and because what the doc has to say is about the
 * INTERCHANGE rather than about base64: it throws on input that is not base64 at
 * all, and the caller decides what that means — the reader refuses the row, the
 * builder never sees one, its input having come out of an authenticated
 * envelope.
 */
export { base64ToBytes };

/**
 * A profile's picture as the manifest carries it (SET-001, migration 040): the
 * blob store's plaintext sha256, the mime the bytes are served as, and their
 * length. A NESTED object rather than three nullable siblings on `profile`, for
 * the reason a task template's payload is one: the three are meaningless apart —
 * migration 040's CHECKs allow all-three or none — and nesting makes "all three
 * or nothing" a fact of the TYPE, so neither the writer nor the reader needs a
 * pair rule to enforce what the shape already says.
 *
 * The bytes travel in the archive's `blobs/` namespace exactly as a note
 * attachment's do, deduplicated in the same union: a picture the user also
 * attached to a note travels once, and either reference alone carries it.
 *
 * `mime` is whatever main sniffed from the bytes it produced itself
 * (SEC-FILE-02) — in practice always `image/png`, since main re-encodes every
 * picture, which is what strips the original's EXIF — and never a guess from a
 * file name.
 */
export interface ArchiveProfilePicture {
  hash: string;
  mime: string;
  sizeBytes: number;
}

/**
 * The profile kinds an archive's manifest may declare (ADR-058, `1.22.0`) —
 * migration 001's own CHECK domain, restated here structurally because
 * `@nexus/core` never imports `@nexus/db` (the file-header rule).
 */
export const ARCHIVE_PROFILE_KINDS = ["personal", "business"] as const;
export type ArchiveProfileKind = (typeof ARCHIVE_PROFILE_KINDS)[number];

export interface ExportArchiveInput {
  /**
   * The profile this archive is OF: its id, name and kind (`1.22.0` — always
   * written; see `SCHEMA_VERSION`'s entry), plus the picture it carries
   * (`1.18.0`) or null for none. The whole object is written into the
   * manifest verbatim, so a caller must build it explicitly rather than hand
   * over a wider profile row — a column the app's own `Profile` type gains later
   * would otherwise appear in every archive's manifest without anyone deciding
   * it should.
   */
  profile: {
    id: string;
    name: string;
    kind: ArchiveProfileKind;
    picture: ArchiveProfilePicture | null;
  };
  /** `app.getVersion()` — stamped by the caller, never read from here. */
  appVersion: string;
  /** ISO-8601, stamped by the caller — this module never reads a clock. */
  createdAt: string;
  settings: ExportSettings;
  data: ProfileData;
  /**
   * Which of the archive's modules ride (IMEX-003). ABSENT means all of them —
   * the whole-profile export this builder has always written, and what every
   * caller that does not offer the choice keeps getting.
   *
   * A subset is a real, complete archive of fewer modules, not a truncated one:
   * `data` is filtered through `filterProfileData` (which also repairs the
   * three cross-module references, see there), the manifest's per-module counts
   * report the filtered reality, only the surviving rows' blobs are declared,
   * and `data/calendar.ics` rides only with the calendar. A restore of it is a
   * restore like any other — it wipes the target profile whole and writes what
   * the archive carries, so an omitted module simply comes back empty
   * (`RestoreStore.replaceProfileData`, ADR-023).
   */
  modules?: ReadonlySet<ArchiveModuleId>;
  /**
   * The profile's private notes, DECRYPTED (ADR-057 §6) — a parallel input
   * beside `data`, deliberately NOT a `ProfileData` member: `ProfileData` is
   * the shape `gatherProfileData` reads, a restore's undo snapshot captures and
   * `RestoreStore` replaces, and private notes travel through none of those
   * paths (they are sealed rows the gather cannot open and the undo must carry
   * as bytes). ABSENT whenever they do not ride — a locked section, a plaintext
   * export, a section never set up, or a caller (the scheduled backup) that
   * never carries them — which writes an empty `data/private-notes.ndjson`,
   * indistinguishable from a profile with no private notes, on purpose.
   *
   * Also deliberately OUTSIDE the module choice (IMEX-003), like `settings`
   * and the profile picture: the private section belongs to no archive module,
   * and inventing one for it would be the second module↔collection mapping this
   * whole arrangement avoids.
   */
  privateNotes?: ExportPrivateNotes;
  /** sha256 hex over a UTF-8 string, injected so this module never imports `node:crypto`. */
  hash: (content: string) => string;
}

/**
 * An archive entry whose content is bytes rather than text. `buildExportArchive`
 * DECLARES these; it never holds their content beyond what its input already
 * carries — an attachment can be 50 MB of encrypted bytes on disk, so it is
 * named by hash and left for the writer to read, decrypt and stream one at a
 * time (ADR-022).
 */
export type ExportBinaryEntry =
  | { kind: "bytes"; path: string; bytes: Uint8Array }
  | { kind: "attachment"; path: string; sha256: string; sizeBytes: number }
  /** A private attachment's decrypted bytes (ADR-057 §6), resolved by the writer's own private-blob reader — named by the envelope's random id, never by a content hash (none exists for it, by design). */
  | { kind: "private-blob"; path: string; id: string; sizeBytes: number };

/** The built archive: every file's exact content, plus the counts the manifest itself also carries (for the caller's own reporting, e.g. the Settings page's confirmation line). */
export interface ExportArchive {
  files: Map<string, string>;
  totalRecords: number;
  byModule: Record<ArchiveModuleId, number>;
  binaries: ExportBinaryEntry[];
}

/** The checksummed NDJSON files, in manifest order. Exported so `importArchive.ts` verifies checksums against exactly the list this module produces them from — never a second, hand-copied literal that could drift. An older archive legitimately carries fewer of them; the reader's checksum walk iterates the UNION of this list and what the manifest declares, which is what makes appending one here backward-compatible. */
export const DATA_FILES = [
  "data/tasks.ndjson",
  "data/calendar.ndjson",
  "data/study.ndjson",
  "data/notifications.ndjson",
  "data/notes.ndjson",
  "data/dashboard.ndjson",
  // Private notes (ADR-057 §6, `1.23.0`): their own file, ALWAYS written —
  // empty whenever they do not ride, which is also what a profile with no
  // private notes writes, indistinguishable on purpose. Appending here is what
  // the union-walk comment above promises stays backward-compatible: a pre-1.23
  // archive neither carries the file nor declares its checksum, and
  // absent-and-undeclared is nothing at all.
  "data/private-notes.ndjson",
  // The FIN module (migration 051, `1.28.0`): its own file, appended on exactly
  // the terms the union-walk comment above promises stay backward-compatible —
  // a pre-1.28 archive neither carries it nor declares its checksum, and
  // absent-and-undeclared is nothing at all.
  "data/finance.ndjson",
  // The HABIT module (migration 055, `1.32.0`): its own file, appended on the
  // same terms the union-walk comment above promises stay backward-compatible —
  // a pre-1.32 archive neither carries it nor declares its checksum, and
  // absent-and-undeclared is nothing at all.
  "data/habits.ndjson",
  // FIT's nutrition half (migration 058, `1.35.0`): its own file, appended on
  // the same terms — a pre-1.34 archive neither carries it nor declares its
  // checksum, and absent-and-undeclared is nothing at all.
  "data/fitness.ndjson",
  // The CANV module (migration 059, `1.36.0`): its own file, on the same terms
  // again — a pre-1.36 archive neither carries it nor declares its checksum.
  "data/canvas.ndjson",
  // The ELEC module (migration 067, `1.40.0`): its own file, on the same terms
  // again — a pre-1.40 archive neither carries it nor declares its checksum.
  "data/electronics.ndjson",
  // The MODULE KIT's section (ADR-090, `1.42.0`): one record per discovered
  // module that has something to say, appended on the same terms again - a
  // pre-1.42 archive neither carries it nor declares its checksum, and
  // absent-and-undeclared is nothing at all.
  "data/modules.ndjson",
] as const;

/** The manifest's module ids, in manifest order — the grouping `countProfileModules` counts by and `buildExportArchive` builds `manifest.modules` from, so the two can never disagree. */
export const ARCHIVE_MODULE_IDS = [
  "tasks",
  "calendar",
  "study",
  "notifications",
  "notes",
  "dashboard",
  // FIN (migration 051, `1.28.0`) — its own module, for the reason the
  // `SCHEMA_VERSION` entry gives: one module↔collection mapping serves both the
  // counter and the filter, so a ledger filed under somebody else's module
  // would make a subset export carry what it says it does not.
  "finance",
  // HABIT (migration 055, `1.32.0`) — its own module, for the reason FIN's entry
  // above gives: one module↔collection mapping serves both the counter and the
  // filter, so habits filed under somebody else's module would make a subset
  // export carry what it says it does not.
  "habits",
  // FIT (migration 058, `1.35.0`) — its own module, on the same terms. Note what
  // it does NOT cover: the food catalogue ships inside the app and is not rows,
  // so this bucket counts the user's own foods, their diary and their goals, and
  // nothing the app supplied.
  "fitness",
  // CANV (migration 059, `1.36.0`) — its own module, on the same terms again.
  // One board is one row, drawing and all, so this count is the number of
  // boards rather than of anything drawn on them.
  "canvas",
  // ELEC (migration 067, `1.40.0`) — its own module, on the same terms again.
  // What it does NOT cover, exactly as `fitness` does not cover the food
  // catalogue: the 153 components the app ships are constants and not rows, so
  // this bucket counts the user's circuits, the machines they measured, their
  // parts and their wires, and nothing the app supplied.
  "electronics",
] as const;
export type ArchiveModuleId = (typeof ARCHIVE_MODULE_IDS)[number];

/**
 * Counts one profile's rows into the manifest's five module buckets — the
 * exact grouping `buildExportArchive` reports in `manifest.modules` and
 * `ExportArchive.byModule`. Extracted to its own function (ADR-023) so a
 * restore preview can count a profile and an archive by the SAME rule: two
 * independently-written tallies (one here, one in a restore module) could
 * only ever drift apart, and a preview that miscounts is worse than no
 * preview at all.
 */
export function countProfileModules(data: ProfileData): Record<ArchiveModuleId, number> {
  return {
    // Lists, sections, tags, tag links, attachments, templates and
    // dependencies are all TASK module rows, so they count into the tasks
    // bucket beside the tasks themselves — the same way a folder, a tag, a tag
    // link, an attachment and a note template count into notes.
    tasks:
      data.tasks.length +
      data.taskLists.length +
      data.taskSections.length +
      data.taskTags.length +
      data.taskTagLinks.length +
      data.taskAttachments.length +
      data.taskTemplates.length +
      data.taskDependencies.length,
    // Event templates are CAL module rows, so they count into the calendar
    // bucket beside the events themselves — the same way a task template counts
    // into tasks. The semester-dates row (zero or one, ADR-054) counts here for
    // the reason `study-settings` counts into STUDY: a restore preview that
    // showed one number too few would be telling the user something untrue
    // about what is about to change.
    calendar:
      data.events.length +
      data.eventTemplates.length +
      data.documents.length +
      data.renewals.length +
      data.people.length +
      data.calendarSettings.length,
    // The scheduling-preferences row (zero or one) counts into STUDY beside the
    // rows it governs, for the reason the dashboard's background row counts into
    // its own module: a restore preview that showed one number too few would be
    // telling the user something untrue about what is about to change.
    study:
      data.subjects.length +
      data.subjectAttachments.length +
      data.subjectNoteLinks.length +
      data.exams.length +
      data.decks.length +
      data.cards.length +
      data.reviewLog.length +
      data.examTopics.length +
      data.plans.length +
      data.blocks.length +
      data.focusSessions.length +
      data.studySettings.length,
    notifications: data.notifications.length,
    notes:
      data.notes.length +
      data.noteFolders.length +
      data.noteTags.length +
      data.noteCategories.length +
      data.noteTagLinks.length +
      data.noteTemplates.length +
      data.noteAttachments.length +
      data.noteVersions.length,
    // The background row (zero or one) plus every named board plus every
    // placed widget, counted like any other rows rather than folded into a
    // neighbouring module: a restore preview that showed "Kontrolna tabla: 6"
    // against "0" is telling the user something true about what is about to
    // change, which is the entire job of that table.
    dashboard:
      data.dashboardSettings.length + data.dashboardSets.length + data.dashboardWidgets.length,
    // The whole ledger in one bucket (migration 051): accounts, the flat
    // categories, the subscriptions (migration 053), every transaction —
    // transfers included, since a transfer IS a row — and the budgets. A restore
    // preview that showed one number too few would be telling the user something
    // untrue about what is about to change, which is the entire job of that
    // table.
    finance:
      data.finAccounts.length +
      data.finCategories.length +
      data.finRecurring.length +
      data.finTransactions.length +
      data.finBudgets.length,
    // The habits and every tick they carry, counted like any other rows: the
    // entries ARE the module's substance — the streak is derived from them — so
    // a preview that showed only the habit count would tell the user almost
    // nothing about what is about to change.
    habits: data.habits.length + data.habitEntries.length,
    // The user's own foods, every logged item and the goals row. The ITEMS are
    // the module's substance, exactly as habit entries are — a preview showing
    // only the food count would say almost nothing about what is about to
    // change. The app-shipped catalogue is counted nowhere, because it is not
    // in the archive at all. FIT's training half (migration 060) counts into
    // this SAME bucket, all ten collections — the user's own exercises, every
    // routine and its items, every logged workout and set, every body reading
    // and the body-facts row, on the reason `SCHEMA_VERSION`'s `1.37.0` entry
    // gives: one module, not two that happen to share a name.
    fitness:
      data.fitFoods.length +
      data.fitMealItems.length +
      data.fitTargets.length +
      data.fitExercises.length +
      data.fitRoutines.length +
      data.fitRoutineItems.length +
      data.fitWorkouts.length +
      data.fitWorkoutSets.length +
      data.fitMeasurements.length +
      data.fitBodyProfile.length,
    // One board is one row, drawing and all. This is deliberately NOT a count of
    // shapes: the number a preview must be right about is how many boards are
    // being replaced, and „412" would name something nobody has a name for.
    canvas: data.canvasBoards.length,
    // Four tables, one bucket. A circuit is what the user names, so a preview
    // saying „4" would be wrong about the only unit they think in — but a
    // machine, a part and a wire are rows a restore replaces too, and a count
    // that ignored them would understate what is at stake. The sum is the
    // honest reading of „how many rows of yours does this touch".
    electronics:
      data.circuits.length +
      data.circuitChassis.length +
      data.circuitParts.length +
      data.circuitWires.length,
    // The kit's section (ADR-090) is counted NOWHERE, deliberately: it belongs
    // to no archive module (see `ProfileData.modules`), and the buckets above
    // are keyed by `ArchiveModuleId` - a closed union this package cannot grow
    // per module. A restore preview therefore says nothing about it, which is
    // the honest answer: what one module's opaque payload contains is the
    // module's own business, and its own screen is where it is described.
  };
}

/** Every module — what an export that names no subset carries (IMEX-003). Read-only by construction: nothing here ever mutates it. */
const ALL_ARCHIVE_MODULES: ReadonlySet<ArchiveModuleId> = new Set(ARCHIVE_MODULE_IDS);

/** The empty array every dropped module's field becomes. One shared value, since nothing ever mutates a `ProfileData` field. */
const NO_ROWS: readonly never[] = [];

/**
 * One profile's rows narrowed to `modules` (IMEX-003) — `countProfileModules`'
 * twin, and deliberately grouped by the SAME module↔collection mapping: a
 * module the counter puts in one bucket and the filter in another would make
 * the manifest lie about its own contents.
 *
 * A module's rows drop as a unit. What that cannot do on its own is the three
 * references that cross a module boundary, each of which would otherwise be
 * left dangling — and a dangling reference is precisely what `parseImportArchive`
 * refuses outright in restore mode, so an archive carrying one would be a backup
 * that cannot be restored:
 *
 * - `subject-note-link.noteId` (STUDY→NOTES) — DROPPED when its note is not
 *   carried. The row IS the pair; without the note there is nothing left of it.
 *   The reverse needs no rule: the link is a STUDY row, so dropping STUDY takes
 *   it along.
 * - `card.sourceNoteId`/`sourceBlockKey` (STUDY→NOTES) — DETACHED, both nulled
 *   together (the parser refuses one without the other). A note-derived card and
 *   its FSRS history are STUDY data the user asked for; the note is gone by
 *   their own choice, so the honest archive is the card without its origin, not
 *   a study export quietly missing the cards its owner made from notes.
 * - `note.cardDeckId` (NOTES→STUDY) — DETACHED, for the reason the interchange
 *   contract makes it nullable at all: the deck a note generates cards into is
 *   decoration on the note, and losing the note over it would be the opposite
 *   of what the user asked for. The same policy `importArchive.ts`'s reference
 *   table already gives both detached edges.
 *
 * Nothing else crosses. Every other reference in that table has both ends inside
 * ONE module: a task's parent, list, section, tags, files and dependencies; a
 * renewal's document; an exam's, deck's, material's, link's and focus session's
 * subject; a card's deck; a review's card; a plan's exam; a block's plan; a
 * note's folder, parent folder, tags, files and versions. Nor is anything else
 * on a row a reference this archive resolves: a folder's `defaultTemplateId` is
 * a NOTES-module id or a built-in constant and deliberately carries no foreign
 * key (migration 028); a notification's `entityId` is checked by no rule and
 * constrained by no column, because a delivered notification is ledger history
 * that already outlives the row it names; a dashboard widget's `widgetId` names
 * a module manifest's slug, not a row; a task template's `tagNames` and an event
 * template's payload name no row at all; and a note's wiki-links live inside its
 * Yjs state, are re-derived at restore time, and already tolerate a target that
 * is not there.
 *
 * BLOBS need no rule of their own: every blob a ROW names (`taskAttachments`,
 * `subjectAttachments`, `noteAttachments`, `dashboardSettings.backgroundHash`)
 * is named by a row living in exactly one module, so `buildExportArchive`
 * declaring blobs off the FILTERED rows already carries exactly the ones a
 * chosen module needs — including the deduplication that lets one file shared
 * across two modules travel once when both ride. The profile's picture
 * (`1.18.0`) is the one blob no row names: it hangs off the manifest, so it is
 * declared outside this filter entirely and rides with every subset.
 */
export function filterProfileData(
  data: ProfileData,
  modules: ReadonlySet<ArchiveModuleId>,
): ProfileData {
  const only = <T>(module: ArchiveModuleId, rows: readonly T[]): readonly T[] =>
    modules.has(module) ? rows : NO_ROWS;

  // Read off the SURVIVING rows, so each repair below asks the one question
  // that matters: is the row this points at still in the archive?
  const notes = only("notes", data.notes);
  const decks = only("study", data.decks);
  const noteIds = new Set(notes.map((note) => note.id));
  const deckIds = new Set(decks.map((deck) => deck.id));

  return {
    tasks: only("tasks", data.tasks),
    taskLists: only("tasks", data.taskLists),
    taskSections: only("tasks", data.taskSections),
    taskTags: only("tasks", data.taskTags),
    taskTagLinks: only("tasks", data.taskTagLinks),
    taskAttachments: only("tasks", data.taskAttachments),
    taskTemplates: only("tasks", data.taskTemplates),
    taskDependencies: only("tasks", data.taskDependencies),
    events: only("calendar", data.events),
    eventTemplates: only("calendar", data.eventTemplates),
    documents: only("calendar", data.documents),
    renewals: only("calendar", data.renewals),
    people: only("calendar", data.people),
    calendarSettings: only("calendar", data.calendarSettings),
    subjects: only("study", data.subjects),
    subjectAttachments: only("study", data.subjectAttachments),
    subjectNoteLinks: only("study", data.subjectNoteLinks).filter((link) => noteIds.has(link.noteId)),
    exams: only("study", data.exams),
    decks,
    cards: only("study", data.cards).map((card) =>
      card.sourceNoteId === null || noteIds.has(card.sourceNoteId)
        ? card
        : { ...card, sourceNoteId: null, sourceBlockKey: null },
    ),
    reviewLog: only("study", data.reviewLog),
    // Topic, exam, deck, plan and block all live in ONE module, so a topic's
    // two references never cross the filter — no repair rule, like a plan's.
    examTopics: only("study", data.examTopics),
    plans: only("study", data.plans),
    blocks: only("study", data.blocks),
    focusSessions: only("study", data.focusSessions),
    studySettings: only("study", data.studySettings),
    notifications: only("notifications", data.notifications),
    notes: notes.map((note) =>
      note.cardDeckId === null || deckIds.has(note.cardDeckId) ? note : { ...note, cardDeckId: null },
    ),
    noteFolders: only("notes", data.noteFolders),
    noteTags: only("notes", data.noteTags),
    // A note's `categoryId` and the categories it names are ONE module, exactly
    // as a folder and `folderId` are — the two drop together or not at all, so
    // no cross-module repair rule is needed for it (unlike the three in the
    // header, which really do straddle a boundary).
    noteCategories: only("notes", data.noteCategories),
    noteTagLinks: only("notes", data.noteTagLinks),
    noteTemplates: only("notes", data.noteTemplates),
    noteAttachments: only("notes", data.noteAttachments),
    noteVersions: only("notes", data.noteVersions),
    dashboardSettings: only("dashboard", data.dashboardSettings),
    // The sets and the widgets that name them drop AS ONE module with the
    // settings row above, so `dashboard-widget.setId` and
    // `dashboard-settings.activeSetId` can never dangle across this filter —
    // no repair rule is needed, unlike the three genuinely cross-module
    // references documented in the header.
    dashboardSets: only("dashboard", data.dashboardSets),
    dashboardWidgets: only("dashboard", data.dashboardWidgets),
    // Every FIN reference has both ends inside FIN — a transaction's account,
    // its counter account, its category and its subscription; a subscription's
    // account and category; a budget's category — so the five drop as one unit
    // with no repair rule, unlike the three genuinely cross-module references
    // documented in the header. Nothing outside FIN points INTO it either, so
    // dropping the module dangles nothing elsewhere.
    finAccounts: only("finance", data.finAccounts),
    finCategories: only("finance", data.finCategories),
    finRecurring: only("finance", data.finRecurring),
    finTransactions: only("finance", data.finTransactions),
    finBudgets: only("finance", data.finBudgets),
    // An entry's only reference is its habit, and the two drop as ONE module —
    // so no repair rule is needed here either, unlike the three genuinely
    // cross-module references documented in the header. Nothing outside HABIT
    // points into it, so dropping the module dangles nothing elsewhere.
    habits: only("habits", data.habits),
    habitEntries: only("habits", data.habitEntries),
    // FIT's three drop as one module, and its ONE pointer — a meal item's
    // `foodRef` — is not a reference this archive resolves at all: the column is
    // text with no foreign key (migration 058), `catalogue:<id>` names something
    // that is not a row anywhere, and the item's own label and snapshot are what
    // make it readable. So there is nothing here to repair even in principle,
    // unlike the three genuinely cross-module references documented in the
    // header.
    fitFoods: only("fitness", data.fitFoods),
    fitMealItems: only("fitness", data.fitMealItems),
    fitTargets: only("fitness", data.fitTargets),
    // FIT's training half (migration 060) drops as the SAME one unit, all seven
    // collections — one module, `SCHEMA_VERSION`'s `1.37.0` entry. Its two real
    // foreign keys (`fit-routine-item.routineId`, `fit-workout-set.workoutId`)
    // have both ends inside this one module, so they drop together with no
    // repair rule needed, exactly as FIN's five do. `exerciseRef`/`routineRef`
    // are not references this archive resolves at all (no foreign key, by
    // design), so there is nothing to repair for them even in principle.
    fitExercises: only("fitness", data.fitExercises),
    fitRoutines: only("fitness", data.fitRoutines),
    fitRoutineItems: only("fitness", data.fitRoutineItems),
    fitWorkouts: only("fitness", data.fitWorkouts),
    fitWorkoutSets: only("fitness", data.fitWorkoutSets),
    fitMeasurements: only("fitness", data.fitMeasurements),
    fitBodyProfile: only("fitness", data.fitBodyProfile),
    // A board points at nothing and nothing points at a board, so this module
    // drops on its own with nothing to repair anywhere — the simplest case in
    // this whole function. The images a board carries go with it, because they
    // are inside its own row rather than in `blobs/`.
    canvasBoards: only("canvas", data.canvasBoards),
    circuits: only("electronics", data.circuits),
    circuitChassis: only("electronics", data.circuitChassis),
    circuitParts: only("electronics", data.circuitParts),
    circuitWires: only("electronics", data.circuitWires),
    // The MODULE KIT's section passes through WHOLE (ADR-090): it belongs to no
    // archive module, so there is no subset to apply to it - a module's payload
    // is not a collection of rows a module choice could drop. `settings` and
    // the private section ride outside this filter for the same reason.
    modules: data.modules,
  };
}

/** Builds the full `.nexus.zip` contents in memory (IMEX-001). Deterministic: identical input always yields identical file content and checksums. */
export function buildExportArchive(input: ExportArchiveInput): ExportArchive {
  const files = new Map<string, string>();

  // The module choice, resolved once (IMEX-003). One code path rather than a
  // branch: an export that named no subset filters against every module, which
  // changes nothing at all.
  const modules = input.modules ?? ALL_ARCHIVE_MODULES;
  const data = filterProfileData(input.data, modules);

  // Read once and named locally — the note section below reaches for these
  // often enough that `data.` on every line only adds noise.
  const {
    notes,
    noteFolders,
    noteTags,
    noteCategories,
    noteTagLinks,
    noteTemplates,
    noteAttachments,
    noteVersions,
  } = data;

  // Dependency order, as in `data/notes.ndjson`: the containers and labels a
  // task points at come first and the joins that need BOTH ends come last, so
  // a reader that streamed the file could resolve every reference as it went.
  const tasksNdjson = toNdjson([
    ...data.taskLists.map((row) => ({ type: "task-list", ...row })),
    ...data.taskSections.map((row) => ({ type: "task-section", ...row })),
    ...data.taskTags.map((row) => ({ type: "task-tag", ...row })),
    ...data.tasks.map((row) => ({ type: "task", ...row })),
    ...data.taskTagLinks.map((row) => ({ type: "task-tag-link", ...row })),
    ...data.taskAttachments.map((row) => ({ type: "task-attachment", ...row })),
    // Last: a template points at no row in this file (its tags are NAMES), so it
    // constrains nothing and sits after the join that needed both its ends.
    ...data.taskTemplates.map((row) => ({ type: "task-template", ...row })),
    ...data.taskDependencies.map((row) => ({ type: "task-dependency", ...row })),
  ]);
  const calendarNdjson = toNdjson([
    // The term's dates lead, exactly as `study-settings` leads its own file:
    // the row points at nothing, so this is how the file reads, not what it
    // requires.
    ...data.calendarSettings.map((row) => ({ type: "calendar-settings", ...row })),
    ...data.events.map((row) => ({ type: "event", ...row })),
    ...data.documents.map((row) => ({ type: "document", ...row })),
    ...data.renewals.map((row) => ({ type: "renewal", ...row })),
    ...data.people.map((row) => ({ type: "person", ...row })),
    // Last, for the reason `task-template` is last in the tasks file: a template
    // points at no row here, so it constrains nothing and sits after everything
    // that does.
    ...data.eventTemplates.map((row) => ({ type: "event-template", ...row })),
  ]);
  // The preferences row leads, then the rows themselves in dependency order —
  // the shape `data/dashboard.ndjson` already has. It points at nothing, so
  // this is how the file reads, not what it requires.
  const studyNdjson = toNdjson([
    ...data.studySettings.map((row) => ({ type: "study-settings", ...row })),
    ...data.subjects.map((row) => ({ type: "subject", ...row })),
    // Straight after the subjects they hang off, exactly as `task-attachment`
    // follows its tasks. The links' other end is a NOTE, which lives in a
    // different file entirely — so their position here is readability, and the
    // reader resolves that reference across files rather than in order.
    ...data.subjectAttachments.map((row) => ({ type: "subject-attachment", ...row })),
    ...data.subjectNoteLinks.map((row) => ({ type: "subject-note-link", ...row })),
    ...data.exams.map((row) => ({ type: "exam", ...row })),
    ...data.decks.map((row) => ({ type: "deck", ...row })),
    ...data.cards.map((row) => ({ type: "card", ...row })),
    ...data.reviewLog.map((row) => ({ type: "review", ...row })),
    // AHEAD of the plans (ADR-063): a plan's blocks name topics, and a topic
    // names the exam and (optionally) the deck already written above.
    ...data.examTopics.map((row) => ({ type: "exam-topic", ...row })),
    ...data.plans.map((row) => ({ type: "plan", ...row })),
    ...data.blocks.map((row) => ({ type: "block", ...row })),
    ...data.focusSessions.map((row) => ({ type: "focus-session", ...row })),
  ]);
  const notificationsNdjson = toNdjson(
    data.notifications.map((row) => ({ type: "notification", ...row })),
  );
  // Bytes are not JSON: `snapshot` is destructured off before the row joins
  // the NDJSON (it travels instead as a `bytes` binary entry below, keyed by
  // the same id/coveredSeq the path encodes).
  const notesNdjson = toNdjson([
    ...noteFolders.map((row) => ({ type: "note-folder", ...row })),
    ...noteTags.map((row) => ({ type: "note-tag", ...row })),
    // Beside the tags and ahead of the notes whose `categoryId` names them —
    // the same dependency order the folders keep. A category points at nothing
    // (it is flat), so only what points AT it constrains where it goes.
    ...noteCategories.map((row) => ({ type: "note-category", ...row })),
    ...notes.map((row) => {
      const { snapshot: _snapshot, ...rest } = row;
      return { type: "note", ...rest };
    }),
    ...noteTagLinks.map((row) => ({ type: "note-tag-link", ...row })),
    ...noteAttachments.map((row) => ({ type: "note-attachment", ...row })),
    ...noteVersions.map((row) => {
      const { snapshot: _snapshot, ...rest } = row;
      return { type: "note-version", ...rest };
    }),
    ...noteTemplates.map((row) => ({ type: "note-template", ...row })),
  ]);

  // The background row first (the preferences lead the file, the
  // `study-settings` idiom), then the named boards, then the widgets whose
  // `setId` names them — dependency order for the widgets, and the one forward
  // reference (`activeSetId` on the settings row) is resolved by the reader's
  // reference pass, never by file order (see `ExportDashboardSet`).
  const dashboardNdjson = toNdjson([
    ...data.dashboardSettings.map((row) => ({ type: "dashboard-settings", ...row })),
    ...data.dashboardSets.map((row) => ({ type: "dashboard-set", ...row })),
    ...data.dashboardWidgets.map((row) => ({ type: "dashboard-widget", ...row })),
  ]);

  // Private notes (ADR-057 §6): notes first, then the versions that reference
  // them — the "everything a row points at came before it" reading every other
  // data file keeps. Absent input writes the empty file, exactly what a profile
  // with no private notes writes.
  // Dependency order, the reading every data file keeps: the accounts and the
  // flat categories a transaction points at come first, then the subscriptions
  // (which point at both), then the transactions (a transfer names TWO accounts
  // and a generated charge names its subscription, all already written), then
  // the budgets, which point only at a category.
  const financeNdjson = toNdjson([
    ...data.finAccounts.map((row) => ({ type: "fin-account", ...row })),
    ...data.finCategories.map((row) => ({ type: "fin-category", ...row })),
    ...data.finRecurring.map((row) => ({ type: "fin-recurring", ...row })),
    ...data.finTransactions.map((row) => ({ type: "fin-transaction", ...row })),
    ...data.finBudgets.map((row) => ({ type: "fin-budget", ...row })),
  ]);

  // The habits first, then the entries that name them — the „everything a row
  // points at came before it" reading every data file keeps. An entry references
  // nothing else, so this is the whole of the file's ordering.
  const habitsNdjson = toNdjson([
    ...data.habits.map((row) => ({ type: "habit", ...row })),
    ...data.habitEntries.map((row) => ({ type: "habit-entry", ...row })),
  ]);

  // The two settings-shaped rows lead (the preferences-first idiom every data
  // file keeps), then the user's own exercises and foods — the two catalogues
  // this profile added to — then the routines (parents before the items that
  // name them), then the workouts (parents before the sets that name them),
  // then the food diary, then the body-weight log. `fit-routine-item.routineId`
  // and `fit-workout-set.workoutId` are the ONLY forward references this file
  // requires in order (migration 060's real foreign keys); a meal item's
  // `foodRef` and a routine item's/workout set's `exerciseRef`/`routineRef` are
  // provenance rather than a reference this archive resolves (see
  // `ExportFitMealItem`, `SCHEMA_VERSION`'s `1.37.0` entry), so beyond those two
  // pairs this is how the file READS, not what it requires.
  const fitnessNdjson = toNdjson([
    ...data.fitTargets.map((row) => ({ type: "fit-target", ...row })),
    ...data.fitBodyProfile.map((row) => ({ type: "fit-body-profile", ...row })),
    ...data.fitExercises.map((row) => ({ type: "fit-exercise", ...row })),
    ...data.fitFoods.map((row) => ({ type: "fit-food", ...row })),
    ...data.fitRoutines.map((row) => ({ type: "fit-routine", ...row })),
    ...data.fitRoutineItems.map((row) => ({ type: "fit-routine-item", ...row })),
    ...data.fitWorkouts.map((row) => ({ type: "fit-workout", ...row })),
    ...data.fitWorkoutSets.map((row) => ({ type: "fit-workout-set", ...row })),
    ...data.fitMealItems.map((row) => ({ type: "fit-meal-item", ...row })),
    ...data.fitMeasurements.map((row) => ({ type: "fit-measurement", ...row })),
  ]);

  // One record type and no ordering to keep: a board names nothing and nothing
  // names a board, so the file is simply the boards in the order they arrived.
  const canvasNdjson = toNdjson(
    data.canvasBoards.map((row) => ({ type: "canvas-board", ...row })),
  );

  // Parents before children, and here that is not tidiness: a chassis and a
  // part each name their circuit and a wire names both its parts, all four as
  // foreign keys in the database a restore writes into.
  const electronicsNdjson = toNdjson([
    ...data.circuits.map((row) => ({ type: "circuit", ...row })),
    ...data.circuitChassis.map((row) => ({ type: "circuit-chassis", ...row })),
    ...data.circuitParts.map((row) => ({ type: "circuit-part", ...row })),
    ...data.circuitWires.map((row) => ({ type: "circuit-wire", ...row })),
  ]);

  const privateNotes = input.privateNotes ?? EMPTY_PRIVATE_NOTES;
  const privateNotesNdjson = toNdjson([
    ...privateNotes.notes.map((row) => ({ type: "private-note", ...row })),
    ...privateNotes.versions.map((row) => ({ type: "private-note-version", ...row })),
  ]);

  // The kit's section (ADR-090): one record per module, in the order the host
  // collected them (which is registration order, so two exports of one profile
  // are byte-identical). A module with nothing to say never reaches here - the
  // host omits it - so an empty file means "no module had anything", exactly
  // what a profile that never used one produces.
  const modulesNdjson = toNdjson(
    data.modules.map((row) => ({ type: "module-data", ...row })),
  );

  files.set("data/tasks.ndjson", tasksNdjson);
  files.set("data/calendar.ndjson", calendarNdjson);
  files.set("data/study.ndjson", studyNdjson);
  files.set("data/notifications.ndjson", notificationsNdjson);
  files.set("data/notes.ndjson", notesNdjson);
  files.set("data/dashboard.ndjson", dashboardNdjson);
  files.set("data/private-notes.ndjson", privateNotesNdjson);
  files.set("data/finance.ndjson", financeNdjson);
  files.set("data/habits.ndjson", habitsNdjson);
  files.set("data/fitness.ndjson", fitnessNdjson);
  files.set("data/canvas.ndjson", canvasNdjson);
  files.set("data/electronics.ndjson", electronicsNdjson);
  files.set("data/modules.ndjson", modulesNdjson);

  // --- Notes: Markdown mirror + binary entries (ADR-022 section 3) -------
  const binaries: ExportBinaryEntry[] = [];
  const notePaths = buildNotePaths(notes, noteFolders);
  const attachmentsByNote = groupAttachmentsByNote(noteAttachments);

  for (const note of notes) {
    const pathInfo = notePaths.get(note.id);
    if (!pathInfo) continue; // buildNotePaths assigns one entry per input note; defensive
    const context: NoteMarkdownContext = {
      attachments: attachmentsByNote.get(note.id) ?? EMPTY_NOTE_ATTACHMENTS,
      rootPrefix: pathInfo.rootPrefix,
    };
    files.set(pathInfo.path, note.snapshot !== null ? renderNoteMarkdown(note.snapshot, context) : "");
    if (note.snapshot !== null) {
      binaries.push({ kind: "bytes", path: `data/notes/${note.id}.ydoc`, bytes: note.snapshot });
    }
  }
  for (const version of noteVersions) {
    binaries.push({
      kind: "bytes",
      path: `data/note-versions/${version.noteId}/${version.coveredSeq}.ydoc`,
      bytes: version.snapshot,
    });
  }
  // Blobs are content-addressed and deduplicated: two attachment rows sharing
  // a hash declare ONE binary entry, not two — across notes, across tasks, and
  // across the two MODULES alike, because `blobs/` is one namespace over one
  // on-disk store (migration 024). A dashboard background (ADR-041) is a blob
  // like any other and joins the SAME union — a background the user also
  // attached to a note travels once, and either row alone is enough to carry
  // it. Notes lead only because they shipped first; the entry a hash lands
  // under is identical either way.
  const blobSizeBySha = new Map<string, number>();
  const declareBlob = (sha256: string, sizeBytes: number): void => {
    if (blobSizeBySha.has(sha256)) return;
    blobSizeBySha.set(sha256, sizeBytes);
    binaries.push({ kind: "attachment", path: `blobs/${sha256}`, sha256, sizeBytes });
  };
  for (const attachment of [
    ...noteAttachments,
    ...data.taskAttachments,
    ...data.subjectAttachments,
  ]) {
    declareBlob(attachment.sha256, attachment.sizeBytes);
  }
  for (const dashboard of data.dashboardSettings) {
    // Both non-null together (migration 030's CHECK, re-checked by the reader),
    // so one guard covers the pair without the other needing a non-null claim.
    if (dashboard.backgroundHash === null || dashboard.backgroundSizeBytes === null) continue;
    declareBlob(dashboard.backgroundHash, dashboard.backgroundSizeBytes);
  }
  // The profile's picture (SET-001), joining the same union — and deliberately
  // OUTSIDE the module filter above it, unlike every other blob here: this one
  // is named by the manifest rather than by a row, so it rides with the archive
  // itself exactly as `profile.name` and `settings` do. A tasks-only export
  // still carries the picture of the profile it is an export of.
  if (input.profile.picture !== null) {
    declareBlob(input.profile.picture.hash, input.profile.picture.sizeBytes);
  }

  // --- Private notes (ADR-057 §6): Markdown mirrors + decrypted blob entries.
  //
  // The mirror path is `notes-private/<id>.md` — the ID, never the title,
  // deliberately DIVERGING from public notes' titled `notes/**` paths: a zip's
  // entry listing is readable without the archive passphrase in some tools'
  // metadata views, and even inside the sealed container a title has no
  // business existing anywhere the note's content does not. Attachments have no
  // Markdown story at all (an empty context — no `blobs/` link could name a
  // private blob anyway), so an attachment image simply renders nothing.
  for (const note of privateNotes.notes) {
    const state = base64ToBytes(note.yjsState);
    files.set(
      `notes-private/${note.id}.md`,
      state.length > 0
        ? renderNoteMarkdown(state, { attachments: EMPTY_NOTE_ATTACHMENTS, rootPrefix: "../" })
        : "",
    );
  }
  // The decrypted attachment bytes, declared by the envelope's own random id —
  // their OWN `private-blobs/` namespace, never the content-addressed `blobs/`
  // union (no sha256 identity exists for them, by design). Deduplicated by id
  // across the live envelopes and every version that still references the same
  // attachment, so one file travels once however many envelopes name it.
  const privateBlobSizeById = new Map<string, number>();
  for (const row of [...privateNotes.notes, ...privateNotes.versions]) {
    for (const ref of row.attachments) {
      if (privateBlobSizeById.has(ref.id)) continue;
      privateBlobSizeById.set(ref.id, ref.sizeBytes);
      binaries.push({
        kind: "private-blob",
        path: `private-blobs/${ref.id}`,
        id: ref.id,
        sizeBytes: ref.sizeBytes,
      });
    }
  }
  // Id-sorted for the reason the blob list is sha-sorted: the manifest must
  // read identically regardless of which envelope happened to name an
  // attachment first.
  const privateBlobs = [...privateBlobSizeById.entries()]
    .map(([id, sizeBytes]) => ({ id, sizeBytes }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // The calendar as a standards-honest `.ics` beside the lossless NDJSON
  // (IMEX-001's "ICS for calendar" clause, CAL-008). A convenience copy for
  // whatever else the user keeps a calendar in — a restore reads the NDJSON and
  // ignores this file entirely (see `SCHEMA_VERSION`'s note). Stamped with the
  // archive's own `createdAt`, so it reads no clock either and two exports of
  // the same profile at the same moment are byte-identical.
  //
  // ABSENT when the calendar is not among the chosen modules (IMEX-003), unlike
  // the NDJSON files, which are always written: an empty `data/calendar.ndjson`
  // is what a profile with no events produces and the format expects, while an
  // empty `VCALENDAR` is a file the user would open in their other calendar and
  // find nothing in — a promise of a calendar they did not ask us to export.
  if (modules.has("calendar")) {
    files.set("data/calendar.ics", buildIcsCalendar(data.events, { now: input.createdAt }).text);
  }

  files.set("tables/tasks.csv", tasksCsv(data.tasks));
  files.set("tables/events.csv", eventsCsv(data.events));
  files.set("tables/documents.csv", documentsCsv(data.documents));
  files.set("tables/subjects.csv", subjectsCsv(data.subjects));
  files.set("tables/exams.csv", examsCsv(data.exams));
  files.set("tables/exam-topics.csv", examTopicsCsv(data.examTopics));
  files.set("tables/cards.csv", cardsCsv(data.cards));
  files.set("tables/study-plans.csv", plansCsv(data.plans));
  files.set("tables/study-blocks.csv", blocksCsv(data.blocks));
  files.set("tables/focus-sessions.csv", focusSessionsCsv(data.focusSessions));

  const byModule = countProfileModules(data);
  const totalRecords = Object.values(byModule).reduce((sum, count) => sum + count, 0);

  const checksums: Record<string, string> = {};
  for (const path of DATA_FILES) {
    checksums[path] = input.hash(files.get(path) ?? "");
  }

  // Sha256-sorted so the manifest reads identically regardless of which note
  // happened to reference a given blob first.
  const blobs = [...blobSizeBySha.entries()]
    .map(([sha256, sizeBytes]) => ({ sha256, sizeBytes }))
    .sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: input.appVersion,
    createdAt: input.createdAt,
    profile: input.profile,
    settings: input.settings,
    modules: ARCHIVE_MODULE_IDS.map((id) => ({ id, records: byModule[id] })),
    checksums,
    blobs,
    // The private attachments' inventory (ADR-057 §6), beside the blob list it
    // mirrors — always written, empty whenever no private notes ride.
    privateBlobs,
  };
  files.set("manifest.json", JSON.stringify(manifest, null, 2));

  return { files, totalRecords, byModule, binaries };
}

// --- Notes: path resolution ------------------------------------------------

/** One note's resolved Markdown mirror path plus the `rootPrefix` its image links need. */
interface NotePathInfo {
  path: string;
  rootPrefix: string;
}

const EMPTY_NOTE_ATTACHMENTS: ReadonlyMap<string, NoteMarkdownAttachment> = new Map();

/**
 * Resolves every note's Markdown mirror path (ADR-022 section 3). Folder
 * segments are claimed first, in `folders`' own input order, then note file
 * names in `notes`' own input order — this makes the archive deterministic:
 * the same input always claims the same names in the same order. Each
 * directory's name registry (via `claimUniqueName`) is shared between its
 * subfolders and its `.md` files, so a folder named "Plan" and a note titled
 * "Plan" in the same parent cannot both become `Plan`.
 *
 * A note whose `folderId` is null, or points at a folder absent from
 * `folders`, lands directly under `notes/`. A folder's own `parentId` chain
 * is resolved (and memoized) recursively; a cycle — never produced by
 * `NoteOrgStore`, but defensive here — is broken by treating the re-entrant
 * folder as a root folder rather than recursing forever.
 */
function buildNotePaths(
  notes: readonly ExportNote[],
  folders: readonly ExportNoteFolder[],
): Map<string, NotePathInfo> {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const registries = new Map<string, Set<string>>();
  const folderDirs = new Map<string, string>();
  const resolving = new Set<string>();

  function registryFor(dir: string): Set<string> {
    let registry = registries.get(dir);
    if (registry === undefined) {
      registry = new Set<string>();
      registries.set(dir, registry);
    }
    return registry;
  }

  function resolveFolderDir(folderId: string): string {
    const cached = folderDirs.get(folderId);
    if (cached !== undefined) return cached;

    const folder = folderById.get(folderId);
    if (folder === undefined || resolving.has(folderId)) return "notes";

    resolving.add(folderId);
    const parentDir = folder.parentId !== null ? resolveFolderDir(folder.parentId) : "notes";
    const name = claimUniqueName(registryFor(parentDir), sanitizePathSegment(folder.name, "Fascikla"), "");
    const dir = `${parentDir}/${name}`;
    resolving.delete(folderId);

    folderDirs.set(folderId, dir);
    return dir;
  }

  for (const folder of folders) resolveFolderDir(folder.id);

  const notePaths = new Map<string, NotePathInfo>();
  for (const note of notes) {
    const dir =
      note.folderId !== null && folderById.has(note.folderId)
        ? resolveFolderDir(note.folderId)
        : "notes";
    const fileName = claimUniqueName(
      registryFor(dir),
      sanitizePathSegment(note.title, UNTITLED_NOTE_NAME),
      ".md",
    );
    const path = `${dir}/${fileName}`;
    const depth = path.split("/").length - 1; // directory segments only, not the file name
    notePaths.set(note.id, { path, rootPrefix: "../".repeat(depth) });
  }
  return notePaths;
}

/** Attachment rows grouped by their note, in the shape `renderNoteMarkdown`'s context wants. */
function groupAttachmentsByNote(
  attachments: readonly ExportNoteAttachment[],
): Map<string, Map<string, NoteMarkdownAttachment>> {
  const byNote = new Map<string, Map<string, NoteMarkdownAttachment>>();
  for (const attachment of attachments) {
    let forNote = byNote.get(attachment.noteId);
    if (forNote === undefined) {
      forNote = new Map<string, NoteMarkdownAttachment>();
      byNote.set(attachment.noteId, forNote);
    }
    forNote.set(attachment.id, { fileName: attachment.fileName, sha256: attachment.sha256 });
  }
  return byNote;
}

/** One JSON object per line, `\n`-joined with a trailing newline; zero rows renders as the empty string (predictable "empty module" shape). */
function toNdjson(records: ReadonlyArray<Record<string, unknown>>): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function tasksCsv(rows: readonly ExportTask[]): string {
  return toCsv(
    ["id", "parentId", "title", "description", "status", "priority", "dueDate", "startDate", "completedAt", "createdAt", "updatedAt"],
    rows.map((row) => [
      row.id, row.parentId, row.title, row.description, row.status, row.priority,
      row.dueDate, row.startDate, row.completedAt, row.createdAt, row.updatedAt,
    ]),
  );
}

function eventsCsv(rows: readonly ExportEvent[]): string {
  return toCsv(
    ["id", "title", "description", "startAt", "endAt", "allDay", "location", "category", "createdAt", "updatedAt"],
    rows.map((row) => [
      row.id, row.title, row.description, row.startAt, row.endAt, row.allDay,
      row.location, row.category, row.createdAt, row.updatedAt,
    ]),
  );
}

function documentsCsv(rows: readonly ExportDocument[]): string {
  return toCsv(
    ["id", "docType", "label", "expiryDate", "reminderOffsets", "notes", "createdAt", "updatedAt"],
    rows.map((row) => [
      row.id, row.docType, row.label, row.expiryDate, row.reminderOffsets.join(";"),
      row.notes, row.createdAt, row.updatedAt,
    ]),
  );
}

function subjectsCsv(rows: readonly ExportSubject[]): string {
  return toCsv(
    ["id", "name", "color", "semester", "archived", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.name, row.color, row.semester, row.archived, row.createdAt, row.updatedAt]),
  );
}

function examsCsv(rows: readonly ExportExam[]): string {
  return toCsv(
    ["id", "subjectId", "examType", "examDate", "scope", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.subjectId, row.examType, row.examDate, row.scope, row.createdAt, row.updatedAt]),
  );
}

function examTopicsCsv(rows: readonly ExportExamTopic[]): string {
  return toCsv(
    ["id", "examId", "name", "sortOrder", "confidence", "deckId", "cut", "createdAt", "updatedAt"],
    rows.map((row) => [
      row.id, row.examId, row.name, row.sortOrder, row.confidence, row.deckId, row.cut,
      row.createdAt, row.updatedAt,
    ]),
  );
}

/** Front/back + state columns only — no FSRS internals (stability/difficulty/etc); the NDJSON keeps everything (ADR-009). */
function cardsCsv(rows: readonly ExportCard[]): string {
  return toCsv(
    ["id", "deckId", "front", "back", "state", "due", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.deckId, row.front, row.back, row.state, row.due, row.createdAt, row.updatedAt]),
  );
}

function plansCsv(rows: readonly ExportStudyPlan[]): string {
  return toCsv(
    ["id", "examId", "dailyMinutes", "startDate", "examWeekBoost", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.examId, row.dailyMinutes, row.startDate, row.examWeekBoost, row.createdAt, row.updatedAt]),
  );
}

function blocksCsv(rows: readonly ExportStudyBlock[]): string {
  return toCsv(
    ["id", "planId", "blockDate", "minutes", "status", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.planId, row.blockDate, row.minutes, row.status, row.createdAt, row.updatedAt]),
  );
}

function focusSessionsCsv(rows: readonly ExportFocusSession[]): string {
  return toCsv(
    ["id", "subjectId", "startedAt", "endedAt", "kind", "plannedMinutes", "pausedSeconds", "outcome", "cycleIndex", "taskId", "label", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.subjectId, row.startedAt, row.endedAt, row.kind, row.plannedMinutes, row.pausedSeconds, row.outcome, row.cycleIndex, row.taskId, row.label, row.createdAt, row.updatedAt]),
  );
}
