# Fixtures

Each file here is a few kilobytes cut from a real source, by
`node scripts/packs/make/build.mjs --fixtures`. They are the data
`convert.test.mjs` and `fidelity.test.mjs` run against, and they are cut rather
than typed so that what the tests assert is the source's own text.

| Fixture | Cut from | Licence | Cut |
|---|---|---|---|
| `carpentry-chapter-ii.html` | Project Gutenberg ebook 20763, *Carpentry for Boys* by J. S. Zerbe (New York Book Company, 1914), the HTML edition, from the `CHAPTER II` heading to the last whole paragraph before `CHAPTER III` | Public domain in the USA (Project Gutenberg's own rights statement for the ebook) | 11,651 bytes, 32 items, 7 captioned figures |
| `abcs-of-mending.txt` | Internet Archive OCR text layer of US Department of Agriculture Farmers' Bulletin No. 1925, *ABC's of Mending* (1942), the first whole paragraphs | Public domain — a work of the U.S. Government, not subject to copyright in the United States (17 U.S.C. 105(a)) | 5,930 bytes, 38 blocks |
| `candlemaking.wikitext` | Wikibooks, *Adventist Youth Honors Answer Book/Arts and Crafts/Candlemaking*, the page's own wikitext, the first whole sections | CC BY-SA 4.0 and the GNU Free Documentation License | 3,181 bytes, 7 blocks |

The full source of each — its URL, size, SHA-256, licence and the sentence that
licence was read from — is in `../sources.json`, and the licence basis of each
one is worked through in `docs/packs/make.md`.

The HTML fixture is cut at an element boundary (the last whole `</p>`), the OCR
one at a blank line, and the wikitext one at a blank line, so no fixture ends
inside a construct the source never left open. The cut is reproducible: deleting
a fixture and re-running `--fixtures` writes the same bytes.
