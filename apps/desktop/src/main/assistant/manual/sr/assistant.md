---
id: assistant
title: Asistent
location: { module: assistant }
keywords: [asistent, model, razgovor, bez interneta, gguf, llama]
---
Asistent je razgovor sa modelom koji radi na ovom računaru. Model se izabere prema hardveru (inteligencija, ravnoteža ili brzina), preuzme jednom i posle radi bez interneta.

Model pronađen pretragom ili uvezen ručno ne služi nijednom nivou: otvori „Modeli“ i pritisni „Koristi za odgovore“ na njegovom redu, pa odgovara od tada. „Koristi preporučeni model“ vraća odgovor nivou.

Kako se koristi:

1. „Modeli“: vidi preporuku za ovaj računar, pa preuzmi model (samo u režimu mreže „Preuzimanja“), uvezi `.gguf` datoteku ili pretraži Hugging Face. Svaka datoteka se proverava prema SHA-256.
2. „Nova konverzacija“ otvara razgovor. Upiši pitanje i pritisni Enter; Shift+Enter prelazi u novi red. Dok odgovor stiže, dugme „Zaustavi“ prekida turn.
3. „Recepti“ pokreću gotove razgovore (isplaniraj dan, pretvori belešku u zadatke, šta da čitaš o nečemu, zaglavljen — pomozi mi kroz ovo).
4. Ispod odgovora stoje „Izvori“: klik vodi u stranicu aplikacije iz koje odgovor dolazi, a adresa sa weba se otvara u tvom pregledaču.

Rad modela: kartica „Rad modela“ u „Modelima“ pokazuje koji je model u memoriji, a „Izbaci iz memorije“ odmah oslobađa tu memoriju. Za ovaj profil ista kartica podešava veličinu konteksta u tokenima (i dalje ograničenu onim na čemu je model treniran), temperaturu, top-p, top-k i kaznu za ponavljanje; prazno polje znači vrednost samog modela („Vrednosti modela“ prazni ta polja, a „Sačuvaj“ čuva promenu). Tu se podešava i posle koliko minuta bez pitanja model napušta memoriju (na početku 15; 0 ga drži dok ga ne izbaciš) i „Automatski sažimaj duge razgovore“, na početku uključeno: kada razgovor preraste ono što model čita odjednom, njegove ranije poruke se sažmu pre odgovora, a razgovor pokazuje to mesto. „Sažmi ranije poruke“, pored polja za poruku, radi isto na zahtev.

Asistent poznaje beleške, zadatke, događaje, tekst priloga, priručnik aplikacije i instalirane pakete sadržaja. Privatne beleške su izuzete. Kada odgovor koristi bezbednosni paket, ispod odgovora stoji obaveštenje o bezbednosti i broj 112.

Preuzete referentne biblioteke se takođe čitaju: za pitanje asistent pretražuje naslove u svakoj biblioteci na ovom računaru i uzima uvodni deo nekolicine članaka čiji se naslovi poklapaju sa pitanjem, pa ih navodi kao izvore.

Alatke koje menjaju podatke ili idu na mrežu traže potvrdu pre svake radnje; odbijanje je uobičajen odgovor i ništa se ne menja. Pretraga weba je isključena dok je ne uključiš u Podešavanjima, u kartici „Asistent“, i radi samo u režimu mreže „Ažuriranja“ ili „Preuzimanja“.

Povezano: settings-modules, network-and-updates, content-packs, search
