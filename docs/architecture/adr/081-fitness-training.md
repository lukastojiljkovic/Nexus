# ADR-081 — FIT: training, and the measurements that tell you whether it worked

**Status:** accepted (2026-08-02) · **Owner:** supervisor · **Implements:** the
PRD's „Fitness (FIT) — Should" beyond its food half, which shipped as
[ADR-078](078-nutrition.md). **Founder instruction (2026-08-02):** *„pazi to za
treninge, praćenje i sve, mora da bude urađeno svetski… potpuni fokus na to."*
Nothing else runs while this arc is open.

**Reserved:** migration **060**, interchange **1.37.0**. Every table, store,
channel and record type below was checked free before this was written.

## 1. What separates a training log from a form over a table

Almost every fitness app is a spreadsheet with rounded corners. The ones people
actually keep using for years get five things right, and those five are what this
ADR is about:

1. **It tells you what you did last time, before you lift.** The single most
   used number in any training app is „what did I do for this exercise on the
   last session". If that costs a tap, the app has failed at its one job.
2. **It knows that not all sets are the same.** Warm-up sets are not training
   volume. An app that counts them inflates every statistic it draws.
3. **It knows that not all exercises are measured the same way.** Bench press is
   weight × reps. Pull-ups are reps. A plank is seconds. Assisted dips are
   *negative* load. A schema that only knows kg × reps is wrong about a third of
   what people do.
4. **It refuses to compute what it cannot know.** An estimated 1RM from a set of
   fifteen is a fiction. So is „you burned 420 kcal". Say the number where it is
   defensible and say nothing where it is not.
5. **It does not lie about the scale.** Body weight swings a kilo or two a day on
   water and food alone. Drawing yesterday-versus-today as „progress" is the most
   common false statement a fitness app makes.

Every decision below is downstream of one of those.

## 2. The exercise catalogue: facts we write, not text we scrape

FIT's food half was assembled from public-domain sources because nutrition values
are *measurements somebody made*. An exercise is not. „Potisak sa klupe — grudi,
tricepsi, prednja ramena — šipka — horizontalni potisak" is a set of **facts**,
not a copyrightable expression, and we are perfectly able to state them.

So: **the catalogue is written, not scraped**, and it ships the way the food
catalogue does — a JSON file the build inlines, never rows seeded into a
profile's database ([`catalogue.ts`](../../../packages/core/src/fitness/catalogue.ts)
states why, and every word of it applies here).

What an entry carries:

- **Serbian name**, and the English name beside it — because the whole lifting
  world writes „RDL" and „hip thrust", and a Serb searching for their exercise
  will type either. Both are searched; the Serbian is displayed.
- **Primary and secondary muscles**, from a closed vocabulary.
- **Equipment**, from a closed vocabulary (šipka, bučice, sprava, kabl, sopstvena
  težina, guma, girja…).
- **Movement pattern** — potisak/povlačenje/čučanj/pregib u kuku/nošenje/izolacija
  — because that is what a routine is actually balanced against.
- **Unilateral or not**, which changes what a „set" means.
- **`metric`**, which is §3, and is the field most catalogues do not have.

**No instruction text in v1**, and that is deliberate rather than lazy: exercise
descriptions are the one part of this domain that IS expressive writing, so
either we write several hundred of them properly in Serbian — a separate,
honest piece of work — or we ship none. Shipping half-sentences scraped from
somewhere would be exactly the „AI slop" the design rules forbid. Recorded as
future work, not pretended away.

Users add their own exercises (`fit_exercises`), exactly as they add their own
foods, and a user exercise is indistinguishable from a catalogue one everywhere
except its provenance.

## 3. `metric` — the field that makes the schema honest

A logged set stores four nullable numbers, and `metric` says which of them mean
anything for this exercise:

