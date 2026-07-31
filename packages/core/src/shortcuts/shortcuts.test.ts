import { describe, expect, it } from "vitest";

import {
  chordAccelerator,
  chordFromEvent,
  findChordConflict,
  formatChord,
  isBindableChord,
  isModifierKey,
  matchesChord,
  MODULE_NAV_CONFLICT,
  MODULE_NAV_MAX,
  moduleNavChord,
  moduleNavPosition,
  normalizeChordKey,
  parseChord,
  type Chord,
  type ChordEvent,
} from "./shortcuts.js";

/** A `ChordEvent` with every modifier off unless the test says otherwise. */
function event(key: string, held: Partial<Omit<ChordEvent, "key">> = {}): ChordEvent {
  return {
    key,
    ctrlKey: held.ctrlKey ?? false,
    metaKey: held.metaKey ?? false,
    altKey: held.altKey ?? false,
    shiftKey: held.shiftKey ?? false,
  };
}

function chord(key: string, held: Partial<Omit<Chord, "key">> = {}): Chord {
  return { ctrl: held.ctrl ?? false, alt: held.alt ?? false, shift: held.shift ?? false, key };
}

describe("normalizeChordKey", () => {
  it("lowercases single characters, including non-ASCII ones the layout prints", () => {
    expect(normalizeChordKey("k")).toBe("k");
    expect(normalizeChordKey("K")).toBe("k");
    expect(normalizeChordKey("Š")).toBe("š");
    expect(normalizeChordKey("1")).toBe("1");
    expect(normalizeChordKey(",")).toBe(",");
    expect(normalizeChordKey("+")).toBe("+");
  });

  it("names function keys canonically, F1 through F12 only", () => {
    expect(normalizeChordKey("F1")).toBe("F1");
    expect(normalizeChordKey("f12")).toBe("F12");
    expect(normalizeChordKey("F13")).toBeNull();
    expect(normalizeChordKey("F0")).toBeNull();
  });

  it("rejects the modifiers themselves — they are held, never the key", () => {
    for (const key of ["Control", "Alt", "Shift", "Meta", "AltGraph"]) {
      expect(normalizeChordKey(key), key).toBeNull();
    }
  });

  it("rejects every other named key, so only the two documented shapes exist", () => {
    for (const key of ["Escape", "Enter", "ArrowLeft", "Tab", "Dead", "Unidentified", ""]) {
      expect(normalizeChordKey(key), key).toBeNull();
    }
  });

  it("rejects whitespace keys — a chord chip must be something a user can see", () => {
    expect(normalizeChordKey(" ")).toBeNull();
  });
});

describe("isModifierKey", () => {
  it("is true exactly for the keys that are held rather than pressed", () => {
    expect(isModifierKey("Control")).toBe(true);
    expect(isModifierKey("Shift")).toBe(true);
    expect(isModifierKey("Alt")).toBe(true);
    expect(isModifierKey("Meta")).toBe(true);
    expect(isModifierKey("AltGraph")).toBe(true);
    expect(isModifierKey("k")).toBe(false);
    expect(isModifierKey("F1")).toBe(false);
  });
});

