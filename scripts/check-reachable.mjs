// No shebang, for the reason every other gate in this directory has none: this
// module is both a CLI (`node scripts/check-reachable.mjs`) and an import
// target for its own tests.
//
// WHAT THIS GATE ENFORCES.
//
// `shared/ipc.ts` is the contract between the renderer and main, and a field on
// one of its PARAMETER shapes is a promise that the renderer can say something.
// `NewDocumentFields.reminderOffsets` was such a promise for months: declared,
// accepted by main, validated by the store, asserted by `documentStore.test.ts`
// — and set by no form, so every document kept its type's default ladder and a
// user could not reach the feature at all. Nothing in this repository could see
// it. The type system calls a well-typed program that never mentions the field
// correct; the linter sees no unused variable, because an unused property is not
// one; the store's tests assert the field is HONOURED, which it always was; and
// the screenshot sweep photographs the form it is missing from, where a missing
// chip row is not a clipped box. `check:pro-flags` asks the same question inside
// the professional drawer (a flag the surface never names is a caveat the user
// never reads); this is that rule one layer down, where the answer is no longer
// a caveat but a field nobody can fill.
//
// THE RULE, and it is one rule.
//
//   Every field of every type a `NexusApi` method takes as a parameter — or that
//   is the type of a property of such a parameter — must be SET by a renderer
//   call site.
//
// "Set" is read through the type checker and through the arguments of the calls
// on the bridge, never by grepping for a name: `ipc.ts` names every field of
// every one of these types itself, so a name that appears somewhere proves
// nothing. The two shapes a payload is actually built in are an object literal
// at a position whose contextual type is the contract type (directly at the call
// site, at a typed local, through `satisfies` or at a return position — with
// shorthand counting like any property, and a spread of another typed object
// counting for every field of that object's type), and a local whose fields are
// assigned one by one, which `exactOptionalPropertyTypes` is what forces for an
// optional field and which no contextual type reaches.
//
// Because of that second shape the evidence is read from the CALL SITES too:
// every argument that lands in a contract-typed parameter is chased back to what
// filled it — an identifier to its initializer and to every `identifier.field = …`
// in the renderer, a conditional to both arms, a `return`ing helper to its own
// returns — which is also what makes an UNANNOTATED local
// (`const fields = { name, color, schedule, target, unit, reminderTime }`) read
// as the six fields it fills rather than as six unreachable ones.
//
// WHY THE ALLOWLIST EXISTS. A few fields are legitimately never set by a screen:
// one main writes itself, one only the paused sync path fills. Every entry
// carries the reason in this file, and an entry that no longer matches a finding
// FAILS the gate — a hand-kept list beside a generated one rots silently, and an
// exemption nobody re-checks is the shape this repository has been bitten by most
// often (`docs/defect-classes.md`, DC-109). Entries marked `TODO(reachable)` are
// the honest other half: fields a screen does fill through a shape this walk
// cannot follow, each with the blind spot named, so the list is visible rather
// than absent. The census is printed beside the verdict so „found nothing“ and
// „looked at nothing“ are not the same green line.

import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

/** The contract, the surface that must fill it, and the project that holds both. */
const CONTRACT_FILE = "apps/desktop/src/shared/ipc.ts";
const RENDERER_DIR = "apps/desktop/src/renderer";
const RENDERER_TSCONFIG = "apps/desktop/tsconfig.web.json";

/** The bridge every renderer call goes through; a call elsewhere is not a screen. */
const BRIDGE_TYPE = "NexusApi";

/**
 * Fields that no renderer call site sets, each with the reason it stands.
 *
 * `TODO(reachable)` marks the two things this list is not closing, and the reason
 * says which it is: a field a screen DOES fill through a shape this walk cannot
 * follow, or one no screen fills and the shape's owner still has to decide on.
 * Every other entry is a field a screen was never meant to set — main's own
 * write, the exchange paths, a value the store resolves itself. An entry that
 * stops matching a finding fails the run, so a stale reason cannot survive here.
 */