| `metric` | what a set records | example |
|---|---|---|
| `weight_reps` | weight + reps | potisak sa klupe |
| `reps` | reps only | zgibovi, sklekovi |
| `weighted_reps` | added weight + reps (weight may be 0) | zgibovi sa tegom |
| `assisted_reps` | **subtracted** assistance + reps | zgibovi na sprави, dipovi sa pomoći |
| `time` | seconds | plank, mrtvo visenje |
| `weight_time` | weight + seconds | farmer's walk držanje |
| `distance_time` | distance + seconds | trčanje, veslanje |

Two consequences the rest of the module obeys:

- **Volume arithmetic is per-metric, and some metrics have none.** Tonnage for a
  plank is meaningless; the module does not invent one. Where a number cannot be
  computed the surface says so rather than drawing a zero.
- **`assisted_reps` is not `weighted_reps` with a minus sign in the UI.** It is
  its own metric because an assisted pull-up getting *easier* means the number
  goes **down**, and every progression indicator in the app has to know that or
  it will draw improvement as regression.

## 4. A set is typed, and warm-ups are not volume

`fit_workout_sets.kind` ∈ `warmup | working | drop | failure`.

**Only `working` and the tail of a drop set count toward volume**, and this is
the same decision — and the same defect — the focus timer hit in ADR-077: when
break phases became rows, every study statistic silently inflated until all four
reads were scoped to `kind = 'work'`. The mirror here is exact, so the store's
volume reads are scoped from the first commit and a test seeds a warm-up and
asserts no statistic moved.

