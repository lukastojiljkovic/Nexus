---
id: content-packs
title: Content packs
location: { module: settings, settings: data }
keywords: [pack, content, wikipedia, map, signature, installing]
---
A content pack is a folder of public content — offline Wikipedia, a map, a dataset — and Nexus accepts it only when it is signed with Nexus's own key. The content stays on this device, in a folder beside the encrypted database, and it is not part of a profile backup.

Download from the catalogue:

1. In the "Data" category open "Content packs". The "Pack catalogue" at the foot of the card lists the packs Nexus has published, grouped by kind, each with "Version", "Size", "Licence" and one of "Not installed", "Installed" or "Update available".
2. "Details" shows the "Attribution", the "Source" and the licence address before anything downloads, and "Refresh the catalogue" reads the list again.
3. Click "Download" on the pack you want. Its row then offers "Pause" and "Cancel", or "Resume" while it is paused, and the file in hand with a count of the files done ("Downloading: …" or "Installing: …"). Every file is checked against its hash while it is written, and the pack is installed when the last file is in.

A download needs the mode that allows it: in the "Privacy" category open "Network and updates", choose "Offline + update checks + downloads", then click "Save the choice" and "Restart Nexus". Nexus reads the mode when it starts, so the change takes effect at the next start; until then the card says "Downloads are off. Turn on Downloads in Privacy to download packs." in place of the catalogue, and only a pack from a folder can be installed.

Install from a folder:

1. Click "Install from a folder…".
2. Pick the folder that holds `pack.json` with its signature and the content. Nexus checks the signature and every hash first, and only then copies.
3. In "Install this pack?" check the title, the version and the size, then click "Install".

Installed packs are listed above the catalogue. Each carries "Version", "Size", "Files", "Licence", "Attribution" and "Source", with "Verify" — which reads the content again and compares it with the signed manifest ("The content was verified and matches the signed manifest.") — and "Remove", which deletes the pack's content from this device ("Your profile data is not touched."). Every installed pack's licence is listed on the "About" page too, under "Pack licences".

Limits: nothing in your profile is touched, and a pack's content stays in its own folder beside the encrypted database. A download is the only thing here that uses the network: it starts when you click "Download", and it reads only from addresses built into the app. A pack that is not signed, that needs a newer version of Nexus, that is already installed in a newer version, or that carries a path or a file the manifest does not allow is refused, with the reason. Symbolic links inside a pack are not allowed.

Related: settings-data, packs-toolkits
