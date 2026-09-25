# Nexus — Sirove beleške osnivača (source of truth)

> Ovaj fajl je, uz `docs/notes/razrade.md`, ulaz za PRD pipeline (`docs/prompts/`). Nove ideje se dodaju
> na dno, u sekciju "Nove ideje" sa datumom — ništa se ne briše.
> Zapisano: 2026-07-04. Jezik beleški: srpski (dokumentacija se piše na engleskom).

## Kontekst osnivača

Imam otprilike mesec i po dana do ispita, ispiti su Algebra, Linearna algebra i
analitička geometrija, Kombinatorika i teorija grafova, uz to treba da tražim
posao/praksu, treba da idem do banke da rešim neku papirologiju, da otvorim novi
račun zbog starog ugovora, treba da sredim auto, treba da detaljno sredim sobu,
odeću, fioke itd, treba da napravim plan za učenje ovih predmeta, da mogu da
pohranim podatke za učenje u app. Osnivač je ujedno i persona #1 — final-year CS
student kome app mora da bude koristan odmah.

## Osnovna ideja

Jednostavna lokalna offline app za Electron koristeći React (+ šta već treba za
backend), za praćenje stvari koje su mi potrebne. App treba da ima login za
korisnika koji kad se uloguje vidi sve svoje podatke. Uz native deo za sve glavne
platforme (macOS, Windows, Linux, Android) treba da postoji websajt koji je
landing page za promociju (jako lepo odrađen), kao i webapp ako neko želi da
koristi app u browseru.

Poželjno je da app ima preview svih stvari — svih file formata za koje je to
moguće, linkova itd. Da mogu da čekiram šta sam sve uradio, da pratim ishranu,
treninge, progres u učenju, lične finansije. Odeljak za beleške: zabava, igrice,
posao, privatne beleške itd. Privatne beleške moraju da budu interno enkriptovane
— samo app može da ih dekriptuje za čitanje, niko drugi ne sme da može da ih
pročita.

Obavezno podržati crtanje i canvas kao Milanote — baš takav: crtanje, linije,
strelice, boxovi, linkovi, slike itd, za vizuelno predstavljanje podataka. Obične
beleške treba moći automatski "vizuelizovati" u takav canvas. Odeljak za javne
beleške — beleške/canvas koje korisnik odluči da podeli sa drugim korisnicima
radi zajedničkog planiranja.

Podešavanja: tema (default system), nekoliko akcentnih boja, profilna slika,
nickname sa proverom unikatnosti, promena email-a, šifre, brisanje profila —
standardne settings stvari. Svi podaci maksimalno zaštićeni; privatne beleške sa
extra zaštitom. Dashboard; todo lista dnevna/nedeljna/mesečna/godišnja/custom.

Import beleški u standardnim formatima: za svaki tip podatka (učenje, posao,
finansije, trening…) standardizovani promptovi spremni za LLM — korisnik prekopira
prompt, LLM mu sredi podatke da budu kompatibilni sa app. Bitno: promptovi ne smeju
da otkrivaju interne stvari app-a, služe samo za kompatibilnost (kasnije ubacujemo
naš LLM u app koji će to raditi). Export podataka ako korisnik ne želi više da
koristi app. Feedback: korisnici mogu da kažu koje feature žele, šta im se
sviđa/ne sviđa. U podešavanjima opcija uključi/isključi feature (bez cluttera).
Na dashboardu summary stvari, hitne stvari, podsetnici.

## Utility deo

Konvertor svih mogućih fajlova koje je moguće implementirati; kalkulator; tajmer;
štoperica. Jako bitno: specijalizovani kalkulatori za različite oblasti — npr.
nešto što pomaže arhitekti koji se bavi predmerom i predračunom. Zabavne stvari
poput base64 encode/decode. Subtitlovi: korisnik može da ih ubaci i menja tajminge
ako nisu usklađeni. Uobičajeni konverteri mernih jedinica. Itd.

## Login i nalozi

Novi account, login na postojeći, forgot password/username, mejl za aktivaciju,
podsetnici. Na desktop i Android verziji: potpuno lokalni nalog koji ne zahteva
ništa od cloud featurea, ali zahteva PIN — koji može da se promeni ukucavanjem
PIN-a uređaja ako ga korisnik zaboravi. App ne izloguje korisnika po defaultu ako
je pri loginu čekirao remember me.

## Onboarding i modularnost

