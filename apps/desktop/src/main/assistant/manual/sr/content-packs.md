---
id: content-packs
title: Paketi sadržaja
location: { module: settings, settings: data }
keywords: [paket, sadržaj, vikipedija, mapa, potpis, instaliranje]
---
Paket sadržaja je fascikla javnog sadržaja — na primer cela Vikipedija za čitanje bez interneta, mapa ili skup podataka — koju Nexus prihvata samo ako je potpisana ključem Nexusa. Sadržaj ostaje na ovom uređaju, u fascikli pored šifrovane baze, i ne ulazi u rezervnu kopiju profila.

Kako se instalira:

1. U kategoriji „Podaci“ otvori „Paketi sadržaja“ i klikni „Instaliraj iz fascikle…“.
2. Izaberi fasciklu u kojoj je `pack.json` sa potpisom i sadržajem. Nexus prvo proverava potpis i svaki heš, pa tek onda kopira.
3. U pitanju „Instalirati ovaj paket?“ proveri naziv, verziju i veličinu, pa klikni „Instaliraj“.

Uz paket stoji „Verzija“, „Veličina“, „Datoteke“, „Licenca“, „Atribucija“ i „Izvor“. Dugme „Proveri“ ponovo čita sadržaj i poredi ga sa potpisanim manifestom („Sadržaj je proveren i odgovara potpisanom manifestu.“), a „Ukloni“ briše sadržaj paketa sa ovog uređaja („Podaci profila se ne diraju.“).

Ograničenja: ništa se ne šalje na internet i ništa iz profila se ne dira. Paket koji nije potpisan, koji traži noviju verziju Nexusa, koji je već instaliran u novijoj verziji ili koji nosi putanju ili datoteku koje manifest ne dopušta se odbija, uz razlog. Simbolički linkovi u paketu nisu dozvoljeni.

Povezano: settings-data, packs-toolkits
