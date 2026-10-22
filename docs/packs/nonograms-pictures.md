# The `nonograms-pictures` pack

**A `dataset` pack: real pictures, rasterised to 10, 15 and 20 cell grids, for the
nonogram puzzles.** The game draws its hidden picture from it instead of noise: a
cat, a castle, a ship, which the player uncovers cell by cell.

The pack is one file of puzzles, `nonograms.json`, plus the attribution that
CC BY 3.0 requires. Nothing in it is executed: it is JSON and text.

## In the app

With the pack installed, Puzzles plays its pictures. A new nonogram at 10 × 10, 15 × 15 or
20 × 20 is dealt one of the pack's pictures of that size, chosen by the game's seed and never
the one just played. A 5 × 5 board, and any size the pack has no picture for, stays random.
No setting turns this on or off: the pictures come with the pack.

A game keeps its picture by id, so a later version of the pack that reorders or adds pictures
does not change a board already in progress. If a saved picture is no longer in the pack, the
game shows a short notice and a New game button, and no random board takes its place.

Without the pack, a line under each 10 to 20 board names the pack and where to install it, on
the Content packs card in Settings.

When a picture is solved, the solved line gives its title in the app's language, and a credit
line gives its author, game-icons.net and CC BY 3.0. The licence requires that credit, so it
is shown whenever the picture is.

## What it contains

**119 puzzles**, from the 119 pictures this build has titles for and that
pass both checks below. Counts by grid side, from the last run:

| Grid | Puzzles |
| --- | --- |
| 10 × 10 | 105 |
| 15 × 15 | 8 |
| 20 × 20 | 6 |

**Measured size: 79 828 bytes in 3 files** — `nonograms.json` 59 784 bytes,
`LICENSE-CC-BY-3.0.txt` 19 467 bytes, `ATTRIBUTION.txt` 577 bytes. The metadata
file `nonograms-pictures.meta.json` sits beside the folder and is not counted.

Each entry of `nonograms.json`:

```json
{
  "id": "10-lorc-cat",
  "size": 10,
  "rows": ["..........", ".....#..#.", "..."],
  "title": { "en": "Cat", "sr": "Mačka" },
  "author": "Lorc",
  "source": "icons-master/lorc/cat.svg"
}
```

`rows` has `size` strings of `size` characters, `1` for a filled cell. Both titles
are written by hand in [`titles.json`](../../scripts/packs/nonograms/titles.json),
the Serbian one in Latin script; an icon without an entry there is not selected.

## How a picture becomes a puzzle

1. **The background is removed.** Every icon in the repository draws a rectangle
   covering its whole viewBox before the silhouette. It is removed by its
   geometry: a path whose data is exactly the viewBox's own rectangle. Every one of
   the 4 050 icons that were judged had it, and the builder counts the removals in
   every run (one per titled icon).
2. **The silhouette is rasterised** at 16 pixels per cell along each side, and a
   cell is filled where the icon covers at least half of its pixels.
3. **Two checks decide whether a grid is kept.**
   - *Fill.* The share of filled cells must lie between 20 % and 50 %.
   - *Uniqueness.* `solveNonogramLines` from `@nexus/core`, the solver the game
     plays with, must solve the grid completely from the clues of its rows and
     columns. A grid it cannot finish is dropped: either its clues allow more than
     one picture, or finding the one they allow takes guessing.
4. **Selection.** Per size, authors take turns in folder order, so one prolific
     folder cannot fill a size; a picture whose name stem is already used, at any
     size, is skipped (`castle` and `castle-tower` do not both ship). The cap is 120
     per size, and it was not reached: the titles are the limit.

### Why these fill bounds

They are judgement calls, and the builder names them as constants. Below 20 % a
grid is a scatter of cells that does not read as a picture. Above 50 % most cells
are filled, and the empty cells, which are what the player has to find out, become
the minority. The bounds are not fitted to the data; the distribution of the grids
the solver finishes is given for reference, from the exploration run over all
4 050 icons: at 10 × 10 the median fill is 0.32, and the 10th and 90th percentiles
are 0.14 and 0.48.

### What the solver proves

That a grid is solvable by line propagation alone, with the same logic the game
uses to check a player's solution. Every cell propagation sets is forced by the
clues, so a grid it completes is the only picture they allow, and one the player
can finish by reasoning, without guessing.

## What it does not contain, and why

**The untitled CC BY icons.** Of the 4 050 judged, 1 627 pass the checks at 10 × 10,
1 359 at 15 × 15 and 1 123 at 20 × 20. The pack is limited by the titles, not by
the pictures: adding a picture means writing its titles in `titles.json`, and the
builder then judges it.

**Icons under CC0.** Two contributors in the repository's `license.txt` are marked
CC0: Viscious Speed (121 icons) and Zeromancer (2). They are left out, so every
picture in the pack is under one licence, CC BY 3.0, and the attribution is
complete.

**Folders with no named contributor.** `badges` (59 icons) and `various-artists`
(2) name no author in the licence file, and so they cannot be attributed. The
folder `lucasms` (5 icons) is also left out: the licence file names its contributor
"Lucas", and the folder name does not match it.

In total, 189 of the 4 239 SVG files in the archive are excluded for these reasons,
and 4 050 are judged.

## Sources and licence

**game-icons.net, CC BY 3.0.** The repository `https://github.com/game-icons/icons`
states in its `license.txt`:

> Icons provided under the Creative Commons 3.0 BY or CC0 if mentioned below.

The licence sentence is the one `build.mjs` checks for in the archive before it
builds anything. The attribution, which the licence requires, travels in three
places: `ATTRIBUTION.txt` (every contributor whose icon is in the pack, the licence
URL, and the change made), the licence text itself in `LICENSE-CC-BY-3.0.txt`
(fetched from `https://creativecommons.org/licenses/by/3.0/legalcode.txt`), and
the pack manifest's `licence.attribution`, which `pack-sign.mjs` writes into the
signed `pack.json`.

The archive is read once and cached. Its SHA-256 is recorded in
[`sources.json`](../../scripts/packs/nonograms/sources.json), and a run whose archive
differs refuses until it is re-run with `--update-sources` on purpose.

## How to rebuild it

```sh
node scripts/packs/nonograms/build.mjs
```

It reads the archive from `~\.nexus-pack-cache\nonograms\master.zip`, judges
every titled icon at each size, and writes the pack folder to
`~\.nexus-packs\nonograms-pictures\` with the metadata file beside it. The fetch
report says what came from the cache. A run on the cached archive takes about
1.4 s; the first judging of all 4 050 icons at every size took about 50 s, and that
run is not part of the builder.

Sign it with:

```sh
node scripts/pack-sign.mjs --dir ~\.nexus-packs\nonograms-pictures --meta ~\.nexus-packs\nonograms-pictures.meta.json --key <release-key.pem>
```

The minimum app version is `2.5.0`, as the brief for this pack fixes it.
