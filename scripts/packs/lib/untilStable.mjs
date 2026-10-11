// No shebang, for the reason every module in this directory has none: this one is
// imported by the pack builders and by their tests.
//
// WHY SANITIZING IS A LOOP AND NOT A `.replace`. A regex that matches several
// characters at once can leave the very thing it removed standing, because the
// next match is looked for in the string the LAST replacement produced:
// `<!--<!-- --> -->` loses the inner comment and keeps an outer one, and
// `<scr<script>ipt>` does the same with a tag. CodeQL reports that shape as
// `incomplete-multi-character-sanitization` at high severity, and the fix its own
// documentation asks for is to apply the replacement until the text stops
// changing.
//
// Every pack builder that turns somebody else's markup into text has this step:
// the two wiki converters, the reference reader and the tales reader. A run over
// text that is already clean costs one comparison, which is why the loop is here
// rather than an argument about whether a fetched page could really contain a
// nested tag.

/**
 * `step` applied to `text` until applying it changes nothing.
 *
 * `step` must be a pure function of its argument, and it must return a string: a
 * step that answers a fresh object every call would never agree with itself and
 * this would not terminate.
 */
export function untilStable(text, step) {
  let out = text;
  for (let previous = null; previous !== out; ) {
    previous = out;
    out = step(out);
  }
  return out;
}