export const ALLOWLIST = [
  {
    type: "NewTaskFields",
    field: "description",
    reason:
      "TODO(reachable) — no TASK screen writes a description: the quick-add builds title, dates, " +
      "list and ladder only, and the field is filled by main (applying a template) and by the " +
      "exchange paths. TASK shows the description nowhere, so nothing here says whether it is a " +
      "form field that is missing or a column the UI is done with.",
  },
  {
    type: "NewTaskFields",
    field: "status",
    reason:
      "A new task is always `todo`: the store defaults it and TASK moves one afterwards through " +
      "`TaskFieldChanges.status`, which the panel does set.",
  },
  {
    type: "TaskFieldChanges",
    field: "description",
    reason:
      "TODO(reachable) — the same shape `reminderOffsets` was: declared, accepted by main, " +
      "honoured by the store, and set by no screen, because TASK draws no description control " +
      "and reads the field nowhere either.",
  },
  {
    type: "EventFieldChanges",
    field: "description",
    reason:
      "TODO(reachable) — CAL's event form has no description control, and the panel reads the " +
      "field nowhere; only the create-time carry paths (`newEventFields`, `copyEventFields`) " +
      "write it, so an event keeps whatever a template gave it and can never be edited.",
  },
  {
    type: "EventFieldChanges",
    field: "category",
    reason:
      "TODO(reachable) — as `EventFieldChanges.description`: nothing in CAL draws or edits a " +
      "category; it travels only on the two create-time carry paths.",
  },
  {
    type: "ExamFieldChanges",
    field: "subjectId",
    reason:
      "No screen moves an exam between subjects: STUDY's exam edit changes type, date and scope " +
      "only. The field is on the wire for the store and the exchange paths.",
  },
  {
    type: "DeckFieldChanges",
    field: "subjectId",
    reason:
      "No screen moves a deck between subjects: the deck edit sets `name` alone, and a deck is " +
      "created inside the subject that owns it.",
  },
  {
    type: "ReviewQueueScope",
    field: "newLimit",
    reason:
      "`shared/ipc.ts` states it: `reviewQueue`'s `newLimit` is deliberately never sent by the " +
      "reviewer — omitted, the store resolves the profile's own daily new-card cap (STUDY-007).",
  },
  {
    type: "NewFinRecurringFields",
    field: "payee",
    reason:
      "Only the exchange paths set a subscription's payee (archive restore, foreign import); the " +
      "FIN form's `name` is what its generated charges are filed under (`recurringStore`: " +
      "`subscription.payee ?? subscription.name`).",
  },
  {
    type: "FinRecurringFieldChanges",
    field: "payee",
    reason:
      "As `NewFinRecurringFields.payee`: the subscription form has one name, and the exchange " +
      "paths are the only writers of the payee beside it.",
  },
  {
    type: "GlobalShortcutChord",
    field: "ctrl",
    reason:
      "TODO(reachable) — the chord a screen captures is the renderer's own mirrored `Chord` " +
      "(`shortcuts.ts`, written through `writeStoredShortcutOverrides`), so the literal's " +
      "contextual type is never `GlobalShortcutChord`; the value reaches `setGlobalShortcut` as " +
      "`shortcuts.globalCapture`.",
  },
  {
    type: "GlobalShortcutChord",
    field: "alt",
    reason: "TODO(reachable) — as `GlobalShortcutChord.ctrl`: the capture surface builds the mirrored `Chord`.",
  },
  {
    type: "GlobalShortcutChord",
    field: "shift",
    reason: "TODO(reachable) — as `GlobalShortcutChord.ctrl`: the capture surface builds the mirrored `Chord`.",
  },
  {
    type: "GlobalShortcutChord",
    field: "key",
    reason: "TODO(reachable) — as `GlobalShortcutChord.ctrl`: the capture surface builds the mirrored `Chord`.",
  },
];

/** A path as this gate spells it: forward slashes, relative to the root. */
function relPath(root, file) {
  return relative(root, file).split(sep).join("/");
}

