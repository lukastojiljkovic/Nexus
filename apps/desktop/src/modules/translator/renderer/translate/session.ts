import type { NllbPackId, TranslationView, TranslatorApi } from "../../shared/ipc.js";

/** The page waits this long after the last change before it asks main for a translation. */
export const TRANSLATE_DEBOUNCE_MS = 500;

/** How often the page asks main how far a running translation has got. */
export const POLL_MS = 200;

/** One translation to ask for: the model, the text as the model reads it, and the two NLLB codes. */
export interface SessionRequest {
  readonly packId: NllbPackId;
  readonly text: string;
  readonly source: string;
  readonly target: string;
}

/** What the output pane shows. */
export type SessionView =
  | { readonly kind: "idle" }
  | { readonly kind: "same-language" }
  | { readonly kind: "translating"; readonly text: string; readonly translated: number; readonly total: number }
  | { readonly kind: "done"; readonly text: string }
  | { readonly kind: "failed"; readonly reason: "load-failed" | "translate-failed"; readonly text: string };

export type SessionApi = Pick<TranslatorApi, "translate" | "translation" | "cancelTranslation">;

/**
 * When the translate page asks main for a translation, and what it shows while it
 * waits.
 *
 * Each change to the request restarts the debounce; once it has been quiet for
 * {@link TRANSLATE_DEBOUNCE_MS}, one translation is asked for and polled every
 * {@link POLL_MS} until it is done. A change while one is running stops the
 * polling at once, and the new translation replaces it in main, which cancels the
 * old one. A stale answer, one that arrives after its request has been replaced,
 * is dropped by a generation counter rather than shown.
 *
 * `dispose` is the unmount: it cancels the running job and stops every timer, and
 * the session stays usable, which React's double-mount in development relies on.
 */
export class TranslationSession {
  /** Bumped by every change and every dispose, so a late reply knows it has been replaced. */
  private generation = 0;
  /** The one timer in flight: the debounce, or the next poll. */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The job main is running for this session and has not finished, or `null`. */
  private job: string | null = null;

  constructor(
    private readonly api: SessionApi,
    private readonly show: (view: SessionView) => void,
  ) {}

  /** The request changed, or `null` when there is nothing to translate yet. */
  update(request: SessionRequest | null): void {
    this.stop();
    if (request === null || request.text.trim() === "") {
      this.cancelRunning();
      this.show({ kind: "idle" });
      return;
    }
    if (request.source === request.target) {
      this.cancelRunning();
      this.show({ kind: "same-language" });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.start(request);
    }, TRANSLATE_DEBOUNCE_MS);
  }

  dispose(): void {
    this.stop();
    this.cancelRunning();
  }

  private async start(request: SessionRequest): Promise<void> {
    const generation = this.generation;
    let jobId: string;
    try {
      ({ jobId } = await this.api.translate(request));
    } catch (failure) {
      if (generation !== this.generation) return;
      console.error("Nexus: the translation could not start:", failure);
      this.show({ kind: "failed", reason: "translate-failed", text: "" });
      return;
    }
    if (generation !== this.generation) return;
    this.job = jobId;
    this.timer = setTimeout(() => void this.poll(generation, jobId), POLL_MS);
  }

  private async poll(generation: number, jobId: string): Promise<void> {
    let view: TranslationView;
    try {
      view = await this.api.translation({ jobId });
    } catch (failure) {
      if (generation !== this.generation) return;
      console.error("Nexus: the translation could not be read:", failure);
      this.job = null;
      this.show({ kind: "failed", reason: "translate-failed", text: "" });
      return;
    }
    if (generation !== this.generation) return;
    if (!view.done) {
      this.show({ kind: "translating", text: view.text, translated: view.translated, total: view.total });
      this.timer = setTimeout(() => void this.poll(generation, jobId), POLL_MS);
      return;
    }
    this.job = null;
    this.show(finished(view));
  }

  /** Forgets the pending debounce or poll, and makes every reply still in flight stale. */
  private stop(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private cancelRunning(): void {
    if (this.job === null) return;
    const jobId = this.job;
    this.job = null;
    this.api.cancelTranslation({ jobId }).catch((failure: unknown) => {
      console.error("Nexus: the translation could not be cancelled:", failure);
    });
  }
}

/**
 * What a finished translation shows. A translation that was aborted was replaced
 * or cancelled on purpose, so it shows nothing; the others say why they stopped.
 */
function finished(view: TranslationView): SessionView {
  if (view.error === null) return { kind: "done", text: view.text };
  if (view.error === "aborted") return { kind: "idle" };
  return {
    kind: "failed",
    reason: view.error === "load-failed" ? "load-failed" : "translate-failed",
    text: view.text,
  };
}
