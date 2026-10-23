# Fact sheet fixtures

The two NASA NSSDCA planetary fact sheets, saved verbatim as the fetch returned them on 2026-10-22:

* `planetfact.html` — https://nssdc.gsfc.nasa.gov/planetary/factsheet/ (the planetary fact sheet, metric; one column per body).
* `sunfact.html` — https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html (the Sun's sheet).

They are NASA material and are not subject to US copyright. The tests in `../fact-sheet.test.mjs` parse these files
without the network; `../fact-sheet.mjs` fetches the live pages when it regenerates the app's facts module.
