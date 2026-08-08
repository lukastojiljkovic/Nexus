import { buildNoteUpdate, parseMarkdownNote } from "@nexus/core";
import { NOTE_FOLDER_COLORS, NoteOrgStore, NoteStore } from "@nexus/db";
import type { NoteFolderColor } from "@nexus/db";
import { compactNow } from "../notes.js";
import { demoAt, demoRandom } from "./context.js";
import type { DatabaseHandle, DemoContext, DemoRandom } from "./context.js";

/**
 * NOTE's demo slice: a second brain across eight areas of an ordinary life —
 * faculty, side projects, recipes, travel, reading, ideas, personal growth
 * and money — never a grid of "Note 1", "Note 2".
 *
 * Every body is produced the way the app itself would produce one, not
 * invented as a raw byte blob: `parseMarkdownNote`/`buildNoteUpdate` is the
 * exact pair `markdownImport.ts` uses to turn a `.md` file into a note, and
 * `compactNow` is the same fold `main` runs after every import — so a demo
 * note is searchable (its plaintext lands in `note_snapshots`) and carries a
 * first version-history checkpoint, indistinguishable from a note a person
 * typed and then paused on. A note's title is its own first block (the
 * editor's own rule — see `noteMarkdown.ts`), so every body below opens with
 * `# <Title>` and `parseMarkdownNote` reads that heading back out as
 * `parsed.title`; nothing here passes a title string of its own.
 *
 * Timing follows two rules: `createdOffsetDays` places the note somewhere in
 * the last ~8 months (a handful cluster inside the last two weeks, so the
 * "recent" and rhythm views read as alive), and `revisitAfterDays` — present
 * only on notes someone genuinely came back to — pushes `updatedAt` later
 * without ever touching `createdAt`, exactly what `NoteStore.create` followed
 * by a later `appendUpdate` does for a real note.
 */

/** One demo folder: its Serbian name, its home in the store's own colour palette, and how old it is. */
interface DemoFolderSpec {
  readonly key: string;
  readonly name: string;
  readonly color: NoteFolderColor;
  readonly createdOffsetDays: number;
}

/** One demo note: where it lives, when it happened, and its real markdown body. */
interface DemoNoteSpec {
  readonly folderKey: string | null;
  /** Days before "today" the note was first written — negative, spread across the last ~8 months. */
  readonly createdOffsetDays: number;
  /** Days added on top of `createdOffsetDays` for the note's last real edit — omitted for a note nobody revisited. */
  readonly revisitAfterDays?: number;
  readonly pinned?: boolean;
  readonly tags?: readonly string[];
  /** Markdown, starting with `# Title` — the note's title IS its first block, so the heading stays in the body. */
  readonly body: string;
}

/**
 * Reads one entry from the store's own colour palette rather than repeating
 * eight literal names by hand — a change to `NOTE_FOLDER_COLORS` cannot leave
 * this file naming a colour that no longer exists.
 */
function paletteColor(index: number): NoteFolderColor {
  const color = NOTE_FOLDER_COLORS[index];
  if (color === undefined) {
    throw new Error(`seedDemoNotes: no folder colour at palette index ${index}.`);
  }
  return color;
}

const FOLDERS: readonly DemoFolderSpec[] = [
  { key: "faks", name: "Fakultet", color: paletteColor(0), createdOffsetDays: -195 },
  { key: "citanje", name: "Čitanje", color: paletteColor(1), createdOffsetDays: -225 },
  { key: "razvoj", name: "Lični razvoj", color: paletteColor(2), createdOffsetDays: -105 },
  { key: "putovanja", name: "Putovanja", color: paletteColor(3), createdOffsetDays: -165 },
  { key: "ideje", name: "Ideje", color: paletteColor(4), createdOffsetDays: -28 },
  { key: "recepti", name: "Recepti", color: paletteColor(5), createdOffsetDays: -235 },
  { key: "finansije", name: "Finansije", color: paletteColor(6), createdOffsetDays: -135 },
  { key: "projekti", name: "Projekti", color: paletteColor(7), createdOffsetDays: -85 },
];

