/**
 * The layout audit that runs INSIDE the rendered page, next to every
 * screenshot.
 *
 * A screenshot proves what a surface looks like; it does not prove that a label
 * is not silently clipped two pixels short, or that a badge is painting on top
 * of the text behind it, or that a row has escaped the box that was supposed to
 * contain it. Those are exactly the defects that survive a review-by-eye,
 * because at a glance they read as "tight" rather than "wrong".
 *
 * So the harness asks the page directly. Every check below is a geometric fact
 * the browser already knows — no heuristics about what a design "should" look
 * like, only claims the layout itself contradicts:
 *
 *  - `offscreen`      an element painted outside the window
 *  - `clipped-text`   text cut off by a container that offers no ellipsis and
 *                     no scrollbar, so the missing words are unreachable
 *  - `escapes-parent` a child painting outside a parent that never asked to
 *                     clip — the class behind the sidebar-foot defect
 *  - `overlap`        two text-bearing elements sharing pixels while neither
 *                     is an overlay
 *  - `small-target`   an interactive control below the 24×24 floor, measured
 *                     in the coordinates it was authored in rather than in
 *                     painted pixels, so a canvas the user zooms is judged on
 *                     its design and not on the zoom it happens to be at
 *
 * The script is a string rather than an imported module because it is evaluated
 * in the RENDERER's world through `executeJavaScript`, where the main process's
 * module graph does not exist. It must therefore be self-contained, use no
 * syntax newer than the shipped Chromium, and return a JSON-serialisable value.
 */

/** One thing the page's own geometry says is wrong. */
export interface AuditFinding {
  kind: "offscreen" | "clipped-text" | "escapes-parent" | "overlap" | "small-target";
  /** A CSS-ish path to the element, built from tag + class, for grepping the source. */
  where: string;
  /** The second element, for `overlap`; empty otherwise. */
  other: string;
  /**
   * How far, in CSS pixels — how many pixels are lost, escape, or are shared.
   * The one exception is `small-target` inside an SVG, which reports the
   * target's size in that SVG's own user units, for the reason given at the
   * rule itself.
   */
  amount: number;
  /** The element's own text, trimmed and capped, so a finding can be found by eye. */
  text: string;
}

/**
 * Elements inside these are excluded from the OVERLAP check only. Overlays are
 * *supposed* to paint over the surface behind them; flagging every open dialog
 * would bury the findings that matter. They are still checked for clipping,
 * escaping and off-screen painting, because those are wrong in an overlay too.
 *
 * **It is a list because the property it encodes is INTENT, and geometry does
 * not carry intent.** Every generalisation of it that has been considered fails
 * on one real case: „positioned with a z-index" also describes an ordinary
 * raised card; „paints an opaque background over the thing beneath it" also
 * describes UČE's state chip painting over the flashcard text it truncates,
 * which is a defect this audit found and must keep finding. An overlay is a
 * surface the USER opened, and nothing about a box says that. So the cost of
 * this list is that a new overlay produces noise until it is added — noise, not
 * silence, which is the failure direction to prefer.
 */
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="menu"], [role="tooltip"], [role="listbox"], .nx-popover, .note__menu, ' +
  // The notification centre's panel: absolutely positioned out of the sidebar
  // foot, 360px wide against a 220px rail, deliberately painting over the page.
  // Every one of its rows was being reported as overlapping whatever it covers
  // — five of the sweep's fifteen findings, all of them the panel doing its job.
  ".ntf__panel, " +
  // NOTE's organizer under 1345px, where it leaves the grid and becomes a
  // drawer over the list — `position: absolute`, `z-index: 5`, its own opaque
  // surface, and a scrim that puts it away again. It carries no `role`, because
  // it is a disclosure rather than a dialog, so nothing above matches it. Ten of
  // the thirteen findings in the run that first opened it were its own folder,
  // tag and category controls reported against the note rows underneath.
  ".note__org-pane";

