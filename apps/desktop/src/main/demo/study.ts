/**
 * STUDY's demo slice: a final-year Computer Science student at RAF Belgrade,
 * mid-way through an August/September exam season — some courses already
 * behind her with real grades' worth of history, a few kolokvijumi and usmeni
 * ispiti still ahead, and flashcard decks she has actually been drilling.
 *
 * The one deliberate design choice here: rather than hand-picking which cards
 * end up "due today" / "mature" / "lapsed", this seeder DRIVES THE REAL
 * SCHEDULER. `simulateReviewHistory` walks the last ~10 weeks day by day,
 * asks `CardStore.dueQueue` — the exact query the review screen calls — what
 * would be due that day, and grades a plausible-sized session of it through
 * `CardStore.review`, the exact call the reviewer makes. Every FSRS field on
 * every card (`stability`, `difficulty`, `due`, `lapses`, …) is therefore a
 * real scheduler output, not an invented one — "produce states the scheduler
 * will accept" is satisfied by never inventing a state at all.
 *
 * `Exam` (migration 005) carries no grade/result column — only `examDate` and
 * a free-text `scope` ("Gradivo": what the exam covers, not how it went). A
 * passed exam is therefore represented the only honest way the schema allows:
 * a past `examDate`. No grade is fabricated into `scope` or anywhere else.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import { CardStore, DeckStore, ExamStore, PlanStore, SubjectStore, TopicStore } from "@nexus/db";
import type { CardRating } from "@nexus/db";
import { demoAt, demoDay, demoRandom, type DemoContext, type DemoRandom } from "./context.js";
import { STUDY_EN, type DemoDeckKey, type DemoExamKey } from "./study.en.js";

type DatabaseHandle = Database.Database;

// --- Exam calendar -----------------------------------------------------------
// Offsets from `ctx.today`, named once and reused both for `examDate` and for
// `simulateReviewHistory`'s "cramming period" boost, so the two can never
// silently disagree about when an exam fell.

const NBP_EXAM_OFFSET = -95;
const ML_PISMENI_OFFSET = -80;
const DS_KOLOKVIJUM_OFFSET = -60;
const PR_EXAM_OFFSET = -45;
const BIS_EXAM_OFFSET = -30;
const SI_EXAM_OFFSET = -18;

/** Past exams only — what `simulateReviewHistory` cram-boosts study probability ahead of. */
const PAST_EXAM_OFFSETS = [
  NBP_EXAM_OFFSET,
  ML_PISMENI_OFFSET,
  DS_KOLOKVIJUM_OFFSET,
  PR_EXAM_OFFSET,
  BIS_EXAM_OFFSET,
  SI_EXAM_OFFSET,
] as const;

const RG_EXAM_OFFSET = 6; // within 7 days — the countdown surfaces have something to show
const DS_USMENI_OFFSET = 13;
const ML_USMENI_OFFSET = 20;

/**
 * The furthest exam out, and the only future one with no plan — see the exam
 * itself for why that absence is the point rather than an oversight.
 */
const SI_USMENI_OFFSET = 34;

/** How many days ahead of a past exam's date count as its "cramming period". */
const CRAM_WINDOW_DAYS = 10;

// --- Review-history simulation ------------------------------------------------

/**
 * A rough Again/Hard/Good/Easy split for an ordinary review session — weighted
 * toward Good, which is what most spaced-repetition sessions actually look
 * like. Cumulative weights, walked in `pickRating`.
 */
const RATING_WEIGHTS: readonly { rating: CardRating; cumulative: number }[] = [
  { rating: 1, cumulative: 0.12 }, // Again
  { rating: 2, cumulative: 0.3 }, // Hard
  { rating: 3, cumulative: 0.8 }, // Good
  { rating: 4, cumulative: 1 }, // Easy
];

function pickRating(rng: DemoRandom): CardRating {
  const roll = rng.next();
  for (const { rating, cumulative } of RATING_WEIGHTS) {
    if (roll < cumulative) return rating;
  }
  return 4; // unreachable given the weights sum to 1, kept for exhaustiveness
}

/**
 * Walks the ~10 weeks before today, one simulated study session per day, each
 * one a real `dueQueue` read followed by real `review` grades — see the module
 * doc comment for why. Stops at YESTERDAY, never at `ctx.today`: leaving today
 * unsimulated is what leaves a genuine due-today backlog for the review screen
 * to open on, rather than a backlog this function graded away.
 *
 * Weekday sessions are likelier and larger than weekend ones, and the ten days
 * before each PAST exam (`PAST_EXAM_OFFSETS`) are busier still — a cramming
 * period, not a flat rate. `newLimit` is deliberately modest (not the
 * profile's default 20/day): a slow trickle of new cards is what leaves a
 * genuine tail of never-reviewed cards by the time the loop reaches today,
 * rather than exhausting the whole collection in the first two weeks.
 */
function simulateReviewHistory(cardStore: CardStore, rng: DemoRandom, ctx: DemoContext): void {
  for (let offset = -70; offset < 0; offset += 1) {
    const weekday = new Date(demoAt(ctx, offset, 12)).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const isCramDay = PAST_EXAM_OFFSETS.some(
      (examOffset) => offset >= examOffset - CRAM_WINDOW_DAYS && offset < examOffset,
    );

    const studyProbability = isCramDay ? 0.97 : isWeekend ? 0.35 : 0.85;
    if (!rng.chance(studyProbability)) continue;

    const now = new Date(demoAt(ctx, offset, rng.int(17, 22), rng.int(0, 59))).toISOString();
    const sessionSize = isCramDay ? rng.int(16, 28) : isWeekend ? rng.int(3, 8) : rng.int(6, 15);
    const newLimit = isCramDay ? rng.int(2, 4) : rng.int(3, 7);

    const queue = cardStore.dueQueue({ newLimit }, now);
    for (const card of queue.cards.slice(0, sessionSize)) {
      cardStore.review(card.id, pickRating(rng), now);
    }
  }
}

// --- Card content --------------------------------------------------------------
// Real question/answer pairs for the actual course material, not placeholder
// text. Cloze templates use `{{…}}`, problem-card steps join on the store's
// own "--" line separator (`@nexus/core`'s `problemSteps.ts`).

interface BasicCardSeed {
  front: string;
  back: string;
}

function seedCards(
  cardStore: CardStore,
  deckId: string,
  basics: readonly BasicCardSeed[],
  clozes: readonly string[],
  problem: { front: string; steps: readonly string[] },
  now: string,
): void {
  for (const card of basics) {
    cardStore.create({ deckId, front: card.front, back: card.back }, now);
  }
  for (const template of clozes) {
    cardStore.createCloze(deckId, template, now);
  }
  cardStore.createProblem(deckId, problem.front, problem.steps.join("\n--\n"), now);
}

