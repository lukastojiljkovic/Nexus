import { sr } from "./copy.sr.js";

/**
 * ASISTENT's copy in English, typed by the Serbian table
 * (`copy.sr.ts` is the shape's source of truth).
 */
export const en: typeof sr = {
  page: {
    subtitle: "A conversation with a local model — no internet, and your own data.",
    loading: "Loading…",
  },
  rail: {
    title: "Conversations",
    new: "New conversation",
    empty: "No conversations yet. A new one begins with the first question.",
    rename: "Rename",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    models: "Models",
    confirmDeleteTitle: "Delete this conversation",
    confirmDeleteBody:
      "This conversation and every message in it are removed. It cannot be brought back.",
    confirmDelete: "Delete",
  },
  thread: {
    emptyTitle: "Ask something",
    emptyBody:
      "The assistant knows your notes, tasks, events and the app's own manual, and answers with no internet. Pick a conversation, or type a question below.",
    thinking: "Thinking…",
    stopped: "Stopped.",
    tools: "Tools",
  },
  composer: {
    placeholder: "A question or an instruction",
    hint: "Enter sends, Shift+Enter begins a new line.",
    send: "Send",
    stop: "Stop",
  },
  workflows: {
    title: "Recipes",
    hint: "A recipe starts a conversation with its steps already in hand. Every write still asks first.",
  },
  confirm: {
    title: "Confirmation",
    question: "A tool is asking for permission before it goes on.",
    allow: "Allow",
    deny: "No",
  },
  citations: {
    sources: "Sources",
  },
  setup: {
    title: "Models",
    close: "Close",
    intro:
      "The assistant runs on this computer: a model is downloaded once and then works with no internet.",
    hardwareTitle: "This machine",
    ram: "Memory",
    cpu: "Processor threads",
    gpu: "Graphics card",
    noGpu: "No graphics card — the model runs on the processor.",
    picksTitle: "The picks for this machine",
    unavailable: "The model list is not available right now.",
    installed: "Installed",
    serves: "Serves",
    size: "Size",
    licence: "Licence",
    download: "Download",
    stop: "Stop",
    resume: "Resume",
    import: "Import a .gguf",
    remove: "Delete",
    removeTitle: "Delete this model",
    removeBody:
      "The model file is removed from this computer. It can be downloaded again later.",
    removeConfirm: "Delete",
    progress: "Downloading",
    downloadFailed: "The download failed.",
    downloadStopped: "The download is stopped and can be resumed.",
    searchTitle: "Search Hugging Face",
    searchPlaceholder: "e.g. qwen2.5 7b instruct gguf",
    search: "Search",
    searchEmpty: "Nothing matched that query.",
    searchHint:
      "A result downloads only in the Downloads network mode, and every file is verified against the SHA-256 Hugging Face publishes.",
    needsDownloads:
      "A download works only in the Downloads network mode. Open Settings, then Privacy, then the Network card.",
    openSettings: "Open settings",
    installedTitle: "Installed models",
    noModel: "No model is installed yet.",
    tierIntelligence: "Intelligence",
    tierBalance: "Balance",
    tierSpeed: "Speed",
  },
  knowledge: {
    indexed: "Passages indexed",
    pending: "Sources pending",
    embedder: "Embedding model",
    noEmbedder: "No embedding model — retrieval is full text only.",
    rebuild: "Rebuild the index",
  },
  web: {
    sentence:
      "With web search on, the assistant sends your query to the provider the tool names. Nothing else leaves this machine.",
    modeBlocked:
      "The network mode allows no connection right now, so web search cannot act.",
  },
  settings: {
    hint: "The assistant works with no internet except for web search, which stays off until you turn it on.",
    saved: "Saved.",
  },
  errors: {
    load: "The assistant was not loaded.",
    action: "That change was not saved.",
    send: "The message was not sent.",
  },
};
