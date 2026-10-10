---
id: workshop
title: Radionica
location: { module: workshop }
keywords: [radionica, stl, g-kod, gerber, model, ploča, pregled]
---
Radionica pregleda STL modele, G-kod i Gerber ploče — bez ijednog dodatnog programa. Tri pregledača su na jednoj stranici i prebacuju se u mestu, pa se jedan zadrži dok se drugi gleda.

Kako se koristi:

1. „Otvori STL“ prikazuje oblik modela, granice u milimetrima, zapreminu i površinu. „Otvori ponovo“ menja datoteku.
2. „Otvori G-kod“ prikazuje slojeve, dužinu putanje, filament i procenu vremena.
3. „Otvori Gerber“ prima Gerber i Excellon datoteke jednog kola; slojevi se slažu na istu ploču („Bakar, gornji“, „Bakar, donji“, „Unutrašnji bakar“, „Zaštitni sloj“, „Sitotisak“, „Pasta“, „Kontura ploče“, „Bušenje“, „Ostalo“), pa se bira koji se vide.
4. „Nedavno otvorene datoteke“ pamti „Samo putanje, nikad sadržaj“; lista je na ovom računaru i briše se dugmetom „Zaboravi listu“.

Ograničenja: model, putanja i ploča se ne upisuju u profil — ništa od geometrije ne preživi ponovno otvaranje stranice, a pamti se samo spisak putanja, i on na ovom računaru. Radionica ne menja datoteke i ništa ne šalje sa računara.

Povezano: drawings, lab
