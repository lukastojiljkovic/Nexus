import { join } from "node:path";

import { packPathProblem } from "../../../main/packs/paths.js";
import { packVersionDir, readInstalled } from "../../../main/packs/registry.js";
import { readFileBounded } from "../../../main/boundedRead.js";
import type { GalleryArtView } from "../shared/ipc.js";

const MAX_ART_JSON_BYTES = 33_554_432;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed.length <= max ? trimmed : null;
}

export async function readArt(
  userData: string,
  publicKeyPem: string,
): Promise<{ works: GalleryArtView[]; skipped: string[] }> {
  const works: GalleryArtView[] = [];
  const skipped: string[] = [];
  for (const installed of readInstalled(userData, publicKeyPem)) {
    if (installed.manifest.kind !== "dataset") continue;
    const declared = installed.manifest.files.find((file) => file.path === "art.json");
    if (declared === undefined || declared.size > MAX_ART_JSON_BYTES) continue;
    const directory = packVersionDir(userData, installed.manifest.id, installed.manifest.version);
    const read = await readFileBounded(join(directory, "art.json"), MAX_ART_JSON_BYTES);
    if (read.status !== "ok") {
      skipped.push(installed.manifest.id);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes));
    } catch {
      skipped.push(installed.manifest.id);
      continue;
    }
    const document = record(value);
    if (document?.layout !== 1 || !Array.isArray(document.works)) {
      skipped.push(installed.manifest.id);
      continue;
    }
    const carried = new Set(installed.manifest.files.map((file) => file.path));
    const before = works.length;
    try {
      for (const [index, raw] of document.works.entries()) {
        const row = record(raw);
        if (row === null) throw new Error(`works[${String(index)}]`);
        const id = text(row.id, 200);
        const title = text(row.title, 300);
        const artist = text(row.artist, 300);
        const date = text(row.date, 100);
        const museum = text(row.museum, 300);
        const credit = text(row.credit);
        const licence = text(row.licence, 200);
        const image = text(row.image, 240);
        const width = row.width;
        const height = row.height;
        if (
          id === null ||
          title === null ||
          artist === null ||
          date === null ||
          museum === null ||
          credit === null ||
          licence === null ||
          image === null ||
          packPathProblem(image) !== null ||
          !carried.has(image) ||
          typeof width !== "number" ||
          typeof height !== "number" ||
          width <= 0 ||
          height <= 0
        ) {
          throw new Error(`works[${String(index)}]`);
        }
        works.push({
          id,
          title,
          artist,
          date,
          medium: text(row.medium, 200),
          museum,
          credit,
          licence,
          packId: installed.manifest.id,
          image: `nx-pack://${installed.manifest.id}/${image}`,
          width,
          height,
        });
      }
    } catch {
      works.length = before;
      skipped.push(installed.manifest.id);
    }
  }
  return { works, skipped };
}
