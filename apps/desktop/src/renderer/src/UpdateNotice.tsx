import { useState } from "react";

import { Button, Icon } from "@nexus/ui";

import { fill, strings } from "./strings.js";
import { useNetworkMode, useUpdateState } from "./updates.js";

/**
 * ADR-089's app-wide notice that a newer version exists.
 *
 * It appears only while updates are ACTIVE — the launch came up in „updates"
 * and the stored choice is still „updates" — only when a check actually found a
 * newer release, and it downloads nothing: the Install button is the user's
 * click and the one thing that starts a download. „Kasnije" hides the notice
 * for that version only, so a later release announces itself.
 *
 * The version and the release page are here; the notes, the check button and
 * the error states live on the About card, which is where somebody who wants to
 * read rather than act will already be.
 */
export function UpdateNotice() {
  const s = strings.network;
  const mode = useNetworkMode();
  const state = useUpdateState();
  const [hiddenVersion, setHiddenVersion] = useState<string | null>(null);

  const offer = state?.offer ?? null;
  if (mode?.updatesActive !== true || offer === null) return null;
  const downloading = state?.phase === "downloading";
  if (state?.phase !== "available" && !downloading) return null;
  if (hiddenVersion === offer.version) return null;

  return (
    <div className="app__banner" role="status">
      <span className="app__banner-text">{fill(s.available, { version: offer.version })}</span>
      {offer.canInstall && (
        <Button
          size="sm"
          variant="primary"
          disabled={downloading}
          onClick={() => void window.nexus.installUpdate().catch(() => undefined)}
        >
          {downloading ? s.installing : s.install}
        </Button>
      )}
      <Button size="sm" onClick={() => void window.nexus.openReleasePage().catch(() => undefined)}>
        {s.releasePage}
      </Button>
      <Button
        size="sm"
        className="app__banner-dismiss"
        aria-label={s.later}
        onClick={() => setHiddenVersion(offer.version)}
      >
        <Icon name="close" size={14} />
      </Button>
    </div>
  );
}
