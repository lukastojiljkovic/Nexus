# The shared page patterns

Six patterns, one place each, for the pages the 2.0 wave is adding. They live in
`packages/ui` and they are adopted rather than imitated: a page that needs a
header, an empty state, a list beside a detail, a form field, a confirmation or
an undo offer uses the component below, and a page that draws its own is a page
the next pass has to convert.

The reason they exist in this order is in the module kit's method: patterns
before pages. Pages built on the same patterns agree with each other without
anybody comparing them; pages built by hand agree only where somebody
remembered.

Each section says when to use it, what the component enforces, and what it
refuses. Where a rule is enforced by code rather than by review, the enforcing
thing is named — a rule that only lives in this document is a rule that holds
until the first page author has not read it.

## PageHeader

**Use it** as the first thing a page renders, once. Never a second one, never
inside a card.

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
is what `filters` and `actions` are for, and a page-level control that drifts
down into the content is where every one of these pages started.

The narrow behaviour is a collapse, not a scrollbar: the filter row stacks, the
secondary actions move behind a labelled trigger, and the title and the primary
action stay where they are. 900px is the window minimum the desktop enforces, so
this is the narrowest window that exists rather than a breakpoint nobody
reaches.

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
leaves as `onSelect`, because two kinds of host want different things from it. A
surface whose rows should be addressable backs it with `useListDetailSelection`,
which keeps the selection in the URL fragment — `#sel=<id>` — so a reload lands
on the same row and the row can be named to somebody else. The fragment rather
than the query string, because only the fragment can change under `file://`,
which is what the packaged app loads. A surface inside somebody else's form
keeps it in state and passes it the same way.

**Don't** put controls inside a row. A row is an `option`: the row's own actions
belong to the detail pane, where they have their own names and their own place
in the Tab order.

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
refusal or a required mark — its whole job is the part a primitive has no place
for. **Don't** hand-write a hint line or an error line beside a field: that is
the shape these rules exist to remove, and the forms this pattern was drawn
from had each answered it a different way.

## ConfirmDialog

**Use it** for one act with one cost — removing a row, discarding a draft.
**Don't** use it for an unrecoverable delete that takes other rows with it: that
class of answer is deliberate only when the user types the name back, and the
app has `TypedConfirmDialog` for exactly that.

What the component enforces, so a caller cannot forget any of it:

- `role="dialog"` with `aria-modal`, named by the heading and described by the
  question;
- a focus trap: Tab cycles inside the panel and wraps at both ends, and focus
  returns where it came from on close;
- Escape, the backdrop and the cancelling button all answer the same thing;
- no default primary, so Enter picks nothing until a button has focus;
- `destructive` moves the OPENING focus to the cancelling answer — the APG's
  "least destructive action", so the key pressed without reading is the one that
  changes nothing.

## Toast

**Use it** for one lightweight announcement about something that just happened:
the row that was deleted (with the offer to take it back), the save that did not
land.

**Do** give the undo offer both halves — a label and a handler — and let the
offer stand until the user answers it or the next one replaces it. **Don't** put
a timer on an undo offer: a timer punishes a slow reader, and the dwell is a
number nobody can defend. One offer at a time, which is why the bar is a slot
rather than a stack.

`kind="error"` is the same component announcing assertively with the `error`
glyph; both kinds carry a shape as well as an ink, so the reading never rests on
the colour.

## Where the rules are enforced

| Rule | Enforced by |
| --- | --- |
| tokens only, no raw colour | `pnpm check:colours`, `check:contrast` |
| every `var(--nx-*)` exists | `pnpm check:tokens` |
| stacking order named, never numbered | `pnpm check:layers` |
| the explanation tier is stated once | `pnpm check:tiers` |
| a field goes through a primitive | `pnpm check:fields`, `check:controls` |
| a control's accessible name is its name | `pnpm check:names` |
| the keyboard and ARIA contracts above | the tests beside each component in `packages/ui/src` |
