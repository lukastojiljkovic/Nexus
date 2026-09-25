# Nexus — Razrade funkcionalnosti

> Detaljne razrade modula, na nivou dubine koji je osnivač postavio primerom
> fitness huba u `raw-spec.md`. Piše se zajednički (osnivač + Claude), svaka
> razrada nosi datum. Ovo je ulaz za PRD fazu — PRD ih formalizuje u
> requirement-e, ne prepisuje ih. Jezik: srpski.

## Onboarding upitnik (2026-07-04)

> **Revizija 2026-07-05** (posle istraživanja,
> `docs/research/onboarding-ux.md`): svaki blokirajući ekran pre prve
> vrednosti košta ~10–15% completion-a, pa se tok ispod menja u **4 osnovna
> ekrana + progressive sloj**: (1) dobrodošlica sa "Počni odmah (lokalno)"
> kao primarnim CTA (cloud sekundarno, nudi se kasnije u prirodnim
> trenucima); (2) Personal/Business/Oba; (3) ko si + šta organizuješ na
> JEDNOM ekranu (zanimanje auto-predlaže oblasti); (4) "Tvoj Nexus" preview
> sa temom/akcentom inline. **Dubinska pitanja se sele u module** — postavlja
> ih modul pri prvom otvaranju; empty states nose objašnjenje + jednu akciju.
> Novo i obavezno: **pre-populacija** — dashboard posle onboardinga nikad
> nije prazan (vođeno kreiranje prvog pravog taska + primer canvas + widgeti
> po personi; primeri se brišu jednim klikom). Principi ispod i dalje važe;
> ekrani 0–7 ispod su zamenjeni ovom strukturom.

### Principi

- **Maksimalno ~2 minuta za osnovni tok (4 ekrana)**, uvek vidljiv progress i
  dugme "Preskoči" (preskakanje → "Essentials" preset).
- Nijedan odgovor nije obavezan i nijedan nije trajan: sve se kasnije menja u
  Settings, uključujući "Ponovo pokreni upitnik".
- **Mapiranje je deklarativno**: svaki odgovor se prevodi u skup feature
  flagova kroz mapu koja je podatak, ne kod — lako se menja, testira i kasnije
  A/B-uje bez diranja jezgra.
- **Anti-clutter pravilo**: posle onboardinga korisniku je vidljivo najviše
  ~7 modula + Dashboard. Sve ostalo postoji, ali sakriveno (Settings →
  kategorije).
- Vizuelno: velike kartice sa ikonama i mikro-animacijama, ne suvi radio
  buttoni; live preview teme; ton copy-ja topao ali kratak.
- Privacy poruka na startu: odgovori ostaju lokalno; kod cloud naloga sinhronizuju
  se tek kad korisnik uključi sync.

### Tok (ekrani)

0. **Dobrodošlica + tip naloga** — izbor cloud vs potpuno lokalni nalog, sa
   iskrenim objašnjenjem razlike (sync i deljenje vs ništa ne napušta uređaj);
   remember-me opcija.
1. **Profil** — Personal / Business / Oba. Ako "oba": sada se podešava
   personal, a business dobija svoj kraći upitnik pri prvom ulasku u business
   profil.
2. **Ko si?** — status/zanimanje, višestruki izbor, kartice + pretraga:
   student, programer, arhitekta, dizajner, freelancer, profesor, preduzetnik,
   zdravstvo, pravo, finansije, ostalo (+ slobodan unos).
3. **Šta želiš da organizuješ?** — multi-select kartice: Obaveze i planiranje /
   Učenje / Posao i projekti / Finansije / Fitnes i ishrana / Beleške i znanje /
   Životna administracija (auto, dokumenta, zdravlje) / Vizuelno planiranje
   (canvas).
