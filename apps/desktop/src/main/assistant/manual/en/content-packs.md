---
id: content-packs
title: Content packs
location: { module: settings, settings: data }
keywords: [pack, content, wikipedia, map, signature, installing]
---
A content pack is a folder of public content — offline Wikipedia, a map, a dataset — and Nexus accepts it only when it is signed with Nexus's own key. The content stays on this device, in a folder beside the encrypted database, and it is not part of a profile backup.

How to install one:

1. In the "Data" category open "Content packs" and click "Install from a folder…".
2. Pick the folder that holds `pack.json` with its signature and the content. Nexus checks the signature and every hash first, and only then copies.
3. In "Install this pack?" check the title, the version and the size, then click "Install".

A pack carries "Version", "Size", "Files", "Licence", "Attribution" and "Source". "Verify" reads the content again and compares it with the signed manifest ("The content was verified and matches the signed manifest."), and "Remove" deletes the pack's content from this device ("Your profile data is not touched.").

Limits: nothing is sent to the internet and nothing in your profile is touched. A pack that is not signed, that needs a newer version of Nexus, that is already installed in a newer version, or that carries a path or a file the manifest does not allow is refused, with the reason. Symbolic links inside a pack are not allowed.

Related: settings-data, packs-toolkits
