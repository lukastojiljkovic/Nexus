---
id: import-ics
title: Uvoz kalendara (.ics)
location: { module: settings, settings: data }
keywords: [uvoz, kalendar, ics, google kalendar, outlook, događaji]
---
Uvoz kalendara čita .ics fajl — izvoz iz Google kalendara, Outlooka ili bilo koje aplikacije koja ga napravi — i dodaje događaje pored onih koje već imaš.

Kako se uvozi:

1. U „Uvoz i izvoz“ otvori „Uvoz kalendara (.ics)“ i klikni „Izaberi .ics fajl…“.
2. Klikni „Prikaži pregled“ i pogledaj kolone „U fajlu“ i „Uvozi se“ za red „Događaji“.
3. Ako su neki događaji već u kalendaru, biraš „Preskoči“ ili „Uvezi svejedno“.
4. Klikni „Uvezi“. Uvoz se može opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.

Šta se ne prenosi: podsetnici (alarmi se broje i ostaju), pravilo ponavljanja koje Nexus nema (dolazi samo prvi termin, kao jednokratan događaj), vremenske zone koje ovaj računar ne poznaje (takav događaj se preskače), događaj bez naslova i sadržaj koji nije događaj (npr. VTODO). Vreme zapisano u drugoj zoni preračunava se na sat ovog računara.

Ograničenja: fajl mora biti iCalendar; ako nije, uvoz se odbija („Ovaj fajl nije iCalendar (.ics) kalendar.“). Sve što ne stigne piše, komad po komad, u pregledu pre uvoza.

Povezano: calendar, export-ics
