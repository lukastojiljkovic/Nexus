# The content packs

**The index of `docs/packs/`.** A **content pack** is a signed folder a user
installs into Nexus — public knowledge, reference works, models or maps, each
carrying its own licence, source and attribution (ADR-091, ADR-103). The app
itself ships Apache-2.0 (`LICENSE`); a pack carries whatever licence its sources
require, and the pack folder states it.

This directory holds one page per **builder**, and those pages are the
authority: what the pack is allowed to contain, the licence of every source,
the measured size of the last build, how to rebuild it, and the checks that
stop the build instead of producing a pack somebody would have to notice was
wrong. Nothing here is a summary of an upstream source; it is the builder's own
record, written beside the code in `scripts/packs/`.

| Pack page | Pack ids and kind | Licence | Builder | What it feeds |
| --- | --- | --- | --- | --- |
| [art.md](art.md) | `art-open-access` *(dataset)* | per work: CC0-1.0, PDM-1.0 or PD-Art | `scripts/packs/art/build.mjs` | Culture and Gallery — the offline art collection |
| [car-help.md](car-help.md) | `car-help` *(content)* | US federal and US Army material, no copyright | `scripts/packs/car-help/build.mjs` | the Reader, for the Car module |
| [collections.md](collections.md) | `collections-wikidata` *(dataset)* | CC0-1.0 | `scripts/packs/collections/build.mjs` | Library — twenty-five suggested collections |
| [dictionary.md](dictionary.md) | `dictionary-sr-en` *(dataset)* | CC BY-SA 4.0 | `scripts/packs/dictionary/build.mjs` | Translator — words and the Wikivoyage phrasebook |
| [foods-usda.md](foods-usda.md) | `foods-usda` *(dataset)* | CC0 (USDA FoodData Central) | `scripts/packs/foods/build.mjs` | Cookbook — per-100 g nutrition |
| [libredwg.md](libredwg.md) | `libredwg` *(tool)* | GPL-3.0-or-later | `scripts/packs/libredwg/build.mjs` | Drawings — DWG to DXF, as a child process |
| [make.md](make.md) | `make-by-hand` *(content)* | public domain, plus three CC BY-SA 4.0 pages | `scripts/packs/make/build.mjs` | the Reader — mending and making by hand |
| [nllb.md](nllb.md) | `nllb-600m`, `nllb-1300m`, `nllb-3300m` *(model)* | CC BY-NC 4.0 (NLLB-200, Meta AI) | `scripts/packs/nllb/build.mjs` | Translator — text translation |
| [nonograms-pictures.md](nonograms-pictures.md) | `nonograms-pictures` *(dataset)* | CC BY 3.0 (game-icons.net) | `scripts/packs/nonograms/build.mjs` | Games — the pictures the nonogram puzzles reveal |
| [planet-textures.md](planet-textures.md) | `planet-textures` *(dataset)* | CC BY 4.0 (Solar System Scope), NASA material not subject to US copyright | `scripts/packs/planet-textures/build.mjs` | Astronomy — the 3D solar system's maps |
| [recipes-world.md](recipes-world.md) | `recipes-world` *(dataset)* | CC BY-SA 4.0 (Wikibooks) and public-domain books | `scripts/packs/recipes/build.mjs` | Cookbook — world and historical recipes |
| [reference.md](reference.md) | `reference-en`, `reference-sr` *(content)* | CC BY-SA 4.0 and public-domain texts | `scripts/packs/reference/build.mjs` | the Reader — charters, constitutions, laws ([reference-en.md](reference-en.md), [reference-sr.md](reference-sr.md)) |
| [stockfish.md](stockfish.md) | `stockfish` *(tool)* | GPL-3.0 | `scripts/packs/stockfish/build.mjs` | Chess — the engine, spoken to over UCI |
| [survival.md](survival.md) | `survival` *(content)* | US federal material, no copyright | `scripts/packs/survival/build.mjs` | the Reader — survival craft, first aid, disasters |
| [survival-food.md](survival-food.md) | `survival-food` *(content)*, `recipes-preserving` *(dataset)* | US federal material; public-domain scans | `scripts/packs/survival-food/` | the Reader, and Cookbook |
| [tales.md](tales.md) | `tales-sr`, `tales-en` *(content)* | public domain | `scripts/packs/tales/build.mjs` | the Reader — folk tales |
| [tessdata.md](tessdata.md) | `tessdata-fast` *(model)* | Apache-2.0 | `scripts/packs/tessdata/build.mjs` | Scanner — the text-recognition models |
| [voice.md](voice.md) | `whisper-tiny`, `whisper-base`, `whisper-small` *(model)*, `mms-tts-eng` *(model)* | Apache-2.0 (Whisper), CC BY-NC 4.0 (the TTS voice) | `scripts/packs/voice/build.mjs` | the Assistant — speech to text, and one voice |

## How a pack reaches a user

Every pack is built by one of the scripts above, signed by the maintainer with
`scripts/pack-sign.mjs` and the release key (the builder never sees the key),
and installed either from the **catalogue** in Settings → Content packs or from
a folder the user points at. Signing and installation are the same for all of
them; what differs is only what each page records about its sources.

Settings → Privacy → Network and updates decides whether a download is possible
at all: **Offline only** and **Offline + update checks** cannot fetch a pack,
and **Downloads** (ADR-092) permits it from a short, compiled-in list of hosts.
A pack installed from a disk needs no network at any point.
