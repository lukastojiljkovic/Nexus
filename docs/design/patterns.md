# The shared page patterns

One component per pattern, in `packages/ui`, and one way in for the modules: a
module reaches the shell only through `moduleKit/moduleSurface.ts`, which
re-exports the components below. A page that needs a header, an empty state, a
read that can fail, a list beside a detail, a form field, a confirmation, an
undo offer or a switcher uses the component here. A page that draws its own is
a page the next pass has to convert, and the adoption matrix at the foot says
which pages have been converted and which have not.

The reason they exist in this order is in the module kit's method: patterns
before pages. Pages built on the same patterns agree with each other without
anybody comparing them; pages built by hand agree only where somebody
remembered.

Each section says when to use the pattern, what the component enforces, and
what it refuses. Where a rule is enforced by code rather than by review, the
enforcing thing is named. A rule that only lives in this document holds until
the first page author has not read it.

## PageHeader

**Use it** as the first thing a page renders, once. Never a second one, never
inside a card. A page keeps its header while its body loads or fails: the
header is a sibling of the body, not a condition on it.

| Slot | For | Rule the code keeps |
| --- | --- | --- |
| `title` | the page's name, as the page's only `<h1>` | one header per page |
| `subtitle` | one line of purpose | `.nx-hint`, under the title, never beside the actions |
| `primaryAction` | the page's one filled action | survives the narrow window |
| `actions` | controls that are peers — a page switcher, a view toggle | rendered after the primary |
| `secondaryActions` + `overflowLabel` | the gear, the import button, the toggle | below 900px they fold into a `⋯` disclosure |
| `filters` | the row that narrows what the page shows | always its own line, stacked below 900px |

**Do** put the page's own controls in it, so the body holds only the page's
content. **Don't** put a control in the body that acts on the whole page — that
is what `filters` and `actions` are for. The filled primary belongs to the
header when it creates the page's main object, and to the body only for a row
or a card that creates something inside it.

The narrow behaviour is a collapse, not a scrollbar: the filter row stacks, the
secondary actions move behind a labelled trigger, and the title and the primary
action stay where they are. 900px is the window minimum the desktop enforces, so
this is the narrowest window that exists rather than a breakpoint nobody
reaches.

**Adopted by:** all 26 module pages, each rendering one `PageHeader`.

## EmptyState

**Use it** for the two shapes of "there is nothing here", and pick the variant
by how much of the surface is empty.

- `variant="page"` — the whole page is empty. It is allowed to take space,
  because nothing else is competing for it, and it carries the first action.
- `variant="inline"` — one list inside a page that is otherwise full. One quiet
  line where the rows would be, no padding, no action.

**Do** say what the page is FOR and give the first action
(`description` + `action`). **Don't** draw an illustration. The `sigil` is the
module's own mark, at the third of its four scales: it says WHICH surface is
empty, which is the one thing a drawn scene cannot say, and it cannot pretend
to explain the moment either.

**Don't** write the empty sentence as a bare `<p className="nx-hint">` (or a
`span`). That draws the same words in a different ink, spacing and bullet from
the page beside it. `apps/desktop/src/renderer/src/moduleKit/emptyLine.test.ts`
fails on a copy leaf named like an empty state inside a bare hint line, and
names the files that still do it: an entry is removed from that list when its
page converts, and a new one is a regression.

**Adopted by:** 55 inline and 13 page empty states across the module renderers,
and 39 bare hint lines still in 27 files (the allowlist).

## Notice

**Use it** for one inline line of news or refusal beside the thing it is about:
a bad value under its field, a failed read above the list that would have held
the rows, a state the user should know before they act. It is a line, not a
panel, and it does not cover what it reports.

`kind` is `info`, `warning` or `danger`. Each kind carries its own glyph, so the
reading never rests on colour. `danger` is `role="alert"` and assertive, because
it reports a thing the user just tried and that did not happen. `info` and
`warning` are `role="status"` and polite, because they describe a state the
reader is already looking at, and interrupting for a state trains people to
ignore the region.

**Do** offer the way out (`action`) when there is one, and leave it out when there
is not: an action offered for its own sake is worse than none. **Don't** use
`Toast` for the inline case. A toast belongs to the whole page and may be
dismissed; a notice belongs to the control it is about.

**Adopted by:** no module page yet. The hand-written `*__error` lines are the
ones it replaces.

## AsyncSurface