4. **Dubinska pitanja** — samo za izabrane oblasti, najviše 2 po oblasti.
   Primeri: Učenje → "Imaš li ispite uskoro?" (→ exam countdown na dashboardu),
   "Želiš li flashcards i spaced repetition?"; Fitnes → "Pratiš li kalorije/
   makroe?"; Finansije → "Budžeti ili samo evidencija?"; Životna administracija
   → "Imaš li auto?" (→ CAR modul).
5. **Stil rada** — nivo planiranja (opušteno/detaljno), apetit za notifikacije
   (minimalno/normalno/sve), okvirno radno vreme (za pametne podsetnike).
6. **Izgled** — tema (system/dark/light) + akcentna boja, uz live preview.
7. **"Tvoj Nexus"** — pregled generisanog dashboarda i liste uključenih modula;
   svaki modul može da se isključi/uključi pre završetka; na kraju ponuda
   importa postojećih podataka (→ IMEX modul). CTA: "Kreni".

### Mapiranje odgovora → moduli (primeri)

| Odgovor | Uključuje |
| --- | --- |
| Student + "ispiti uskoro" | STUDY, TASK, CAL, Pomodoro (UTIL), exam countdown widget |
| Programer | UTIL (dev alati), TIME, READ; predlog PRO packa "Developer" |
| Arhitekta (business) | PRO pack "Arhitekta" (predmer/predračun), DOC, TASK |
| Fitnes + makroi | FIT (pun), Dashboard fitness widget |
| Fitnes bez makroa | FIT (lite: samo treninzi i težina) |
| Životna administracija + auto | CAR, CAL (istek dokumenata), INV |
| Vizuelno planiranje | CANV, NOTE |
| Ništa izabrano / sve preskočeno | Essentials: DASH, TASK, NOTE, CAL |

### Edge cases

- **Sve izabrano** → dozvoljeno, ali uz upozorenje i predlog prioritizacije
  ("kreni sa 5, ostalo te čeka u Settings").
- **Prekid na pola** → stanje se čuva lokalno; sledeće pokretanje nastavlja gde
  je stao.
- **Ponovno pokretanje upitnika** → isključivanje modula NIKAD ne briše
  podatke, samo sakriva modul; ponovno uključivanje vraća sve.
- **Business upitnik** — kraći: delatnost → predlog profession packa. Odluka
  osnivača (2026-07-04): business i personal su potpuno odvojeni; jedino je
  kalendar zajednički, uz jasnu vizuelnu razliku personal/business eventova.
  Profil se bira tabom na loginu; prebacivanje u toku rada je moguće, ali
  traži šifru pri svakom prelasku.

### Otvorena pitanja

- Da li odgovor o zanimanju automatski preskače ekran 3 (auto-predlog oblasti)?
  Predlog: auto-predlog + potvrda, ne preskakanje.
- Opt-in telemetrija odgovora radi poboljšanja upitnika (tek uz analytics
  modul, nikad za lokalne naloge)?

## Profession toolkits — katalog (2026-07-04)

**Pattern:** svaki profession pack = (1) preset postojećih modula, (2)
mini-alati specifični za struku, (3) specijalizovani kalkulatori, (4) šabloni
(checkliste, dokumenti, evidencije). Ne gradimo poseban SaaS po struci — gradimo
alate koji unutar Nexus-a štede sate nedeljno. Pack se predlaže kroz business
onboarding, uključuje se i ručno u Settings. Zdravstveni i pravni alati nose
obavezan disclaimer (nisu medicinski/pravni savet).

- **Arhitekta / građevinski inženjer** — predmer i predračun (pozicije, količine,
  jedinične cene, rekapitulacija, export); kalkulatori površina/zapremina/
  materijala (beton, opeka, malter); konverzija razmera; evidencija projekata i
  investitora; rokovi dozvola i tehničkih prijema u kalendaru.
- **Programer / IT** — dev alati iz UTIL (base64, JSON, regex, UUID, hash, URL);
  snippet biblioteka sa syntax highlightingom; time tracking po projektu;
  flashcards za interview prep; cron expression builder.
- **Dizajner** — palete boja i WCAG kontrast checker; moodboard preset na
  canvasu; biblioteka asseta; evidencija klijentskih revizija; px/rem/pt
  konverteri.
