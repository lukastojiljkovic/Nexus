import { Button, Icon } from "@nexus/ui";
import { strings } from "./strings.js";
import { discardUnsavedExit, retryUnsavedExit, useUnsavedExits } from "./unsavedExits.js";

/**
 * The shell's word on writes that failed after their page was gone
 * (`unsavedExits.ts`, DC-148): one banner each, above whatever page is open, for
 * the active profile only. `role="alert"` because it arrives while the user is
 * somewhere else and says an edit is not on disk.
 */
export function UnsavedExitBanners({ profileId }: { profileId: string | null }) {
  const exits = useUnsavedExits(profileId);
  if (exits.length === 0) return null;
  const s = strings.app.unsavedExit;

  return (
    <>
      {exits.map((exit) => (
        <div key={exit.id} className="app__banner" role="alert">
          <span className="app__banner-text">{exit.message}</span>
          {exit.retryFailed && <span className="app__banner-error">{s.retryFailed}</span>}
          {exit.retryable && (
            <Button
              size="sm"
              variant="primary"
              disabled={exit.retrying}
              onClick={() => void retryUnsavedExit(exit.id)}
            >
              {s.retry}
            </Button>
          )}
          <Button
            size="sm"
            className="app__banner-dismiss"
            aria-label={s.dismiss}
            onClick={() => discardUnsavedExit(exit.id)}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      ))}
    </>
  );
}
