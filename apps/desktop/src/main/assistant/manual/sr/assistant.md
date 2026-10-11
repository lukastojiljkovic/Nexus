---
id: assistant
title: Asistent
location: { module: assistant }
keywords: [asistent, model, razgovor, bez interneta, gguf, llama]
---
Asistent je razgovor sa modelom koji radi na ovom računaru. Model se izabere prema hardveru (inteligencija, ravnoteža ili brzina), preuzme jednom i posle radi bez interneta.

Kako se koristi:

1. „Modeli“: vidi preporuku za ovaj računar, pa preuzmi model (samo u režimu mreže „Preuzimanja“), uvezi `.gguf` datoteku ili pretraži Hugging Face. Svaka datoteka se proverava prema SHA-256.
2. „Nova konverzacija“ otvara razgovor. Upiši pitanje i pritisni Enter; Shift+Enter prelazi u novi red. Dok odgovor stiže, dugme „Zaustavi“ prekida turn.
3. „Recepti“ pokreću gotove razgovore (isplaniraj dan, pretvori belešku u zadatke, šta da čitaš o nečemu, zaglavljen — pomozi mi kroz ovo).
4. Ispod odgovora stoje „Izvori“: klik vodi u stranicu aplikacije iz koje odgovor dolazi, a adresa sa weba se otvara u tvom pregledaču.

Asistent poznaje beleške, zadatke, događaje, tekst priloga, priručnik aplikacije i instalirane pakete sadržaja. Privatne beleške su izuzete. Kada odgovor koristi bezbednosni paket, ispod odgovora stoji obaveštenje o bezbednosti i broj 112.

Alatke koje menjaju podatke ili idu na mrežu traže potvrdu pre svake radnje; odbijanje je uobičajen odgovor i ništa se ne menja. Pretraga weba je isključena dok je ne uključiš u Podešavanjima, u kartici „Asistent“, i radi samo u režimu mreže „Ažuriranja“ ili „Preuzimanja“.

Povezano: settings-modules, network-and-updates, content-packs, search
