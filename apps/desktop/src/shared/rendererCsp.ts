/** The renderer's Content-Security-Policy in the two modes it runs in. */

export type RendererCspMode = "production" | "development";

/**
 * The packaged page is served from file:, so every app scheme it loads is
 * cross-origin. The directives below admit only the local schemes each surface
 * actually uses; the development policy adds the HMR socket and React Refresh's
 * inline preamble, and nothing else.
 */
export function rendererCsp(mode: RendererCspMode): string {
  const development = mode === "development";
  return [
    "default-src 'self'",
    development ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    development
      ? "img-src 'self' data: blob: nx-blob: priv-blob: nx-pack:"
      : "img-src 'self' data: nx-blob: priv-blob: nx-pack:",
    "media-src 'self' nx-blob:",
    "font-src 'self' data:",
    development
      ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:* nx-pack: nx-map:"
      : "connect-src 'self' nx-pack: nx-map:",
    "frame-src nx-zim:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