Pošto app ima jako puno feature-a, prilikom pravljenja naloga: upitnik, lepo
vizuelno prikazan, koji pita korisnika šta mu je potrebno i kako planira da
koristi app, pa mu napravi početni raspored funkcionalnosti. Sve ostalo inicijalno
sakriveno; u settings-u prikazano po kategorijama. Glavna fora: app je ful
modularna sa pažljivo napisanim, detaljnim upitnikom, tako da se potpuno prilagodi
korisniku. Dva odvojena login-a/profila po korisniku: personal i business, sa lepo
razdvojenim funkcionalnostima.

## Beta i komercijalizacija

Početne verzije: potpuno besplatan ful pristup. Kasnije ograničavamo i
komercijalizujemo; beta korisnici dobijaju jako dobar popust na sve
funkcionalnosti. Ideja je da app koriste ljudi za organizaciju privatnih obaveza
i posla — po oblastima specijalizovani feature za sve moguće tipove poslova.

## Kalendar i posebni podsetnici

Kalendar za eventove itd. Posebna vrsta podsetnika za isticanje dokumenata:
kartice u banci, lična karta, pasoš, vozačka, registracija auta itd.

---

## APP SPECIFIKACIJA

### 1. Vizija projekta

Moderna all-in-one productivity i life management platforma koja korisniku
omogućava organizaciju praktično svih aspekata života kroz jednu aplikaciju.

Platforma postoji kao: desktop aplikacija (Electron + React), web aplikacija,
landing page za promociju, Android aplikacija.

Podržane platforme: Windows, macOS, Linux, Android, browser.

Aplikacija je "offline-first": sve osnovne funkcionalnosti rade bez interneta,
cloud sinhronizacija se koristi samo kada je dostupna.

### 2. Tipovi korisnika

**Cloud korisnik:** registracija, login, email verifikacija, forgot password,
forgot username, remember me, sinhronizacija između uređaja, cloud backup.

**Lokalni korisnik** (desktop i Android): bez email adrese, bez servera, bez
interneta, PIN zaštita, promena PIN-a potvrdom PIN-a uređaja, svi podaci ostaju
lokalno.

### 3. Dashboard

Prikazuje: današnje/nedeljne/mesečne/godišnje obaveze, custom periode, hitne
obaveze, prioritete, podsetnike, summary aktivnosti, statistiku, progress,
poslednje otvorene dokumente, poslednje beleške, brze akcije, widgete koje
korisnik izabere.

### 4. Organizacija života — TODO sistem

Daily, weekly, monthly, yearly, custom. Podržati: check liste, prioritete,
tagove, rokove, repeat, categories, subtasks, dependencies.

### 5. Učenje

Za studente: planovi učenja, ispiti, predmeti, materijali, skripte, beleške,
flashcards, spaced repetition, progress, statistika, vreme provedeno u učenju,
Pomodoro integracija.

### 6. Pregled dokumenata

Preview što većeg broja formata: PDF, DOCX, XLSX, PPTX, TXT, Markdown, source
code, slike, video, audio, linkovi, ZIP (pregled sadržaja), ostali formati gde
je preview moguć.

### 7. Beleške

Kategorije: posao, učenje, zabava, igre, finansije, privatno, putovanja, ideje,
recepti, projekti, random. Podržati: rich text, Markdown, priloge, linkove,
tagove, search, folder hijerarhiju.

### 8. Privatne beleške

Posebna kategorija: interno enkriptovane, samo aplikacija može da ih dekriptuje,
maksimalna zaštita, niko drugi ne može da ih pročita. Na telefonu biometrija ili
PIN za ulazak; na desktopu i u browseru ponovo šifra.

### 9. Canvas (Milanote stil)

Beskonačan canvas: sticky notes, text box, boxovi, grupe, slike, PDF, video,
audio, linkovi, linije, strelice, konekcije, draw, zoom, pan, infinite canvas.
Dodatno: obične beleške automatski vizuelizovati u canvas.

### 10. Javne beleške

Deljenje beleški i canvas-a, read only, collaborative editing, timsko planiranje.

### 11. Profil

Profilna slika, nickname sa proverom jedinstvenosti, promena email-a, promena
šifre, brisanje naloga.

### 12. Settings

Vizuelna: system/dark/light, accent colors, pozadina.
Funkcionalna: enable/disable feature, dashboard customization, notification
settings, privacy settings, backup settings.

### 13. Sigurnost

Maksimalna zaštita podataka, enkripcija, bezbedna autentifikacija, zaštita
privatnih beleški, lokalno čuvanje kada je potrebno.

### 14. Ishrana