const NBP_BASICS: readonly BasicCardSeed[] = [
  { front: "Šta je B-stablo i zašto se koristi za indekse?", back: "Balansirano stablo pretrage sa više dece po čvoru čija visina raste logaritamski sa brojem ključeva, što minimizuje broj disk I/O operacija pri pretrazi." },
  { front: "Čime se B+-stablo razlikuje od običnog B-stabla?", back: "Svi podaci se čuvaju isključivo u listovima, koji su međusobno povezani u listu; unutrašnji čvorovi sadrže samo ključeve za usmeravanje, što ubrzava opsežne (range) upite." },
  { front: "Šta garantuje akronim ACID?", back: "Atomicity, Consistency, Isolation, Durability — transakcija je sve-ili-ništa, čuva validnost baze, ne meša se sa drugim transakcijama i njeni efekti opstaju posle pada sistema." },
  { front: "Šta je „non-repeatable read“ i koji nivo izolacije ga sprečava?", back: "Kada isti upit u istoj transakciji dva puta vrati različitu vrednost za isti red jer ga je druga transakcija u međuvremenu izmenila; sprečava ga REPEATABLE READ i viši nivoi." },
  { front: "Šta je „phantom read“?", back: "Kada transakcija ponovi upit sa WHERE uslovom i dobije nove redove koje je druga transakcija u međuvremenu ubacila; sprečava ga tek SERIALIZABLE nivo izolacije." },
  { front: "Definiši treću normalnu formu (3NF).", back: "Relacija je u 3NF ako je u 2NF i nijedan ne-ključni atribut ne zavisi tranzitivno od primarnog ključa." },
  { front: "Šta je denormalizacija i kada se koristi?", back: "Namerno uvođenje redundanse radi bržeg čitanja (manje JOIN-ova), po cenu složenijeg održavanja konzistentnosti — tipično u OLAP/izveštajnim sistemima." },
  { front: "Koja je razlika između klasterovanog i neklasterovanog indeksa?", back: "Klasterovani indeks određuje fizički redosled redova u tabeli i tabela ga ima najviše jedan; neklasterovani je odvojena struktura koja pokazuje na redove, tabela ih može imati više." },
  { front: "Čemu služi EXPLAIN ANALYZE?", back: "Stvarno izvršava upit i prikazuje realan plan izvršavanja sa izmerenim vremenima po koraku, za razliku od EXPLAIN koji samo procenjuje plan." },
  { front: "Objasni razliku između OLTP i OLAP sistema.", back: "OLTP optimizuje česte kratke transakcije nad malim brojem redova; OLAP optimizuje složene agregacione upite nad velikim istorijskim skupovima podataka." },
  { front: "Šta je MVCC?", back: "Multi-Version Concurrency Control — tehnika kojom baza čuva više verzija reda tako da čitaoci vide konzistentan snimak podataka bez blokiranja pisaca, i obrnuto." },
  { front: "Šta je deadlock nad transakcijama i kako se rešava?", back: "Kružno čekanje dve ili više transakcija na resurse koje druga drži; baza ga detektuje i prekida (rollback) jednu transakciju kao žrtvu." },
  { front: "Čemu služi particionisanje (sharding) baze?", back: "Deli veliku tabelu ili bazu na manje delove po ključu radi horizontalnog skaliranja čitanja, pisanja i skladišta preko više servera." },
  { front: "Šta je pokriveni indeks (covering index)?", back: "Indeks koji sadrži sve kolone potrebne upitu, pa se odgovor dobija isključivo iz indeksa bez dodatnog čitanja tabele." },
  { front: "Koja je razlika između INNER JOIN i LEFT OUTER JOIN?", back: "INNER JOIN vraća samo redove koji se poklapaju u obe tabele; LEFT OUTER JOIN vraća sve redove leve tabele, sa NULL vrednostima kad poklapanja nema." },
  { front: "Čemu služi write-ahead log (WAL)?", back: "Promene se prvo upisuju u log pre nego što se primene na podatke; omogućava oporavak posle pada sistema i osnova je za replikaciju." },
  { front: "Šta je strano-ključno ograničenje (foreign key)?", back: "Ograničenje koje osigurava da vrednost kolone u jednoj tabeli mora postojati kao ključ u drugoj tabeli, čuvajući referencijalni integritet." },
  { front: "Šta je materijalizovani pogled (materialized view)?", back: "Rezultat upita fizički sačuvan kao tabela radi brzine čitanja, koji se periodično ili ručno osvežava, za razliku od običnog pogleda koji se svaki put ponovo izračunava." },
];

const NBP_CLOZES: readonly string[] = [
  "{{c1::MVCC}} omogućava čitaocima da vide konzistentan snimak podataka bez čekanja na {{c2::pisce}}.",
  "Normalizacija baze prolazi kroz forme: {{c1::1NF}}, {{c2::2NF}}, {{c3::3NF}}, i opciono {{c4::BCNF}}.",
];

const NBP_PROBLEM = {
  front: "Upit koji spaja students i grades po student_id sporo radi jer nema indeksa. Kojim redosledom dijagnostikuješ i rešavaš problem?",
  steps: [
    "Pokreni EXPLAIN ANALYZE i proveri da li baza radi sequential scan umesto index scan.",
    "Proveri da tip kolone za JOIN (student_id) tačno odgovara u obe tabele — implicitna konverzija tipa onemogućava korišćenje indeksa.",
    "Dodaj indeks na grades.student_id.",
    "Ponovo pokreni EXPLAIN ANALYZE i uporedi plan i vreme izvršavanja sa prethodnim.",
  ],
};

const ML_BASICS: readonly BasicCardSeed[] = [
  { front: "Šta je overfitting?", back: "Model previše prilagođen podacima za treniranje, uključujući šum, zbog čega loše generalizuje na nove, neviđene podatke." },
  { front: "Kako regularizacija (L1/L2) smanjuje overfitting?", back: "Dodaje kaznu na veličinu težina u funkciju gubitka; L1 (Lasso) gura neke težine na nulu (selekcija atributa), L2 (Ridge) ih ravnomerno smanjuje." },
  { front: "Šta opisuje bias-variance kompromis?", back: "Visok bias (prevelika pojednostavljenost) dovodi do underfittinga; visoka varijansa (preosetljivost na trening skup) dovodi do overfittinga — cilj je naći ravnotežu koja minimizuje ukupnu grešku." },
  { front: "Čemu služi k-struka unakrsna validacija (k-fold cross-validation)?", back: "Deli podatke na k delova, trenira na k-1 i testira na preostalom, k puta rotirajući test deo — daje pouzdaniju procenu performansi modela nego jedna podela na trening/test." },
  { front: "Šta radi gradijentni spust (gradient descent)?", back: "Iterativno ažurira parametre modela u pravcu suprotnom od gradijenta funkcije gubitka, korakom određenim stopom učenja (learning rate), dok ne pronađe (lokalni) minimum." },
  { front: "Zašto je stopa učenja (learning rate) bitna u gradijentnom spustu?", back: "Prevelika stopa učenja može preskočiti minimum ili divergirati; premala usporava konvergenciju i može zaglaviti u lokalnom minimumu ili platou." },
  { front: "Šta je funkcija aktivacije i zašto je neophodna u neuronskim mrežama?", back: "Nelinearna transformacija izlaza neurona (npr. ReLU, sigmoid); bez nje bi slaganje slojeva ostalo ekvivalentno jednoj linearnoj transformaciji, bez obzira na dubinu mreže." },
  { front: "Šta je backpropagation?", back: "Algoritam koji lančanim pravilom izvoda unazad propagira grešku kroz slojeve mreže, računajući gradijent funkcije gubitka po svakoj težini." },
  { front: "Šta je random forest?", back: "Ansambl velikog broja stabala odlučivanja, svako trenirano nad slučajnim podskupom podataka i atributa (bagging), čije se predikcije usrednjavaju ili glasaju." },
  { front: "Čemu služi matrica konfuzije (confusion matrix)?", back: "Prikazuje broj tačno i pogrešno klasifikovanih primera po klasi (TP, FP, TN, FN), osnova za metrike kao što su preciznost, odziv i F1 mera." },
  { front: "Šta meri F1 mera i zašto se koristi umesto tačnosti (accuracy)?", back: "Harmonijska sredina preciznosti i odziva; korisnija je od tačnosti kod neuravnoteženih klasa, gde model koji uvek predviđa većinsku klasu ima visoku tačnost, ali je beskoristan." },
  { front: "Šta je k-means klasterovanje?", back: "Nenadgledani algoritam koji deli podatke u k grupa minimizujući sumu kvadratnih rastojanja tačaka od centra (centroida) njihovog klastera, iterativno ažurirajući centre." },
  { front: "Šta je one-hot enkodiranje?", back: "Predstavljanje kategoričke promenljive binarnim vektorom u kome je tačno jedna komponenta 1, a ostale 0 — izbegava lažno uređenje koje bi obično celobrojno kodiranje uvelo." },
  { front: "Zašto se atributi standardizuju (normalizuju) pre treniranja mnogih modela?", back: "Atributi različitih skala mogu dominirati funkcijom gubitka ili usporiti konvergenciju gradijentnog spusta; standardizacija (npr. z-skor) izjednačava njihov uticaj." },
  { front: "Šta je dropout u neuronskim mrežama?", back: "Tehnika regularizacije koja tokom treniranja nasumično „gasi“ deo neurona u sloju, sprečavajući mrežu da se prekomerno osloni na uske kombinacije neurona." },
  { front: "Šta je transfer learning?", back: "Ponovna upotreba modela treniranog na jednom (obično velikom) skupu podataka kao polazne tačke za srodan zadatak, umesto treniranja od nule." },
  { front: "Koja je razlika između nadgledanog i nenadgledanog učenja?", back: "Nadgledano učenje trenira model na obeleženim primerima (ulaz + tačan izlaz); nenadgledano traži strukturu (klastere, projekcije) u podacima bez oznaka." },
  { front: "Šta meri funkcija gubitka unakrsne entropije (cross-entropy loss)?", back: "Razliku između predviđene raspodele verovatnoća po klasama i stvarne (jednoznačne) klase; standardni izbor za klasifikacione zadatke." },
];