/** The name a type is declared under, or `undefined` for an inline shape. */
function nameOf(type) {
  return (type.aliasSymbol ?? type.getSymbol())?.getName();
}

/** The declaration a type was written at, or `undefined` for a built-in. */
function declarationOf(type) {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  return symbol?.declarations?.[0];
}

/** A union arrives as one type; its members are what a literal can be. */
function membersOf(type) {
  return type.isUnion() ? type.types : [type];
}

/**
 * Whether a type is one of the several shapes TypeScript calls an object — but
 * not an array or a type parameter, neither of which a form fills in by naming
 * its fields.
 */
function isObjectShape(type) {
  if ((type.flags & ts.TypeFlags.Object) === 0) return false;
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) return false;
  const name = nameOf(type);
  if (name === "Array" || name === "ReadonlyArray") return false;
  if ((type.objectFlags & ts.ObjectFlags.Reference) !== 0 && type.getNumberIndexType() !== undefined) {
    return false; // a list of its element type, not a payload shape
  }
  return true;
}

/**
 * Every type this rule reaches: the parameters of `NexusApi` themselves, and the
 * named types their own properties carry (`transaction: NewFinTransactionFields`
 * on a request interface is one payload the renderer still has to fill). Both are
 * recorded with their fields and the line each field is declared on.
 *
 * The parameter map comes back with them: which method takes a contract type at
 * which argument position is what lets a call site be read as evidence, since
 * `const fields = { … }; createHabit(profileId, fields)` names no type anywhere
 * and is still a form filling six fields.
 */
export function contractTypes(checker, contractFile, repoRoot = REPO_ROOT) {
  const api = contractFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === BRIDGE_TYPE,
  );
  if (api === undefined) {
    throw new Error(`check-reachable: no ${BRIDGE_TYPE} interface in ${relPath(repoRoot, contractFile.fileName)}`);
  }

  const contractPath = relPath(repoRoot, contractFile.fileName);
  const types = new Map();
  const methods = new Map();
  const declaredHere = (declaration) =>
    relPath(repoRoot, declaration.getSourceFile().fileName) === contractPath;

  /** Records `type` when it is a named shape this file declares, and says so. */
  function record(type) {
    const name = nameOf(type);
    if (name === undefined || name.startsWith("__")) return undefined;
    if (types.has(name)) return types.get(name);
    const declaration = declarationOf(type);
    if (declaration === undefined || !declaredHere(declaration)) return undefined;
    const fields = new Map();
    for (const property of checker.getPropertiesOfType(type)) {
      const field = property.valueDeclaration ?? property.declarations?.[0];
      if (field === undefined) continue;
      fields.set(property.getName(), {
        file: relPath(repoRoot, field.getSourceFile().fileName),
        line: field.getSourceFile().getLineAndCharacterOfPosition(field.getStart()).line + 1,
      });
    }
    if (fields.size === 0) return undefined;
    const entry = { name, fields };
    types.set(name, entry);
    return entry;
  }

  // The parameters first. An inline parameter shape has no name of its own, so
  // it is not recorded — but its properties are walked below all the same.
  const parameters = [];
  for (const member of api.members) {
    if (!ts.isMethodSignature(member)) continue;
    const signature = checker.getSignatureFromDeclaration(member);
    if (signature === undefined) continue;
    const targets = [];
    for (const parameter of signature.getParameters()) {
      const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
      if (declaration === undefined) {
        targets.push([]);
        continue;
      }
      const type = checker.getTypeAtLocation(declaration);
      parameters.push(type);
      const names = [];
      for (const shape of membersOf(type)) {
        if (!isObjectShape(shape)) continue;
        const entry = record(shape);
        if (entry !== undefined) names.push(entry.name);
      }
      targets.push(names);
    }
    methods.set(member.name.text, targets);
  }

  // Then one level down: the named shapes those parameters' properties carry.
  for (const parameter of parameters) {
    for (const shape of membersOf(parameter)) {
      if (!isObjectShape(shape)) continue;
      for (const property of checker.getPropertiesOfType(shape)) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        if (declaration === undefined) continue;
        for (const nested of membersOf(checker.getTypeAtLocation(declaration))) {
          if (isObjectShape(nested)) record(nested);
        }
      }
    }
  }

  return { types, methods };
}

