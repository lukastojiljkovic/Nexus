import fontDataUrl from "./fonts/NotoSans-Regular.ttf?inline";

/**
 * The font DRAWINGS gives its text entities, so a drawing's annotations render
 * offline.
 *
 * **The font: Noto Sans Regular.** `dxf-viewer` draws TEXT and MTEXT from the
 * raw TTF files it is handed, and nothing else - one font is enough because a
 * DXF's own text style is not honoured by the renderer at all (its README says
 * so). Noto Sans is the one that covers what this product's users write: all
 * five Serbian letters in both cases, Latin extended, Greek and Cyrillic, 3 748
 * glyphs measured with `opentype.js` against the file that ships here.
 *
 * **Licence: SIL Open Font License 1.1**, "Copyright 2018 The Noto Project
 * Authors". The licence text ships beside the font
 * (`fonts/NotoSans-Regular.OFL.txt`, taken byte for byte from the same upstream
 * repository), and the OFL asks for one thing this file is careful about: the
 * font is embedded UNMODIFIED, and nothing here claims a reserved name. Source:
 * https://github.com/notofonts/noto-fonts (raw: /main/hinted/ttf/NotoSans/NotoSans-Regular.ttf,
 * licence: /main/LICENSE).
 *
 * **Why `?inline` and not an asset URL.** The bytes have to reach the PARSE
 * WORKER, and the worker's own `fetch` is the one thing this app's packaged
 * `file:` origin plus a `connect-src 'self'` policy cannot promise. `?inline`
 * puts the font in the module's own chunk as a data URL, the page decodes it
 * here, and the worker is handed the bytes over `postMessage` - the same route
 * the drawing takes, with no fetch and no policy change. The price is about
 * 760 KB of base64 in a chunk that only loads when somebody opens a drawing.
 */

/**
 * The bytes of a base64 data URL.
 *
 * Exactly the decoding this needs and no more: a data URL with a `;base64,`
 * marker is decoded, and anything else - a URL with no comma, one that is not
 * base64 - answers empty rather than throwing, because the only caller is
 * loading a file the build put there and an exception at that point would be a
 * blank viewer with no explanation.
 */
export function bytesFromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.slice(0, comma).includes(";base64")) return new Uint8Array(0);
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** The bundled font's bytes, for the worker. A fresh array per call: the worker takes ownership of what it is sent. */
export function textFontBytes(): Uint8Array {
  return bytesFromDataUrl(fontDataUrl);
}
