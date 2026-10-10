import { useRef, useState } from "react";
import { Button, Card } from "@nexus/ui";
import { copy } from "../copy.js";
import { MAX_QR_PIXELS } from "../qrDecode.js";
import { decodeOffThread } from "../qr.js";

/**
 * The QR reader (mini-apps): an image in, its code's text out - shown as text,
 * never acted on.
 *
 * **An image, not the camera.** The camera would need the `media` web permission,
 * and this session denies every web permission on purpose: `main/index.ts`
 * records the decision - "there is no camera, microphone, geolocation, MIDI or
 * clipboard-read path anywhere in the product" - and opening a video stream is a
 * change to the product's security posture rather than a module's judgement. So
 * the reader takes a picture the user already has, which is the other half of
 * what the brief allows and needs no permission at all.
 *
 * **The decoded text is text.** It is drawn in a selectable paragraph, copied by
 * an explicit button, and NEVER opened: a QR code is exactly how a stranger
 * hands a URL to a program, and "the app opened what the picture said" is the
 * behaviour this module exists not to have. The page states that out loud when
 * the text is a URL, because the one thing a user may expect and will not get is
 * a link that opens itself.
 *
 * **Why the copy is a document command rather than the Clipboard API.** The same
 * permission decision above denies `navigator.clipboard`, so the copy goes
 * through the user-gesture path that needs no permission: a temporary selection
 * and `document.execCommand("copy")`. If that fails the text is still on screen
 * and selectable, and the page says the copy did not happen rather than claiming
 * it did.
 */

/** How long a decoded text is shown whole. Longer than any real code, and short of a wall of prose. */
const MAX_TEXT_SHOWN = 4000;

/** True for text a reader would expect to be clickable. */
function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** Copies through the gesture-based command, and says whether it worked. */
function copyThroughSelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.className = "miniapps__clipboard";
  document.body.appendChild(area);
  area.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    console.error("Nexus: the QR text could not be copied:", error);
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}

export function QrApp() {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  /** Reads one image: pixels through a canvas, then the decode off this thread. */
  async function read(file: File): Promise<void> {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    setText(null);
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > MAX_QR_PIXELS) {
        setProblem(copy.qr.tooLarge);
        return;
      }
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (context === null) {
        setProblem(copy.qr.badImage);
        return;
      }
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const decoded = await decodeOffThread({
        width: pixels.width,
        height: pixels.height,
        rgba: pixels.data,
      });
      if (decoded === null) {
        setProblem(copy.qr.noCode);
        return;
      }
      setText(decoded);
    } catch (error) {
      console.error("Nexus: the QR image could not be read:", error);
      setProblem(copy.qr.badImage);
    } finally {
      setBusy(false);
    }
  }

  const shown = text === null ? null : text.slice(0, MAX_TEXT_SHOWN);

  return (
    <div className="miniapps__app">
      <Card className="miniapps__card miniapps__qr" title={copy.qr.file}>
        <p className="nx-hint">{copy.qr.fileHint}</p>
        <div className="miniapps__row">
          <input
            ref={picker}
            type="file"
            accept="image/*"
            className="miniapps__file-input"
            aria-label={copy.qr.file}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // The same file twice has to be readable twice, so the input is
              // emptied after every attempt.
              event.target.value = "";
              if (file !== undefined) void read(file);
            }}
          />
          <Button size="sm" variant="primary" disabled={busy} onClick={() => picker.current?.click()}>
            {copy.qr.choose}
          </Button>
          {busy && <span className="miniapps__readout">{copy.qr.decoding}</span>}
        </div>
        {problem !== null && <p className="miniapps__field-error">{problem}</p>}
      </Card>

      <Card className="miniapps__card miniapps__qr" title={copy.qr.text}>
        {shown === null ? (
          <p className="nx-hint">{copy.qr.empty}</p>
        ) : (
          <>
            <p className="miniapps__qr-text">{shown}</p>
            {looksLikeUrl(shown) && <p className="nx-hint">{copy.qr.urlHint}</p>}
            <div className="miniapps__row">
              <Button
                size="sm"
                onClick={() => {
                  setCopied(copyThroughSelection(shown));
                }}
              >
                {copy.actions.copy}
              </Button>
              {copied && <span className="nx-hint">{copy.actions.copied}</span>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