Praćenje: obroka, kalorija, makronutrijenata, težine, ciljeva, grafika napretka.

### 15. Treninzi

Praćenje: treninga, vežbi, serija, ponavljanja, kilograma, progress, statistika.

### 16. Finansije

Lične finansije: prihodi, rashodi, budžeti, kategorije, grafikoni, statistika.

### 17. Kalendar

Eventovi, podsetnici, ispiti, sastanci, rođendani, custom događaji.

### 18. Import

Import postojećih podataka; za svaku oblast standardizovani LLM promptovi.
Oblasti: učenje, posao, finansije, trening, ishrana, beleške.

### 19. Export

Korisnik može da izveze sve svoje podatke.

### 20. Utility sekcija

**Opšti alati:** calculator, scientific calculator, timer, stopwatch, calendar,
Pomodoro.
**Konverteri:** unit, file, image, audio, video, subtitle.
**Video alati:** subtitle timing editor.
**Programerski alati:** Base64 encode/decode, hash generator, UUID generator,
JSON formatter, regex tester, URL encoder/decoder.
**Specijalizovani kalkulatori po oblastima:** arhitektura, građevina, finansije,
matematika, fizika.

### 21. Feedback

Predlozi, bug reporti, željene funkcionalnosti, utisci.

### 22. Onboarding

Pri prvoj registraciji lep vizuelni upitnik: čime se baviš, student ili zaposlen,
koje funkcionalnosti želiš, finansije/trening/planer/canvas? Na osnovu odgovora
app prilagođava početni izgled.

### 23. Modularnost

Početni ekran prikazuje samo funkcionalnosti koje korisnik koristi. Sve ostalo
sakriveno, uključuje se u Settings.

### 24. Beta

Početne verzije potpuno besplatne, sve otključano. Kasnije premium; beta
korisnici dobijaju veliki popust.

### 25. Dugoročna vizija

Specijalizovane funkcionalnosti za profesije: studenti, programeri, arhitekte,
dizajneri, freelanceri, inženjeri, profesori, preduzetnici. Sve modularno.

### 26. Dodatne funkcionalnosti

- **Goal tracker:** SMART ciljevi, OKR, milestones
- **Habit tracker:** dnevne navike, statistika, streakovi
- **Time tracking:** praćenje rada, projekti, fokus vreme
- **Read later:** čuvanje članaka, linkova, PDF-ova
- **Bookmark manager:** organizacija linkova
- **Biblioteka:** knjige, članci, kursevi
- **Password vault (opciono):** lokalno enkriptovan
- **Inventory:** garancije, računi, lične stvari
- **Automobil:** registracija, servisi, gume, potrošnja, osiguranje
- **Putovanja:** planovi, itinereri, budžeti
- **Shopping lista; Wishlist**
- **Zdravlje:** lekovi, terapije, podsetnici
- **AI asistent:** organizacija, pisanje, sumarizacija, analiza; kasnije potpuno
  integrisan
- **Analytics:** statistika korišćenja, heatmap aktivnosti
- **Automation:** npr. završi zadatak → označi milestone → pošalji notifikaciju
- **Plugin sistem:** dodavanje novih funkcionalnosti bez izmene jezgra
- **Desktop/mobile widgeti**
- **Napredne notifikacije:** snooze, prioriteti, smart reminders

### 27. Landing page

Moderan marketinški sajt: hero sekcija, screenshot-ovi, feature sekcije,
animacije, FAQ, pricing, download, blog, kontakt.

### 28. Web app

Browser verzija skoro identična desktop aplikaciji.

### 29. Opšta filozofija

Korisnik ne sme da bude zatrpan ogromnim brojem funkcionalnosti. Onboarding
određuje šta mu je potrebno i prikazuje samo to; ostalo se uključuje u Settings.
Cilj nije još jedan planner ili notes app, već centralno mesto za organizaciju
celog privatnog i poslovnog života uz maksimalnu modularnost, privatnost,
bezbednost i rad potpuno offline.

---

## Razrada: nivo detalja koji očekujem (primer — fitness)

Nijedna funkcionalnost pojedinačno nije revolucionarna; fora je "50 aplikacija u
jednoj" — kao IDE za programere, ali za život. Primer očekivane razrade: fitness
je ceo hub — logovanje ishrane, treninga, načina života. Treba izgraditi veliku
bazu tipova treninga i kako utiču na muškarce i žene, i veliku bazu namirnica i
njihovih sastava — pogotovo LIDL, Maxi, Roda, Idea, Aroma, Aman i ostali marketi
u Srbiji i proizvodi u njima. Korisnik pravi tipična jela od tih sastojaka koja
se pamte, pa loguje "pojeo sam jelo br. 1" bez ponovnog unosa namirnica. Taj tip
razrađenosti očekujem od svakog feature-a.