const ML_CLOZES: readonly string[] = [
  "Bias-variance kompromis: visok {{c1::bias}} vodi ka underfitting-u, dok visoka {{c2::varijansa}} vodi ka overfitting-u.",
  "Tri glavne kategorije mašinskog učenja su {{c1::nadgledano}}, {{c2::nenadgledano}} i {{c3::učenje sa potkrepljenjem}}.",
];

const ML_PROBLEM = {
  front: "Model za klasifikaciju ima 99% tačnost na skupu gde je 99% primera negativno. Kako proceniti da li je model zaista dobar?",
  steps: [
    "Izračunaj matricu konfuzije i pogledaj broj TP, FP, TN, FN — ne samo ukupnu tačnost.",
    "Izračunaj preciznost i odziv za pozitivnu (manjinsku) klasu — tačnost od 99% ovde može značiti da model uvek predviđa negativnu klasu.",
    "Uporedi F1 meru sa baznom linijom (model koji uvek predviđa većinsku klasu) — ako je F1 blizu baznoj liniji, model ništa nije naučio.",
    "Ako je problem stvaran, razmotri balansiranje klasa (oversampling/undersampling) ili prilagođavanje praga odluke.",
  ],
};

const DS_BASICS: readonly BasicCardSeed[] = [
  { front: "Šta tvrdi CAP teorema?", back: "Distribuirani sistem pri particiji mreže (Partition tolerance) mora birati između Konzistentnosti (Consistency) i Dostupnosti (Availability) — sve tri se ne mogu istovremeno garantovati." },
  { front: "Koja je razlika između konzistentnosti i dostupnosti u kontekstu CAP teoreme?", back: "Konzistentnost znači da svi čvorovi vide isti (najnoviji) podatak u svakom trenutku; dostupnost znači da svaki zahtev dobija odgovor, čak i ako nije najnoviji podatak." },
  { front: "Čemu služi Raft algoritam konsenzusa?", back: "Omogućava skupu čvorova da se saglase oko jedinstvenog niza operacija (replicated log) čak i uz otkaze čvorova, birajući lidera koji koordinira replikaciju." },
  { front: "Šta je „split-brain“ problem?", back: "Kada particija mreže dovede do toga da dva podskupa čvorova nezavisno misle da su aktivni lider/primarni, što može dovesti do konfliktnih pisanja." },
  { front: "Šta radi protokol dvofazne potvrde (Two-Phase Commit, 2PC)?", back: "Koordinator prvo pita sve učesnike da li mogu da commit-uju (faza pripreme), a tek kad svi potvrde, šalje im komandu za konačan commit (faza izvršenja) — osigurava atomičnost preko više čvorova." },
  { front: "Koji je glavni nedostatak 2PC protokola?", back: "Blokirajući je — ako koordinator otkaže posle faze pripreme, učesnici mogu ostati zaključani čekajući odluku, dok se koordinator ne oporavi." },
  { front: "Šta je vektorski čas (vector clock)?", back: "Struktura koja svakom događaju dodeljuje vektor brojača po čvoru, omogućavajući da se utvrdi da li su dva događaja uzročno povezana ili konkurentna, bez sinhronizovanih satova." },
  { front: "Šta je konzistentno heširanje (consistent hashing)?", back: "Tehnika raspodele podataka po čvorovima kružnim heš prostorom, tako da dodavanje ili uklanjanje čvora remeti samo mali deo raspodele umesto svih ključeva." },
  { front: "Šta je eventual consistency?", back: "Model u kojem, ako se prestanu nova pisanja, svi replika na kraju konvergiraju ka istoj vrednosti — dozvoljava privremenu nekonzistentnost radi veće dostupnosti." },
  { front: "Šta je kvorum (quorum) u replikovanom sistemu?", back: "Minimalan broj čvorova koji mora potvrditi operaciju (čitanje ili pisanje) da bi se smatrala uspešnom; tipično W + R > N garantuje da čitanje vidi poslednje pisanje." },
  { front: "Koja je razlika između horizontalnog i vertikalnog skaliranja?", back: "Horizontalno skaliranje dodaje više mašina (šardovanje, replikacija); vertikalno skaliranje povećava resurse jedne mašine (CPU, RAM)." },
  { front: "Šta je „idempotentna“ operacija i zašto je bitna u distribuiranim sistemima?", back: "Operacija čiji rezultat ostaje isti bez obzira koliko puta se izvrši; bitna je jer mreža može dostaviti isti zahtev više puta (retry), pa ponovno izvršenje ne sme praviti štetu." },
  { front: "Šta je message queue (npr. Kafka, RabbitMQ) i čemu služi u distribuiranom sistemu?", back: "Posrednik koji čuva poruke između proizvođača i potrošača, omogućavajući asinhronu komunikaciju, odvezivanje servisa (decoupling) i otpornost na privremene otkaze potrošača." },
  { front: "Šta je „leader election“?", back: "Proces kojim distribuirani sistem bira jedan čvor da koordinira određenu aktivnost (npr. replikaciju), obično uz algoritme poput Raft ili Paxos, sa mehanizmom otkrivanja otkaza lidera." },
  { front: "Šta je razlika između sinhrone i asinhrone replikacije?", back: "Sinhrona replikacija čeka potvrdu replike pre nego što potvrdi pisanje klijentu (jača konzistentnost, veća latencija); asinhrona potvrđuje odmah i replicira u pozadini (manja latencija, rizik gubitka podataka)." },
  { front: "Šta je circuit breaker obrazac u mikroservisima?", back: "Obrazac koji prati otkaze poziva ka drugom servisu i, posle praga otkaza, privremeno prekida dalje pozive (fail fast) umesto da čeka tajmaut, dajući servisu vreme da se oporavi." },
  { front: "Šta je „fan-out“ u distribuiranim sistemima?", back: "Slanje jednog zahteva ili događaja ka više servisa/čvorova paralelno, čiji se odgovori zatim agregiraju ili obrađuju nezavisno." },
  { front: "Zašto je precizna sinhronizacija satova teška u distribuiranim sistemima i kako se to zaobilazi?", back: "Mrežna kašnjenja su promenljiva pa apsolutno vreme nije pouzdano za uređenje događaja; umesto toga koriste se logički (Lamport) ili vektorski časovnici koji beleže uzročnost." },
];

const DS_CLOZES: readonly string[] = [
  "Kod replikacije, {{c1::sinhrona}} replikacija čeka potvrdu pre odgovora klijentu, dok {{c2::asinhrona}} odgovara odmah i replicira u pozadini.",
  "CAP teorema: pri particiji mreže sistem bira između {{c1::konzistentnosti}} i {{c2::dostupnosti}}.",
];

const DS_PROBLEM = {
  front: "Servis za plaćanja povremeno dupliraš naplatu jer klijent ponavlja zahtev posle tajmauta. Kako to rešiti na nivou dizajna?",
  steps: [
    "Prepoznaj da je uzrok nedostatak idempotencije — mreža ili klijent mogu poslati isti zahtev više puta.",
    "Uvedi jedinstveni idempotency key koji klijent generiše po transakciji i šalje sa svakim pokušajem.",
    "Na serveru čuvaj rezultat prve obrade po tom ključu; naredni zahtevi sa istim ključem vraćaju sačuvani rezultat umesto ponovne naplate.",
    "Postavi razuman TTL za čuvanje ključeva kako skladište ne bi raslo neograničeno.",
  ],
};