const NOTES: readonly DemoNoteSpec[] = [
  // --- Fakultet --------------------------------------------------------
  {
    folderKey: "faks",
    createdOffsetDays: -190,
    tags: ["faks", "učenje"],
    body: `# Algoritmi pretrage grafova

Beleške sa predavanja iz strukture podataka i algoritama — pretraga u dubinu i
pretraga u širinu, i zašto izbor između njih zavisi od oblika problema.

## DFS (pretraga u dubinu)

Ide što dublje može pre nego što se vrati nazad. Implementira se rekurzivno
ili preko eksplicitnog steka. Dobar je za detekciju ciklusa, topološko
sortiranje i pronalaženje komponenti povezanosti.

## BFS (pretraga u širinu)

Obilazi graf sloj po sloj koristeći red (queue). Garantuje najkraći put u
neusmerenom grafu bez težina na granama — svaki čvor se prvi put poseti preko
najkraćeg mogućeg puta od korena.

## Dijkstra

Proširenje BFS-a za grafove sa nenegativnim težinama. Umesto reda koristi red
sa prioritetom (min-heap), a složenost je O((V + E) log V) uz binarnu gomilu.

- DFS → komponente, ciklusi, topološko sortiranje
- BFS → najkraći put bez težina
- Dijkstra → najkraći put sa nenegativnim težinama
- Bellman-Ford → kada postoje negativne težine (sporiji, ali tačan)

Za ispit obavezno znati da nacrtam trag algoritma na papiru, ne samo pseudokod.
`,
  },
  {
    folderKey: "faks",
    createdOffsetDays: -165,
    revisitAfterDays: 45,
    tags: ["faks"],
    body: `# Baze podataka — normalizacija

Normalizacija je proces organizovanja tabela tako da se smanji redundansa i
spreče anomalije pri unosu, izmeni i brisanju podataka.

## 1NF

Svaka kolona sadrži atomsku vrednost, nema ponavljajućih grupa. Ako imam
kolonu "telefoni" sa više brojeva odvojenih zarezom, to krši 1NF — svaki broj
ide u svoj red.

## 2NF

Tabela je u 1NF i svaki neključni atribut zavisi od CELOG složenog ključa, ne
samo od dela. Ovo je bitno kod tabela sa kompozitnim primarnim ključem.

## 3NF

Tabela je u 2NF i nema tranzitivnih zavisnosti — neključni atribut ne sme da
zavisi od drugog neključnog atributa.

Primer sa vežbi: tabela Narudžbina(id, kupac_id, kupac_ime, proizvod_id,
cena_proizvoda) krši 3NF jer kupac_ime zavisi od kupac_id, a ne direktno od
ključa narudžbine. Rešenje je razdvajanje u Kupac i Proizvod tabele, povezane
spoljnim ključevima.

- 1NF — atomske vrednosti
- 2NF — puna funkcionalna zavisnost od ključa
- 3NF — nema tranzitivnih zavisnosti
- BCNF — stroža verzija 3NF, svaka determinanta je kandidat-ključ

Vratio sam se na ovo pred ispit i dodao primer — ranije mi normalizacija nije
bila jasna bez konkretne tabele.
`,
  },
  {
    folderKey: "faks",
    createdOffsetDays: -150,
    body: `# Operativni sistemi — planiranje procesa

Planer (scheduler) bira koji proces dobija CPU sledeći. Cilj je balans
između propusnosti, vremena odziva i pravičnosti.

- **FCFS** (first come, first served) — jednostavan, ali loš kada dugi proces
  blokira kratke (konvoj efekat).
- **SJF** (shortest job first) — optimalan po prosečnom vremenu čekanja, ali
  zahteva da znamo trajanje unapred, što u praksi retko važi.
- **Round Robin** — svaki proces dobija vremenski kvant, pa ide na kraj reda.
  Dobar za interaktivne sisteme; veličina kvanta je kompromis između odziva i
  režijskih troškova prebacivanja konteksta.
- **Prioritetno planiranje** — rizik od izgladnjivanja niskoprioritetnih
  procesa, rešava se starenjem (aging) prioriteta.

Za ispit: umeti nacrtati Gantov dijagram za dati skup procesa i izračunati
prosečno vreme čekanja za svaki algoritam.
`,
  },
  {
    folderKey: "faks",
    createdOffsetDays: -120,
    revisitAfterDays: 75,
    tags: ["faks", "učenje"],
    body: `# Veštačka inteligencija — beleške sa predavanja

## Neuron i aktivacione funkcije

Veštački neuron računa težinsku sumu ulaza plus bias, pa provlači kroz
aktivacionu funkciju. Bez nelinearne aktivacije, cela mreža bi se svela na
jednu linearnu transformaciju bez obzira na broj slojeva.

- Sigmoid — izlaz (0,1), problem nestajućeg gradijenta u dubokim mrežama
- ReLU — max(0, x), brz za računanje, standardni izbor za skrivene slojeve
- Softmax — za izlazni sloj kod klasifikacije sa više klasa, izlazi sumiraju
  na 1

## Propagacija unazad (backpropagation)

Lančano pravilo primenjeno unazad kroz slojeve — računa gradijent funkcije
greške u odnosu na svaku težinu. Gradient descent zatim pomera težine u
pravcu suprotnom od gradijenta, korakom koji određuje stopa učenja (learning
rate).

Bitna napomena sa vežbi: prevelika stopa učenja divergira (loss skače),
premala presporo konvergira. Adam optimizator adaptivno menja stopu po
parametru i u praksi je skoro uvek bolji početni izbor od običnog SGD-a.

## Overfitting

Model previše nauči trening skup, uključujući šum, i loše generalizuje.
Rešenja: regularizacija (L2), dropout, rani prekid treniranja (early
stopping) na osnovu validacionog skupa.

Dopunio sam ove beleške posle konsultacija — profesor je objasnio zašto je
batch normalization bitna za stabilnost treniranja, to mi je promaklo prvi
put.
`,
  },
  {
    folderKey: "faks",
    createdOffsetDays: -95,
    body: `# Kompajleri — leksička analiza

Prva faza kompajlera — pretvara niz karaktera izvornog koda u niz tokena
(leksema). Radi preko konačnog automata generisanog iz regularnih izraza koji
opisuju svaki tip tokena.

- Identifikator: \`[a-zA-Z_][a-zA-Z0-9_]*\`
- Ceo broj: \`[0-9]+\`
- Operator: \`+ - * / = == != <= >=\`

Leksički analizator (lekser) mora da primeni pravilo najdužeg podudaranja
(maximal munch) — kod \`<=\` ne sme da pročita samo \`<\` pa stane, mora da
proveri da li sledeći karakter produžava token.

Greške na ovom nivou su npr. nepoznat karakter ili nezatvoren string literal
— lekser ih prijavljuje sa brojem linije i kolone, što je razlog zašto se
linija i kolona prate tokom čitanja ulaza.

Sledeća faza je sintaksna analiza (parsing), koja od niza tokena gradi
stablo sintakse — to su sledeće beleške.
`,
  },
  {
    folderKey: "faks",
    createdOffsetDays: -60,
    body: `# Mrežni protokoli — TCP/IP sloj

Kratak pregled slojeva pred kolokvijum iz računarskih mreža.

TCP je protokol orijentisan na konekciju — uspostavlja vezu preko troputnog
rukovanja (SYN, SYN-ACK, ACK), garantuje isporuku i redosled paketa preko
potvrda i retransmisije. UDP nema ništa od toga — brži je, koristi se kod
striminga i DNS upita gde je gubitak paketa prihvatljiviji od kašnjenja koje
TCP unosi retransmisijama.

IP sloj se bavi rutiranjem — svaki paket nosi izvornu i odredišnu adresu, a
ruteri odlučuju sledeći skok na osnovu tabele rutiranja. IPv4 adresa je 32
bita, zato je iscrpljena i zato postoji IPv6 sa 128 bita.

Da proverim pred kolokvijum: razlika između TCP i UDP zaglavlja, i kako
subnet maska deli adresu na deo mreže i deo hosta.
`,
  },
  {
    folderKey: "faks",
    createdOffsetDays: -13,
    revisitAfterDays: 12,
    pinned: true,
    tags: ["faks", "hitno"],
    body: `# Priprema za odbranu diplomskog rada

Lista svega što mora biti spremno pre odbrane. Ažuriram kako prolazim kroz
stavke.

- [x] Finalna verzija rada predata mentoru na pregled
- [x] Ispravke po komentarima mentora unete
- [x] Prezentacija — prva verzija (15 slajdova)
- [x] Uvezana verzija predata u studentsku službu
- [ ] Vežbanje usmenog izlaganja — bar tri puta naglas, sa štopericom
- [ ] Pripremiti odgovore na očekivana pitanja komisije o metodologiji
- [ ] Proveriti da demo aplikacija radi na laptopu koji nosim na odbranu (ne
      na fakultetskom računaru!)
- [ ] Odštampati rezervnu kopiju prezentacije na USB-u
- [ ] Obući se prigodno, poneti ličnu kartu i indeks

Najveći rizik je pitanje o alternativnim pristupima koje nisam obradio u
radu — pripremiti jasno obrazloženje zašto je izabrani pristup bolji za ovaj
konkretan problem.
`,
  },

  // --- Projekti ----------------------------------------------------------
  {
    folderKey: "projekti",
    createdOffsetDays: -80,
    revisitAfterDays: 77,
    pinned: true,
    tags: ["projekat", "ideja"],
    body: `# Nexus — roadmap ideje

Slobodne beleške o pravcu razvoja — ne sve će ući u finalnu verziju, ovo je
mesto da zapišem ideju pre nego što je zaboravim.

## Kratkoročno

- Doraditi pretragu da rangira po relevantnosti, ne samo po datumu
- Dodati brzi prečac za kreiranje beleške iz bilo kog ekrana
- Poboljšati praznu državu (empty state) svake sekcije — trenutno deluje
  prazno i nedovršeno

## Srednjoročno

- Widget dashboard koji povlači podatke iz više modula odjednom
- Izvoz čitavog profila u čitljiv arhivski format, ne samo baza
- Tamna i svetla tema moraju biti dosledne do poslednjeg piksela — ovo je
  stalni posao, ne jednokratan zadatak

## Dugoročno (posle desktop verzije)

Web verzija iz istog koda — Electron i React već su birani sa tim na umu.
Sinhronizacija između uređaja dolazi tek kad desktop verzija bude potpuno
zrela. Prioritet je da proizvod prvo bude odličan lokalno, pa tek onda da se
širi.

Vratio sam se da dodam stavku o widget dashboard-u — to mi je sinoć palo na
pamet dok sam gledao kako druge aplikacije organizuju početni ekran.
`,
  },
  {
    folderKey: "projekti",
    createdOffsetDays: -55,
    body: `# API dizajn za RAG sistem

Beleške dok razmišljam o arhitekturi malog retrieval-augmented generation
sistema za ličnu bazu znanja.

Osnovni tok: upit korisnika se prvo pretvara u embedding vektor, pa se
poredi sa vektorima dokumenata u vektorskoj bazi (ChromaDB za početak, laka
za lokalni razvoj). Top-k najsličnijih odlomaka se ubacuje u kontekst
prompta zajedno sa originalnim pitanjem, i tek onda ide poziv modelu.

Pitanja koja još nisam rešio:

- Kako seckati dugačke dokumente na odlomke — fiksna dužina je jednostavna
  ali seče rečenice na pola. Semantičko seckanje po pasusima je bolje, ali
  sporije za implementaciju.
- Da li čuvati istoriju razgovora u istom kontekstu ili raditi rewriting
  upita na osnovu prethodnih poruka pre pretrage.
- Reranking posle prvog retrieval-a — vredi li dodatna latencija.

Za sad pravim najprostiju moguću verziju da imam nešto što radi, pa tek onda
optimizujem kvalitet retrieval-a.
`,
  },
  {
    folderKey: "projekti",
    createdOffsetDays: -30,
    revisitAfterDays: 20,
    tags: ["projekat", "posao"],
    body: `# Refaktorisanje autentifikacije

Plan za čišćenje modula za autentifikaciju pre nego što dodam još
funkcionalnosti na njega.

- [x] Izdvojiti validaciju lozinke u posebnu funkciju sa testovima
- [x] Ukloniti duplirani kod za proveru sesije iz tri različita fajla
- [x] Zameniti ručno poređenje niski (string) za tokene vremenski konstantnom
      funkcijom
- [ ] Dodati testove za granične slučajeve (prazna lozinka, prekoračenje
      dužine, Unicode karakteri)
- [ ] Dokumentovati tok osvežavanja tokena (refresh flow) — trenutno postoji
      samo u mojoj glavi
- [ ] Proveriti da svaka greška vraća generičku poruku korisniku, bez
      otkrivanja da li nalog postoji

Najveći dug je nedostatak testova za granične slučajeve — to je sledeće na
redu pre bilo kakve nove funkcionalnosti.
`,
  },
  {
    folderKey: "projekti",
    createdOffsetDays: -12,
    body: `# Ideja: alat za praćenje navika

Mala, fokusirana aplikacija — samo lista navika i mreža kvadratića kao kod
GitHub contribution grafa. Nikakvih gejmifikacija sa bedžovima i nivoima, to
brzo postane sopstveni cilj umesto navike.

Jedina "pametna" stvar bi bila serija (streak) i podsetnik koji se ne
oglašava ako je navika već označena tog dana. Sve ostalo — statistika,
izvoz, deljenje — nepotrebno je za prvu verziju.
`,
  },
  {
    folderKey: "projekti",
    createdOffsetDays: -8,
    revisitAfterDays: 7,
    tags: ["projekat", "posao"],
    body: `# Portfolio sajt — TODO lista

- [x] Sekcija sa projektima — kartice sa kratkim opisom i linkom ka
      repozitorijumu
- [x] Sekcija O meni — kratka, bez fraza tipa "strastven programer"
- [x] Responsive prelamanje za mobilne uređaje
- [ ] Dodati sekciju sa sertifikatima i kursevima
- [ ] Optimizovati slike — trenutna veličina stranice je prevelika
- [ ] Proveriti kontrast boja za pristupačnost (accessibility)
- [ ] Povezati kontakt formu sa mejlom
- [ ] Deploy i provera na stvarnom domenu, ne samo lokalno

Cilj je da ovo bude gotovo pre nego što počnem aktivno da se javljam na
oglase.
`,
  },
  {
    folderKey: "projekti",
    createdOffsetDays: -45,
    revisitAfterDays: 27,
    tags: ["faks", "projekat"],
    body: `# Diplomski rad — struktura poglavlja

Radna struktura, menja se kako pišem.

1. Uvod — motivacija, problem, ciljevi rada
2. Pregled srodnih radova — šta postoji, gde su ograničenja postojećih
   pristupa
3. Metodologija — arhitektura predloženog rešenja, korišćene tehnologije i
   zašto baš one
4. Implementacija — ključni delovi sistema, sa naglaskom na ono što je
   originalni doprinos
5. Evaluacija — metodologija testiranja, rezultati, poređenje sa
   alternativama
6. Zaključak — šta je postignuto, ograničenja, pravci za dalji rad

Mentor je predložio da poglavlje o evaluaciji bude opširnije i da uključi i
kvalitativnu analizu, ne samo brojke — to je razlog za ovu izmenu strukture.
`,
  },

  // --- Recepti -------------------------------------------------------------
  {
    folderKey: "recepti",
    createdOffsetDays: -200,
    tags: ["recept"],
    body: `# Sarma

Zimski klasik, ide sporo ali se isplati. Za veći lonac, dovoljno za šest do
osam osoba.

## Sastojci

- 1 tegla kiselog kupusa (listovi, ne seckan)
- 500 g mlevenog mesa (pola svinjsko, pola juneće)
- 1 šolja pirinča
- 2 crna luka, sitno seckana
- 1 kašika slatke aleve paprike
- so, biber, malo ulja
- dimljena slanina ili rebarca za dno lonca

## Priprema

1. Izdvojiti listove kupusa, ispariti previše kisele delove pod mlazom vode.
2. Propržiti luk na ulju dok ne omekša, ostaviti da se prohladi.
3. Pomešati meso, pirinač, propržen luk, alevu papriku, so i biber — fil
   treba da bude ujednačen.
4. Na svaki list staviti kašiku fila, uviti u čvrst zamotuljak, presavijajući
   krajeve prema unutra.
5. Na dno lonca poređati slaninu ili rebarca, pa slagati sarme čvrsto jednu
   do druge.
6. Preliti vodom da pokrije sarme, dodati malo alevapaprike u vodu za boju.
7. Kuvati na laganoj vatri tri do četiri sata — što duže, to bolje, ukusi se
   stope.

Najvažnija lekcija iz prošlog pokušaja: ne žuriti sa vatrom. Na jačoj vatri
se kupus raspada pre nego što se fil skuva do kraja.
`,
  },
  {
    folderKey: "recepti",
    createdOffsetDays: -175,
    body: `# Karađorđeva šnicla

Svinjski but rasečen i naslagan u rolat, punjen kajmakom, uvaljan i pržen —
brže od sarme, dobro za goste kad nema vremena za dugo kuvanje.

## Sastojci

- svinjski but, iseckan na tanke šnicle i istučen
- kajmak (ili gusti sir po ukusu)
- brašno, jaje, prezle za pohovanje
- ulje za prženje
- tartar sos za serviranje

## Priprema

Šniclu istući tanko, staviti kašiku kajmaka na sredinu, uviti u rolat i
osigurati čačkalicom ili koncem za kuvanje. Uvaljati redom u brašno, umućeno
jaje, pa u prezle. Pržiti na dubokom ulju dok ne porumeni sa svih strana.
Ukloniti čačkalicu pre serviranja i poslužiti uz tartar sos i pomfrit.

Trik koji sam naučio od komšinice: dodati malo rendanog sira u kajmak, manje
curi tokom prženja.
`,
  },
  {
    folderKey: "recepti",
    createdOffsetDays: -140,
    tags: ["recept"],
    body: `# Prebranac

Pasulj sa puno luka, pečen u rerni — pravi se dan unapred, sledećeg dana je
još bolji.

Uveče preliti pasulj hladnom vodom. Sledeći dan skuvati do polumekoće u
svežoj vodi, sa listom lovora. U međuvremenu ispržiti dosta
crnog luka na ulju dok ne postane zlatan, dodati alevu papriku van vatre da
ne izgori. Pasulj oceniti (sačuvati malo tečnosti), pomešati sa lukom u
vatrostalnoj posudi, dodati so, biber, malo tečnosti od kuvanja i peći u
rerni na 180 stepeni dok se ne stvori zlatna korica na vrhu, oko sat
vremena.

Ključna stvar je količina luka — mora ga biti gotovo koliko i pasulja, to je
ono što razlikuje prebranac od običnog kuvanog pasulja.
`,
  },
  {
    folderKey: "recepti",
    createdOffsetDays: -60,
    body: `# Palačinke

Brz recept za kad nema vremena. Testo za oko petnaest tankih palačinki.

- [x] Umutiti 2 jaja sa prstohvatom soli
- [x] Dodati 300 ml mleka i 150 ml vode, umutiti
- [x] Postepeno umešati 200 g brašna da nema grudvica
- [x] Ostaviti testo da odstoji 15 minuta
- [ ] Ispeći na dobro zagrejanom tiganju, tanak sloj ulja između svake

Testo mora biti tečno kao voda — ako je gusto, palačinke ispadnu debele i
gumene. Punim ih najčešće domaćom pekmezom od šljiva ili nutelom za decu kad
dođu u posetu.
`,
  },
  {
    folderKey: "recepti",
    createdOffsetDays: -230,
    tags: ["recept"],
    body: `# Ajvar — zimnica

Jesenji ritual — pravim veću količinu odjednom da traje preko cele zime.

## Priprema paprika

Pečem crvenu babura papriku i patlidžan na roštilju ili u rerni dok kožica
ne pocrni sa svih strana, pa ih odmah stavljam u zatvorenu činiju ili kesu
da se pare — kožica tada skida sama, bez guljenja nožem.

## Kuvanje

Oljuštene paprike i patlidžan sameljem ili iseckam sitno, pa kuvam na
laganoj vatri uz povremeno mešanje, sa uljem, malo soli i sirćeta. Kuva se
dugo — sat i po do dva — dok voda ne ispari i ajvar ne postane gust.

## Zatvaranje tegli

- [x] Sterilisati tegle i poklopce ključalom vodom
- [x] Ajvar sipati vreo u suve, tople tegle
- [x] Zatvoriti odmah, dok je vruće
- [x] Okrenuti tegle naglavačke dok se ne ohlade potpuno
- [ ] Etiketirati sa datumom pravljenja
- [ ] Odneti u ostavu, podalje od svetla

Ove godine sam dodao malo više patlidžana nego prošle — ispalo je blaže,
manje ljuto, baš kako volimo.
`,
  },
  {
    folderKey: "recepti",
    createdOffsetDays: -13,
    tags: ["recept"],
    body: `# Musaka

Slojevi krompira i mlevenog mesa, preliveni belim sosom — najbolje se jede
sledećeg dana, kad se slojevi slegnu.

Krompir isečen na kolutove propržiti kratko na ulju, samo da porumeni, ne
do kraja pečen. Meso propržiti sa lukom, so, biber, malo alevapaprike.
Ređati naizmenično sloj krompira, sloj mesa, ponoviti. Preko svega preliti
beli sos — puter, brašno, mleko, kuvano dok se ne zgusne, sa jajetom
umešanim na kraju van vatre da se ne zgruša. Peći na 180 stepeni oko 40
minuta dok vrh ne porumeni.

Danas mi je prvi put ispao beli sos bez grudvica — trik je da se mleko sipa
postepeno, malo po malo, uz stalno mešanje.
`,
  },

  // --- Putovanja -----------------------------------------------------------
  {
    folderKey: "putovanja",
    createdOffsetDays: -100,
    body: `# Vikend u Zlatiboru

Kratak beg iz grada, dva dana. Vreme je bilo skoro savršeno — sunčano danju,
hladno uveče, baš kako treba za planinu.

Prvog dana šetnja do Zlatiborskog jezera, pa uveče večera u restoranu sa
domaćom hranom — proja sa sirom i kajmakom bila je bolja nego što sam
očekivao. Drugog dana kratka tura ka Gostilju, vodopadi su bili manji nego
na fotografijama koje sam video ranije, ali vožnja kroz šumu je vredela sama
po sebi.

Sledeći put vredi ostati duže — dva dana su premalo da se vidi i Mokra Gora
sa Šarganskom osmicom, to je ostalo za sledeći put.
`,
  },
  {
    folderKey: "putovanja",
    createdOffsetDays: -70,
    revisitAfterDays: 30,
    tags: ["putovanje"],
    body: `# Plan puta — Grčka, leto

Grubi plan, menjaće se kad budemo rezervisali smeštaj.

## Dan 1-3 — Solun

Sletanje, upoznavanje grada, promenada uz more, Bela kula. Solun je izabran
kao ulazna tačka jer je let jeftiniji nego direktno na ostrva.

## Dan 4-7 — Halkidiki

Iznajmljivanje auta u Solunu, vožnja do Sitonije. Plaže manje gužve nego
Kasandra po onome što sam čitao, prioritet je opuštanje, ne obilazak.

## Dan 8-10 — povratak preko Meteora

Usput stati kod manastira Meteora — obavezno rano ujutru zbog gužve i
vrućine kasnije tokom dana.

## Za pripremiti

- [x] Rezervisati letove
- [x] Proveriti validnost pasoša (ne ističe u narednih 6 meseci)
- [ ] Rezervisati smeštaj za Solun i Sitoniju
- [ ] Iznajmiti auto — proveriti da li treba međunarodna vozačka
- [ ] Kupiti putno osiguranje
- [ ] Skinuti mape offline za slučaj lošeg signala

Dodao sam stavku o pasošu pošto sam proverio da ističe za osam meseci — taman
na ivici, ali prošao je proveru.
`,
  },
  {
    folderKey: "putovanja",
    createdOffsetDays: -160,
    body: `# Beleške sa puta — Budimpešta

Vikend u Budimpešti, prvi put sa autobusom umesto avionom — iznenađujuće
udobno, i jeftinije.

Termalna kupatila Sečenji su vredela svake pohvale, posebno uveče kad je
manje gužve i osvetljenje je posebno lepo. Zgrada Parlamenta izgleda
impresivnije uživo nego na slikama, pogotovo sa druge strane Dunava uveče
kad je osvetljena. Hrana je bila mešovita — gulaš je bio odličan u jednom
malom restoranu van turističke zone, dok je isti taj gulaš u restoranu blizu
centra bio prilično bezukusan i preskup.

Pouka za sledeći put: tražiti restorane bar deset minuta hoda od glavnih
turističkih tačaka, razlika u kvalitetu i ceni je ogromna.
`,
  },
  {
    folderKey: "putovanja",
    createdOffsetDays: -9,
    pinned: true,
    tags: ["putovanje"],
    body: `# Lista za pakovanje — planinarenje

- [x] Planinarske cipele, uhodane, ne nove
- [x] Vodootporna jakna
- [x] Ranac 30-40 l sa pojasom za kukove
- [x] Termos i dovoljno vode
- [ ] Prva pomoć — mala apoteka
- [ ] Baterijska lampa ili čeona lampa sa rezervnim baterijama
- [ ] Energetski barovi i orašasti plodovi
- [ ] Mapa staze skinuta offline, i papirna kao rezerva
- [ ] Punjena power banka za telefon

Naučeno iz prošlog izleta: nikad ne krenuti bez papirne mape, telefon je
ostao bez signala baš na najkritičnijoj raskrsnici staze.
`,
  },
  {
    folderKey: "putovanja",
    createdOffsetDays: -5,
    tags: ["putovanje", "ideja"],
    body: `# Ideje za sledeće putovanje

Brza lista mesta koja me privlače, bez konkretnog plana za sada.

- Crna Gora — Durmitor, planinarenje i kanjon Tare
- Portugal — Lisabon i Porto, čuo sam da je hrana odlična i jeftinija nego
  ostatak zapadne Evrope
- Bosna — Mostar i vodopadi Kravice, blizu je i lako za vikend
- Island — skuplje i ambicioznije, za kad budžet dozvoli

Prioritet za sledeću sezonu je verovatno Crna Gora — najbliže, najjeftinije,
i dovoljno za samo produženi vikend.
`,
  },

  // --- Čitanje ---------------------------------------------------------
  {
    folderKey: "citanje",
    createdOffsetDays: -220,
    revisitAfterDays: 40,
    tags: ["knjiga"],
    body: `# Sapiens — Juval Noa Harari

Istorija čovečanstva kroz tri revolucije — kognitivnu, poljoprivrednu i
naučnu. Knjiga koja menja perspektivu na to šta uopšte znači "napredak".

## Kognitivna revolucija

Pre oko 70.000 godina Homo sapiens razvija sposobnost da veruje u zajedničke
fikcije — mitove, religije, nacije, novac. Hararijeva teza je da baš ta
sposobnost, a ne inteligencija sama po sebi, omogućava saradnju u velikim
grupama nepoznatih ljudi, nešto što nijedna druga vrsta ne ume.

## Poljoprivredna revolucija

Naziva je "najvećom prevarom u istoriji" — poljoprivreda je omogućila veće
populacije, ali je prosečnom pojedincu donela lošiju ishranu, više rada i
lošije zdravlje nego kod lovaca-sakupljača. Zanimljiva teza, iako pomalo
pojednostavljena.

## Naučna revolucija

Počinje priznanjem neznanja — spremnošću da se kaže "ne znamo" i da se to
neznanje aktivno istražuje, umesto oslanjanja na svete tekstove kao izvor
svih odgovora.

Delovi o budućnosti i biotehnologiji su me manje ubedili nego istorijski deo
— deluju spekulativnije. Vredi pročitati bar prva dva dela knjige, čak i ako
se preskoči poslednji.

Vratio sam se da dodam ovaj poslednji pasus posle druge polovine knjige —
prvobitne beleške su pokrivale samo prvi deo.
`,
  },
  {
    folderKey: "citanje",
    createdOffsetDays: -130,
    body: `# Majstor i Margarita — beleške

Bulgakovljev roman koji meša satiru na sovjetsko društvo, ljubavnu priču i
teološku fantastiku — trebalo mi je poglavlje-dva da se naviknem na taj
ritam.

> Rukopisi ne gore.

Ova rečenica mi je ostala najduže u glavi — ideja da istina i umetnost
prežive uništenje, čak i kad ih sistem pokuša da zbriše. Voland i njegova
svita unose haos u Moskvu na način koji je istovremeno komičan i jezivo
tačan kao slika birokratije i straha.

Poglavlja o Pontiju Pilatu, umetnuta kroz roman Majstora, deluju kao
potpuno druga knjiga po tonu — ozbiljnija, sporija. Trebalo mi je vreme da
shvatim zašto su tu, ali na kraju se sve poveže oko teme oprosta i
kukavičluka.
`,
  },
  {
    folderKey: "citanje",
    createdOffsetDays: -85,
    tags: ["knjiga", "lično"],
    body: `# Atomske navike — Džejms Klir

Praktična knjiga, malo ponavljanja ali dobre ideje koje sam odmah pokušao
da primenim.

- Fokus na sistem, ne na cilj — cilj je pravac, sistem je ono što
  svakodnevno radiš.
- Identitet pre ponašanja — pitanje nije "želim da trčim", nego "želim da
  budem osoba koja trči". Promena identiteta je trajnija od discipline.
- Pravilo dva minuta — nova navika treba da traje manje od dva minuta na
  početku, da se savlada prag pokretanja pre nego što se gradi trajanje.
- Habit stacking — nova navika se veže za postojeću rutinu ("posle jutarnje
  kafe, pet minuta istezanja").
- Okruženje oblikuje ponašanje više nego motivacija — ako ne želim da jedem
  grickalice, ne treba da ih uopšte imam u kući.

Najkorisniji deo za mene je bilo pravilo dva minuta — direktno sam primenio
na čitanje, počeo sam sa "pročitaj jednu stranu" umesto sa ambicioznim
ciljem po danu, i sada čitam duže gotovo svaki dan.
`,
  },
  {
    folderKey: "citanje",
    createdOffsetDays: -50,
    body: `# 1984 — Džordž Orvel

Drugo čitanje, ovog puta sa više pažnje na jezik nego na priču samu.

Novogovor kao alat kontrole je ono što me je ovog puta najviše zaintrigiralo
— ideja da ako se iz jezika ukloni reč za koncept, postaje teže i samu
misao formulisati. To je strašnija ideja od same nadzorne kamere ili
telekrana, jer napada mišljenje pre nego što stigne do akcije.

Vinstonov slom pod pritiskom u Ministarstvu ljubavi i dalje je jednako
neprijatan za čitanje koliko je bio i prvi put — Orvel ne dozvoljava nadu na
kraju, i baš ta odsutnost olakšanja je razlog zašto knjiga ostaje toliko
upečatljiva decenijama kasnije.
`,
  },
  {
    folderKey: "citanje",
    createdOffsetDays: -35,
    revisitAfterDays: 21,
    tags: ["knjiga", "projekat"],
    body: `# Čista arhitektura — Robert Martin

Tehnička knjiga o dizajnu softvera, čitam paralelno sa radom na sopstvenim
projektima da odmah primenim ono što pročitam.

## Pravilo zavisnosti

Zavisnosti izvornog koda mogu da idu samo ka unutra, prema poslovnoj logici
— spoljni slojevi (baza, UI, framework) zavise od unutrašnjih, nikad
obrnuto. Poslovna logika ne sme da zna ništa o bazi podataka koju koristi.

## Granice (boundaries)

Interfejsi razdvajaju slojeve tako da se detalj implementacije (npr. koja
baza) može zameniti bez dodirivanja poslovne logike. Ovo je apstraktnije od
onoga što sam ranije mislio da je "dobra arhitektura" — nije o folderima i
imenima fajlova, nego o pravcu zavisnosti.

## Kritika koju sam pokupio iz diskusija online

Neki delovi deluju kao preterivanje za male projekte — puna slojevita
arhitektura za mali skript je overengineering. Vredi primeniti principe
selektivno, prema veličini i životnom veku projekta, ne kao dogmu.

Vratio sam se na ovo poglavlje o granicama posle rasprave sa kolegom o tome
kako da strukturiramo API sloj na poslu — druga polovina beleški je nastala
tim povodom.
`,
  },
  {
    folderKey: "citanje",
    createdOffsetDays: -6,
    revisitAfterDays: 5,
    tags: ["knjiga"],
    body: `# Lista knjiga za pročitati

- [x] Sapiens — Juval Noa Harari
- [x] Atomske navike — Džejms Klir
- [x] 1984 — Džordž Orvel
- [ ] Dizajn podatkovno intenzivnih aplikacija — Martin Kleppmann
- [ ] Tanki oglasi — o istoriji reklame (radni naslov, ne pamtim tačan)
- [ ] Braća Karamazovi — Dostojevski, odlažem jer je debela ali mora jednom
- [ ] Misliti brzo i sporo — Danijel Kaneman

Dodao Kleppmanovu knjigu na vrh liste posle preporuke sa posla — kažu da je
obavezna za svakog ko radi sa distribuiranim sistemima.
`,
  },

  // --- Ideje -----------------------------------------------------------
  {
    folderKey: "ideje",
    createdOffsetDays: -25,
    tags: ["ideja", "učenje"],
    body: `# Ideja — AI agent za organizaciju studiranja

Agent koji na osnovu silabusa predmeta i datuma ispita sam pravi plan
učenja — koliko gradiva dnevno, sa bafer danima pred kraj. Ne mora biti
pametan u smislu da razume gradivo, dovoljno je da dobro raspoređuje vreme i
podseća.

Zanimljivo bi bilo da povuče i istoriju — koliko sam realno ispoštovao
prethodne planove — i da na osnovu toga koriguje procenu koliko mi vremena
stvarno treba, umesto da veruje optimističnoj proceni koju sam ja uneo.
`,
  },
  {
    folderKey: "ideje",
    createdOffsetDays: -11,
    body: `# Mala igra za učenje srpskog jezika

Ideja za sitan pet projekat — igra pogađanja padeža za strance koji uče
srpski. Rečenica sa praznim mestom, ponuđene opcije padeža, tačan odgovor
otključava sledeće pitanje.

Najveći izazov nije programiranje nego sadržaj — trebalo bi na desetine
rečenica po svakom padežu da igra ne bude ponavljajuća posle pet minuta.
`,
  },
  {
    folderKey: "ideje",
    createdOffsetDays: -7,
    tags: ["posao", "ideja"],
    body: `# Unapređenje CV-a

- [x] Ažurirati sekciju sa projektima — dodati Nexus
- [x] Skratiti opis svakog iskustva na najviše tri reda
- [ ] Dodati merljive rezultate gde god mogu (ne samo "radio sam na X", nego
      šta je to donelo)
- [ ] Proveriti da li je format čitljiv za ATS sisteme koje kompanije koriste
      za skrining
- [ ] Napraviti verziju na engleskom, ne samo prevod reč po reč
- [ ] Zamoliti nekoga da pročita pre slanja — svež pogled hvata greške koje
      ja više ne vidim

Prioritet je sekcija sa merljivim rezultatima — trenutni CV zvuči kao lista
zaduženja, ne postignuća.
`,
  },
  {
    folderKey: "ideje",
    createdOffsetDays: -4,
    body: `# Beleška sa razgovora o poslu

Utisci odmah posle razgovora, dok su sveži.

Pitanja su bila fokusirana na sistemski dizajn i konkretne odluke iz
prethodnih projekata, manje na teorijska pitanja iz udžbenika — to mi je
odgovaralo, lakše mi je da pričam o stvarnim odlukama nego da recitujem
definicije. Jedno pitanje me je uhvatilo nespremnog — o tome kako bih
skalirao sistem kad broj korisnika naraste deset puta, nisam imao razrađen
odgovor unapred.

Za sledeći razgovor: pripremiti unapred po jedan konkretan primer za svaku
veliku temu (skaliranje, testiranje, timski rad, rešavanje konflikta)
umesto da improvizujem u trenutku.
`,
  },
  {
    folderKey: "ideje",
    createdOffsetDays: -2,
    tags: ["ideja"],
    body: `# Ideja za sadržaj bloga

Teme koje bih voleo da razradim, redom kako mi padaju na pamet:

- Kako sam napravio prvi RAG sistem — greške koje sam napravio i šta bih
  drugačije
- Iskustvo sa diplomskim radom — od izbora teme do odbrane
- Poređenje lokalnih modela za razvoj — šta stvarno radi na običnom laptopu
- Zašto sam prešao na TypeScript strict mod za lične projekte

Prva tema je verovatno najkorisnija drugima — najmanje je pisano o tome na
srpskom.
`,
  },
  {
    folderKey: "ideje",
    createdOffsetDays: -1,
    body: `# Random misao o produktivnosti

Manje planiranja, više startovanja — često provedem više vremena praveći
listu zadataka nego što bi mi trebalo da uradim prvi od njih. Probaj sutra
da preskočiš listu i samo počneš.
`,
  },

  // --- Lični razvoj --------------------------------------------------------
  {
    folderKey: "razvoj",
    createdOffsetDays: -40,
    revisitAfterDays: 37,
    pinned: true,
    tags: ["lično", "zdravlje"],
    body: `# Ciljevi za drugu polovinu godine

## Posao / karijera

Aktivno se javljati na pozicije, bar tri prijave nedeljno umesto povremenog
pregledavanja oglasa. Završiti diplomski rad i odbraniti ga pre kraja
perioda.

## Zdravlje

Trčanje tri puta nedeljno, čak i kratko kad nema vremena za duže. Manje kafe
posle 16h — spavanje mi je bolje kad to poštujem.

## Učenje

Jedan tehnički kurs do kraja, ne skakati sa kursa na kurs bez završavanja.
Čitanje bar deset strana dnevno, svejedno tehnička knjiga ili beletristika.

## Finansije

Odvajanje fiksnog procenta prihoda za štednju pre bilo koje potrošnje, ne
posle.

Vratio sam se da prekontrolišem ciljeve na pola perioda — trčanje ide
dobro, čitanje kasni, kurs sam pauzirao na pola. Realno postavljam prioritet
za preostali deo perioda: prvo diplomski, pa posao, ostalo kako stigne.
`,
  },
  {
    folderKey: "razvoj",
    createdOffsetDays: -4,
    body: `# Refleksija posle razgovora za posao

Ne o samom razgovoru nego o tome kako sam se osećao — nervoza je bila manja
nego prošli put, verovatno zato što sam imao jasniju predstavu šta da
očekujem.

Primetio sam da mi glas ubrza kad pričam o nečemu što mi je teško da
objasnim — svesno usporavanje pomaže. Isto tako, priznavanje "ne znam, ali
evo kako bih pristupio" zvuči mnogo bolje uživo nego što sam mislio da hoće
— iskrenost deluje kao samopouzdanje, ne kao slabost.
`,
  },
  {
    folderKey: "razvoj",
    createdOffsetDays: -60,
    revisitAfterDays: 50,
    tags: ["lično", "zdravlje"],
    body: `# Navike koje gradim

- [x] Ustajanje u isto vreme radnim danima, čak i bez alarma sada
- [x] Čaša vode odmah posle buđenja, pre kafe
- [x] Kratko istezanje pre spavanja
- [ ] Ograničiti društvene mreže na fiksno vreme dnevno, ne "po potrebi"
- [ ] Planiranje sledećeg dana veče pre, ne ujutru u žurbi
- [ ] Jedan dan nedeljno potpuno bez ekrana posle 20h

Prve tri su postale automatske, ne razmišljam više o njima. Sledeće na redu
je ograničavanje društvenih mreža — to mi je i dalje najteže, posebno uveče
kad sam umoran i nemam volje za disciplinu.
`,
  },
  {
    folderKey: "razvoj",
    createdOffsetDays: -20,
    body: `# Beleške sa meditacije

Deset minuta ujutru, treći mesec zaredom. Najveća promena nije u samoj
meditaciji nego van nje — primetim brže kad mi misli krenu u krug bez
izlaza, i lakše ih pustim umesto da ih pratim.

I dalje mi je teško sa fokusom na dah kad je dan pred sobom pun — um
automatski počne da pravi listu zadataka. Ne borim se više protiv toga,
samo primetim i vratim pažnju, bez frustracije zbog toga što je odlutala.
`,
  },
  {
    folderKey: "razvoj",
    createdOffsetDays: -100,
    tags: ["učenje", "lično"],
    body: `# Plan učenja engleskog — napredni nivo

Nivo je već solidan, cilj je sada nijansa — idiomi, prirodniji izgovor,
manje "udžbeničkog" fraziranja.

- Gledanje serija bez titlova, ili sa engleskim titlom umesto srpskog
- Čitanje tehničke dokumentacije naglas povremeno, radi izgovora
  terminologije
- Vođenje razgovora sa strancima kad god se ukaže prilika, umesto
  izbegavanja iz nelagode
- Slušanje podkasta o temama koje me već zanimaju na srpskom — lakše se
  prati sadržaj kad je tema poznata

Najveći napredak dolazi od razgovora uživo, ne od pasivnog slušanja — to mi
je jasno posle nekoliko meseci probanja različitih pristupa.
`,
  },

  // --- Finansije -----------------------------------------------------------
  {
    folderKey: "finansije",
    createdOffsetDays: -10,
    tags: ["finansije"],
    body: `# Budžet za avgust

- [x] Kirija — plaćeno prvog u mesecu
- [x] Struja i internet — plaćeno
- [ ] Rata za telefon
- [ ] Godišnje osiguranje za auto — dospeva krajem meseca
- [ ] Prebaciti fiksni procenat na štednju čim stigne plata

Ovog meseca dodatni trošak je osiguranje za auto, zato je budžet za izlaske
manji nego obično — prihvatljivo, dešava se svake godine u isto vreme, ne bi
trebalo da me iznenadi sledeći put.
`,
  },
  {
    folderKey: "finansije",
    createdOffsetDays: -75,
    body: `# Praćenje ušteđevine

Počeo sam da vodim jednostavnu evidenciju umesto da se oslanjam na osećaj
koliko štedim. Svakog prvog u mesecu upisujem stanje na štednom računu i
kratko zabeležim šta je uticalo na razliku u odnosu na prošli mesec.

Prva stvar koju sam primetio — najveće "curenje" novca nisu velike
jednokratne kupovine, nego sitni česti troškovi koje ne pamtim pojedinačno
(kafa napolju, dostava hrane). Sledeći korak je da ih pratim odvojeno bar
mesec dana da vidim stvarnu sumu.
`,
  },
  {
    folderKey: "finansije",
    createdOffsetDays: -55,
    tags: ["finansije", "ideja"],
    body: `# Ideje za dodatnu zaradu

- Frilens programiranje uveče i vikendom — najrealnije, direktno koristi
  postojeće veštine
- Tutorstvo iz programiranja za mlađe studente — manje plaćeno, ali
  fleksibilno oko ispita
- Prodaja sitnih alata/skripti koje već pravim za sebe, ako imaju širu
  primenu
- Pisanje tehničkih tekstova za blogove kompanija — vidim da neke kompanije
  plaćaju za to

Frilens je verovatno najbrži put do rezultata, ali zahteva vreme da se
izgradi prvih par klijenata i referenci.
`,
  },
  {
    folderKey: "finansije",
    createdOffsetDays: -130,
    body: `# Poređenje banaka za štednju

Kratko poređenje pre nego što otvorim novi štedni račun, da ne biram na
osnovu prve reklame koju vidim.

Razlike između banaka nisu ogromne u kamatnoj stopi, ali se dosta razlikuju
u uslovima — neke traže minimalni period da se kamata isplati u punom
iznosu, neke naplaćuju održavanje računa ako je stanje ispod određenog
praga. Bitno je pročitati sitna slova o prevremenom povlačenju sredstava,
jer tu je najveća razlika između ponuda koje na prvi pogled izgledaju
slično.

Odlučio sam se za banku koja nema minimalno stanje i gde mogu delimično da
povučem sredstva bez gubitka cele kamate — fleksibilnost mi je važnija od
par desetina dinara razlike u kamati.
`,
  },

  // --- Unfiled -------------------------------------------------------------
  {
    folderKey: null,
    createdOffsetDays: -3,
    body: `# Lozinka za ruter

Mreža: DOM-5G. Lozinka je na nalepnici sa donje strane rutera, ne ova koju
obično koristim — promenjena je posle poslednjeg restarta zbog problema sa
signalom.
`,
  },
  {
    folderKey: null,
    createdOffsetDays: -15,
    tags: ["lično"],
    body: `# Citat koji mi se svideo

> Disciplina je izabrati između onoga što želiš sada i onoga što želiš
> najviše.

Naišao sam na ovo slučajno i ostalo mi je u glavi ceo dan — jednostavno, ali
tačno pogađa gotovo svaku odluku koju odlažem.
`,
  },
  {
    folderKey: null,
    createdOffsetDays: -6,
    body: `# Ideja za poklon za mamu

Pomenula je da joj treba nova frenč presa za kafu, stara je napukla. Uz to
možda i kesica dobre kafe iz one male pržionice u centru koju je jednom
pohvalila.
`,
  },
  {
    folderKey: null,
    createdOffsetDays: -2,
    body: `# Majstor za klimu — kontakt

Preporuka od komšije, dolazi isti dan ako se javiš pre podne. Zvao za
servisiranje pred leto, ne za hitan kvar — zapisujem broj da ga ne tražim
ponovo iz grupe sa komšijama.
`,
  },
  {
    folderKey: null,
    createdOffsetDays: -1,
    tags: ["hitno"],
    body: `# Podsetnik — obnoviti pasoš

Ističe za četiri meseca — dovoljno blizu da počnem proces sada, pre nego
što postane hitno pred neko putovanje. Zakazati termin u MUP-u, poneti
staru ličnu kartu i dokaz o uplati takse.
`,
  },
  {
    folderKey: null,
    createdOffsetDays: 0,
    body: `# Random misao pred spavanje

Čudno je koliko ideja dođe baš u trenutku kad se ugasi svetlo i nema više
volje da se ustane i zapiše. Možda treba držati beležnicu doslovno pored
jastuka.
`,
  },
  {
    folderKey: null,
    createdOffsetDays: -8,
    revisitAfterDays: 7,
    body: `# Filmovi za pogledati

- [x] Oppenheimer
- [x] Duna: Drugi deo
- [ ] Zona interesovanja
- [ ] Prošlost je jedna zemlja stranaca (ako postoji na nekoj platformi)
- [ ] Pretraga (Searching) — preporuka od druga

Dodao dva nova naslova posle preporuke — lista se stalno puni brže nego što
se prazni.
`,
  },
];

