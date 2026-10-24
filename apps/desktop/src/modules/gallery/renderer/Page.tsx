import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  LoadingState,
  PageHeader,
  Select,
  TextArea,
  TextField,
} from "@nexus/ui";

import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { activeLocale, collator, declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type {
  GalleryArtView,
  GalleryPersonalView,
  GalleryView,
  GalleryZimImageView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  countText,
  filterGallery,
  galleryTags,
  type GalleryDisplayImage,
  type GallerySource,
} from "./gallery.js";
import "./gallery.css";

function personalImage(item: GalleryPersonalView): GalleryDisplayImage {
  return {
    key: `personal:${item.id}`,
    id: item.id,
    source: "personal",
    title: item.title,
    tags: item.tags,
    notes: item.notes,
    image: `nx-blob://${item.thumbnailSha256}`,
    fullImage: `nx-blob://${item.sha256}`,
    credit: null,
    licence: null,
    width: item.width,
    height: item.height,
    personal: item,
  };
}

function artImage(item: GalleryArtView): GalleryDisplayImage {
  return {
    key: `art:${item.packId}:${item.id}`,
    id: item.id,
    source: "art",
    title: item.title,
    tags: [item.artist],
    notes: [item.artist, item.date, item.medium ?? ""].filter(Boolean).join(" · "),
    image: item.image,
    fullImage: item.image,
    credit: item.credit,
    licence: item.licence,
    width: item.width,
    height: item.height,
    personal: null,
  };
}

function zimImage(item: GalleryZimImageView): GalleryDisplayImage {
  return {
    key: `zim:${item.libraryId}:${item.zimPath}`,
    id: `${item.libraryId}:${item.zimPath}`,
    source: "zim",
    title: item.title,
    tags: [item.libraryTitle],
    notes: item.libraryTitle,
    image: item.image,
    fullImage: item.image,
    credit: item.libraryTitle,
    licence: null,
    width: null,
    height: null,
    personal: null,
  };
}

export default function GalleryPage({ profileId }: ModulePageProps) {
  const locale = activeLocale();
  const [view, setView] = useState<GalleryView | null>(null);
  const [zim, setZim] = useState<readonly GalleryZimImageView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<GallerySource | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [open, setOpen] = useState<GalleryDisplayImage | null>(null);
  const [editing, setEditing] = useState<GalleryDisplayImage | null>(null);
  const [deleting, setDeleting] = useState<GalleryDisplayImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanCursor, setScanCursor] = useState<Record<string, number>>({});
  const [scanDone, setScanDone] = useState<Record<string, boolean>>({});
  const scanCancelled = useRef(false);
  const [libraryId, setLibraryId] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.gallery.list({ profileId }));
      setError(null);
    } catch (error) {
      setError(copy.errors.load);
      console.error("Nexus: the gallery could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const images = useMemo(
    () => [
      ...(view?.personal.map(personalImage) ?? []),
      ...(view?.art.map(artImage) ?? []),
      ...zim.map(zimImage),
    ],
    [view, zim],
  );
  const tags = useMemo(() => galleryTags(images, collator({}, locale).compare), [images, locale]);
  const shown = useMemo(
    () => filterGallery(images, { query, source, tag }),
    [images, query, source, tag],
  );

  async function importFiles(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        setView(
          await window.nexus.modules.gallery.importImage({
            profileId,
            fileName: file.name,
            title: file.name.replace(/\.[^.]+$/, ""),
            notes: "",
            tags: [],
            bytes,
          }),
        );
      }
    } catch (error) {
      setError(copy.import.failed);
      console.error("Nexus: gallery images could not be imported:", error);
    } finally {
      setBusy(false);
    }
  }

  async function scanLibrary(): Promise<void> {
    if (libraryId === "") return;
    if (scanning) {
      scanCancelled.current = true;
      return;
    }
    setScanning(true);
    setError(null);
    scanCancelled.current = false;
    try {
      let afterIndex = scanCursor[libraryId] ?? 0;
      const found: GalleryZimImageView[] = [];
      for (let page = 0; page < 10 && !scanCancelled.current; page += 1) {
        const answer = await window.nexus.modules.gallery.scanZim({
          profileId,
          libraryId,
          afterIndex,
        });
        found.push(...answer.images);
        afterIndex = answer.nextIndex;
        setScanCursor((current) => ({ ...current, [libraryId]: answer.nextIndex }));
        if (answer.done) {
          setScanDone((current) => ({ ...current, [libraryId]: true }));
          break;
        }
      }
      setZim((current) => {
        const seen = new Set(current.map((entry) => entry.image));
        return [...current, ...found.filter((entry) => !seen.has(entry.image))];
      });
    } catch (error) {
      setError(copy.errors.scan);
      console.error("Nexus: Reference images could not be loaded:", error);
    } finally {
      setScanning(false);
    }
  }

  async function remove(image: GalleryDisplayImage): Promise<void> {
    setDeleting(null);
    if (image.source !== "personal") return;
    try {
      setView(await window.nexus.modules.gallery.remove({ profileId, id: image.id }));
      setOpen(null);
      setError(null);
    } catch (error) {
      setError(copy.errors.mutate);
      console.error("Nexus: the gallery image could not be removed:", error);
    }
  }

  return (
    <div className="gallery nx-measure">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="image"
        actions={
          <label className="gallery__file-button">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              disabled={busy}
              onChange={(event) => {
                void importFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {copy.actions.import}
          </label>
        }
      />
      {error !== null && <p className="gallery__error" role="alert">{error}</p>}
      <Card title={copy.filters.search}>
        <div className="gallery__filters">
          <TextField
            label={copy.filters.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            label={copy.filters.source}
            value={source ?? ""}
            onChange={(event) => setSource(event.target.value === "" ? null : event.target.value as GallerySource)}
          >
            <option value="">{copy.filters.all}</option>
            <option value="personal">{copy.filters.personal}</option>
            <option value="art">{copy.filters.art}</option>
            <option value="zim">{copy.filters.zim}</option>
          </Select>
          <Select
            label={copy.filters.tag}
            value={tag ?? ""}
            onChange={(event) => setTag(event.target.value === "" ? null : event.target.value)}
          >
            <option value="">{copy.filters.allTags}</option>
            {tags.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </Select>
        </div>
        {view !== null && view.zimLibraries.length > 0 && (
          <div className="gallery__reference">
            <Select
              label={copy.sources.zim}
              value={libraryId}
              onChange={(event) => setLibraryId(event.target.value)}
            >
              <option value="">—</option>
              {view.zimLibraries.map((library) => (
                <option key={library.id} value={library.id}>{library.title}</option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={busy || libraryId === "" || scanDone[libraryId] === true}
              onClick={() => void scanLibrary()}
            >
              {scanning
                ? copy.actions.cancelScan
                : (scanCursor[libraryId] ?? 0) > 0
                  ? copy.actions.scanMore
                  : copy.actions.scan}
            </Button>
            {scanning && (
              <span className="nx-hint" role="status">
                {countText(copy.scan.progress, zim.length)}
              </span>
            )}
            {!scanning && libraryId !== "" && scanDone[libraryId] === true && (
              <span className="nx-hint">{copy.scan.complete}</span>
            )}
            {!scanning && libraryId !== "" && (scanCursor[libraryId] ?? 0) > 0 && scanDone[libraryId] !== true && (
              <span className="nx-hint">{countText(copy.scan.partial, zim.length)}</span>
            )}
          </div>
        )}
        {view === null ? (
          <LoadingState label={copy.page.loading} rows={3} />
        ) : images.length === 0 ? (
          <EmptyState title={copy.empty.title} description={copy.empty.body} />
        ) : shown.length === 0 ? (
          <EmptyState title={copy.empty.noResults} />
        ) : (
          <div className="gallery__grid">
            {shown.map((image) => (
              <button
                key={image.key}
                type="button"
                className="gallery__tile"
                onClick={() => setOpen(image)}
              >
                <img src={image.image} alt={image.title} loading="lazy" />
                <span className="gallery__tile-title">{image.title}</span>
                <span className="gallery__source">{copy.sources[image.source]}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {open !== null && (
        <Dialog
          title={open.title}
          onClose={() => setOpen(null)}
          actions={
            open.personal === null ? (
              <Button onClick={() => setOpen(null)}>{copy.actions.close}</Button>
            ) : (
              <>
                <Button
                  onClick={() => {
                    setEditing(open);
                    setOpen(null);
                  }}
                >
                  {copy.actions.edit}
                </Button>
                <Button variant="danger" onClick={() => setDeleting(open)}>{copy.actions.delete}</Button>
              </>
            )
          }
        >
          <img className="gallery__viewer" src={open.fullImage} alt={open.title} />
          {open.credit !== null && (
            <p className="nx-hint"><strong>{copy.viewer.credit}:</strong> {open.credit}</p>
          )}
          {open.licence !== null && (
            <p className="nx-hint"><strong>{copy.viewer.licence}:</strong> {open.licence}</p>
          )}
          {open.notes !== "" && (
            <p className="nx-hint"><strong>{copy.viewer.notes}:</strong> {open.notes}</p>
          )}
          {open.width !== null && open.height !== null && (
            <p className="nx-hint">{copy.viewer.dimensions}: {open.width} × {open.height}</p>
          )}
        </Dialog>
      )}

      {awaitEdit(editing, () => setEditing(null), async (values) => {
        if (editing === null || editing.personal === null) return;
        try {
          setView(await window.nexus.modules.gallery.update({ profileId, id: editing.id, ...values }));
          setEditing(null);
          setOpen(null);
        } catch (error) {
          setError(copy.errors.mutate);
          console.error("Nexus: the gallery image could not be updated:", error);
        }
      })}
      {deleting !== null && (
        <ConfirmDialog
          title={copy.actions.delete}
          name={deleting.title}
          question={copy.actions.delete}
          confirmLabel={copy.actions.delete}
          cancelLabel={copy.actions.cancel}
          destructive
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

interface EditValues {
  readonly title: string;
  readonly notes: string;
  readonly tags: readonly string[];
}

function awaitEdit(
  editing: GalleryDisplayImage | null,
  onClose: () => void,
  onSave: (values: EditValues) => Promise<void>,
) {
  if (editing === null) return null;
  return <GalleryEditDialog image={editing} onClose={onClose} onSave={onSave} />;
}

function GalleryEditDialog({
  image,
  onClose,
  onSave,
}: {
  image: GalleryDisplayImage;
  onClose: () => void;
  onSave: (values: EditValues) => Promise<void>;
}) {
  const [title, setTitle] = useState(image.title);
  const [notes, setNotes] = useState(image.notes);
  const [tags, setTags] = useState(image.tags.join(", "));
  return (
    <Dialog
      title={copy.import.title}
      onClose={onClose}
      actions={
        <Button onClick={onClose} variant="quiet">
          {copy.actions.cancel}
        </Button>
      }
    >
      <TextField label={copy.import.title} value={title} onChange={(event) => setTitle(event.target.value)} />
      <TextField label={copy.import.tags} value={tags} onChange={(event) => setTags(event.target.value)} />
      <TextArea label={copy.import.notes} value={notes} onChange={(event) => setNotes(event.target.value)} />
      <Button
        onClick={() => void onSave({
          title: title.trim() || image.title,
          notes,
          tags: tags.split(",").map((entry) => entry.trim()).filter(Boolean),
        })}
      >
        {copy.actions.save}
      </Button>
    </Dialog>
  );
}