const PR_BASICS: readonly BasicCardSeed[] = [
  { front: "Koje su glavne faze prevodioca?", back: "Leksička analiza, sintaksna analiza, semantička analiza, generisanje međukoda, optimizacija koda i generisanje ciljnog koda." },
  { front: "Šta radi leksička analiza (skener)?", back: "Deli izvorni tekst na tokene (leksičke jedinice) prema regularnim izrazima, uklanjajući beline i komentare i prijavljujući leksičke greške." },
  { front: "Šta je konačni automat i čemu služi u leksičkoj analizi?", back: "Model koji prepoznaje regularne jezike; leksički analizator se generiše kao (determinisani) konačni automat koji prepoznaje obrasce tokena." },
  { front: "Šta radi sintaksna analiza (parser)?", back: "Proverava da li niz tokena odgovara gramatici jezika i gradi sintaksno (parse) ili apstraktno sintaksno stablo (AST)." },
  { front: "Koja je razlika između LL i LR parsera?", back: "LL parser gradi stablo od korena ka listovima čitajući ulaz sleva nadesno uz levu izvedbu; LR parser gradi stablo od listova ka korenu uz desnu izvedbu unazad, prepoznajući širu klasu gramatika." },
  { front: "Šta je leva rekurzija u gramatici i zašto je problem za LL parsere?", back: "Pravilo oblika A → Aα; LL parser bi ušao u beskonačnu rekurziju pokušavajući da je razvije, pa se gramatika mora transformisati da je ukloni pre generisanja LL parsera." },
  { front: "Šta je tabela simbola (symbol table)?", back: "Struktura podataka koja čuva informacije o identifikatorima (ime, tip, opseg važenja, adresu) korišćene tokom semantičke analize i generisanja koda." },
  { front: "Šta je apstraktno sintaksno stablo (AST)?", back: "Hijerarhijska reprezentacija strukture programa koja izostavlja sintaksne detalje (npr. zagrade, tačku-zapetu) zadržavajući samo semantički bitnu strukturu." },
  { front: "Čemu služi semantička analiza?", back: "Proverava pravila koja gramatika ne može izraziti — tipsku ispravnost, opseg važenja promenljivih, jedinstvenost deklaracija — i popunjava tabelu simbola." },
  { front: "Šta je međukod (intermediate representation) i zašto se koristi?", back: "Reprezentacija programa nezavisna i od izvornog i od ciljnog jezika (npr. trojke, četvorke, SSA); omogućava da se optimizacije i podrška za više ciljnih platformi pišu jednom, nezavisno." },
  { front: "Šta je SSA (Static Single Assignment) oblik?", back: "Međukod u kome se svaka promenljiva dodeljuje tačno jednom, uz phi-čvorove za spajanje vrednosti sa različitih grana kontrolnog toka — pojednostavljuje mnoge optimizacije." },
  { front: "Navedi primer optimizacije koja se radi nad međukodom.", back: "Eliminacija mrtvog koda (uklanjanje instrukcija čiji rezultat se nikad ne koristi), constant folding (računanje konstantnih izraza unapred), ili eliminacija zajedničkih podizraza." },
  { front: "Šta je dodela registara (register allocation)?", back: "Faza generisanja koda koja mapira (potencijalno neograničen broj) privremenih promenljivih iz međukoda na ograničen skup fizičkih registara procesora, po potrebi prelivajući (spilling) neke u memoriju." },
  { front: "Šta je gramatika bez konteksta (context-free grammar)?", back: "Formalna gramatika čija su pravila oblika A → α, gde je A jedan neterminal — dovoljno izražajna za sintaksu većine programskih jezika, generisana i prepoznatljiva parserima." },
  { front: "Šta je razrešavanje preopterećenja (overload resolution) u semantičkoj analizi?", back: "Postupak kojim prevodilac, kada postoji više funkcija/operatora istog imena, na osnovu tipova argumenata bira tačno jednu odgovarajuću definiciju." },
  { front: "Šta je „shift-reduce“ konflikt kod LR parsera?", back: "Situacija u kojoj parser ne zna da li da pomeri sledeći token na stek (shift) ili da svede trenutni niz na neterminal (reduce) — znak dvosmislenosti ili nedovoljne moći parsera za tu gramatiku." },
  { front: "Zašto se koriste generatori parsera poput yacc/bison ili ANTLR?", back: "Automatski generišu parser iz formalne specifikacije gramatike, izbegavajući ručno, grešaka podložno pisanje analize sintakse." },
  { front: "Šta je just-in-time (JIT) kompilacija?", back: "Prevođenje (dela) programa u mašinski kod tokom izvršavanja, a ne unapred, često uz profilisanje da bi se agresivnije optimizovao „vrući“ kod." },
];

const PR_CLOZES: readonly string[] = [
  "Faze prevodioca redom: {{c1::leksička}} analiza, {{c2::sintaksna}} analiza, {{c3::semantička}} analiza, generisanje koda.",
  "LL parser gradi stablo {{c1::od korena ka listovima}}, dok LR parser gradi stablo {{c2::od listova ka korenu}}.",
];

const PR_PROBLEM = {
  front: "Gramatika E → E + T | T ima levu rekurziju i LL(1) parser upada u beskonačnu petlju. Kako je transformisati?",
  steps: [
    "Prepoznaj oblik leve rekurzije: E → E + T | T.",
    "Uvedi novi neterminal E' i prepiši pravilo bez leve rekurzije: E → T E'.",
    "Definiši E' da hvata ponavljanje: E' → + T E' | ε.",
    "Proveri da izvedena gramatika generiše isti jezik kao originalna, samo desno rekurzivno.",
  ],
};