/** The property name a literal member or an assignment target contributes. */
function memberName(node) {
  const name = node.name;
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

/** Parentheses, `as`, `satisfies` and `!` carry the same payload inside. */
function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** How far a payload is chased through locals, conditionals and one helper. */
const CHASE_DEPTH = 4;

/**
 * Which contract fields each renderer call site fills.
 *
 * Two kinds of evidence, because the renderer builds payloads in two shapes.
 *
 * 1. An object literal whose CONTEXTUAL type is the contract type —
 *    `createTask(profileId, { title })`, a typed `changes` local, `satisfies`, a
 *    return position. Shorthand counts exactly like a written property, and a
 *    spread of an expression whose type is a contract type counts for every field
 *    of that type, which is what the reader of that line would say.
 *
 * 2. An argument at a call on the bridge, chased back to what filled it. This is
 *    not a convenience: `exactOptionalPropertyTypes` makes
 *
 *      const fields: NewTaskFields = { title };
 *      if (due !== null) fields.dueDate = due;
 *
 *    the ordinary way to write an optional field, and the contextual type of
 *    `{ title }` says nothing about `dueDate`. An unannotated local carries no
 *    type name at all, so `HabitsPage`'s
 *    `{ name, color, schedule, target, unit, reminderTime }` would otherwise read
 *    as six unreachable fields. The chase follows an identifier to its
 *    initializer and to every `identifier.field = …` in the program, a
 *    conditional to both arms, and a call to a helper's own `return` expressions.
 */
export function rendererSetters(program, checker, contract, methods, repoRoot = REPO_ROOT) {
  const setters = new Map();
  const names = new Set(contract.keys());
  const assignments = new Map();
  let literalCount = 0;
  let callSiteCount = 0;

  /** Every contract type name this type is or includes. */
  function contractsIn(type) {
    if (type === undefined) return [];
    const matched = [];
    for (const member of membersOf(type)) {
      const name = nameOf(member);
      if (name !== undefined && (names.has(name) || name === BRIDGE_TYPE)) matched.push(name);
    }
    return matched;
  }

  function add(name, fields) {
    const bucket = setters.get(name) ?? new Set();
    for (const field of fields) {
      if (contract.get(name).fields.has(field)) bucket.add(field);
    }
    setters.set(name, bucket);
  }

  const rendererPrefix = `${relPath(repoRoot, join(repoRoot, RENDERER_DIR))}/`;
  const rendererFiles = [];
  for (const sourceFile of program.getSourceFiles()) {
    const path = relPath(repoRoot, sourceFile.fileName);
    if (!path.startsWith(rendererPrefix)) continue;
    // A test that fills a payload is not a screen a user can reach.
    if (/\.test\.tsx?$/.test(path)) continue;
    rendererFiles.push(sourceFile);
  }

  // Pass one: every `something.field = …` in the renderer, keyed by the symbol it
  // assigns to, so a payload assembled after its literal is still read as that
  // literal's fields.
  for (const sourceFile of rendererFiles) {
    const visit = (node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left)
      ) {
        const field = memberName(node.left);
        const symbol = checker.getSymbolAtLocation(node.left.expression);
        if (field !== null && symbol !== undefined) {
          const bucket = assignments.get(symbol) ?? new Set();
          bucket.add(field);
          assignments.set(symbol, bucket);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  /** The `return` expressions a chased helper answers with. */
  function returnExpressions(declaration) {
    const body = declaration.body;
    if (body === undefined) return [];
    const found = [];
    const walk = (node) => {
      if (ts.isFunctionLike(node)) return; // a nested closure's returns are its own
      if (ts.isReturnStatement(node)) {
        if (node.expression !== undefined) found.push(node.expression);
        return;
      }
      ts.forEachChild(node, walk);
    };
    walk(body);
    return found;
  }

  /** The fields `expression` contributes to the target contract types. */
  function fieldsOf(expression, targets, depth) {
    const contributed = new Set();
    if (depth < 0) return contributed;
    const node = unwrap(expression);

    if (ts.isObjectLiteralExpression(node)) {
      for (const member of node.properties) {
        if (!ts.isSpreadAssignment(member)) {
          const field = memberName(member);
          if (field !== null) contributed.add(field);
          continue;
        }
        const spread = contractsIn(checker.getTypeAtLocation(member.expression));
        if (spread.length > 0) {
          for (const name of spread) {
            for (const field of contract.get(name).fields.keys()) contributed.add(field);
          }
          continue;
        }
        // A spread of an untyped local (`{ ...state, name }`) still carries the
        // fields that local was built with.
        for (const field of fieldsOf(member.expression, targets, depth - 1)) contributed.add(field);
      }
      return contributed;
    }

    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol === undefined) return contributed;
      for (const field of assignments.get(symbol) ?? []) contributed.add(field);
      for (const declaration of symbol.declarations ?? []) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
          for (const field of fieldsOf(declaration.initializer, targets, depth - 1)) {
            contributed.add(field);
          }
        }
      }
      return contributed;
    }

    if (ts.isConditionalExpression(node)) {
      for (const field of fieldsOf(node.whenTrue, targets, depth - 1)) contributed.add(field);
      for (const field of fieldsOf(node.whenFalse, targets, depth - 1)) contributed.add(field);
      return contributed;
    }

    if (ts.isCallExpression(node)) {
      const signature = checker.getResolvedSignature(node);
      const returns = signature?.getReturnType();
      const declaration = signature?.getDeclaration();
      const answered = returns === undefined ? [] : contractsIn(returns).filter((name) => targets.includes(name));
      if (answered.length > 0 && declaration !== undefined && ts.isFunctionLike(declaration)) {
        for (const returned of returnExpressions(declaration)) {
          for (const field of fieldsOf(returned, answered, depth - 1)) contributed.add(field);
        }
      }
      return contributed;
    }

    return contributed;
  }

  // Pass two: the contextual literals, and the calls on the bridge.
  for (const sourceFile of rendererFiles) {
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const matched = contractsIn(checker.getContextualType(node)).filter((name) => names.has(name));
        if (matched.length > 0) {
          literalCount += 1;
          for (const name of matched) add(name, fieldsOf(node, [name], CHASE_DEPTH));
        }
      }

      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const targets = methods.get(node.expression.name.text);
        if (targets !== undefined) {
          const receiver = checker.getTypeAtLocation(node.expression.expression);
          if (contractsIn(receiver).includes(BRIDGE_TYPE)) {
            callSiteCount += 1;
            for (let index = 0; index < node.arguments.length && index < targets.length; index += 1) {
              const argument = node.arguments[index];
              if (argument === undefined) continue;
              for (const name of targets[index]) add(name, fieldsOf(argument, [name], CHASE_DEPTH));
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { setters, literalCount, callSiteCount };
}

/** The fields no renderer call site sets, with the allowlist entry that covers each. */
export function findingsIn(contract, setters, allowlist) {
  const covered = new Map(allowlist.map((entry) => [`${entry.type}.${entry.field}`, entry]));
  const findings = [];
  for (const [name, entry] of contract) {
    for (const [field, where] of entry.fields) {
      if (setters.get(name)?.has(field) === true) continue;
      const key = `${name}.${field}`;
      findings.push({ key, type: name, field, file: where.file, line: where.line, allowed: covered.get(key) });
    }
  }
  return findings;
}

/** Allowlist entries that no longer cover a finding — every one of them a failure. */
export function staleEntries(contract, setters, allowlist) {
  const violations = [];
  for (const entry of allowlist) {
    const owner = contract.get(entry.type);
    if (owner === undefined) {
      violations.push({ ...entry, detail: `no contract type named \`${entry.type}\`` });
      continue;
    }
    if (!owner.fields.has(entry.field)) {
      violations.push({ ...entry, detail: `\`${entry.type}\` declares no field \`${entry.field}\`` });
      continue;
    }
    if (setters.get(entry.type)?.has(entry.field) === true) {
      violations.push({
        ...entry,
        detail: `a renderer call site now sets \`${entry.type}.${entry.field}\` — delete the entry`,
      });
    }
  }
  return violations;
}

/**
 * The whole rule over one tree: build the renderer program, collect the contract
 * parameters, read the call sites that fill them, and hand back both the findings
 * nobody has accounted for and the census that says how much was looked at.
 */
export function auditRepo({ repoRoot = REPO_ROOT, allowlist = ALLOWLIST } = {}) {
  const configPath = join(repoRoot, RENDERER_TSCONFIG);
  const host = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (parsed === undefined) throw new Error(`check-reachable: cannot read ${RENDERER_TSCONFIG}`);
  return auditProgram(ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options }), {
    repoRoot,
    allowlist,
  });
}