**Use it** for one read that has three states: loading, failed and ready.
`AsyncSurface` draws the skeleton while the read is in flight, a failure with its
own heading and a Retry when the read can be asked again, and the body only when
the data is there.

- The failure has its OWN title. A page that reports a read it could not make as
  „there is nothing here" has told the user their data is gone. The empty
  state's words and the failure's words are different facts.
- A failed read never falls through to the body. Stale rows drawn as if the read
  had succeeded are the quiet version of a wrong screen.
- The Retry is drawn only when there is a handler to call. A button with no
  handler is not an offer.

The header stays with the page (see PageHeader); `AsyncSurface` is the body.
`asyncSurfacePlan` is the pure decision and the test beside it pins it.

**Adopted by:** no module page yet. The shell surfaces that show a failed read
as a dead end are the ones to convert.

## Dialog

**Use it** for every modal panel: a question the user opened, a form that sits
on top of the page, a picker. The frame is the same for all of them.

What the component enforces, so a caller cannot forget any of it:

- `role="dialog"` with `aria-modal`, named by the heading and described by the
  description when there is one. It is never `alertdialog`: that role makes some
  screen readers cut across what is being read, and these panels are questions
  the user opened, not alarms.
- A focus trap (`useFocusTrap`, the one implementation in `packages/ui`): Tab
  cycles inside the panel and wraps at both ends, and focus returns to where it
  came from on close. `initialFocusRef` names the control that takes the opening
  focus; without it the first tabbable control does.
- Escape and the backdrop both close it, and both are suppressed while `busy`. A
  request already in flight owns the answer it is about to give.
- While mounted it holds a modal layer (`useModalLayer`), so the shell's global
  shortcuts do not act through it.

**Deliberately without a portal.** The shell's scrolling column creates no
containing block, so a fixed panel is already positioned against the window, and
`packages/ui` does not depend on `react-dom`.

**Adopted by:** the shared `ConfirmDialog` only. Six module renderer files still
draw their own `role="dialog"` (cookbook, culture, lab, maps, reader, signals),
and the shell's module launcher still uses the `recur-dialog__*` recipe.

## ConfirmDialog

**Use it** for one act with one cost — removing a row, discarding a draft.
**Don't** use it for an unrecoverable delete that takes other rows with it: that
class of answer is deliberate only when the user types the name back, and the
app has `TypedConfirmDialog` for exactly that.

`ConfirmDialog` is `Dialog` with the two answers in one row, the cancelling one
first in the DOM. What it enforces on top of the frame:

- no default primary, so Enter picks nothing until a button has focus;
- Escape, the backdrop and the cancelling button all answer the same thing;
- `destructive` moves the OPENING focus to the cancelling answer — the APG's
  "least destructive action", so the key pressed without reading is the one that
  changes nothing. The rule is `confirmFocus`, and its test pins both branches.

The renderer's `ConfirmDialog` is a re-export of this one, so there is no second
confirmation recipe in the app.

**Adopted by:** 6 module renderer files (assistant ×2, calculator, car, chess,
maps).

## Toast

**Use it** for one lightweight announcement about something that just happened
on the whole page: the row that was deleted (with the offer to take it back),
the save that did not land.

**Do** give the undo offer both halves — a label and a handler — and let the
offer stand until the user answers it or the next one replaces it. **Don't** put
a timer on an undo offer: a timer punishes a slow reader, and the dwell is a
number nobody can defend. One offer at a time, which is why the bar is a slot
rather than a stack.

`dismissLabel` is required, so every offer, undo or not, has a way to close it
that is named in the page's words. `kind="error"` is the same component
announcing assertively with the `error` glyph; both kinds carry a shape as well
as an ink.

**Adopted by:** no module page, and the shell's two (Finance, Habits). The undo
bars that predate it are the ones to convert.

## ListDetail

**Use it** when one list selects what a pane beside it shows — a rail of
accounts beside a ledger, a rail of tools beside a surface. **Don't** use it for
a list that navigates to another page, and don't use it when the "detail" is
one more list: that is two lists, not a master and a detail.

The keyboard model is the WAI-ARIA Authoring Practices' single-select listbox
with selection following focus, and every part of it is in
`views/listDetailKeys.ts` where a test can pin it:

- one Tab stop for the whole list, not one per row;
- ↑/↓ move the keyboard and the selection together, wrapping at both ends;
- Enter opens the row the keyboard is standing on;
- Escape closes it and leaves the keyboard on the row it named.