const BIS_BASICS: readonly BasicCardSeed[] = [
  { front: "Koja je osnovna razlika između simetrične i asimetrične kriptografije?", back: "Simetrična koristi isti ključ za enkripciju i dekripciju (brža, problem distribucije ključa); asimetrična koristi par javni/privatni ključ (sporija, rešava distribuciju ključa i omogućava digitalne potpise)." },
  { front: "Šta je heš funkcija i koje svojstvo je čini kriptografski bezbednom?", back: "Funkcija koja proizvoljan ulaz preslikava u izlaz fiksne dužine; bezbedna heš funkcija je otporna na kolizije, ne može se invertovati i mala promena ulaza menja ceo izlaz (efekat lavine)." },
  { front: "Čemu služi digitalni potpis?", back: "Dokazuje autentičnost i integritet poruke — pošiljalac heš poruke šifruje svojim privatnim ključem, a primalac ga proverava javnim ključem pošiljaoca." },
  { front: "Šta se dešava tokom TLS „handshake“ postupka (pojednostavljeno)?", back: "Klijent i server se dogovore o algoritmima, server pošalje sertifikat (javni ključ), razmene se (ili izvedu Diffie-Hellman-om) podaci za sesijski ključ, i dalja komunikacija se šifruje simetrično tim ključem." },
  { front: "Šta je SQL injekcija?", back: "Napad u kome se neproverovan korisnički unos ubacuje direktno u SQL upit, menjajući njegovo značenje — sprečava se parametrizovanim (bound) upitima, nikad konkatenacijom stringova." },
  { front: "Šta je XSS (Cross-Site Scripting)?", back: "Napad u kome napadač ubacuje zlonamerni JavaScript u stranicu koju posećuju drugi korisnici, jer aplikacija nije eskejpovala/sanitizovala korisnički unos pre prikaza u HTML-u." },
  { front: "Šta je CSRF (Cross-Site Request Forgery)?", back: "Napad koji navodi već prijavljenog korisnika da nesvesno pošalje zahtev ka aplikaciji u kojoj je autentifikovan (npr. klikom na zlonameran link), zloupotrebljavajući njegovu sesiju." },
  { front: "Šta je princip najmanjih privilegija (principle of least privilege)?", back: "Svakom korisniku, procesu ili sistemu treba dodeliti samo minimalna prava neophodna za obavljanje njegovog zadatka, ništa više." },
  { front: "Koja je razlika između autentifikacije i autorizacije?", back: "Autentifikacija dokazuje ko si (login, lozinka, MFA); autorizacija određuje šta smeš da radiš nakon što si autentifikovan (prava pristupa, uloge)." },
  { front: "Šta je RBAC (Role-Based Access Control)?", back: "Model kontrole pristupa u kome se prava ne dodeljuju direktno korisnicima već ulogama, a korisnici se dodeljuju ulogama — pojednostavljuje upravljanje pravima na velikom broju korisnika." },
  { front: "Šta je „salt“ pri heširanju lozinki i zašto je bitan?", back: "Nasumična vrednost dodata lozinci pre heširanja, jedinstvena po korisniku; sprečava napadača da koristi unapred izračunate (rainbow) tabele za sve korisnike odjednom." },
  { front: "Zašto se za heširanje lozinki ne koriste brze heš funkcije poput SHA-256 direktno?", back: "Prebrze su, što napadaču omogućava milijarde pokušaja u sekundi; koriste se namerno spore funkcije (bcrypt, scrypt, Argon2) koje usporavaju brute-force napad." },
  { front: "Šta je prekoračenje bafera (buffer overflow)?", back: "Upisivanje više podataka u memorijski bafer nego što je alociran, čime se prepisuju susedni podaci (npr. povratna adresa na steku), potencijalno omogućavajući izvršenje proizvoljnog koda." },
  { front: "Šta je „defense in depth“?", back: "Strategija bezbednosti sa više nezavisnih slojeva zaštite (mreža, aplikacija, podaci), tako da probijanje jednog sloja ne kompromituje ceo sistem." },
  { front: "Šta radi firewall i na kom nivou tipično filtrira saobraćaj?", back: "Kontroliše dolazni i odlazni mrežni saobraćaj po pravilima (IP, port, protokol); filtrira uglavnom na mrežnom/transportnom nivou, dok napredniji (WAF) razumeju i aplikacioni sloj." },
  { front: "Šta je „zero-day“ ranjivost?", back: "Bezbednosni propust koji je otkriven (i eventualno se aktivno eksploatiše) pre nego što je proizvođač softvera objavio zakrpu — „nula dana“ je vreme koje je proizvođač imao da reaguje." },
  { front: "Šta je dvofaktorska autentifikacija (2FA/MFA)?", back: "Autentifikacija koja zahteva dva ili više nezavisnih faktora (nešto što znaš, nešto što imaš, nešto što jesi), otežavajući kompromitaciju naloga i kada je lozinka procurela." },
  { front: "Šta je „man-in-the-middle“ napad?", back: "Napadač se ubacuje između dve strane koje komuniciraju i presreće ili menja saobraćaj, a da nijedna strana to ne primeti — protiv njega štiti autentifikovano šifrovanje (npr. TLS sa validacijom sertifikata)." },
];

const BIS_CLOZES: readonly string[] = [
  "Kod hešovanja lozinki dodaje se {{c1::salt}} da bi se sprečila upotreba unapred izračunatih {{c2::rainbow}} tabela.",
  "Trijada CIA u bezbednosti: {{c1::Confidentiality}}, {{c2::Integrity}}, {{c3::Availability}}.",
];

const BIS_PROBLEM = {
  front: "Forma za prijavu direktno spaja korisnički unos u SQL upit (\"SELECT * FROM users WHERE username = '\" + input + \"'\"). Kako sistematski otkloniti problem?",
  steps: [
    "Prepoznaj uzrok: konkatenacija nepoverljivog unosa direktno u SQL string omogućava SQL injekciju.",
    "Zameni konkatenaciju parametrizovanim (bound) upitom sa placeholder-ima (?, $1) umesto ručnog spajanja stringova.",
    "Dodaj validaciju/ograničenje dužine i tipa unosa na aplikativnom nivou kao dodatni sloj (defense in depth).",
    "Proveri da li se isti obrazac (konkatenacija u SQL upit) ponavlja i na drugim mestima u kodu, ne samo na prijavljenom mestu.",
  ],
};

const SI_BASICS: readonly BasicCardSeed[] = [
  { front: "Šta znači SOLID akronim u dizajnu softvera?", back: "Single responsibility, Open/closed, Liskov substitution, Interface segregation, Dependency inversion — pet principa objektno-orijentisanog dizajna koji čine kod lakšim za održavanje i proširivanje." },
  { front: "Objasni princip jedne odgovornosti (Single Responsibility Principle).", back: "Klasa treba da ima samo jedan razlog za promenu — jednu jasno definisanu odgovornost; mešanje više odgovornosti u jednoj klasi otežava izmene i testiranje." },
  { front: "Šta kaže princip otvoreno/zatvoreno (Open/Closed Principle)?", back: "Softverski entiteti treba da budu otvoreni za proširenje, a zatvoreni za izmenu — nova funkcionalnost se dodaje kroz nove klase/implementacije, a ne menjanjem postojećeg, proverenog koda." },
  { front: "Šta je Liskov princip supstitucije?", back: "Objekti izvedene klase moraju moći da zamene objekte bazne klase a da program ostane ispravan — podtip ne sme kršiti očekivanja (ugovor) koje nameće njegov natip." },
  { front: "Šta je dizajn obrazac Singleton i koja je česta kritika na njega?", back: "Obrazac koji garantuje da klasa ima tačno jednu instancu sa globalnom tačkom pristupa; kritikuje se jer uvodi globalno stanje i otežava testiranje i paralelizaciju." },
  { front: "Šta je dizajn obrazac Factory Method?", back: "Definiše interfejs za kreiranje objekta, ali ostavlja podklasama da odluče koju konkretnu klasu će instancirati — razdvaja kreiranje objekta od koda koji ga koristi." },
  { front: "Šta je dizajn obrazac Observer?", back: "Definiše zavisnost jedan-prema-više između objekata, tako da kada se stanje subjekta promeni, svi njegovi posmatrači (observeri) budu automatski obavešteni i ažurirani." },
  { front: "Šta je dizajn obrazac Strategy?", back: "Enkapsulira porodicu algoritama iza zajedničkog interfejsa i omogućava da se algoritam menja u trenutku izvršavanja nezavisno od klijenta koji ga koristi." },
  { front: "Koja je razlika između kompozicije i nasleđivanja?", back: "Nasleđivanje uspostavlja „je-vrsta“ (is-a) odnos i statički je vezano za tip; kompozicija uspostavlja „ima“ (has-a) odnos sastavljanjem objekata i fleksibilnija je jer se ponašanje može menjati u toku izvršavanja." },
  { front: "Šta je test piramida (testing pyramid)?", back: "Model koji preporučuje mnogo jediničnih (unit) testova u osnovi, manje integracionih testova u sredini i najmanje end-to-end testova na vrhu, jer su jedinični testovi brži i jeftiniji za održavanje." },
  { front: "Koja je razlika između jediničnog (unit) i integracionog testa?", back: "Jedinični test proverava jednu izolovanu komponentu (obično uz mokove zavisnosti); integracioni test proverava da li više komponenti ispravno sarađuju zajedno, uključujući stvarne zavisnosti." },
  { front: "Šta je TDD (Test-Driven Development)?", back: "Praksa u kojoj se prvo piše (padajući) test za novo ponašanje, zatim minimalan kod da test prođe, pa se kod refaktoriše — ciklus crveno-zeleno-refaktoriši." },
  { front: "Šta je refaktorisanje koda?", back: "Menjanje unutrašnje strukture koda radi čitljivosti i održivosti, bez promene njegovog spoljašnjeg ponašanja — sigurno je jedino uz pokrivenost testovima koji to ponašanje čuvaju." },
  { front: "Šta je „code smell“?", back: "Površinski znak u kodu (npr. predugačka metoda, dupliran kod, prevelika klasa) koji ukazuje na dublji problem dizajna, iako sam po sebi ne mora biti greška." },
  { front: "Šta je kontinualna integracija (CI)?", back: "Praksa čestog spajanja izmena u zajedničku granu, uz automatsko pokretanje build-a i testova na svakom spajanju, kako bi se konflikti i regresije otkrili što ranije." },
  { front: "Šta je kontinualna isporuka (Continuous Delivery)?", back: "Praksa u kojoj je svaka izmena koja prođe CI automatski spremna za puštanje u produkciju u bilo kom trenutku, iako sâmo puštanje može ostati ručna odluka." },
  { front: "Šta je „tehnički dug“ (technical debt)?", back: "Implicitni trošak budućeg dodatnog rada nastao izborom brzog rešenja umesto boljeg pristupa koji bi trajao duže — poput finansijskog duga, nosi „kamatu“ u vidu otežanog održavanja." },
  { front: "Šta je Scrum sprint?", back: "Vremenski ograničen period (obično 1-4 nedelje) tokom kog tim isporučuje potencijalno upotrebljiv inkrement proizvoda, sa planiranjem na početku i retrospektivom na kraju." },
];

