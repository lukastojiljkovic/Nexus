---
id: scanner
title: Scanner
location: { module: scanner }
keywords: [scanner, ocr, text from an image, camera, clipboard, note]
---
The Scanner reads text off an image or the camera and hands it to a note — all on this computer, with no internet.

How to use it:

1. The picture arrives in one of three ways: from a chosen file, pasted from the clipboard (Ctrl+V), or as one frame from the camera.
2. The crop and the orientation are set on the picture; the contrast step helps the reading and never changes what is stored.
3. The recognition runs off the main thread, so the page stays responsive; a progress bar shows while it runs.
4. The text that was read is copied or written into a note. The picture can go into the note as well — the framed photograph, cropped and rotated the way it was framed, not the processed copy the engine read.

Limits: the page keeps no list of past scans — a scan is an act, and its two outcomes are the clipboard and a note the user asked for. The camera is asked for by this app, and only while a scan is taken.

Related: notes-markdown, content-packs
