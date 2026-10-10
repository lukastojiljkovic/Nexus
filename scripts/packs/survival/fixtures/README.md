# Fixtures for the Survival pack's converter

Five files, 59 KB together, cut from the real sources of the `survival` pack so
the converter's tests read what the build reads instead of a 26-megabyte
manual. They are cut by `node scripts/packs/survival/build.mjs --fixtures`, which
extracts them from the cached sources, so a fixture is the source's own data and
never a hand-typed sample.

A page fixture is the page's RAW text runs (with their positions and sizes) and
the placement of its embedded images, so the test that reads it runs the
normaliser itself. The figure PNGs are the crops the build makes, at 200 pixels
wide. Each file is a quotation under the licence of the source it comes from,
which is public domain (work of the U.S. Government, 17 U.S.C. 105(a)); the
sentence each licence was read from is in [`../sources.json`](../sources.json).

| File | Source | What it is | SHA-256 |
| --- | --- | --- | --- |
| `atp-3-50-21-p24.json` | ATP 3-50.21, Survival (2018), PDF page 24 (printed page 2-6) | the page's text runs, image placements, size and rotation | `ab4248bff37a41509a572e1eed9acb0d742ed7d0d7fbd65a5cd94b71d37f9170` |
| `atp-3-50-21-p24-figure.png` | the same page | "Figure 2-1. Jaw Thrust Method", cropped from the page render at 200 px wide | `e5eaf2aac0f48d42e684feb73a96554e7cbb161c412134635e5a85a3c423b7f6` |
| `fm-21-76-p372.json` | FM 21-76, Survival (5 June 1992), PDF page 372 (printed page B-8) | the page's text runs, image placements, size and rotation | `6780a3c19c6cb85dec50a08107d1ed614298f6d01dcde8bb764e25a6606d8735` |
| `fm-21-76-p372-figure.png` | the same page | the Asparagus illustration, cropped from the page render at 200 px wide | `3dff90618f486786038dfc2960774a92e4d305746b40a55fa5e04d24b2ee2cc9` |
| `foodsafety-temperatures.html` | FoodSafety.gov, Safe Minimum Internal Temperatures (page reviewed 21 November 2024) | the page's own `<article>` element, verbatim | `cea837d9fc2943f1754136ec118db68f067383b9b02866c4331da2e5731d3301` |

## Why these four pages

Each page carries a case the converter has to get right, and each case is the
source's own:

* **ATP 3-50.21 page 2-6** has a figure whose caption is printed UNDER it
  ("Figure 2-1. Jaw Thrust Method"), two bulleted lists whose bullet arrives as
  the Symbol font's `z`, a wrapped list item, an all-caps section heading
  ("DIRECT PRESSURE") set a fifth larger than the body, and eight embedded
  images of which seven are 21.5-by-8.6-point change bars in the margin. Its
  running head and footer are the two pieces of furniture the normaliser drops.
* **FM 21-76 page B-8** is a plant entry: the illustration is printed ABOVE the
  text, the entry name is a size larger than the body, the fields
  (`Description:` and the rest) are at body size, and the page label `B-8` sits
  25 points above the bottom edge â€” which is why the normaliser's bottom band is
  smaller than its top one.
* **The FoodSafety.gov page** has a 17-row table with a header row and a cell
  that spans two rows, an image nested inside the article element, and text
  after the table. Its whole text is the comparison the HTML converter is
  measured against: one word lost, and the test says so.