/** One instant `offsetDays` from "today", at an hour/minute drawn from `rnd` — never `Date.now`. */
function stamp(ctx: DemoContext, rnd: DemoRandom, offsetDays: number): string {
  return new Date(demoAt(ctx, offsetDays, rnd.int(8, 23), rnd.int(0, 59))).toISOString();
}

function requireFolderId(folderIds: ReadonlyMap<string, string>, key: string): string {
  const id = folderIds.get(key);
  if (id === undefined) {
    throw new Error(`seedDemoNotes: unknown folder key "${key}".`);
  }
  return id;
}

export function seedDemoNotes(db: DatabaseHandle, ctx: DemoContext): void {
  const notes = new NoteStore(db, ctx.profileId);
  const org = new NoteOrgStore(db, ctx.profileId);
  const rnd = demoRandom("notes");

  const folderIds = new Map<string, string>();
  for (const folder of FOLDERS) {
    const created = org.createFolder(
      { parentId: null, name: folder.name, color: folder.color },
      stamp(ctx, rnd, folder.createdOffsetDays),
    );
    folderIds.set(folder.key, created.id);
  }

  // Tags are get-or-create (`NoteOrgStore.createTag`'s own rule) — cached here
  // too, so the same Serbian tag name is never created twice across notes.
  const tagIds = new Map<string, string>();
  const resolveTag = (name: string, now: string): string => {
    const existing = tagIds.get(name);
    if (existing !== undefined) return existing;
    const tag = org.createTag(name, now);
    tagIds.set(name, tag.id);
    return tag.id;
  };

  for (const spec of NOTES) {
    const createdAt = stamp(ctx, rnd, spec.createdOffsetDays);
    // A note nobody revisited keeps ONE instant for both stamps — `create`
    // and `appendUpdate` are still two calls (the only way the store writes a
    // note), but both carry `createdAt` so `updatedAt` never drifts from it.
    const updatedAt =
      spec.revisitAfterDays === undefined
        ? createdAt
        : stamp(ctx, rnd, Math.min(0, spec.createdOffsetDays + spec.revisitAfterDays));

    const parsed = parseMarkdownNote(spec.body.trim(), "Beleška");
    const update = buildNoteUpdate(parsed.blocks);

    const note = notes.create(createdAt);
    notes.appendUpdate(note.id, update, parsed.title, updatedAt);
    if (spec.folderKey !== null) {
      notes.setFolder(note.id, requireFolderId(folderIds, spec.folderKey));
    }
    if (spec.pinned === true) notes.setPinned(note.id, true);
    for (const tagName of spec.tags ?? []) {
      org.attachTag(note.id, resolveTag(tagName, updatedAt));
    }
    // Same fold `markdownImport.ts` runs after every import: it writes the
    // searchable plaintext into `note_snapshots` and takes the note's first
    // version-history checkpoint, so a demo note is whole from its first byte.
    compactNow(notes, note.id);
  }
}