export const AUDIT_SCRIPT = `(() => {
  const OVERLAY_SELECTOR = ${JSON.stringify(OVERLAY_SELECTOR)};
  const findings = [];
  const seen = new Set();

  function ownLabel(el) {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".")
      : "";
    return tag + cls;
  }

  // The element AND the nearest ancestor that carries a class, joined by " in ".
  // A finding whose element is a bare "path" or "text" names nothing a person
  // can grep for — the sweep reported an SVG path 72.6px off-screen on FIN and
  // there was no way to tell which drawing it belonged to. One level of
  // ancestry is what turns that into an address.
  function label(el) {
    if (!el || el === document.documentElement) return "html";
    const own = ownLabel(el);
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      if (typeof node.className === "string" && node.className.trim() !== "") {
        return own + " in " + ownLabel(node);
      }
    }
    return own;
  }

  function textOf(el) {
    const raw = (el.textContent || "").replace(/\\s+/g, " ").trim();
    return raw.length > 60 ? raw.slice(0, 57) + "..." : raw;
  }

  // The precision the report has always printed at. It is named because the
  // small-target rule now COMPARES at it too: a rule and a report that disagree
  // about the same number are worse than either being slightly coarse.
  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function add(kind, el, other, amount) {
    const where = label(el);
    const key = kind + "|" + where + "|" + label(other) + "|" + Math.round(amount);
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      kind: kind,
      where: where,
      other: other ? label(other) : "",
      amount: round1(amount),
      text: textOf(el),
    });
  }

  const viewWidth = document.documentElement.clientWidth;
  const viewHeight = document.documentElement.clientHeight;
  const all = Array.prototype.slice.call(document.querySelectorAll("body *"));
  const boxes = [];

  // The nearest ancestor that CLIPS — the scroll container an element actually
  // lives inside. Everything below depends on knowing it, because a rect is
  // reported in unclipped page coordinates: a sidebar row scrolled out of view
  // still reports where it WOULD be, which is on top of whatever is pinned
  // under the scroller. Without this the audit reported the sidebar's hidden
  // rows as overlapping the profile foot on 236 surfaces — 236 findings that
  // were all one artefact of the instrument.
  function clipperOf(el) {
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.overflow !== "visible" ||
        style.overflowX !== "visible" ||
        style.overflowY !== "visible"
      ) {
        return node;
      }
    }
    return null;
  }

  // The part of the rectangle a reader can actually see, clipped by EVERY
  // clipping ancestor rather than by the nearest one.
  //
  // The nearest one is not enough and the calendar is why. An event's time
  // label sits inside the event button, which clips for its own ellipsis — so
  // the nearest clipper is the button, the label is entirely inside it, and
  // nothing is trimmed. The thing that actually hid it is two levels further
  // up: the hour grid scrolls to the working day, and everything above that
  // point is off the top of the pane. Stopping at the first clipper reported
  // those labels as overlapping the column headers they were scrolled behind.
  function visibleRect(el, rect) {
    let box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.overflow === "visible" &&
        style.overflowX === "visible" &&
        style.overflowY === "visible"
      ) {
        continue;
      }
      const bounds = node.getBoundingClientRect();
      box = {
        left: Math.max(box.left, bounds.left),
        right: Math.min(box.right, bounds.right),
        top: Math.max(box.top, bounds.top),
        bottom: Math.min(box.bottom, bounds.bottom),
      };
    }
    return box;
  }

  /** True when a clipping ancestor has scrolled this element out of sight. */
  function isClippedAway(rect, visible) {
    // Half of each axis has to survive the clip. A row peeking under a fade is
    // genuinely on screen and its geometry still counts; one entirely past the
    // edge is not being looked at by anyone.
    return (
      visible.right - visible.left < rect.width / 2 ||
      visible.bottom - visible.top < rect.height / 2
    );
  }

  // Every \`sticky\`/\`fixed\` element met so far — see the overlap guard below.
  const pinned = [];

  for (const el of all) {
    const style = getComputedStyle(el);
    // \`checkVisibility\` and not three named properties, because the three named
    // properties were \`display\`, \`visibility\` and \`opacity\`, and a fourth
    // exists. Chromium hides a closed \`<details>\`'s contents with
    // \`content-visibility\` on \`::details-content\` — the subtree is not painted,
    // but it keeps a layout box, and \`getComputedStyle\` on a descendant still
    // answers \`display: block; visibility: visible; opacity: 1\`. So every
    // collapsed risk notice in the professional drawer measured as a paragraph
    // sitting on top of the first field below it: 726 overlap findings in one
    // sweep, all of them the design working exactly as drawn.
    //
    // This is DC-01's inverse for the second time, and the lesson is the same
    // one: an audit that reports the app working is an audit nobody finishes
    // reading, which costs more than the findings it buys. Enumerating the ways
    // a box can be invisible is the mistake — the platform already has the
    // predicate, it accounts for \`content-visibility\`, and it also catches an
    // ANCESTOR at \`opacity: 0\`, which the property test never did.
    if (
      !el.checkVisibility({
        contentVisibilityAuto: true,
        opacityProperty: true,
        visibilityProperty: true,
      })
    ) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    // The box as it is actually PAINTED — \`rect\` trimmed by every clipping
    // ancestor. Both the clip test and the offscreen test below read it.
    const painted = visibleRect(el, rect);
    if (isClippedAway(rect, painted)) continue;

    // Recorded HERE, above every later \`continue\`, so a pinned bar that is
    // itself skipped by one of them (a visually-hidden one, say) still shields
    // its descendants. See the overlap guard for what it is for.
    if (style.position === "sticky" || style.position === "fixed") pinned.push(el);

    // --- Painted outside the window -----------------------------------------
    // Only the leading edges and the right edge: a page that scrolls vertically
    // legitimately has content below the fold, and flagging it would flag
    // every long list in the app.
    //
    // Measured on the CLIPPED box, not the raw one. An element inside a
    // horizontal scroller is wider than its scroller by design — that is what
    // the scroller is for — and comparing its own rect against the window
    // reported the HTTP registry's table as 104px offscreen when it was in fact
    // 104px into a box built to scroll it. What genuinely paints outside the
    // window is the SCROLLER, and the scroller is in this same loop, so nothing
    // real is lost: the finding just moves to the element that can actually be
    // fixed. (The registry table has a separate, real problem at the narrowest
    // window — no visible affordance saying a fifth column exists — but that is
    // a design decision, not a geometric fact, and an audit that conflates the
    // two teaches nobody anything.)
    const overRight = painted.right - viewWidth;
    if (overRight > 1) add("offscreen", el, null, overRight);
    if (painted.left < -1) add("offscreen", el, null, -painted.left);
    if (rect.top < -1 && style.position === "fixed") add("offscreen", el, null, -rect.top);
    if (style.position === "fixed" && rect.bottom - viewHeight > 1) {
      add("offscreen", el, null, rect.bottom - viewHeight);
    }

    // --- Text cut off with no way to reach it -------------------------------
    // Hidden overflow is only a defect when the element neither ellipsises nor
    // scrolls: then the words are simply gone. \`auto\`/\`scroll\` give the reader
    // a way through, and \`text-overflow: ellipsis\` at least admits to it.
    // „.nx-sr-only" is a 1px box with hidden overflow holding a full
    // sentence — that is what visually-hidden IS. It clips by construction and
    // reporting it is reporting the utility's own definition.
    if (el.classList.contains("nx-sr-only")) continue;

    const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
    const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
    const ellipsised = style.textOverflow === "ellipsis";
    const lineClamped = style.webkitLineClamp && style.webkitLineClamp !== "none";
    if (clipsX && !ellipsised && el.scrollWidth - el.clientWidth > 1) {
      add("clipped-text", el, null, el.scrollWidth - el.clientWidth);
    }
    if (clipsY && !lineClamped && el.scrollHeight - el.clientHeight > 1) {
      add("clipped-text", el, null, el.scrollHeight - el.clientHeight);
    }

    // --- A child painting outside a parent that never asked to clip ---------
    // Flow children only. An absolutely positioned or fixed child has left its
    // parent's box on purpose, and a parent that scrolls is containing it.
    // HORIZONTALLY only, and against the immediate parent.
    //
    // The axis matters. A page's content box being taller than the pane above
    // it is what scrolling IS, and measuring the vertical axis reported exactly
    // that as an 874px defect. Width is different: a parent's width was chosen,
    // by a grid column or a flex basis or a rail, and a child wider than it is
    // a child painting over its neighbour — which is precisely the dashboard's
    // document rows, where the name escaped its own cell by 41.7px and landed
    // on top of „isteklo pre 200 dana".
    const parent = el.parentElement;
    if (parent !== null && style.position === "static") {
      const parentStyle = getComputedStyle(parent);
      const parentScrollsX =
        parentStyle.overflowX === "auto" ||
        parentStyle.overflowX === "scroll" ||
        parent.scrollWidth - parent.clientWidth > 1;
      // A NEGATIVE inline margin is a deliberate statement that this element
      // extends past its parent's content box, and it is how a list row's hover
      // tint is bled into the card's own padding so it reads as a band across
      // the list rather than as a box around the text. The geometry is
      // indistinguishable from an escape; the intent is not, and it is written
      // down right there in the margin.
      const bled =
        Number.parseFloat(parentStyle.marginLeft) < 0 ||
        Number.parseFloat(style.marginLeft) < 0 ||
        Number.parseFloat(style.marginRight) < 0;
      if (!parentScrollsX && !bled) {
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.width >= 1) {
          const escape = Math.max(rect.right - parentRect.right, parentRect.left - rect.left);
          if (escape > 2) add("escapes-parent", el, parent, escape);
        }
      }
    }

    // --- Controls too small to hit ------------------------------------------
    const role = el.getAttribute("role");
    const interactive =
      el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT" ||
      el.tagName === "SELECT" || role === "button" || role === "tab" ||
      role === "menuitem" || role === "checkbox" || role === "radio";
    // The target is measured in the coordinates it was AUTHORED in, which for
    // everything outside an SVG is the painted pixel and for the workbench is
    // not. A canvas the user zooms paints its contents at whatever zoom they
    // chose: the same pin, whose hit circle is 24 circuit units across and can
    // be no larger without stealing its neighbour's click (PIN_HIT_RADIUS is
    // exactly half PIN_PITCH), measures 15.8px in the fit view and 29px one
    // press of „+" later. Two verdicts for one design, neither of them about
    // the design. getScreenCTM is the entire chain from an element's own user
    // space to the screen, so dividing it out asks what the floor is actually
    // about: is this target 24 across where it was written down?
    //
    // Nothing outside an SVG has such a chain, so every other element on every
    // other surface is measured exactly as before. Rotation is decomposed
    // rather than read off a/d, because a part turned 90° puts the scale in
    // b/c, and reading a there would answer 0.
    let unitX = 1;
    let unitY = 1;
    if (interactive && typeof el.getScreenCTM === "function") {
      const ctm = el.getScreenCTM();
      if (ctm !== null) {
        unitX = Math.hypot(ctm.a, ctm.b) || 1;
        unitY = Math.hypot(ctm.c, ctm.d) || 1;
      }
    }
    // A measurement reconstructed THROUGH a matrix cannot be relied on to land
    // on an integer, and a target designed to sit exactly ON the floor is the
    // one case where that matters. The bench's pin is 24 circuit units across
    // by construction, so dividing its painted width back out by the same scale
    // lands a hair under 24 rather than on it: eighteen electronics frames
    // reported a failing target whose size the report printed, correctly, as
    // „24". A rule and a report that disagree about the same number teach the
    // reader to stop believing the report, and that costs more than the false
    // finding does — so the rule now tests the number the report shows.
    const unitW = round1(rect.width / unitX);
    const unitH = round1(rect.height / unitY);
    if (interactive && (unitW < 24 || unitH < 24)) {
      // A control's PAINTED box and its TARGET are different measurements, and
      // the honest way to grow the second without moving the first is a
      // transparent, absolutely positioned pseudo-element — which is exactly
      // what „.nx-checkbox input::before" does: the tick stays 15px and the
      // thing a pointer hits is 24. getBoundingClientRect cannot see it, so
      // without this the component that FIXED the class reports as the class.
      const before = getComputedStyle(el, "::before");
      const padW = before.content === "none" ? 0 : Number.parseFloat(before.width) || 0;
      const padH = before.content === "none" ? 0 : Number.parseFloat(before.height) || 0;
      const hitW = Math.max(unitW, padW);
      const hitH = Math.max(unitH, padH);
      if (hitW < 24 || hitH < 24) add("small-target", el, null, Math.min(hitW, hitH));
    }

    // Only text-bearing leaves take part in the overlap pass: a container
    // overlapping its own child is the normal case, and comparing every pair
    // of boxes in the document would report nothing but that.
    const ownText = Array.prototype.some.call(
      el.childNodes,
      (node) => node.nodeType === 3 && node.textContent.trim().length > 0,
    );
    // A \`sticky\` or \`fixed\` ancestor makes an element an overlay in fact even
    // when it carries no overlay ROLE, and \`OVERLAY_SELECTOR\` cannot see it:
    // that list is about dialogs and menus, while this is about a bar pinned to
    // the edge of a scroller. Content scrolling underneath such a bar is what
    // the bar is FOR, so the shared pixels are the design working. Adding the
    // \`settings-sync\` scene — the first that scrolls a page before shooting —
    // turned four of those into standing findings, which is how a report starts
    // being scrolled past.
    //
    // \`pinned\` is collected during this same pass rather than by walking
    // ancestors per leaf: \`all\` is in document order, so a pinned ancestor is
    // always already in the list by the time one of its descendants is reached,
    // and the list holds a handful of elements rather than one per node.
    if (ownText && !el.closest(OVERLAY_SELECTOR) && !pinned.some((root) => root.contains(el))) {
      // The VISIBLE rect, not the laid-out one. An element half-scrolled out
      // of a pane still reports where it would be if the pane were not
      // scrolled, and the part hanging outside lands on whatever is pinned
      // above or below it — the calendar's hour grid scrolls to the working
      // day, so every event above that point was reported as overlapping the
      // column headers. Comparing what a reader can see is the only comparison
      // that means anything.
      boxes.push({ el: el, rect: visibleRect(el, rect), z: style.zIndex });
    }
  }

  // --- Two pieces of text sharing pixels ------------------------------------
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      // Two pixels of tolerance on each axis: sub-pixel layout rounding and
      // shared hairline borders are not defects, and reporting them would make
      // the audit noise rather than signal.
      if (overlapX > 2 && overlapY > 2) {
        add("overlap", a.el, b.el, Math.min(overlapX, overlapY));
      }
    }
  }

  return findings;
})()`;
