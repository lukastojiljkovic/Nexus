---
id: import-fin-csv
title: Uvoz izvoda (.csv)
location: { module: settings, settings: data }
keywords: [izvod, banka, csv, promet, deduplikacija, valuta]
---
Uvoz izvoda čita bankarski izvod (.csv) i upisuje promet u jedan tvoj račun. Prvo mora da postoji račun („Prvo napravi račun — izvod ulazi u račun koji izabereš…“).

Kako se uvozi:

1. U „Uvoz i izvoz“ otvori „Uvoz izvoda (.csv)“, ili u Finansijama dugme „Uvoz izvoda (.csv)…“.
2. Klikni „Izaberi izvod (.csv)…“ i u „Mapiranje kolona izvoda“ odredi uloge: „Datum“, „Iznos (sa predznakom)“, „Isplata (odliv)“, „Uplata (priliv)“, „Primalac“, „Opis“, „Valuta“ ili „Ne uvozi se“. Jedna kolona mora biti „Datum“, a iznos je ili jedna kolona sa predznakom ili kolone isplate/uplate — nikad oboje.
3. Izaberi „Razdvajanje kolona“, „Prvi red je zaglavlje“, „Račun u koji izvod ulazi“ i „Šta znači predznak u koloni Iznos“.
4. Klikni „Prikaži pregled“. U „Kako je fajl pročitan“ pišu format brojeva, format datuma i predznak; u „Već uvezeno“ svaki red koji već stoji u ledgeru; u „Šta se ne uvozi“ odbačeni redovi.
5. Klikni „Uvezi“.

Ograničenja: izvod u drugoj valuti od izabranog računa se odbija — Nexus ne drži kurs. Ako kolona dopušta dva čitanja koja daju različite brojeve ili datume, uvoz se odbija umesto da pogađa. Isti izvod možeš uvesti dva puta bez duplikata: svaki već uvezen red se preskače i piše u pregledu. Fajl preko 5 MB se odbija.

Povezano: finance-transactions, import-csv