Under 1100px the detail becomes the full view and the list steps aside, with one
visible way back. That is the same rule as the header's collapse, one breakpoint
up: the pair needs about 280px of rail plus a detail that is still readable.

**The selection is not the component's to keep.** It arrives as `selectedId` and
leaves as `onSelect`. A surface whose rows should be addressable backs it with
`useListDetailSelection`, which keeps the selection in the URL fragment —
`#sel=<id>` — so a reload lands on the same row. The fragment rather than the
query string, because only the fragment can change under `file://`, which is
what the packaged app loads.

**Don't** put controls inside a row. A row is an `option`: the row's own actions
belong to the detail pane, where they have their own names and their own place
in the Tab order.

**Adopted by:** no module page. The gallery uses it; the product does not yet.

## FormLayout, Field, FieldError

`FormLayout` is the frame — one heading, one column, one row of answers. It does
not draw fields: every box is `TextField`, `Select`, `TextArea` or `Checkbox`.
`Field` is what sits between them.

**Use `Field`** for every field of a form:

```tsx
<Field required help={s.form.targetHint} error={targetError}>
  <TextField label={s.form.targetLabel} inputMode="numeric" value={targetDraft} onChange={…} />
</Field>
```

The four rules it states once:

1. **One label rule.** `Field` draws no name of its own: the control and its
   label are the primitive's (`TextField`, `Select`, `TextArea`, `Checkbox`),
   whose label rule is stated once in `packages/ui`. A second `<label>` here
   would be a second name for one control — the quietest failure in the whole
   form layer, because the screen and the screen reader then disagree and
   nothing goes red.
2. **One help rule.** `help` is a `.nx-hint` line under the control, and it is
   `aria-describedby`'d, so it is read where it is written.
3. **One inline error rule.** `error` is `FieldError`: danger ink, the `warning`
   glyph, `role="alert"` so it is announced when it appears, and a danger border
   on the control it refuses. Colour never carries the refusal alone.
4. **Required marks.** `required` renders the mark in the accent ink and sets
   `aria-required` on the control — never the native `required` attribute, which
   would add the browser's own bubble to a page whose refusals are drawn in the
   page.

**Do** let a page bring its own frame class to `FormLayout` when the form sits
in a card, and **do** reach for `Field` the moment a field has a help line, a
refusal or a required mark. **Don't** hand-write a hint line or an error line
beside a field.

**Adopted by:** 2 module renderer files use `Field`; `FormLayout` is used by no
module page.

## Segmented

**Use it** for „which one of these is on": a view switcher, a filter, a scale
step. It is single-select by construction.

The paint of „on" is keyed off `aria-pressed` and never off a modifier class, so
the screen and the screen reader cannot disagree about which entry is on. The
class is always `.nx-segmented__option`; there is no selected-state modifier.
„This is on" was sometimes drawn as a filled primary button, and a filled button
has to keep meaning „press this" everywhere.

A picker that turns several entries on at once (a weekday ladder) is a toggle
group and not this component.

**Adopted by:** 7 module renderer files paint an option with the class directly;
none uses the component yet.

## Toolbar

**Use it** for the row of controls that changes what a page shows, drawn beneath
the header: a view switcher, a filter row. It is a named `group`, not a
`toolbar`: `toolbar` promises arrow-key roving focus, and this row is reached
with Tab.

Page-wide controls that act on the whole page belong in the header. The toolbar
is for controls that are a view of the content below them.

**Adopted by:** no module page yet.

## Section

**Use it** to name a group of rows on a page or inside a card. The caption is
the `.nx-eyebrow` tier, with the actions at its right and the rows beneath.

The heading level is the caller's decision. A section with a `level` is a
heading and appears in the outline a screen reader builds; a section without one
has a paragraph caption and is not in the outline. Pick the level for the
document, not for the look: the caption looks the same at every level.

**Adopted by:** no module page yet. Section titles are drawn with several
devices across the module renderers today.

## SettingsRow

**Use it** for one setting in a settings card: its name and hint on the left,
its control on the right, a rule between rows. It is a `group` named by its label
and described by its hint when it has one.

A module's settings card drew these with the shell's classes, so the card could
not be read without the shell's stylesheet. `nx-settings-row` carries the same
arrangement on its own.

Outcome of a save is announced with `Notice` or `Toast`, not by a bare line
inside the row.

