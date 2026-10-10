# Fixtures

Small slices of the real sources, cut by
`node scripts/packs/car-help/build.mjs --fixtures` (which reads the cache in
`%TEMP%\nexus-pack-cache\car-help\`). They are the only content this pack
commits to the repository: the pack itself is written to `%TEMP%` and signed
later.

Every byte below is a public-domain US Government work (17 U.S.C. 105(a)); see
`../sources.json` for the digests and the licence evidence.

| File | Where it came from | What it is |
| --- | --- | --- |
| `fm-21-305-17-4.json` | FM 21-305 / AFMAN 24-306 (1993), page 17-4, leaf 91 of the Internet Archive's DjVu XML | that page's lines as the OCR's own extractor grouped them — each line's text and the box it occupies — so the normaliser, the furniture rule, the corrections table and the block builder are all the code under test |
| `nhtsa-tires-blowouts.html` | NHTSA, "Tires" (TireWise), snapshot 2024-12-31; the `Tire Blowouts` section of the page's article element | headings, paragraphs and a list, and the byte slice the tokeniser reads |
| `nhtsa-tires-pressure.html` | the same page's `Maintaining Proper Tire Pressure` section | an `h2`, an `h4` and a five-item list |
| `ready-car-kit.html` | Ready.gov, "Car Safety", snapshot 2024-12-31; `Emergency Kit for the Car` through `Prepare Your Car for Emergencies` | two lists, and the hidden `Image` label the converter has to drop |

`fm-21-305-17-4.json` is the raw page, NOT the normalised one: the test feeds it
through `normalisePage` itself, so the four corrections the table makes to that
page are applied by the code the build runs, not by the fixture.
