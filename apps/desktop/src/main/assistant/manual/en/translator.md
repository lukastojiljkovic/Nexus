---
id: translator
title: Translator
location: { module: translator }
keywords: [translator, translate, dictionary, word, translation, phrases, serbian, english]
---
The Translator translates text between 202 languages, and it is also a Serbian–English dictionary with travel phrases — all of it works offline. The page has two tabs: "Translate" and "Words".

How to use it:

1. "Words" looks a word up in the `dictionary-sr-en` pack; the search and its hits run in the main process, and "Recent" keeps the last lookups ("Look it up again" brings one back, "Clear the list" empties the list).
2. "Travel phrases" come from the pack, by topic, in Serbian and English. A pack that carries no phrases says "This pack carries no phrases."
3. "Translate" is the first tab and opens by default. It translates on the device, with no internet. Each of the two language buttons above the text opens a list with a search field ("Search languages", which matches a name, an English name or a code), the "Recent" languages and "All languages"; the source list starts with "Detect language", which reads the language of the text and shows it as "Detected: …". "Swap languages" exchanges the two. The text is typed or pasted into "Text to translate", up to 4000 characters; the translation appears under "Translation" and starts when you pause typing. When more than one model is installed, a "Model" switch chooses between them ("600M", "1.3B" or "3.3B"); the larger models translate better and more slowly. When the target is Serbian, a "Script" switch chooses "Latin" or "Cyrillic". "Copy" copies the translation. With no model installed, the tab says "No translation model is installed yet" and points at the "Content packs" card.

Limits: the dictionary and the models live in packs, added in Settings, on the "Content packs" card; nothing is translated over the internet. Settings, on the "Translator" card, hold the "Direction on open" ("Automatic", "English → Serbian", "Serbian → English") and how many recent lookups are kept.

Related: content-packs, wiki
