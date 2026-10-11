---
id: import-csv
title: Uvoz zadataka (.csv)
location: { module: settings, settings: data }
keywords: [uvoz, csv, zadaci, mapiranje, kolone, lista]
---
Uvoz zadataka čita CSV tabelu — izvoz iz drugog alata ili ručno vođen spisak — i pravi zadatke. Ti kažeš koja kolona je šta, a svi zadaci ulaze u jednu listu koju izabereš.

Kako se uvozi:

1. U „Uvoz i izvoz“ otvori „Uvoz zadataka (.csv)“ i klikni „Izaberi .csv fajl…“.
2. U „Mapiranje kolona“ odredi „Ulogu kolone“ za svaku kolonu: „Naziv zadatka“, „Opis“, „Rok“, „Prioritet“, „Status“, „Sekcija“, „Oznake“, „Lista (ne uvozi se)“ ili „Ne uvozi se“. Tačno jedna kolona mora biti „Naziv zadatka“.
3. Izaberi „Razdvajanje kolona“ („Zapeta (,)“, „Tačka-zapeta (;)“) i reci je li „Prvi red je zaglavlje“.
4. Izaberi „Listu za uvezene zadatke“ — postojeću ili „Nova lista…“.
5. Klikni „Prikaži pregled“; čitaš „Redova u tabeli“ i „Uvozi se zadataka“, a u „Šta se ne uvozi“ stoji svaki odbačen red („Red 12“).
6. Klikni „Uvezi“. Uvoz se može opozvati jednim klikom, ali samo dok ne zaključaš ili ne zatvoriš aplikaciju.

Ograničenja: kolona sa ulogom „Lista“ se prepoznaje ali se ne prenosi — svi zadaci ulaze u listu izabranu pre uvoza. Red bez naziva se preskače; rok koji ne može da se pročita (dvocifrena godina se odbija) daje zadatak bez roka, a ne izostavljen red. Tabela preko 5 MB se odbija.

Povezano: tasks, import-fin-csv
