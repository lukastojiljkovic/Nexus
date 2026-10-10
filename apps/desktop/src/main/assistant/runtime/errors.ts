/**
 * The runtime's ONE error type, and the reason there is only one.
 *
 * Every entry point of `ModelHost` can fail for a reason a caller must be able
 * to act on: the network mode forbids a search, the disk is full, a model is not
 * installed, the worker refused an image. In the app that becomes a sentence in
 * the user's language, and the sentence has to be chosen by the CODE rather than
 * by matching on a message — a message is prose and prose gets edited.
 *
 * So each refusal carries a machine code and a message that is written for the
 * app's own log (which is English, like every comment here). The UI never shows
 * `message`; it switches on `code` and reads its own copy.
 */

/** Why a runtime call was refused. */
export type RuntimeErrorCode =
  /** This launch is not in the `downloads` network mode. */
  | "mode"
  /** A request to Hugging Face failed, or answered something unusable. */
  | "network"
  /** The volume cannot hold what the download may need. */
  | "no-space"
  /** The download service refused, or the transfer ended badly. */
  | "download"
  /** The bytes did not match the SHA-256 the entry states. */
  | "hash"
  /** A file could not be read, written, renamed or deleted. */
  | "io"
  /** The caller aborted: not a failure, and the partial download is kept. */
  | "aborted"
  /** No model with that id is installed. */
  | "not-installed"
  /** The model could not be loaded. */
  | "load"
  /** Generation failed. */
  | "complete"
  /** Embedding failed. */
  | "embed"
  /** A message carried images and this runtime loads no vision model (ADR-096). */
  | "unsupported-images"
  /** The file the user picked is not a GGUF model this build can use. */
  | "not-a-gguf"
  /** The worker refused because something else is already running. */
  | "busy"
  /** The worker died, or answered something this build does not understand. */
  | "worker"
  /** A bug in this runtime. */
  | "internal";

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(code: RuntimeErrorCode, message: string) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}