/** The same rule over an already-built program, which is what the tests drive. */
export function auditProgram(program, { repoRoot = REPO_ROOT, allowlist = ALLOWLIST } = {}) {
  const checker = program.getTypeChecker();
  const contractFile = program.getSourceFile(join(repoRoot, CONTRACT_FILE));
  if (contractFile === undefined) {
    throw new Error(`check-reachable: ${CONTRACT_FILE} is not in the program`);
  }
  const { types, methods } = contractTypes(checker, contractFile, repoRoot);
  const { setters, literalCount, callSiteCount } = rendererSetters(program, checker, types, methods, repoRoot);
  const findings = findingsIn(types, setters, allowlist);

  let fieldCount = 0;
  for (const entry of types.values()) fieldCount += entry.fields.size;

  return {
    findings,
    /** The findings no allowlist entry accounts for — the ones that fail the run. */
    unaccounted: findings.filter((finding) => finding.allowed === undefined),
    stale: staleEntries(types, setters, allowlist),
    census: {
      contractTypes: types.size,
      fields: fieldCount,
      literals: literalCount,
      callSites: callSiteCount,
      allowed: findings.filter((finding) => finding.allowed !== undefined).length,
      todo: allowlist.filter((entry) => entry.reason.startsWith("TODO(reachable)")).length,
    },
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { unaccounted, stale, census } = auditRepo();

  if (census.contractTypes === 0 || census.fields === 0 || census.callSites === 0) {
    // Guards the guard: an empty census is a broken walk, not a clean tree.
    console.error(
      "check-reachable: found no contract types, fields or call sites at all — " +
        "the walk is broken, not the tree.",
    );
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error(`check-reachable: ${stale.length} allowlist entry(ies) that no longer apply.\n`);
    for (const entry of stale) console.error(`  ${entry.type}.${entry.field}  ${entry.detail}`);
    console.error(
      "\nAn exemption that outlives its finding is a hand-kept list beside a generated\n" +
        "one (DC-109). Delete the entry, or restore the field it was written for.",
    );
    process.exit(1);
  }

  if (unaccounted.length > 0) {
    console.error(`check-reachable: ${unaccounted.length} field(s) no renderer call site sets.\n`);
    for (const finding of unaccounted) {
      console.error(`  ${finding.file}:${finding.line}  \`${finding.key}\``);
    }
    console.error(
      "\nA field on an IPC parameter is a promise that a screen can say something. One no\n" +
        "renderer call site sets is that promise with nothing behind it — the type system\n" +
        "is content, the linter sees no unused property, and the store's own tests assert\n" +
        "a field the UI cannot fill. Give it a call site, or, if no screen is ever meant\n" +
        "to set it, add it to ALLOWLIST in this file with the reason it stands.",
    );
    process.exit(1);
  }

  console.log(
    `check-reachable: ${census.fields} fields across ${census.contractTypes} IPC parameter types — ` +
      `${census.fields - census.allowed} set by a renderer call site, ${census.allowed} allowlisted ` +
      `(${census.todo} of them TODO(reachable)); ${census.callSites} bridge call(s) and ` +
      `${census.literals} contextual literal(s) read.`,
  );
}
