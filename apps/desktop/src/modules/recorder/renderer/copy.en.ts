import { sr } from "./copy.sr.js";

/**
 * The RECORDER in English — the same shape as `copy.sr.ts`, checked by the
 * compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error
 * each. The register is the app's own English: sentence case, informative, no
 * exclamation marks.
 */
export const en: typeof sr = {
  page: {
    subtitle: "A voice and camera diary — record it, then play it back when you need it.",
    loading: "Loading…",
  },
  capture: {
    title: "Recording",
    kindLabel: "What to record",
    kindAudio: "Sound",
    kindVideo: "Camera",
    deviceLabel: "Device",
    deviceDefault: "Default device",
    levelLabel: "Sound level",
    start: "Record",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    discard: "Discard",
    elapsedLabel: "Recorded",
    remainingLabel: "Time left",
    countdown: "Recording starts in…",
    unsupportedAudio: "This computer cannot record sound in a format Nexus stores.",
    unsupportedVideo: "This computer cannot record video in a format Nexus stores.",
    permissionDenied:
      "Nexus has no access to the microphone or the camera. Open Settings → Privacy & security → Microphone (and Camera) and allow apps to use them, then try again.",
    saveFailed: "The recording was not saved. Check the free space and try again.",
  },
  list: {
    title: "Recordings",
    searchLabel: "Search",
    searchPlaceholder: "Title, tag or note",
    tagLabel: "Tag",
    tagAll: "All tags",
    emptyTitle: "No recordings yet",
    emptyBody:
      "Record the first one — a voice memo or a short video — and give it a title and tags afterwards.",
    noResults: "No recording answers this search.",
    play: "Play",
    hide: "Hide",
    edit: "Edit",
    remove: "Delete",
    deletedNotice: "The recording was deleted.",
    undo: "Restore",
    dismiss: "Close",
  },
  form: {
    editTitle: "Edit recording",
    titleLabel: "Title",
    titlePlaceholder: "Leave empty for the date and time",
    diaryLabel: "File in the diary",
    dateLabel: "Date",
    tagsLabel: "Tags",
    tagsPlaceholder: "voice, outside",
    tagsHint: "Separate the tags with commas.",
    notesLabel: "Note",
    notesPlaceholder: "What is on the recording",
    save: "Save",
    cancel: "Cancel",
  },
  stats: {
    recordings: "Recordings",
    audio: "Sound",
    video: "Video",
    limitLabel: "Largest single recording",
  },
  errors: {
    load: "The recordings could not be loaded.",
    mutate: "The change was not saved.",
    tags: "Too many tags — shorten the list.",
    date: "Choose a date to file the entry under.",
  },
  settings: {
    caption: "A three-second countdown before every recording.",
    hint: "It gives you time to put the device down before recording starts.",
    saved: "Saved.",
    loadError: "The setting could not be loaded.",
    saveError: "The setting was not saved.",
  },
  widget: {
    empty: "No recordings yet.",
    loading: "Loading…",
    loadError: "The recordings could not be loaded.",
  },
};