- **Freelancer (opšti)** — klijenti i projekti; ponude i fakture sa PDV/paušal
  logikom; evidencija naplate; hourly-rate kalkulator (od željene godišnje
  zarade); rokovi ugovora u kalendaru.
- **Profesor / nastavnik** — raspored časova; evidencija ocena i prisustva;
  planovi lekcija; banka pitanja + generisanje flashcards; kalendar školske
  godine.
- **Lekar / medicinska sestra** — evidencija smena; privatne (enkriptovane)
  beleške o slučajevima; klinički kalkulatori (BMI, BSA, GFR, doze po kg — uz
  disclaimer); istek licenci i KME bodova u kalendaru.
- **Advokat** — predmeti sa statusima; ročišta u kalendaru; podsetnici na
  procesne rokove i zastarelost; evidencija sati po predmetu; advokatska tarifa
  kalkulator.
- **Računovođa** — klijenti sa statusima obaveza; srpski poreski kalendar
  (PDV, akontacije, završni) kao preset podsetnika; kalkulatori zatezne kamate
  i PDV-a; evidencija predatih prijava.
- **Fotograf / videograf** — shoot planner sa shot listama; golden hour
  kalkulator; evidencija isporuka i licenci; storage/arhiva evidencija; ugovori
  i avansi.
- **Fitness trener** — klijenti sa programima (koristi FIT bazu vežbi); merenja
  i progres klijenata; zakazivanje termina; šabloni programa po cilju.
- **Nutricionista** — meal planovi iz food baze (uključujući srpske markete);
  klijenti i merenja; export jelovnika; kalkulatori BMR/TDEE.
- **Agent nekretnina** — portfolio nekretnina sa fotografijama; obilasci u
  kalendaru; kalkulator kredita/rate i provizije; evidencija kupaca i njihovih
  kriterijuma.
- **Ugostitelj** — normativi (recepture sa cenom koštanja po porciji!); zalihe
  i dobavljači sa rokovima plaćanja; raspored smena; kalkulacija marže menija.
- **Poljoprivrednik** — evidencija parcela i kultura; kalendar tretmana i
  prskanja (karenca podsetnici); rokovi subvencija; kalkulacija prinosa i
  troškova po hektaru.
- **Prevodilac / pisac** — projekti sa word count progresom; cena po
  prevodilačkoj kartici (1800 karaktera) kalkulator; rokovi predaje;
  terminološke baze po klijentu.
- **Muzičar / producent** — gig kalendar sa honorarima; setlist manager;
  inventar opreme (veže se na INV); BPM/tonalitet beleške po pesmi.
- **Vozač / transport** — putni nalozi; evidencija potrošnje goriva; servisni
  intervali (CAR modul); dnevnice i troškovi po turi.
- **Elektro / mašinski inženjer** — inženjerski kalkulatori (Omov zakon, snaga,
  presek kablova; momenti, tolerancije, čvrstoća); napredne konverzije jedinica;
  evidencija projekata i revizija.
- **Event planner** — runsheet/timeline po događaju; budžet sa stavkama;
  evidencija vendora i ugovora; checkliste po tipu događaja (svadba,
  konferencija, žurka).
- **Krojač / zanatlija** — mere klijenata; narudžbine sa statusima; kalkulacija
  cene (materijal + rad); rokovi isporuke.
- **Stomatolog / veterinar** — varijante lekarskog packa: kartoni (enkriptovani),
  termini, podsetnici za kontrole/vakcinacije.
- **Preduzetnik / mali biznis (opšti)** — mini CRM (kontakti, prilike); obaveze
  prema državi u kalendaru; cash-flow pregled (FIN business varijanta); ciljevi
  po kvartalu (GOAL).

Katalog je otvoren — PRO modul u PRD-u definiše format packa, a novi packovi se
dodaju kroz isti mehanizam (dugoročno i kroz plugin sistem).