const SI_CLOZES: readonly string[] = [
  "SOLID principi: {{c1::Single responsibility}}, {{c2::Open/closed}}, {{c3::Liskov substitution}}, {{c4::Interface segregation}}, {{c5::Dependency inversion}}.",
  "TDD ciklus: {{c1::crveno}} (padajući test), {{c2::zeleno}} (test prolazi), {{c3::refaktoriši}}.",
];

const SI_PROBLEM = {
  front: "Nova funkcionalnost zahteva još jednu if granu u već ogromnoj metodi koja obrađuje tipove naloga. Kako to uraditi u duhu Open/Closed principa?",
  steps: [
    "Prepoznaj da dodavanje još jedne if/else grane krši Open/Closed princip — svaka nova vrsta naloga zahteva izmenu postojećeg, proverenog koda.",
    "Izdvoji zajednički interfejs (npr. NalogObrada) sa metodom koju svaka vrsta naloga implementira na svoj način.",
    "Napravi po jednu implementaciju interfejsa za svaku postojeću granu iz if/else lanca, prenoseći logiku iz metode.",
    "Novu vrstu naloga dodaj kao novu implementaciju interfejsa, bez ijedne izmene postojećih klasa ili poziva koji ih koriste.",
  ],
};

// --- Study-plan blocks ---------------------------------------------------------

/**
 * Creates a topic-aware plan for an upcoming exam starting 14 days ago (so the
 * generated schedule straddles today), then hand-decides each PAST block's
 * fate: most become `done` (a realistic completion rate), the rest are left
 * `planned` for `syncAll` to turn `missed` — which is what gives the
 * plan-vs-actual chart both agreement and divergence to show. Future blocks
 * are left exactly as the engine generated them.
 */
function seedPlan(
  planStore: PlanStore,
  examId: string,
  dailyMinutes: number,
  weekdayMinutes: readonly number[] | null,
  rng: DemoRandom,
  ctx: DemoContext,
): void {
  const startDate = demoDay(ctx, -14);
  const nowIso = new Date(ctx.now).toISOString();
  const plan = planStore.createPlan(
    weekdayMinutes === null
      ? { examId, dailyMinutes, startDate, examWeekBoost: true }
      : { examId, dailyMinutes, startDate, examWeekBoost: true, weekdayMinutes },
    nowIso,
    ctx.today,
  );

  for (const block of planStore.listBlocks(plan.id)) {
    if (block.blockDate >= ctx.today) continue; // future — stays "planned" as generated
    if (!rng.chance(0.65)) continue; // left "planned" in the past — syncAll turns it "missed"
    const doneAt = instantForDate(block.blockDate, rng.int(18, 22), rng.int(0, 59));
    planStore.setBlockStatus(block.id, "done", doneAt);
  }
}

/** A plan-engine date ("YYYY-MM-DD", already rooted in `ctx.today`) plus a time of day, as a local ISO instant. */
function instantForDate(dateKey: string, hour: number, minute: number): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

// --- Entry point -----------------------------------------------------------

/**
 * Fills STUDY's slice of a demo profile in the language the run asked for.
 *
 * The Serbian path is the original seeder, unchanged; the English path mirrors
 * its shape with the copy in `study.en.ts`. Both drive the same stores, the
 * same review-history simulation and the same study plans, so the two profiles
 * differ only in language.
 */
export function seedDemoStudy(db: DatabaseHandle, ctx: DemoContext): void {
  if (ctx.locale === "en") {
    seedDemoStudyEnglish(db, ctx);
    return;
  }
  seedDemoStudySerbian(db, ctx);
}

