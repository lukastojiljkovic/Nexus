# Recipe converter fixtures

Small slices of the real sources, cut verbatim so the converter's tests run
against the shapes the pack is actually built from rather than against text
written to make the tests pass.

* `wikibooks-pages.json`, `sr-wikibooks-pages.json`,
  `wikibooks-category-kinds.json` — three English Cookbook pages, two Serbian
  `Kuvar:` pages, and the entries of the Cookbook's category tree those pages
  fall under. All of it is CC BY-SA 4.0, from
  `https://en.wikibooks.org/wiki/Cookbook:Beurre_Blanc`,
  `…/Cookbook:Pupusas`,
  `…/Cookbook:Bløtkake_(Norwegian_Berries_and_Cream_Cake)`,
  `https://sr.wikibooks.org/wiki/Kuvar:Bubrezi_u_umaku` and
  `https://sr.wikibooks.org/wiki/Kuvar:Mozak_s_jajima`. Each page's history
  lists its authors; the fixtures are unmodified apart from being sliced out of
  the API response.
* `beeton-slice.txt`, `farmer-slice.txt`, `gutenberg-start.txt`,
  `gutenberg-end.txt` — slices of *The Book of Household Management*
  (`https://www.gutenberg.org/ebooks/10136`) and *The Boston Cooking-School
  Cook Book* (`https://www.gutenberg.org/ebooks/65061`). Both are public domain.

The full URLs, byte counts, SHA-256 digests and the quoted licence evidence for
each source are in `../sources.json`.
