---
id: content-packs
title: Paketi sadržaja
location: { module: settings, settings: data }
keywords: [paket, sadržaj, vikipedija, mapa, potpis, instaliranje]
---
Paket sadržaja je fascikla javnog sadržaja — na primer cela Vikipedija za čitanje bez interneta, mapa ili skup podataka — koju Nexus prihvata samo ako je potpisana ključem Nexusa. Sadržaj ostaje na ovom uređaju, u fascikli pored šifrovane baze, i ne ulazi u rezervnu kopiju profila.

Preuzimanje iz kataloga:

1. U kategoriji „Podaci“ otvori „Paketi sadržaja“. Na dnu kartice je „Katalog paketa“: spisak paketa koje je Nexus objavio, složen po vrsti sadržaja, a uz svaki stoje „Verzija“, „Veličina“, „Licenca“ i jedno od „Nije instaliran“, „Instaliran“ ili „Dostupno ažuriranje“.
2. „Detalji“ pokazuju „Atribuciju“, „Izvor“ i adresu licence pre nego što se bilo šta preuzme, a „Osveži katalog“ ponovo čita spisak.
3. Klikni „Preuzmi“ na paketu koji želiš. U tom redu su zatim „Pauza“ i „Otkaži“, odnosno „Nastavi“ dok je preuzimanje pauzirano, a pored njih datoteka koja se trenutno preuzima ili instalira, sa brojem gotovih. Svaka datoteka se proverava prema svom hešu dok se piše, a paket se instalira kad uđe i poslednja.

Preuzimanje traži režim koji ga dozvoljava: u kategoriji „Privatnost“ otvori „Mreža i ažuriranja“, izaberi „Bez mreže + provere ažuriranja + preuzimanja“, pa klikni „Sačuvaj izbor“ i „Restartuj Nexus“. Nexus čita režim pri pokretanju, pa promena važi od sledećeg pokretanja; do tada na mestu kataloga stoji da je preuzimanje isključeno i da se uključi u privatnosti, a instalirati može samo paket iz fascikle.

Instaliranje iz fascikle:

1. Klikni „Instaliraj iz fascikle…“.
2. Izaberi fasciklu u kojoj je `pack.json` sa potpisom i sadržajem. Nexus prvo proverava potpis i svaki heš, pa tek onda kopira.
3. U pitanju „Instalirati ovaj paket?“ proveri naziv, verziju i veličinu, pa klikni „Instaliraj“.

Instalirani paketi stoje iznad kataloga. Uz svaki stoji „Verzija“, „Veličina“, „Datoteke“, „Licenca“, „Atribucija“ i „Izvor“, uz dugme „Proveri“ — koje ponovo čita sadržaj i poredi ga sa potpisanim manifestom („Sadržaj je proveren i odgovara potpisanom manifestu.“) — i „Ukloni“, koje briše sadržaj paketa sa ovog uređaja („Podaci profila se ne diraju.“). Licence instaliranih paketa stoje i na stranici „O aplikaciji“, pod „Licence paketa“.

Ograničenja: ništa iz tvog profila se ne dira, a sadržaj paketa ostaje u svojoj fascikli pored šifrovane baze. Preuzimanje je jedino što ovde koristi mrežu: počinje kad klikneš „Preuzmi“ i čita samo sa adresa ugrađenih u aplikaciju. Paket koji nije potpisan, koji traži noviju verziju Nexusa, koji je već instaliran u novijoj verziji ili koji nosi putanju ili datoteku koje manifest ne dopušta se odbija, uz razlog. Simbolički linkovi u paketu nisu dozvoljeni.

Povezano: settings-data, packs-toolkits