function seedDemoStudySerbian(db: DatabaseHandle, ctx: DemoContext): void {
  const rng = demoRandom("study");
  const nowIso = new Date(ctx.now).toISOString();

  const subjectStore = new SubjectStore(db, ctx.profileId);
  const examStore = new ExamStore(db, ctx.profileId);
  const deckStore = new DeckStore(db, ctx.profileId);
  const cardStore = new CardStore(db, ctx.profileId);
  const topicStore = new TopicStore(db, ctx.profileId);
  const planStore = new PlanStore(db, ctx.profileId);

  // --- Subjects --------------------------------------------------------------
  const nbp = subjectStore.create({ name: "Napredne baze podataka", color: "jade", semester: "8. semestar" });
  const ml = subjectStore.create({ name: "Mašinsko učenje", color: "gold", semester: "8. semestar" });
  const ds = subjectStore.create({ name: "Distribuirani sistemi", color: "bronze", semester: "8. semestar" });
  const pr = subjectStore.create({ name: "Prevodioci", color: "burgundy", semester: "7. semestar" });
  const bis = subjectStore.create({ name: "Bezbednost informacionih sistema", color: "crimson", semester: "7. semestar" });
  const si = subjectStore.create({ name: "Softversko inženjerstvo", color: "graphite", semester: "8. semestar" });
  const rg = subjectStore.create({ name: "Računarska grafika", color: "jade", semester: "7. semestar" });

  // --- Exams — six already passed, three still ahead --------------------------
  const examNbp = examStore.create({
    subjectId: nbp.id,
    examType: "kolokvijum",
    examDate: demoDay(ctx, NBP_EXAM_OFFSET),
    scope: "Relacioni model, normalizacija, indeksi (B-stablo, B+-stablo), osnove transakcija.",
  });
  // Past exams for ML/DS whose ids nothing below needs to reference again —
  // the row itself (a passed exam on the subject's timeline) is the point.
  examStore.create({
    subjectId: ml.id,
    examType: "pismeni",
    examDate: demoDay(ctx, ML_PISMENI_OFFSET),
    scope: "Regresija, stabla odlučivanja, osnove neuronskih mreža, metrike evaluacije.",
  });
  examStore.create({
    subjectId: ds.id,
    examType: "kolokvijum",
    examDate: demoDay(ctx, DS_KOLOKVIJUM_OFFSET),
    scope: "CAP teorema, replikacija, 2PC, osnovni modeli konzistentnosti.",
  });
  const examPr = examStore.create({
    subjectId: pr.id,
    examType: "pismeni",
    examDate: demoDay(ctx, PR_EXAM_OFFSET),
    scope: "Leksička i sintaksna analiza, gramatike, LL/LR parsiranje.",
  });
  const examBis = examStore.create({
    subjectId: bis.id,
    examType: "usmeni",
    examDate: demoDay(ctx, BIS_EXAM_OFFSET),
    scope: "Kriptografija, TLS, tipični napadi (SQLi, XSS, CSRF), kontrola pristupa.",
  });
  const examSi = examStore.create({
    subjectId: si.id,
    examType: "pismeni",
    examDate: demoDay(ctx, SI_EXAM_OFFSET),
    scope: "SOLID principi, dizajn obrasci, testiranje, Scrum.",
  });

  const examRg = examStore.create({
    subjectId: rg.id,
    examType: "kolokvijum",
    examDate: demoDay(ctx, RG_EXAM_OFFSET),
    scope: "Transformacije, rasterizacija, osvetljenje (Phong), teksturisanje.",
  });
  const examDsUsmeni = examStore.create({
    subjectId: ds.id,
    examType: "usmeni",
    examDate: demoDay(ctx, DS_USMENI_OFFSET),
    scope: "Konsenzus algoritmi, particionisanje, vektorski časovnici, distribuirane transakcije.",
  });
  const examMlUsmeni = examStore.create({
    subjectId: ml.id,
    examType: "usmeni",
    examDate: demoDay(ctx, ML_USMENI_OFFSET),
    scope: "Regularizacija, ansambli, transfer learning, nenadgledano učenje.",
  });
  // Not bound, and deliberately absent from the `seedPlan` calls below: every
  // other future exam here has a plan, and „Novi plan" is drawn ONLY for a
  // future exam that has none. So the profile that the screenshot sweep and the
  // „Demo" account both read had no plan form at all — the page rendered the
  // „nothing left to plan" empty state instead, and a create form nobody could
  // reach was a create form nobody had ever looked at.
  //
  // It is also the truer fixture. A student whose every upcoming exam is
  // already planned is the unusual one; the exam furthest out is the one still
  // waiting, which is why this is the furthest out and has no topics yet.
  examStore.create({
    subjectId: si.id,
    examType: "usmeni",
    examDate: demoDay(ctx, SI_USMENI_OFFSET),
    scope: "Arhitektonski obrasci, refaktorisanje, procena i planiranje.",
  });

  // --- Decks + cards -----------------------------------------------------------
  const deckNbp = deckStore.create({ subjectId: nbp.id, name: nbp.name });
  seedCards(cardStore, deckNbp.id, NBP_BASICS, NBP_CLOZES, NBP_PROBLEM, nowIso);

  const deckMl = deckStore.create({ subjectId: ml.id, name: ml.name });
  seedCards(cardStore, deckMl.id, ML_BASICS, ML_CLOZES, ML_PROBLEM, nowIso);

  const deckDs = deckStore.create({ subjectId: ds.id, name: ds.name });
  seedCards(cardStore, deckDs.id, DS_BASICS, DS_CLOZES, DS_PROBLEM, nowIso);

  const deckPr = deckStore.create({ subjectId: pr.id, name: pr.name });
  seedCards(cardStore, deckPr.id, PR_BASICS, PR_CLOZES, PR_PROBLEM, nowIso);

  const deckBis = deckStore.create({ subjectId: bis.id, name: bis.name });
  seedCards(cardStore, deckBis.id, BIS_BASICS, BIS_CLOZES, BIS_PROBLEM, nowIso);

  const deckSi = deckStore.create({ subjectId: si.id, name: si.name });
  seedCards(cardStore, deckSi.id, SI_BASICS, SI_CLOZES, SI_PROBLEM, nowIso);

  // --- Exam topics (ADR-063) — one list per subject, attached to whichever
  // exam a plan would actually be built against: the upcoming one when there
  // is one, else the most recent past one. Confidence is deliberately varied:
  // some manual numbers, some left null (never rated), some deck-linked so
  // `TopicStore.deriveDeckConfidence` fills them in from real review history.
  seedTopics(
    topicStore,
    [
      { examId: examNbp.id, name: "Indeksiranje i B-stabla", confidence: 85 },
      { examId: examNbp.id, name: "Normalizacija i dekompozicija šema", confidence: null, deckId: deckNbp.id },
      { examId: examNbp.id, name: "Transakcije i ACID", confidence: 90 },
      { examId: examNbp.id, name: "Optimizacija upita (EXPLAIN, planovi izvršavanja)", confidence: 55 },
      { examId: examNbp.id, name: "Replikacija i particionisanje", confidence: null },
      { examId: examNbp.id, name: "NoSQL modeli podataka", confidence: 70 },

      { examId: examMlUsmeni.id, name: "Linearna i logistička regresija", confidence: 80 },
      { examId: examMlUsmeni.id, name: "Stabla odlučivanja i ansambli (random forest)", confidence: null, deckId: deckMl.id },
      { examId: examMlUsmeni.id, name: "Neuronske mreže i backpropagation", confidence: 45 },
      { examId: examMlUsmeni.id, name: "Regularizacija i overfitting", confidence: null, deckId: deckMl.id },
      { examId: examMlUsmeni.id, name: "Evaluacija modela (matrica konfuzije, F1)", confidence: 65 },
      { examId: examMlUsmeni.id, name: "Nenadgledano učenje (k-means, klasterovanje)", confidence: null },
      { examId: examMlUsmeni.id, name: "Transfer learning i predtrenirani modeli", confidence: 30 },

      { examId: examDsUsmeni.id, name: "CAP teorema i konzistentnost", confidence: 75 },
      { examId: examDsUsmeni.id, name: "Konsenzus algoritmi (Raft, Paxos)", confidence: null, deckId: deckDs.id },
      { examId: examDsUsmeni.id, name: "Dvofazna potvrda i distribuirane transakcije", confidence: 50 },
      { examId: examDsUsmeni.id, name: "Replikacija (sinhrona/asinhrona)", confidence: null, deckId: deckDs.id },
      { examId: examDsUsmeni.id, name: "Particionisanje i konzistentno heširanje", confidence: 60 },
      { examId: examDsUsmeni.id, name: "Vektorski časovnici i uzročnost", confidence: 25 },

      { examId: examPr.id, name: "Leksička analiza i konačni automati", confidence: 88 },
      { examId: examPr.id, name: "LL i LR sintaksna analiza", confidence: null, deckId: deckPr.id },
      { examId: examPr.id, name: "Tabela simbola i semantička analiza", confidence: 72 },
      { examId: examPr.id, name: "Međukod i SSA oblik", confidence: 60 },
      { examId: examPr.id, name: "Optimizacija koda", confidence: null },
      { examId: examPr.id, name: "Dodela registara", confidence: 78 },

      { examId: examBis.id, name: "Simetrična i asimetrična kriptografija", confidence: 82 },
      { examId: examBis.id, name: "TLS/SSL protokol", confidence: null, deckId: deckBis.id },
      { examId: examBis.id, name: "SQL injekcija i XSS", confidence: 95 },
      { examId: examBis.id, name: "Kontrola pristupa (RBAC, ACL)", confidence: 68 },
      { examId: examBis.id, name: "Heš funkcije i čuvanje lozinki", confidence: null },
      { examId: examBis.id, name: "Mrežna bezbednost (firewall, MITM)", confidence: 58 },

      { examId: examSi.id, name: "SOLID principi", confidence: 90 },
      { examId: examSi.id, name: "Dizajn obrasci (GoF)", confidence: null, deckId: deckSi.id },
      { examId: examSi.id, name: "Testiranje i TDD", confidence: 77 },
      { examId: examSi.id, name: "CI/CD", confidence: 63 },
      { examId: examSi.id, name: "Agilne metodologije (Scrum)", confidence: null },
      { examId: examSi.id, name: "Refaktorisanje i tehnički dug", confidence: 71 },

      { examId: examRg.id, name: "Rasterizacija i z-bafer", confidence: 40 },
      { examId: examRg.id, name: "Transformacije i matrice (model-view-projection)", confidence: null },
      { examId: examRg.id, name: "Osvetljenje (Phong model)", confidence: 55 },
      { examId: examRg.id, name: "Teksturisanje i mapiranje", confidence: null },
      { examId: examRg.id, name: "Krive i površi (Bezier, B-spline)", confidence: 20 },
    ],
    nowIso,
  );

  // --- Review history — the real scheduler, walked day by day ------------------
  simulateReviewHistory(cardStore, rng, ctx);

  // --- Study plans for the three upcoming exams ---------------------------------
  seedPlan(planStore, examRg.id, 60, null, rng, ctx);
  seedPlan(planStore, examDsUsmeni.id, 90, null, rng, ctx);
  seedPlan(planStore, examMlUsmeni.id, 70, [90, 90, 90, 90, 60, 30, 30], rng, ctx);

  planStore.syncAll(nowIso, ctx.today);

  // NOTE: `StatsStore` is deliberately never called here — it is a read-only
  // facade (no `create`/`insert`/write method anywhere on it) over exactly the
  // tables this function already writes (`review_log` via `CardStore.review`,
  // `study_blocks` via `PlanStore`). There is nothing for a seeder to hand it;
  // its charts read what `simulateReviewHistory`/`seedPlan` produced above.
}