## Nove ideje

<!-- Dodaj nove ideje ovde, sa datumom. Ništa se ne briše. -->

### 2026-07-05 — Kandidat za ime: Vesper

Osnivač: "V.E.S.P.E.R. — Versatile Ecosystem for Strategic Planning &
Everyday Resources. Vesper znači večernja zvezda, prva svetlost u sumrak. Ime
je poetsko, pomalo misteriozno, a akronim razbija tu poetsku maglu preciznim
obećanjem. Zvuči kao tajni agent među aplikacijama."

Procena (Claude): **Vesper** je jak kandidat — kratko, izgovorljivo isto na
srpskom i engleskom, stvarna reč sa dubinom (lat. večernja zvezda; Bond
asocijacija daje "tajni agent" ton). Slabost je backronym (korporativna fraza)
i tačkasta stilizacija (kuca se teško, lošiji wordmark i search) — predlog:
brend je "Vesper", akronim kao easter egg u About ekranu. Due diligence pre
odluke: postojala je poznata notes app "Vesper" (Gruber, ugašena 2016) —
srodna kategorija, proveriti žig; domeni vesper.app/.com verovatno
zauzeti/premium. Kodno ime u dokumentaciji ostaje Nexus dok provera ne prođe.

### 2026-07-05 — Vizuelni jezik: kanban, kartice, grafovi + design system

Kanban i kartice i grafovi svuda — to je vizuelni aspekt app. Razrada (Claude):
tretirati kao **poglede (views) nad podacima** — isti podaci se prikazuju kao
lista / kanban tabla / kartice / kalendar / grafikon, gde ima smisla (taskovi
kao lista ili kanban, beleške kao kartice, statistika svuda kao grafovi;
opciono graf-view povezanih beleški). JAKO BITNO: app ne sme da izgleda kao
generic AI slop — cela app mora da ima dobar, prepoznatljiv design system,
nikako generično. Design system je pillar, ne afterthought.

### 2026-07-04 — Predlozi za personal deo (Claude)

- **Quick capture inbox** — globalna prečica na desktopu / quick tile i share
  target na Androidu: sve što ti padne na pamet ulazi u jedan inbox, sortira se
  kasnije (GTD princip). Za app ovog tipa ovo je kritičan "lepak" među modulima.
- **Subscriptions tracker** — pretplate (streaming, teretana, domeni, software)
  sa cenom, datumom obnove u kalendaru i vezom na finansije.
- **Meal planner** — nedeljni plan jela iz sačuvanih recepata/jela, koji
  automatski generiše shopping listu iz sastojaka.
- **Gifts tracker** — rođendani iz kalendara + ideje za poklone + budžet po
  osobi; podsetnik dovoljno unapred da poklon stigne.
- **Home maintenance** — periodični podsetnici: zamena filtera, servis kotla,
  dimnjačar, baterije u detektoru.
- **Countdown widgeti** — ispiti, putovanja, rokovi kao odbrojavanje na
  dashboardu.
- **Godišnji pregled ("Nexus Wrapped")** — auto-generisan pregled godine iz svih
  modula: završeni zadaci, položeni ispiti, treninzi, pročitane knjige, uštede.
- **Mood/energy dnevnik** — uz habit tracker, 10-sekundni dnevni unos;
  vremenom korelacije (san ↔ produktivnost ↔ trening).

### 2026-07-04 — Productivity boosters

Pomodoro pauze kao "productivity booster" sekcija: tokom pauze app nudi kratke
aktivnosti — mini igre iz Entertainment sekcije (sudoku, karte). Dodatna ideja
(Claude): predlozi za istezanje, odmor očiju (20-20-20 pravilo), disanje,
podsetnik za hidrataciju. Booster je opcioni deo Pomodoro flow-a, nikad obaveza.

### 2026-07-04 — Entertainment sekcija

Sekcija za zabavu unutar app: sudoku, igre sa kartama (solitaire i slično) i
druge male igre tog tipa. Potpuno offline, uklapa se u modularni sistem (vidljivo
samo ako korisnik uključi). Prirodne integracije: Pomodoro pauze ("odigraj brzi
sudoku tokom pauze"), statistika/streakovi kroz postojeći stats sistem.
