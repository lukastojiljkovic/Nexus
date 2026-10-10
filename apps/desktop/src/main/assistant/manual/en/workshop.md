---
id: workshop
title: Workshop
location: { module: workshop }
keywords: [workshop, stl, g-code, gerber, model, board, viewer]
---
The Workshop views STL models, G-code toolpaths and Gerber boards — with nothing else installed. The three viewers share one page and switch in place, so one stays loaded while another is looked at.

How to use it:

1. "Open an STL" shows the model's shape, its bounds in millimetres, its volume and its area. "Open again" changes the file.
2. "Open G-code" shows the layers, the path length, the filament and the estimated time.
3. "Open Gerber" takes the Gerber and Excellon files of one circuit; the layers stack onto the same board ("Copper, top", "Copper, bottom", "Inner copper", "Solder mask", "Silkscreen", "Paste", "Board outline", "Drill", "Other"), and you choose which are shown.
4. "Recently opened files" keeps "Paths only, never the contents"; the list is on this computer and is cleared with "Forget the list".

Limits: the model, the toolpath and the board are not written to the profile — no geometry survives a reload, and only the list of paths is kept, on this computer. The Workshop changes no file and sends nothing off the machine.

Related: drawings, lab
