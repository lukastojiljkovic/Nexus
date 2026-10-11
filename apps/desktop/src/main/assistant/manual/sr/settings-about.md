---
id: settings-about
title: O aplikaciji
location: { module: settings, settings: about }
keywords: [o aplikaciji, verzija, licence, lokacija podataka]
---
Kategorija „O aplikaciji“ drži dve kartice: „O aplikaciji“ i „Licence“.

„O aplikaciji“:

1. „Verzija“ — koja je verzija Nexusa instalirana.
2. „Electron“, „Chromium“ i „Node“ — verzije okruženja u kojem se aplikacija izvršava.
3. „Lokacija podataka“ — fascikla u kojoj stoji šifrovana baza ovog uređaja.

„Licence“:

1. „Biblioteke“ — spisak biblioteka otvorenog koda. Pored svake je dugme „Prikaži tekst licence“, a uz tekst stoji „Pročitano iz“ i fajl iz kojeg je pročitan.
2. „Fontovi“ — fontovi za crtanje; „Fontovi za crtanje isporučuju se u samoj aplikaciji i učitavaju se sa diska — nijedan se ne preuzima sa mreže.“
3. Ispod biblioteka stoji da Electron u sebi nosi Chromium i Node.js i da njihova puna obaveštenja idu uz aplikaciju, u fajlu `LICENSES.chromium.html` pored izvršnog fajla.

Ograničenja: ako uz paket nema teksta licence, kartica to kaže umesto da ga izmisli („Paket navodi ovu licencu u svom manifestu, ali uz sebe ne isporučuje njen tekst.“). Ako ništa na disku ne utvrđuje licencu, stoji „Licenca nije utvrđena ni iz jednog fajla koji se isporučuje.“

Povezano: settings, settings-privacy
