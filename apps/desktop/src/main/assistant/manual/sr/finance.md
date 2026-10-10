---
id: finance
title: Finansije
location: { module: finance }
keywords: [finansije, račun, transakcija, prenos, budžet, valuta]
---
Finansije vode račune, promet i pretplate. Stanje računa se računa iz početnog stanja i upisanog prometa — ne prepisuje se ručno.

Kako počinješ:

1. U railu „Računi“ klikni „Novi račun“: „Naziv računa“, „Vrsta“ („Gotovina“, „Tekući račun“, „Kartica“, „Štednja“), „Valuta“ (troslovna oznaka, npr. RSD) i „Početno stanje“.
2. Promet upisuješ formom: „Vrsta unosa“ je „Rashod“, „Prihod“ ili „Prenos“; uz to idu „Iznos“, „Opis“, „Datum“, „Račun“ (za prenos „Sa računa“ i „Na račun“) i „Kategorija“.
3. Klikni „Dodaj“.

Stranica ima tri prikaza: „Knjiga“ (promet), „Izveštaj“ (mesec unazad) i „Pretplate“ (ono što se naplaćuje samo). Iznad stoji „Ukupno“, po valuti. Promet možeš da uvoziš iz izvoda (.csv) preko „Uvoz izvoda (.csv)…“, a kategorije dobijaju budžet preko „Uredi“.

Ograničenja: Nexus nema kurs i ne konvertuje valute — zbir se nikada ne pravi preko valuta, a izvod u drugoj valuti se odbija. Prenos između dva svoja računa ne menja ukupan zbir.

Povezano: finance-transactions, settings-data