**Adopted by:** no module settings card yet. Nine module renderer files draw
their rows with the shell's classes.

## useModalLayer

Not a component. `useModalLayer()` publishes „a modal is open" for as long as the
calling component is mounted, and `isModalOpen()` is what the shell's global key
handler asks before it acts on a chord. `Dialog` calls it, so a dialog is a
layer without any caller remembering to say so.

A count, not a boolean: nested modals are the ordinary case, and a release by the
inner one must not tell the guard the outer one has closed. The release is
idempotent, because React runs effects twice in development.

**Wired into the shell:** not yet. Until it is, the shell's shortcuts act through
an open dialog.

## Where the rules are enforced

| Rule | Enforced by |
| --- | --- |
| tokens only, no raw colour | `pnpm check:colours`, `check:contrast` |
| every `var(--nx-*)` exists | `pnpm check:tokens` |
| stacking order named, never numbered | `pnpm check:layers` |
| the explanation tier is stated once | `pnpm check:tiers` |
| a field goes through a primitive | `pnpm check:fields`, `check:controls` |
| a control's accessible name is its name | `pnpm check:names` |
| a module reaches the shell only through `moduleKit/` | `moduleKit/moduleBoundary.test.ts` (allowlist) |
| an empty list is never a bare hint line | `moduleKit/emptyLine.test.ts` (allowlist) |
| the keyboard and ARIA contracts above | the tests beside each component in `packages/ui/src` |

Two of the rules above are enforced by an allowlist, not by a gate: an entry
names a file that still breaks the rule, and the test fails when that file
stops breaking it, so the list can only shrink.

## Adoption matrix

Counted over `apps/desktop/src/modules/*/renderer` (non-test `.ts` and `.tsx`
files, one row per module, its `Page.tsx` the page), with a node script that
reads the source text: `<EmptyState` tags split by whether the tag contains
`variant="inline"`; a bare empty line is the expression of `emptyLine.test.ts`;
`role="dialog"`, `ConfirmDialog`, `Toast`, `nx-segmented__option` and
`set__module-row` are substring counts per file. Counts are files, except the
EmptyState columns, which are tags.

| Module | PageHeader | EmptyState inline | EmptyState page | LoadingState (files) | Bare empty line | Hand-rolled dialog (files) | ConfirmDialog (files) | Toast | Segmented paint (files) | Settings row (files) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arcade | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| assistant | 1 | 1 | 1 | 1 | 2 | 0 | 2 | 0 | 0 | 1 |
| astronomy | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| boards | 1 | 1 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 1 |
| calculator | 1 | 2 | 0 | 1 | 1 | 0 | 1 | 0 | 0 | 0 |
| car | 1 | 8 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| cards | 1 | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| chess | 1 | 3 | 0 | 1 | 2 | 0 | 1 | 0 | 0 | 0 |
| cookbook | 1 | 4 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| culture | 1 | 8 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 1 |
| drawings | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| emergency | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| lab | 1 | 1 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| library | 1 | 3 | 0 | 1 | 5 | 0 | 0 | 0 | 0 | 0 |
| maps | 1 | 4 | 0 | 1 | 1 | 1 | 1 | 0 | 0 | 0 |
| miniapps | 1 | 0 | 1 | 1 | 7 | 0 | 0 | 0 | 0 | 0 |
| pantry | 1 | 1 | 1 | 1 | 3 | 0 | 0 | 0 | 0 | 0 |
| puzzles | 1 | 2 | 0 | 5 | 0 | 0 | 0 | 0 | 4 | 1 |
| reader | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| recorder | 1 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| scanner | 1 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| signals | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 |
| timers | 1 | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 1 |
| translator | 1 | 2 | 1 | 2 | 2 | 0 | 0 | 0 | 1 | 0 |
| wiki | 1 | 2 | 0 | 1 | 4 | 0 | 0 | 0 | 0 | 0 |
| workshop | 1 | 2 | 3 | 1 | 4 | 0 | 0 | 0 | 1 | 1 |
| **Total** | **26** | **55** | **13** | **24 modules** | **39** | **6** | **6** | **0** | **7** | **9** |

Not counted in this matrix: the shell's pages (`apps/desktop/src/renderer/src`).
Components no module page uses yet: `Dialog`, `Notice`, `AsyncSurface`,
`Section`, `Toolbar`, `SettingsRow`, the `Segmented` component, `Toast`,
`ListDetail` and `FormLayout`.
