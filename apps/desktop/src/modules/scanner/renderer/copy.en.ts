import { TESSDATA_PACK_ID } from "./ocrConfig.js";
import { sr } from "./copy.sr.js";

/**
 * SKENER in English - the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error
 * each. The register is the app's English: sentence case, informative, no
 * exclamation marks.
 */
export const en: typeof sr = {
  page: {
    subtitle: "Reads text off an image or the camera and hands it to a note - offline.",
  },
  source: {
    title: "Source",
    file: "Choose an image",
    fileHint: "PNG, JPEG or WebP from this device.",
    camera: "Turn the camera on",
    cameraHint: "The camera starts with one click and runs while the page is open.",
    capture: "Capture the frame",
    stopCamera: "Turn the camera off",
    pasteHint: "An image on the clipboard (Ctrl+V) works too.",
    cameraDenied: "Camera access was refused. Allow it in the Windows camera settings.",
    cameraError: "No camera is available on this device.",
    decodeError: "That image could not be read. Try another file.",
    emptyTitle: "No image yet",
    emptyBody:
      "Choose an image, paste one from the clipboard, or turn the camera on - recognition runs with the network off.",
  },
  edit: {
    title: "Preparation",
    rotateLeft: "Rotate left",
    rotateRight: "Rotate right",
    cropHint: "Drag a rectangle over the image or type the percentages - only the crop is read.",
    left: "Left (%)",
    top: "Top (%)",
    width: "Width (%)",
    height: "Height (%)",
    whole: "Whole image",
    threshold: "Improve the contrast",
    thresholdHint: "Grey, a wider tone range and black and white - it helps with faint pictures.",
    reset: "Back to the start",
  },
  read: {
    title: "Reading",
    latin: "Serbian (Latin)",
    cyrillic: "Serbian (Cyrillic)",
    english: "English",
    languageHint: "Pick at least one language. The models come from the pack installed on this device.",
    read: "Read the text",
    reading: "Recognising…",
    readError: "The recognition did not work. Try another picture or another language.",
    phase: {
      core: "Preparing the engine",
      init: "Starting the engine",
      languages: "Loading the languages",
      api: "Preparing the languages",
      text: "Recognising the text",
      other: "Working…",
    },
    phaseLabel: "Stage",
    progressLabel: "Progress",
  },
  result: {
    title: "Text",
    emptyTitle: "No text yet",
    emptyBody: "Once the image has been read, the text appears here - line by line.",
    linesLabel: "Recognised lines",
    lineLabel: "Line",
    confidenceLabel: "Line confidence",
    lowMark: "Uncertain",
    lowNote: "Marked lines are uncertain - check them before using the text.",
    confidenceLabelSummary: "Average confidence",
    copy: "Copy the text",
    copied: "The text has been copied.",
    copyError: "The copy did not work.",
    noteTitle: "Note title",
    noteTitleHint: "If it is left empty, the title is derived from the text itself.",
    save: "Save as a note",
    attach: "Attach the image to the note",
    saved: "Saved in the notes.",
    saveError: "The note was not saved.",
    attachError: "The note was saved, but the image was not attached.",
  },
  pack: {
    checking: "Checking the language pack…",
    missingTitle: "The language pack is not installed",
    missingBody: `The scanner reads text with models from the ${TESSDATA_PACK_ID} pack. Install it in Settings, the Data category, the Content packs card.`,
    unknownTitle: "The pack state is not known",
    unknownBody:
      "The list of packs could not be read. Open the page again, or check Settings, the Data category.",
  },
};
