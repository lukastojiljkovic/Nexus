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
 *  - `small-target`   an interactive control below the 24×24 CSS-pixel floor
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
  /** How far, in CSS pixels — how many pixels are lost, escape, or are shared. */
  amount: number;
  /** The element's own text, trimmed and capped, so a finding can be found by eye. */
  text: string;
}

/**
 * Elements inside these are excluded from the OVERLAP check only. Overlays are
 * *supposed* to paint over the surface behind them; flagging every open dialog
 * would bury the findings that matter. They are still checked for clipping,
 * escaping and off-screen painting, because those are wrong in an overlay too.
 */
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="menu"], [role="tooltip"], [role="listbox"], .nx-popover, .note__menu, ' +
  // The notification centre's panel: absolutely positioned out of the sidebar
  // foot, 360px wide against a 220px rail, deliberately painting over the page.
  // Every one of its rows was being reported as overlapping whatever it covers
  // — five of the sweep's fifteen findings, all of them the panel doing its job.
  ".ntf__panel";

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

  function add(kind, el, other, amount) {
    const where = label(el);
    const key = kind + "|" + where + "|" + label(other) + "|" + Math.round(amount);
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      kind: kind,
      where: where,
      other: other ? label(other) : "",
      amount: Math.round(amount * 10) / 10,
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
  function isClippedAway(el, rect) {
    const visible = visibleRect(el, rect);
    // Half of each axis has to survive the clip. A row peeking under a fade is
    // genuinely on screen and its geometry still counts; one entirely past the
    // edge is not being looked at by anyone.
    return (
      visible.right - visible.left < rect.width / 2 ||
      visible.bottom - visible.top < rect.height / 2
    );
  }

  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    if (isClippedAway(el, rect)) continue;

    // --- Painted outside the window -----------------------------------------
    // Only the leading edges and the right edge: a page that scrolls vertically
    // legitimately has content below the fold, and flagging it would flag
    // every long list in the app.
    const overRight = rect.right - viewWidth;
    if (overRight > 1) add("offscreen", el, null, overRight);
    if (rect.left < -1) add("offscreen", el, null, -rect.left);
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
    if (interactive && (rect.width < 24 || rect.height < 24)) {
      // A control's PAINTED box and its TARGET are different measurements, and
      // the honest way to grow the second without moving the first is a
      // transparent, absolutely positioned pseudo-element — which is exactly
      // what „.nx-checkbox input::before" does: the tick stays 15px and the
      // thing a pointer hits is 24. getBoundingClientRect cannot see it, so
      // without this the component that FIXED the class reports as the class.
      const before = getComputedStyle(el, "::before");
      const padW = before.content === "none" ? 0 : Number.parseFloat(before.width) || 0;
      const padH = before.content === "none" ? 0 : Number.parseFloat(before.height) || 0;
      const hitW = Math.max(rect.width, padW);
      const hitH = Math.max(rect.height, padH);
      if (hitW < 24 || hitH < 24) add("small-target", el, null, Math.min(hitW, hitH));
    }

    // Only text-bearing leaves take part in the overlap pass: a container
    // overlapping its own child is the normal case, and comparing every pair
    // of boxes in the document would report nothing but that.
    const ownText = Array.prototype.some.call(
      el.childNodes,
      (node) => node.nodeType === 3 && node.textContent.trim().length > 0,
    );
    if (ownText && !el.closest(OVERLAY_SELECTOR)) {
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