interface TopicSeed {
  examId: string;
  name: string;
  confidence: number | null;
  deckId?: string;
}

/** Creates one exam topic per seed (ADR-063); a deck link is omitted, not `undefined`, when there is none. */
function seedTopics(topicStore: TopicStore, seeds: readonly TopicSeed[], now: string): void {
  for (const seed of seeds) {
    if (seed.deckId === undefined) {
      topicStore.create({ examId: seed.examId, name: seed.name, confidence: seed.confidence }, now);
    } else {
      topicStore.create(
        { examId: seed.examId, name: seed.name, confidence: seed.confidence, deckId: seed.deckId },
        now,
      );
    }
  }
}

/**
 * The English counterpart of the seeder above.
 *
 * Same subjects, exams, decks, topics and plans, filled from `study.en.ts`
 * instead of the Serbian literals — the schedule itself is shared, because
 * `simulateReviewHistory`, `seedPlan` and `seedTopics` take no copy. The topic
 * list is data here rather than an inline array: an English topic names its
 * exam and deck by key, which the map below resolves against the ids this run
 * created.
 */
function seedDemoStudyEnglish(db: DatabaseHandle, ctx: DemoContext): void {
  const rng = demoRandom("study");
  const nowIso = new Date(ctx.now).toISOString();

  const subjectStore = new SubjectStore(db, ctx.profileId);
  const examStore = new ExamStore(db, ctx.profileId);
  const deckStore = new DeckStore(db, ctx.profileId);
  const cardStore = new CardStore(db, ctx.profileId);
  const topicStore = new TopicStore(db, ctx.profileId);
  const planStore = new PlanStore(db, ctx.profileId);

  // --- Subjects --------------------------------------------------------------
  const s = STUDY_EN.subjects;
  const nbp = subjectStore.create({ name: s.nbp.name, color: "jade", semester: s.nbp.semester });
  const ml = subjectStore.create({ name: s.ml.name, color: "gold", semester: s.ml.semester });
  const ds = subjectStore.create({ name: s.ds.name, color: "bronze", semester: s.ds.semester });
  const pr = subjectStore.create({ name: s.pr.name, color: "burgundy", semester: s.pr.semester });
  const bis = subjectStore.create({ name: s.bis.name, color: "crimson", semester: s.bis.semester });
  const si = subjectStore.create({ name: s.si.name, color: "graphite", semester: s.si.semester });
  const rg = subjectStore.create({ name: s.rg.name, color: "jade", semester: s.rg.semester });

  // --- Exams — six already passed, three still ahead -------------------------
  const sc = STUDY_EN.scopes;
  const examNbp = examStore.create({
    subjectId: nbp.id,
    examType: "kolokvijum",
    examDate: demoDay(ctx, NBP_EXAM_OFFSET),
    scope: sc.nbp,
  });
  examStore.create({
    subjectId: ml.id,
    examType: "pismeni",
    examDate: demoDay(ctx, ML_PISMENI_OFFSET),
    scope: sc.mlPismeni,
  });
  examStore.create({
    subjectId: ds.id,
    examType: "kolokvijum",
    examDate: demoDay(ctx, DS_KOLOKVIJUM_OFFSET),
    scope: sc.dsKolokvijum,
  });
  const examPr = examStore.create({
    subjectId: pr.id,
    examType: "pismeni",
    examDate: demoDay(ctx, PR_EXAM_OFFSET),
    scope: sc.pr,
  });
  const examBis = examStore.create({
    subjectId: bis.id,
    examType: "usmeni",
    examDate: demoDay(ctx, BIS_EXAM_OFFSET),
    scope: sc.bis,
  });
  const examSi = examStore.create({
    subjectId: si.id,
    examType: "pismeni",
    examDate: demoDay(ctx, SI_EXAM_OFFSET),
    scope: sc.si,
  });

  const examRg = examStore.create({
    subjectId: rg.id,
    examType: "kolokvijum",
    examDate: demoDay(ctx, RG_EXAM_OFFSET),
    scope: sc.rg,
  });
  const examDsUsmeni = examStore.create({
    subjectId: ds.id,
    examType: "usmeni",
    examDate: demoDay(ctx, DS_USMENI_OFFSET),
    scope: sc.dsUsmeni,
  });
  const examMlUsmeni = examStore.create({
    subjectId: ml.id,
    examType: "usmeni",
    examDate: demoDay(ctx, ML_USMENI_OFFSET),
    scope: sc.mlUsmeni,
  });
  // The furthest exam out, deliberately absent from the plan calls below — see
  // the Serbian seeder's note beside the same call.
  examStore.create({
    subjectId: si.id,
    examType: "usmeni",
    examDate: demoDay(ctx, SI_USMENI_OFFSET),
    scope: sc.siUsmeni,
  });

  // --- Decks + cards ---------------------------------------------------------
  const cards = STUDY_EN.cards;
  const deckNbp = deckStore.create({ subjectId: nbp.id, name: nbp.name });
  seedCards(cardStore, deckNbp.id, cards.nbp.basics, cards.nbp.clozes, cards.nbp.problem, nowIso);

  const deckMl = deckStore.create({ subjectId: ml.id, name: ml.name });
  seedCards(cardStore, deckMl.id, cards.ml.basics, cards.ml.clozes, cards.ml.problem, nowIso);

  const deckDs = deckStore.create({ subjectId: ds.id, name: ds.name });
  seedCards(cardStore, deckDs.id, cards.ds.basics, cards.ds.clozes, cards.ds.problem, nowIso);

  const deckPr = deckStore.create({ subjectId: pr.id, name: pr.name });
  seedCards(cardStore, deckPr.id, cards.pr.basics, cards.pr.clozes, cards.pr.problem, nowIso);

  const deckBis = deckStore.create({ subjectId: bis.id, name: bis.name });
  seedCards(cardStore, deckBis.id, cards.bis.basics, cards.bis.clozes, cards.bis.problem, nowIso);

  const deckSi = deckStore.create({ subjectId: si.id, name: si.name });
  seedCards(cardStore, deckSi.id, cards.si.basics, cards.si.clozes, cards.si.problem, nowIso);

  // --- Exam topics (ADR-063) --------------------------------------------------
  const examIds: Partial<Record<DemoExamKey, string>> = {
    nbp: examNbp.id,
    pr: examPr.id,
    bis: examBis.id,
    si: examSi.id,
    rg: examRg.id,
    dsUsmeni: examDsUsmeni.id,
    mlUsmeni: examMlUsmeni.id,
  };
  const deckIds: Partial<Record<DemoDeckKey, string>> = {
    nbp: deckNbp.id,
    ml: deckMl.id,
    ds: deckDs.id,
    pr: deckPr.id,
    bis: deckBis.id,
    si: deckSi.id,
  };
  seedTopics(
    topicStore,
    STUDY_EN.topics.map((topic) => {
      const examId = examIds[topic.exam];
      if (examId === undefined) {
        throw new Error(`The English demo names no exam for the topic "${topic.name}".`);
      }
      const deckId = topic.deck === undefined ? undefined : deckIds[topic.deck];
      if (topic.deck !== undefined && deckId === undefined) {
        throw new Error(`The English demo names no deck for the topic "${topic.name}".`);
      }
      return {
        examId,
        name: topic.name,
        confidence: topic.confidence,
        ...(deckId === undefined ? {} : { deckId }),
      };
    }),
    nowIso,
  );

  // --- Review history and study plans — the same schedule either way ----------
  simulateReviewHistory(cardStore, rng, ctx);

  seedPlan(planStore, examRg.id, 60, null, rng, ctx);
  seedPlan(planStore, examDsUsmeni.id, 90, null, rng, ctx);
  seedPlan(planStore, examMlUsmeni.id, 70, [90, 90, 90, 90, 60, 30, 30], rng, ctx);

  planStore.syncAll(nowIso, ctx.today);
}