describe("formatChord", () => {
  it("serializes in the fixed Ctrl, Alt, Shift, key order", () => {
    expect(formatChord(chord("k", { ctrl: true }))).toBe("Ctrl+K");
    expect(formatChord(chord("k", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+K");
    expect(formatChord(chord("k", { ctrl: true, alt: true, shift: true }))).toBe("Ctrl+Alt+Shift+K");
    expect(formatChord(chord("k", { alt: true }))).toBe("Alt+K");
  });

  it("keeps function keys by name and punctuation as typed", () => {
    expect(formatChord(chord("F1"))).toBe("F1");
    expect(formatChord(chord(",", { ctrl: true }))).toBe("Ctrl+,");
    expect(formatChord(chord("+", { ctrl: true }))).toBe("Ctrl++");
  });
});

describe("parseChord", () => {
  it("round-trips every canonical serialization", () => {
    for (const text of ["Ctrl+K", "Ctrl+Shift+K", "Ctrl+Alt+Shift+K", "Alt+N", "F1", "Ctrl+,", "Ctrl++"]) {
      const parsed = parseChord(text);
      expect(parsed, text).not.toBeNull();
      expect(parsed === null ? null : formatChord(parsed), text).toBe(text);
    }
  });

  it("normalizes the key and accepts modifiers in any order or casing", () => {
    expect(parseChord("Ctrl+K")).toEqual(chord("k", { ctrl: true }));
    expect(parseChord("shift+ctrl+k")).toEqual(chord("k", { ctrl: true, shift: true }));
    expect(parseChord("f1")).toEqual(chord("F1"));
  });

  it("refuses malformed text rather than guessing at it", () => {
    for (const text of [
      "", // nothing at all
      "Ctrl+", // a separator with no key after it
      "++", // an empty modifier
      "Ctrl+Ctrl+K", // a repeated modifier
      "Hyper+K", // a modifier this app does not know
      "Ctrl+Escape", // a key that is neither a character nor F1–F12
      "Ctrl+Space",
    ]) {
      expect(parseChord(text), text).toBeNull();
    }
  });
});

describe("isBindableChord", () => {
  it("accepts a chord holding Ctrl or Alt", () => {
    expect(isBindableChord(chord("k", { ctrl: true }))).toBe(true);
    expect(isBindableChord(chord("k", { alt: true }))).toBe(true);
    expect(isBindableChord(chord("k", { ctrl: true, shift: true }))).toBe(true);
  });

  it("accepts a function key, which prints nothing on its own", () => {
    expect(isBindableChord(chord("F1"))).toBe(true);
    expect(isBindableChord(chord("F5", { shift: true }))).toBe(true);
  });

  it("refuses what typing looks like — a bare or merely shifted character", () => {
    expect(isBindableChord(chord("k"))).toBe(false);
    expect(isBindableChord(chord("k", { shift: true }))).toBe(false);
    expect(isBindableChord(chord("1"))).toBe(false);
  });
});

describe("chordFromEvent", () => {
  it("reads a bindable combination off a plain event shape", () => {
    expect(chordFromEvent(event("k", { ctrlKey: true }))).toEqual(chord("k", { ctrl: true }));
    expect(chordFromEvent(event("K", { ctrlKey: true, shiftKey: true }))).toEqual(
      chord("k", { ctrl: true, shift: true }),
    );
    expect(chordFromEvent(event("F1"))).toEqual(chord("F1"));
  });

  it("treats Cmd as Ctrl, the palette's own long-standing rule", () => {
    expect(chordFromEvent(event("k", { metaKey: true }))).toEqual(chord("k", { ctrl: true }));
  });

  it("returns null for anything that must never be capturable", () => {
    expect(chordFromEvent(event("k"))).toBeNull();
    expect(chordFromEvent(event("K", { shiftKey: true }))).toBeNull();
    expect(chordFromEvent(event("Control", { ctrlKey: true }))).toBeNull();
    expect(chordFromEvent(event("Escape", { ctrlKey: true }))).toBeNull();
  });
});

describe("matchesChord", () => {
  const ctrlK = chord("k", { ctrl: true });

  it("matches on either Ctrl or Cmd", () => {
    expect(matchesChord(ctrlK, event("k", { ctrlKey: true }))).toBe(true);
    expect(matchesChord(ctrlK, event("k", { metaKey: true }))).toBe(true);
    expect(matchesChord(ctrlK, event("K", { ctrlKey: true }))).toBe(true);
  });

  it("requires Alt and Shift to match exactly", () => {
    expect(matchesChord(ctrlK, event("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesChord(ctrlK, event("k", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(
      matchesChord(chord("k", { ctrl: true, shift: true }), event("K", { ctrlKey: true, shiftKey: true })),
    ).toBe(true);
  });

  it("never matches an unmodified keystroke, so typing is never captured", () => {
    expect(matchesChord(ctrlK, event("k"))).toBe(false);
    expect(matchesChord(ctrlK, event("j", { ctrlKey: true }))).toBe(false);
    expect(matchesChord(ctrlK, event("Control", { ctrlKey: true }))).toBe(false);
  });
});

describe("the reserved Ctrl+digit family", () => {
  it("builds a chord for positions 1 through 9 only", () => {
    expect(moduleNavChord(1)).toEqual(chord("1", { ctrl: true }));
    expect(formatChord(chord("9", { ctrl: true }))).toBe("Ctrl+9");
    expect(moduleNavChord(MODULE_NAV_MAX)).toEqual(chord("9", { ctrl: true }));
    expect(moduleNavChord(0)).toBeNull();
    expect(moduleNavChord(10)).toBeNull();
    expect(moduleNavChord(1.5)).toBeNull();
  });

  it("reads a position off an event, digits staying digits", () => {
    expect(moduleNavPosition(event("3", { ctrlKey: true }))).toBe(3);
    expect(moduleNavPosition(event("3", { metaKey: true }))).toBe(3);
    expect(moduleNavPosition(event("0", { ctrlKey: true }))).toBeNull();
    expect(moduleNavPosition(event("3"))).toBeNull();
    expect(moduleNavPosition(event("3", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(moduleNavPosition(event("3", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe("chordAccelerator", () => {
  it("writes the modifiers in Electron's order, Ctrl as CommandOrControl", () => {
    expect(chordAccelerator(chord("n", { ctrl: true, shift: true }))).toBe("CommandOrControl+Shift+N");
    expect(chordAccelerator(chord("n", { ctrl: true, alt: true }))).toBe("CommandOrControl+Alt+N");
    expect(chordAccelerator(chord("j", { alt: true }))).toBe("Alt+J");
    expect(chordAccelerator(chord("j", { alt: true, shift: true }))).toBe("Alt+Shift+J");
    expect(chordAccelerator(chord("q", { ctrl: true, alt: true, shift: true }))).toBe(
      "CommandOrControl+Alt+Shift+Q",
    );
  });

  it("names letters uppercase, digits and function keys as they stand", () => {
    expect(chordAccelerator(chord("z", { ctrl: true }))).toBe("CommandOrControl+Z");
    expect(chordAccelerator(chord("0", { ctrl: true }))).toBe("CommandOrControl+0");
    expect(chordAccelerator(chord("F12", { alt: true }))).toBe("Alt+F12");
    // Casing on the way in is irrelevant — the accelerator is canonical.
    expect(chordAccelerator(chord("f5", { ctrl: true }))).toBe("CommandOrControl+F5");
  });

  it("refuses a chord holding neither Ctrl nor Alt — a global hotkey must not swallow a bare key", () => {
    expect(chordAccelerator(chord("F1"))).toBeNull();
    expect(chordAccelerator(chord("F5", { shift: true }))).toBeNull();
  });

  it("refuses what typing looks like, exactly as `isBindableChord` does", () => {
    expect(chordAccelerator(chord("k"))).toBeNull();
    expect(chordAccelerator(chord("k", { shift: true }))).toBeNull();
    expect(chordAccelerator(chord("1"))).toBeNull();
  });

  it("refuses punctuation: an OS hotkey binds a physical key, so the printed chord would be a lie on a non-US layout", () => {
    for (const key of [",", ".", "+", "-", "/", ";", "'", "[", "]", "\\", "`"]) {
      expect(chordAccelerator(chord(key, { ctrl: true })), key).toBeNull();
      expect(chordAccelerator(chord(key, { ctrl: true, alt: true })), key).toBeNull();
    }
  });

  it("refuses a key the layout prints but an accelerator cannot name", () => {
    for (const key of ["š", "č", "ć", "ž", "đ", "€", "ю"]) {
      expect(chordAccelerator(chord(key, { ctrl: true })), key).toBeNull();
    }
  });

  it("refuses the named keys a chord can never legitimately carry", () => {
    // None of these survives `normalizeChordKey`, so no captured or stored
    // chord can hold one — this pins that a hand-built `Chord` is refused too.
    for (const key of ["Escape", "Enter", "Tab", "Space", " ", "ArrowLeft", "Backspace", "F13", ""]) {
      expect(normalizeChordKey(key), key).toBeNull();
      expect(chordAccelerator(chord(key, { ctrl: true, alt: true })), key).toBeNull();
    }
  });

  it("is never longer than the modifiers plus a function key — main's payload cap has headroom", () => {
    expect(chordAccelerator(chord("F12", { ctrl: true, alt: true, shift: true }))).toBe(
      "CommandOrControl+Alt+Shift+F12",
    );
  });

  it("only ever answers for a chord this app would let the user bind", () => {
    const keys = ["k", "n", "1", "F1", "F12", ",", "+", "š", "Escape"];
    for (const key of keys) {
      for (const held of [
        {},
        { ctrl: true },
        { alt: true },
        { shift: true },
        { ctrl: true, alt: true },
        { ctrl: true, shift: true },
        { alt: true, shift: true },
        { ctrl: true, alt: true, shift: true },
      ]) {
        const candidate = chord(key, held);
        if (chordAccelerator(candidate) !== null) {
          expect(isBindableChord(candidate), formatChord(candidate)).toBe(true);
        }
      }
    }
  });
});

describe("findChordConflict", () => {
  const bindings: Record<string, Chord> = {
    palette: chord("k", { ctrl: true }),
    quickCreate: chord("n", { ctrl: true }),
    shortcutsHelp: chord("F1"),
  };

  it("names the action already holding the chord", () => {
    expect(findChordConflict("lock", chord("n", { ctrl: true }), bindings)).toBe("quickCreate");
    expect(findChordConflict("lock", chord("F1"), bindings)).toBe("shortcutsHelp");
  });

  it("does not report an action against itself — rebinding to the same chord is a no-op, not a clash", () => {
    expect(findChordConflict("palette", chord("k", { ctrl: true }), bindings)).toBeNull();
  });

  it("reserves the whole Ctrl+digit family", () => {
    expect(findChordConflict("lock", chord("1", { ctrl: true }), bindings)).toBe(MODULE_NAV_CONFLICT);
    expect(findChordConflict("lock", chord("9", { ctrl: true }), bindings)).toBe(MODULE_NAV_CONFLICT);
    // Only the bare Ctrl+digit form is reserved; adding Alt or Shift leaves it free.
    expect(findChordConflict("lock", chord("1", { ctrl: true, shift: true }), bindings)).toBeNull();
    expect(findChordConflict("lock", chord("0", { ctrl: true }), bindings)).toBeNull();
  });

  it("returns null for a free chord", () => {
    expect(findChordConflict("lock", chord("j", { ctrl: true, alt: true }), bindings)).toBeNull();
  });
});