A set also carries **RIR** (reps in reserve, 0–5, nullable) rather than RPE.
Both are the same information; RIR is the one a person can actually answer
without a decade of calibration („koliko si još mogao?"), and a field people
answer wrongly is worse than one they leave empty.

## 5. What gets computed, and what deliberately does not

**Estimated 1RM.** Epley (`w × (1 + r/30)`) and Brzycki (`w × 36/(37 − r)`)
agree closely up to about five reps and diverge badly past ten. So: **the
estimate is published with its formula named, and refused above 10 reps** rather
than extrapolated. This is ADR-078's Atwater posture applied to a different
domain — a number nobody can defend is not a number this product prints. The
value is never stored; a stored estimate would rot the moment the formula changed.

**Weekly volume, in two figures that are never conflated:**
- **hard sets per muscle group per week** — the metric current training science
  actually uses for hypertrophy, and the one a person can act on;
- **tonnage (kg × reps)** for the strength lifts, where it means something.

Both are labelled in the UI. An app that shows one number called „volume" is
hiding which one it picked.

**Personal records**, per exercise: heaviest set, best estimated 1RM (where
defined), most reps at a given weight. Derived on read, never a stored „PR" row —
a PR table and a set table can disagree, and only one of them is the truth.

**No calorie burn.** Nexus has no heart-rate data, no VO2, no accelerometer, and
a MET-table estimate for „strength training, general" is a number with an error
bar wider than the meal it would offset. FIN refuses an exchange rate it cannot
verify; FIT refuses this for the identical reason, and says so on the surface
rather than leaving a suspicious gap.

## 6. Routines are shapes, not schedules

A routine is a **saved shape of a session** — the ADR-035 rule that task
templates already run on: relative and by-name where an absolute value would rot.
It holds an ordered list of exercises with target sets and a target rep range,
and nothing about *when*.

Starting a workout from a routine prefills the exercises and, beside each one,
**the numbers from the last time that exercise was done** — which is §1.1, the
whole reason anybody opens the app mid-set. That read is one query, not one per
exercise.

Deliberately **not** in v1, and recorded rather than silently missing: automatic
progression schemes (5×5 auto-increment, percentage-of-1RM blocks). They are
opinionated programming, and an app that quietly decides your next weight has to
be right about deloads, failures and missed weeks — which needs the log to exist
first. The data model does not resist them.

## 7. The rest timer, and the founder's one-timer rule

ADR-077 settled that Nexus has **one** focus timer: *„nećemo da imamo više
tajmera, mislim da je to loše."*

A rest timer between sets is a countdown of 60–180 seconds that starts when a set
is logged. Putting it in `focus_sessions` would repeat ADR-077's own defect in
reverse — sixty-second rows polluting the honest-attention statistics the focus
module exists to keep clean.

**The resolution: it is not a tracked timer at all.** It is ephemeral, lives in
main-process memory exactly as the running focus phase does, writes no row, keeps
no history and produces no statistic. It is a kitchen timer for the set you just
finished. Nothing about it appears in „Fokus", and the one-timer rule is
untouched, because that rule is about *what the product records as time spent* —
of which there remains exactly one.

**This is flagged to the founder rather than assumed.** If he reads his rule more
broadly, the rest countdown comes out and the module loses nothing structural.

## 8. Measurements: the scale is noisy and the app must say so

`fit_measurements` is one row per (day, kind): **weight**, **body-fat percent**,
and circumferences — vrat, grudi, struk, kukovi, nadlaktica, butina, list.

The load-bearing decision is the reading, not the schema. Body weight swings 1–2 kg
a day on water, salt and gut content. So:

- the trend line is a **7-day moving average**, and it is what the number and the
  chart both show;
- the raw daily readings are drawn behind it, so nothing is hidden;
- a change is only called a change when the averages differ — **never**
  yesterday against today.

This is the same class of decision as HABIT's gentle streaks and STUDY's honest
stats: the product's job is to tell the truth about a noisy signal, not to
generate a satisfying number.

**No body-fat formula.** Navy-tape and BMI-based estimates carry error bars of
±4 percentage points, which is larger than a year of real change. The field
accepts what a user's own caliper or scale told them, and Nexus does not compute
one. Same rule as §5's calorie burn.

## 8a. The body profile, and energy that is measured rather than guessed

**Founder, 2026-08-02:** *„moraš da ubaciš da korisnik unese svoje parametre,
tipa visinu težinu pol, i opciono ako ima da može da nam se uračuna preciznije
za kalorije i tako to — ono procenat masti, mišića, vode, i to ako može da
izmeri da budu preciznija merenja."*

This is the right instinct and it reaches further than it looks, because Nexus is
about to hold **both** halves of the energy equation — logged intake (ADR-078)
and a weight trend (§8) — which almost no app has together. That makes a
population formula the *fallback* rather than the answer.

### The split: what is a fact about you, and what is a reading

- **`fit_body_profile`** — one row per profile: **sex**, **birth date**,
  **height**, and the activity level. These are facts about a person, not
  observations, and they change rarely. Age is derived from the birth date so it
  cannot silently rot; storing „30" once means being wrong from the next birthday
  onwards.
- **`fit_measurements`** (§8) — the time series: **weight**, **body-fat %**,
  **muscle %/kg**, **water %**, and the circumferences. A smart scale produces
  the first four in one step, so they are entered together and stored as one
  day's reading.

Both live in the encrypted database, which is where health data belongs and
already is; nothing about this reaches a network, because there is none.

### Three tiers of energy expenditure, and the app names which one it used

**Tier 1 — MEASURED, from the user's own data.** Over a window of at least 14
days, with intake logged on at least 80 % of them:

```
TDEE ≈ mean daily intake − (Δ trend weight in kg × 7700 / days)
```

using the **trend** weight at both ends (§8's moving average), never two raw
weigh-ins. This is not a formula about people in general; it is arithmetic about
*this* person, and it beats every equation below it — an equation predicts to
±10 % at best, while this measures.

**Its preconditions are refusals, and they are the whole reason it can be
trusted.** If intake is logged on half the days, mean intake is not mean intake
and the answer is confidently wrong. So: too few days → refuse and say how many
more; too little logging coverage → refuse and say so; not enough weigh-ins to
form both trend endpoints → refuse. A tier that quietly degrades is worse than
one that declines.

The 7700 kcal/kg figure is itself an approximation (the literature runs
~7000–7700 depending on the fat/lean ratio of the change) and is named as an
assumption on screen rather than presented as physics.

**Tier 2 — KATCH–McARDLE, when body fat % is known.** `BMR = 370 + 21.6 × LBM`,
where LBM is lean body mass from the measured body-fat percentage. This is
exactly what the founder asked for: a real measurement making the number better.
It is also **sex-independent by construction** — the sex terms in other formulas
are standing in for body composition, and here we have the composition itself.

**Tier 3 — MIFFLIN–ST JEOR**, the current standard when nothing but the basics
are known: `10×kg + 6.25×cm − 5×age + 5` (m) / `− 161` (f). Harris–Benedict is
deliberately not used; it is a 1919 equation superseded for good reason.

TDEE is BMR × an activity factor, and **the activity factors are the crudest part
of the whole calculation** (1.2 … 1.9, from studies with wide spread). The app
says so where it shows one, because a user who does not know that will trust the
wrong digit.

**The app always states which tier produced the number and what it would take to
reach the tier above.** „Procena po Mifflin–St Jeor formuli. Izmeri procenat
masti za precizniju procenu, ili beleži obroke 14 dana i Nexus će je izračunati
iz tvojih podataka." That sentence is the feature.

### What this never does

- **It never overwrites the user's own calorie target.** `fit_targets` already
  holds goals the user set. A computed figure is offered — „predloži cilj na
  osnovu ovoga" — and adopted by a deliberate act. A number that silently
  replaced somebody's decision is the same failure as converting money at a rate
  the app cannot verify.
- **It computes no body-fat percentage.** Navy-tape and BMI-based estimates carry
  ±4 percentage points, which is more than a year of real change. Nexus accepts
  what the user's caliper or scale reported and does not invent one.
- **BMI is shown only when there is no body-fat reading**, and labelled for what
  it is — a population screening figure that reads a muscular person as
  overweight. With a real body-fat percentage on file it adds nothing and is not
  drawn.
- **Bioimpedance readings are treated as trends, never as points.** A smart
  scale's absolute body-fat number can be several points off and moves with
  hydration; its *direction over weeks* is informative. So body fat, muscle and
  water get §8's moving-average treatment for the same reason weight does, and
  the water reading earns its place mainly by **explaining** a jump in weight
  rather than by feeding any calculation.

## 9. Where it appears, and where it deliberately does not

- **„Trening"** — a second section of the FIT page beside „Ishrana", not a new
  module. FIT is one hub; a person tracking their body does not think of food and
  training as separate applications.
- **Dashboard widget** — this week's sessions and the next routine.
- **NOT a calendar source.** HABIT settled this argument already: a thing that
  happens three to five times a week would put hundreds of bars a year into a
  calendar built for appointments. A workout is logged, not scheduled.
- **Not in the focus timer's stats** (§7), and not in the notification engine in
  v1 — a reminder to train is a habit, and HABIT already does habits properly.

## 10. Slices

- **a — the catalogue and the model.** `packages/core/src/fitness/exercise.ts`
  (the entry type, the closed vocabularies, `metric`, validation) and
  `data/exercises.json`, written and validated; plus the pure arithmetic:
  estimated 1RM with its refusal, volume per metric, the moving average.
- **a2 — the body and its energy** (§8a, added on the founder's instruction and
  running beside slice a). `packages/core/src/fitness/body.ts`: the body-profile
  model, lean body mass, the three expenditure tiers with the refusals that make
  the measured one trustworthy, and the target suggestion that is offered rather
  than applied.
- **b — the data layer.** Migration **060** (`fit_exercises`, `fit_routines`,
  `fit_routine_items`, `fit_workouts`, `fit_workout_sets`, `fit_measurements`,
  `fit_body_profile`), the stores, the `fit:*` channels, interchange **1.37.0**
  with the new record types through export/import/restore/foreign-import.
- **c — „Trening".** Logging a session, starting from a routine, last-time
  numbers beside every exercise, the rest countdown, routine editing.
- **d — progression and „Merenja".** PRs, weekly volume by muscle group, the
  1RM trend, the measurement surface with its moving average, and the dashboard
  widget.
