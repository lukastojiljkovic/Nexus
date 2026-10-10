---
id: settings-about
title: About
location: { module: settings, settings: about }
keywords: [about, version, licences, data location]
---
The "About" category holds two cards: "About" and "Licences".

"About":

1. "Version" — which version of Nexus is installed.
2. "Electron", "Chromium" and "Node" — the versions of the runtime the app runs in.
3. "Data location" — the folder that holds this device's encrypted database.

"Licences":

1. "Libraries" — the open-source libraries. Beside each one is "Show the licence text", and beside the text "Read from" and the file it was read from.
2. "Fonts" — the drawing fonts; "The drawing fonts ship inside the app itself and are loaded from disk — none is fetched from the network."
3. Under the libraries it says that Electron carries Chromium and Node.js inside it and that their full notices ship with the app, in `LICENSES.chromium.html` beside the executable.

Limits: if a package ships no licence text, the card says so instead of inventing one ("The package names this licence in its manifest, but does not ship its text with it."). If nothing on disk establishes a licence, you read "The licence was not established from any shipped file."

Related: settings, settings-privacy
