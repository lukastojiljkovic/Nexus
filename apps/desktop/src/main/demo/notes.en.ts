/**
 * The English bodies of the demo notebook, one per entry of `NOTES` in
 * `notes.ts` and in the same order.
 *
 * Kept as a parallel array rather than a map keyed by the Serbian text: the
 * Serbian bodies are thousands of characters each, and a map would carry every
 * one of them a second time as a key. `seedDemoNotes` reads
 * `NOTE_BODIES_EN[index]` when the run is English and the Serbian body straight
 * off its spec otherwise, so the Serbian scene is untouched and the two can
 * never be silently reordered - the array length is asserted by a test.
 */
export const NOTE_BODIES_EN: readonly string[] = [
  `# Graph search algorithms

Notes from the data structures and algorithms lecture — depth-first search and
breadth-first search, and why the choice between them depends on the shape of
the problem.

## DFS (depth-first search)

Goes as deep as it can before coming back. Implemented recursively or with an
explicit stack. Good for cycle detection, topological sorting and finding
connected components.

## BFS (breadth-first search)

Walks the graph layer by layer using a queue. Guarantees the shortest path in an
unweighted, undirected graph — every node is first reached by the shortest
possible path from the root.

## Dijkstra

An extension of BFS for graphs with non-negative weights. It uses a priority
queue (min-heap) instead of a plain queue, and the complexity is
O((V + E) log V) with a binary heap.

- DFS → components, cycles, topological sorting
- BFS → shortest path without weights
- Dijkstra → shortest path with non-negative weights
- Bellman-Ford → when negative weights exist (slower, but exact)

For the exam I have to be able to draw the algorithm's trace on paper, not just
the pseudocode.
`,
  `# Databases — normalisation

Normalisation is the process of organising tables so that redundancy is reduced
and insertion, update and deletion anomalies are prevented.

## 1NF

Every column holds an atomic value; there are no repeating groups. A column
"phones" with several comma-separated numbers breaks 1NF — each number belongs in
its own row.

## 2NF

The table is in 1NF and every non-key attribute depends on the WHOLE composite
key, not only on part of it. This matters for tables with a composite primary
key.

## 3NF

The table is in 2NF and has no transitive dependencies — a non-key attribute must
not depend on another non-key attribute.

An example from the exercises: the table Order(id, customer_id, customer_name,
product_id, product_price) breaks 3NF because customer_name depends on
customer_id rather than directly on the order key. The fix is to split it into
Customer and Product tables joined by foreign keys.

- 1NF — atomic values
- 2NF — full functional dependence on the key
- 3NF — no transitive dependencies
- BCNF — a stricter 3NF, where every determinant is a candidate key

I came back to this before the exam and added the example — normalisation was
not clear to me earlier without a concrete table.
`,
  `# Operating systems — process scheduling

The scheduler picks which process gets the CPU next. The goal is a balance
between throughput, response time and fairness.

- **FCFS** (first come, first served) — simple, but bad when a long process
  blocks short ones (the convoy effect).
- **SJF** (shortest job first) — optimal for average waiting time, but it needs
  the durations in advance, which is rarely true in practice.
- **Round Robin** — each process gets a time quantum, then goes to the back of
  the queue. Good for interactive systems; the size of the quantum is a
  trade-off between response time and the overhead of context switching.
- **Priority scheduling** — risks starving low-priority processes, fixed by
  aging their priority.

For the exam: be able to draw the Gantt chart for a given set of processes and
compute the average waiting time for each algorithm.
`,
  `# Artificial intelligence — lecture notes

## The neuron and activation functions

An artificial neuron computes the weighted sum of its inputs plus a bias, then
passes it through an activation function. Without a non-linear activation the
whole network would collapse into a single linear transformation, however many
layers it has.

- Sigmoid — output in (0,1), vanishing-gradient problem in deep networks
- ReLU — max(0, x), fast to compute, the standard choice for hidden layers
- Softmax — for the output layer in multi-class classification; the outputs sum
  to 1

## Backpropagation

The chain rule applied backwards through the layers — it computes the gradient of
the loss with respect to every weight. Gradient descent then moves the weights
against the gradient, by a step the learning rate decides.

An important note from the exercises: too large a learning rate diverges (the
loss jumps), too small converges painfully slowly. The Adam optimiser adapts the
rate per parameter and in practice is almost always a better starting point than
plain SGD.

## Overfitting

The model learns the training set too well, noise included, and generalises
poorly. Remedies: regularisation (L2), dropout, early stopping on the validation
set.

I added to these notes after the office hours — the professor explained why batch
normalisation matters for training stability, which I had missed the first time.
`,
  `# Compilers — lexical analysis

The compiler's first phase — turning the characters of the source text into a
stream of tokens (lexemes). It works through a finite automaton generated from
the regular expressions that describe each token type.

- Identifier: \`[a-zA-Z_][a-zA-Z0-9_]*\`
- Integer: \`[0-9]+\`
- Operator: \`+ - * / = == != <= >=\`

The lexer must apply maximal munch — on \`<=\` it must not read just \`<\` and stop; it
has to check whether the next character extends the token.

Errors at this level are, for example, an unknown character or an unterminated
string literal — the lexer reports them with a line and column, which is why line
and column are tracked while the input is read.

The next phase is syntax analysis (parsing), which builds a syntax tree from the
stream of tokens — that is the next note.
`,
  `# Network protocols — TCP/IP layer

A quick review of the layers before the computer networks midterm.

TCP is connection-oriented — it establishes a connection with a three-way
handshake (SYN, SYN-ACK, ACK), and guarantees delivery and packet order through
acknowledgements and retransmission. UDP has none of that — it is faster, and it
is used for streaming and DNS queries, where losing a packet is more acceptable
than the delay TCP introduces with its retransmissions.

The IP layer handles routing — every packet carries a source and a destination
address, and routers choose the next hop from a routing table. An IPv4 address is
32 bits, which is why they ran out and why IPv6 exists with 128 bits.

To check before the midterm: the difference between the TCP and UDP headers, and
how a subnet mask splits an address into the network part and the host part.
`,
  `# Preparing for the thesis defence

A list of everything that must be ready before the defence. I update it as I work
through the items.

- [x] Final version of the thesis submitted to the supervisor for review
- [x] Corrections from the supervisor's comments applied
- [x] Presentation — first version (15 slides)
- [x] Bound copy submitted to the student office
- [ ] Rehearsing the talk — at least three times out loud, with a stopwatch
- [ ] Preparing answers to the committee's expected questions about the
      methodology
- [ ] Checking that the demo application runs on the laptop I am taking to the
      defence (not on a faculty computer!)
- [ ] Printing a backup copy of the presentation onto a USB stick
- [ ] Dressing appropriately, bringing my identity card and student record book

The biggest risk is a question about the alternative approaches I did not cover
in the thesis — I need a clearly argued reason why the chosen approach is better
for this particular problem.
`,
  `# Nexus — roadmap ideas

Free notes about the direction of development — not all of this will make the
final version; this is where I write an idea down before I forget it.

## Short term

- Refine search so it ranks by relevance, not only by date
- Add a quick shortcut for creating a note from any screen
- Improve each section's empty state — right now it looks bare and unfinished

## Medium term

- A dashboard widget that pulls data from several modules at once
- Export the whole profile into a readable archive format, not only the database
- Dark and light themes must be consistent down to the last pixel — this is
  ongoing work, not a one-off task

## Long term (after the desktop version)

A web version from the same code — Electron and React were chosen with that in
mind. Syncing between devices comes only once the desktop version is fully
mature. The priority is for the product to be excellent locally first, and only
then to spread.

I came back to add the widget-dashboard item — it occurred to me last night while
I was looking at how other applications organise their home screen.
`,
  `# API design for a RAG system

Notes while I think about the architecture of a small retrieval-augmented
generation system for a personal knowledge base.

The basic flow: the user's query is first turned into an embedding vector, then
compared with the document vectors in a vector database (ChromaDB to start with,
easy for local development). The top-k most similar passages go into the prompt's
context together with the original question, and only then does the call to the
model go out.

Questions I have not settled yet:

- How to split long documents into passages — a fixed length is simple but cuts
  sentences in half. Semantic splitting by paragraph is better but slower to
  implement.
- Whether to keep the conversation history in the same context, or rewrite the
  query from the previous messages before the search.
- Reranking after the first retrieval — is the extra latency worth it.

For now I am building the simplest possible version so that I have something that
works, and only then will I optimise retrieval quality.
`,
  `# Refactoring authentication

A plan for cleaning up the authentication module before I add more functionality
to it.

- [x] Move password validation into its own function with tests
- [x] Remove the duplicated session-check code from three different files
- [x] Replace the manual string comparison for tokens with a constant-time
      function
- [ ] Add tests for the edge cases (empty password, over-length, Unicode
      characters)
- [ ] Document the token refresh flow — at the moment it exists only in my head
- [ ] Check that every error returns a generic message to the user, without
      revealing whether the account exists

The biggest debt is the missing edge-case tests — that is next in line before any
new functionality.
`,
  `# Idea: a habit-tracking tool

A small, focused application — just a list of habits and a grid of squares like
GitHub's contribution graph. No gamification with badges and levels; that quickly
becomes its own goal instead of the habit.

The only "clever" thing would be the streak and a reminder that stays quiet if the
habit has already been ticked that day. Everything else — statistics, export,
sharing — is unnecessary for a first version.
`,
  `# Portfolio site — TODO list

- [x] Projects section — cards with a short description and a link to the
      repository
- [x] About me section — short, without phrases like "passionate programmer"
- [x] Responsive wrapping for mobile devices
- [ ] Add a section with certificates and courses
- [ ] Optimise the images — the current page size is too large
- [ ] Check colour contrast for accessibility
- [ ] Wire the contact form to email
- [ ] Deploy and check on a real domain, not only locally

The goal is to have this finished before I start actively applying for jobs.
`,
  `# Thesis — chapter structure

A working structure, changing as I write.

1. Introduction — motivation, the problem, the goals of the work
2. Related work — what exists, where the limitations of existing approaches are
3. Methodology — the architecture of the proposed solution, the technologies used
   and why those
4. Implementation — the key parts of the system, with emphasis on what is the
   original contribution
5. Evaluation — the testing methodology, results, comparison with the
   alternatives
6. Conclusion — what was achieved, limitations, directions for further work

The supervisor suggested making the evaluation chapter more extensive and
including a qualitative analysis, not only numbers — that is why the structure
changed.
`,
  `# Sarma

A winter classic; it takes a long time but it pays off. This makes a big pot,
enough for six to eight people.

## Ingredients

- 1 jar of sour cabbage (whole leaves, not shredded)
- 500 g minced meat (half pork, half beef)
- 1 cup of rice
- 2 onions, finely chopped
- 1 tablespoon of sweet paprika
- salt, pepper, a little oil
- smoked bacon or ribs for the bottom of the pot

## Method

1. Separate the cabbage leaves and rinse off the sourest parts under running
   water.
2. Fry the onion in oil until soft, then leave it to cool.
3. Mix the meat, rice, fried onion, paprika, salt and pepper — the filling
   should be even.
4. Put a spoonful of filling on each leaf and roll it into a firm parcel,
   folding the ends inwards.
5. Line the bottom of the pot with bacon or ribs, then pack the rolls tightly
   against one another.
6. Pour on water to cover them, and add a little paprika to the water for
   colour.
7. Cook on a low heat for three to four hours — the longer the better, the
   flavours merge.

The most important lesson from last time: do not rush the heat. On a high flame
the cabbage falls apart before the filling is cooked through.
`,
  `# Karađorđeva schnitzel

Pork loin cut and rolled into a roulade, filled with kajmak, breaded and fried —
faster than sarma, and good for guests when there is no time for a long cook.

## Ingredients

- pork loin, cut into thin escalopes and beaten flat
- kajmak (or a thick cheese, to taste)
- flour, egg and breadcrumbs for coating
- oil for frying
- tartare sauce to serve

## Method

Beat the escalope thin, put a spoonful of kajmak in the middle, roll it up and
secure it with a toothpick or kitchen twine. Roll it in flour, then beaten egg,
then breadcrumbs. Fry in deep oil until golden on all sides. Remove the
toothpick before serving and serve with tartare sauce and chips.

The trick I learned from the neighbour: add a little grated cheese to the
kajmak; it leaks less during frying.
`,
  `# Prebranac

Beans with plenty of onion, baked in the oven — make it a day ahead; it is even
better the next day.

Soak the beans in cold water overnight. The next day, cook them until half soft
in fresh water with a bay leaf. Meanwhile fry plenty of onion in oil until
golden, and stir in the paprika off the heat so it does not burn. Drain the
beans (keeping a little of the cooking liquid), mix them with the onion in a
baking dish, add salt, pepper and a little of the cooking liquid, and bake at
180°C until a golden crust forms on top, about an hour.

The key is the amount of onion — there must be almost as much onion as beans;
that is what separates prebranac from plain cooked beans.
`,
  `# Pancakes

A quick recipe for when there is no time. This batter makes about fifteen thin
pancakes.

- [x] Beat 2 eggs with a pinch of salt
- [x] Add 300 ml of milk and 150 ml of water, and beat
- [x] Gradually stir in 200 g of flour so there are no lumps
- [x] Leave the batter to rest for 15 minutes
- [ ] Cook them in a well-heated pan, a thin film of oil between each

The batter must be as runny as water — if it is thick, the pancakes come out
thick and rubbery. I usually fill them with home-made plum jam, or Nutella for
the children when they visit.
`,
  `# Ajvar — preserving for winter

An autumn ritual — I make a large batch at once so it lasts the whole winter.

## Preparing the peppers

I roast red babura peppers and aubergine on the grill or in the oven until the
skin is blackened all over, then put them straight into a covered bowl or a bag
to steam — the skin then comes off by itself, with no knife.

## Cooking

I mince or finely chop the peeled peppers and aubergine, then cook them on a low
heat with occasional stirring, with oil, a little salt and vinegar. It cooks for
a long time — an hour and a half to two — until the water evaporates and the
ajvar thickens.

## Sealing the jars

- [x] Sterilise the jars and lids in boiling water
- [x] Pour the ajvar hot into dry, warm jars
- [x] Seal at once, while it is hot
- [x] Turn the jars upside down until they cool completely
- [ ] Label them with the date they were made
- [ ] Take them to the pantry, away from the light

This year I added a little more aubergine than last — it came out milder, less
hot, exactly how we like it.
`,
  `# Moussaka

Layers of potato and minced meat under a white sauce — best eaten the next day,
once the layers have settled.

Cut the potatoes into rounds and fry them briefly in oil, just until golden, not
cooked through. Fry the meat with onion, salt, pepper and a little paprika.
Layer potato, then meat, and repeat. Pour the white sauce over everything —
butter, flour and milk cooked until thick, with an egg stirred in off the heat
so it does not curdle. Bake at 180°C for about 40 minutes, until the top is
golden.

Today the white sauce came out lump-free for the first time — the trick is to
pour the milk in gradually, a little at a time, stirring constantly.
`,
  `# Weekend in Zlatibor

A short escape from the city, two days. The weather was almost perfect — sunny
by day, cold in the evening, exactly right for the mountains.

On the first day a walk to Lake Zlatibor, then dinner in a restaurant serving
home cooking — the proja with cheese and kajmak was better than I expected. On
the second day a short trip towards Gostilje; the waterfalls were smaller than
in the photographs I had seen before, but the drive through the forest was
worth it on its own.

Next time it is worth staying longer — two days is too little to see Mokra Gora
and the Šargan Eight as well; that is left for the next trip.
`,
  `# Trip plan — Greece, summer

A rough plan; it will change once we book accommodation.

## Days 1-3 — Thessaloniki

Landing, getting to know the city, the seafront promenade, the White Tower.
Thessaloniki was chosen as the entry point because the flight is cheaper than
flying straight to the islands.

## Days 4-7 — Halkidiki

Hire a car in Thessaloniki and drive to Sithonia. Fewer crowds on the beaches
than Kassandra, from what I have read; the priority is relaxing, not
sightseeing.

## Days 8-10 — back via Meteora

Stop at the Meteora monasteries on the way — early in the morning, because of
the crowds and the heat later in the day.

## To prepare

- [x] Book the flights
- [x] Check the passport is valid (it does not expire for six months)
- [ ] Book accommodation for Thessaloniki and Sithonia
- [ ] Hire a car — check whether an international licence is needed
- [ ] Buy travel insurance
- [ ] Download offline maps in case the signal is poor

I added the passport item after checking that it expires in eight months — just
on the edge, but it passed the check.
`,
  `# Travel notes — Budapest

A weekend in Budapest, the first time by coach instead of flying — surprisingly
comfortable, and cheaper.

The Széchenyi thermal baths deserved every word of praise, especially in the
evening when there are fewer people and the lighting is beautiful. The Parliament
building looks more impressive in person than in pictures, especially from the
other side of the Danube at night when it is lit. The food was mixed — the
goulash was excellent in a small restaurant outside the tourist zone, while the
same goulash in a restaurant near the centre was rather bland and overpriced.

The lesson for next time: look for restaurants at least a ten-minute walk from
the main tourist spots; the difference in quality and price is enormous.
`,
  `# Packing list — hiking

- [x] Hiking boots, broken in, not new
- [x] Waterproof jacket
- [x] 30-40 l rucksack with a hip belt
- [x] Thermos and enough water
- [ ] First aid — a small kit
- [ ] Torch or headlamp with spare batteries
- [ ] Energy bars and nuts
- [ ] The route map downloaded offline, and a paper one as backup
- [ ] A charged power bank for the phone

Learned on the last trip: never set off without a paper map; the phone lost its
signal right at the most critical junction of the route.
`,
  `# Ideas for the next trip

A quick list of places that appeal to me, with no concrete plan for now.

- Montenegro — Durmitor, hiking and the Tara canyon
- Portugal — Lisbon and Porto; I have heard the food is excellent and cheaper
  than the rest of western Europe
- Bosnia — Mostar and the Kravice waterfalls; close by and easy for a weekend
- Iceland — pricier and more ambitious, for when the budget allows

The priority for next season is probably Montenegro — closest, cheapest, and
enough for a long weekend on its own.
`,
  `# Sapiens — Yuval Noah Harari

The history of humankind through three revolutions — cognitive, agricultural and
scientific. A book that changes your perspective on what "progress" even means.

## The Cognitive Revolution

About 70,000 years ago Homo sapiens developed the ability to believe in shared
fictions — myths, religions, nations, money. Harari's thesis is that this
ability, rather than intelligence by itself, is what makes cooperation possible
among large groups of strangers, something no other species can do.

## The Agricultural Revolution

He calls it "history's biggest fraud" — agriculture made larger populations
possible, but gave the average individual a worse diet, more work and worse
health than hunter-gatherers had. An interesting thesis, if a little
simplified.

## The Scientific Revolution

It begins with an admission of ignorance — a readiness to say "we do not know"
and to investigate that ignorance actively, instead of relying on sacred texts
as the source of every answer.

The parts about the future and biotechnology convinced me less than the
historical ones — they feel more speculative. Worth reading at least the first
two parts of the book, even if the last is skipped.

I came back to add this last paragraph after the second half of the book — the
original notes covered only the first part.
`,
  `# The Master and Margarita — notes

Bulgakov's novel mixes satire of Soviet society, a love story and theological
fantasy — it took me a chapter or two to settle into that rhythm.

> Manuscripts don't burn.

That sentence stayed with me the longest — the idea that truth and art survive
destruction, even when a system tries to erase them. Woland and his retinue
bring chaos to Moscow in a way that is at once comic and chillingly accurate as
a picture of bureaucracy and fear.

The chapters about Pontius Pilate, woven through the Master's novel, read like a
completely different book in tone — more serious, slower. It took me a while to
see why they are there, but in the end everything comes together around
forgiveness and cowardice.
`,
  `# Atomic Habits — James Clear

A practical book; some repetition, but good ideas that I tried to apply straight
away.

- Focus on the system, not the goal — the goal is a direction; the system is
  what you do every day.
- Identity before behaviour — the question is not "I want to run" but "I want to
  be a person who runs". A change of identity lasts longer than discipline.
- The two-minute rule — a new habit should take less than two minutes at first,
  to get over the starting threshold before building duration.
- Habit stacking — a new habit is attached to an existing routine ("after the
  morning coffee, five minutes of stretching").
- Environment shapes behaviour more than motivation — if I do not want to eat
  snacks, I should not have them in the house at all.

The most useful part for me was the two-minute rule — I applied it directly to
reading, starting with "read one page" instead of an ambitious daily goal, and
now I read longer almost every day.
`,
  `# 1984 — George Orwell

A second reading, this time paying more attention to the language than to the
story itself.

Newspeak as a tool of control is what intrigued me most this time — the idea
that if you remove a word for a concept from the language, the thought itself
becomes harder to form. That is a more frightening idea than the surveillance
screen or the telescreen, because it attacks thinking before it reaches action.

Winston's breaking under pressure in the Ministry of Love is still as
uncomfortable to read as it was the first time — Orwell allows no hope at the
end, and that very absence of relief is why the book remains so striking
decades later.
`,
  `# Clean Architecture — Robert Martin

A technical book about software design; I am reading it alongside work on my own
projects so I can apply what I read immediately.

## The dependency rule

Source-code dependencies may only point inwards, towards the business logic —
outer layers (database, UI, framework) depend on inner ones, never the other way
round. The business logic must know nothing about the database it uses.

## Boundaries

Interfaces separate the layers so that an implementation detail (which
database, say) can be swapped without touching the business logic. This is more
abstract than what I used to think "good architecture" meant — it is not about
folders and file names, but about the direction of dependencies.

## A criticism I picked up from discussions online

Some parts feel like overkill for small projects — a full layered architecture
for a small script is over-engineering. It is worth applying the principles
selectively, according to the size and expected life of the project, not as
dogma.

I came back to this chapter on boundaries after an argument with a colleague
about how to structure the API layer at work — the second half of these notes
grew out of that.
`,
  `# Books to read

- [x] Sapiens — Yuval Noah Harari
- [x] Atomic Habits — James Clear
- [x] 1984 — George Orwell
- [ ] Designing Data-Intensive Applications — Martin Kleppmann
- [ ] Thin adverts — a history of advertising (a working title; I do not
      remember the exact one)
- [ ] The Brothers Karamazov — Dostoevsky; I keep putting it off because it is
      thick, but it has to happen once
- [ ] Thinking, Fast and Slow — Daniel Kahneman

I put Kleppmann's book at the top of the list after a recommendation at work —
they say it is essential for anyone working with distributed systems.
`,
  `# Idea — an AI agent for organising study

An agent that builds a study plan by itself from the course syllabus and the
exam dates — how much material per day, with buffer days near the end. It does
not have to be clever in the sense of understanding the material; it is enough
that it schedules the time well and reminds me.

It would be interesting if it also pulled in history — how faithfully I actually
kept previous plans — and used that to correct its estimate of how much time I
really need, instead of trusting the optimistic estimate I typed in.
`,
  `# A small game for learning Serbian

An idea for a small side project — a case-guessing game for people learning
Serbian. A sentence with a gap, case options offered, and the right answer
unlocks the next question.

The biggest challenge is not the programming but the content — it would need
dozens of sentences for each case so that the game is not repetitive after five
minutes.
`,
  `# Improving the CV

- [x] Update the projects section — add Nexus
- [x] Shorten each experience entry to at most three lines
- [ ] Add measurable results wherever I can (not just "I worked on X", but what
      it delivered)
- [ ] Check that the format is readable by the ATS systems companies use for
      screening
- [ ] Make an English version, not just a word-for-word translation
- [ ] Ask someone to read it before sending — fresh eyes catch mistakes I can no
      longer see

The priority is the measurable-results section — the current CV reads like a list
of duties, not achievements.
`,
  `# Note from a job interview

Impressions right after the interview, while they are fresh.

The questions focused on system design and concrete decisions from previous
projects, less on textbook theory — which suited me, since it is easier to talk
about real decisions than to recite definitions. One question caught me
unprepared — how I would scale the system if the number of users grew tenfold; I
had no worked-out answer ready.

For the next interview: prepare one concrete example in advance for each big
topic (scaling, testing, teamwork, resolving conflict) instead of improvising on
the spot.
`,
  `# Blog content ideas

Topics I would like to develop, in the order they come to mind:

- How I built my first RAG system — the mistakes I made and what I would do
  differently
- The experience of the thesis — from choosing the topic to the defence
- Comparing local models for development — what really runs on an ordinary
  laptop
- Why I moved to TypeScript strict mode for personal projects

The first topic is probably the most useful to others — the least has been
written about it in Serbian.
`,
  `# A random thought about productivity

Less planning, more starting — I often spend more time making the to-do list
than the first item on it would have taken to do. Try skipping the list tomorrow
and simply begin.
`,
  `# Goals for the second half of the year

## Work / career

Apply actively for positions, at least three applications a week instead of
browsing the adverts now and then. Finish the thesis and defend it before the end
of the period.

## Health

Run three times a week, even briefly when there is no time for longer. Less
coffee after 4 pm — I sleep better when I keep to that.

## Learning

Finish one technical course rather than jumping between courses without
finishing. Read at least ten pages a day, whether a technical book or fiction.

## Finances

Set aside a fixed percentage of income for savings before any spending, not
after.

I came back to review the goals at the midpoint — running is going well, reading
is behind, and I paused the course halfway. Realistically I am setting the
priority for the rest of the period: thesis first, then the job, the rest as it
comes.
`,
  `# Reflections after a job interview

Not about the interview itself but about how I felt — the nerves were smaller
than last time, probably because I had a clearer idea of what to expect.

I noticed my voice speeds up when I talk about something I find hard to
explain — deliberately slowing down helps. Likewise, admitting "I don't know,
but here is how I would approach it" comes across much better in person than I
thought it would — honesty reads as confidence, not weakness.
`,
  `# Habits I am building

- [x] Getting up at the same time on weekdays, now even without an alarm
- [x] A glass of water straight after waking, before coffee
- [x] A short stretch before bed
- [ ] Limit social media to a fixed time each day, not "as needed"
- [ ] Plan the next day the evening before, not in the morning rush
- [ ] One day a week completely screen-free after 8 pm

The first three have become automatic; I no longer think about them. Next in
line is limiting social media — still the hardest for me, especially in the
evening when I am tired and have no will for discipline.
`,
  `# Notes from meditation

Ten minutes in the morning, three months in a row now. The biggest change is not
in the meditation itself but outside it — I notice sooner when my thoughts start
going round with no way out, and I let them go more easily instead of following
them.

Focusing on the breath is still hard when the day ahead is full — the mind
starts making a to-do list on its own. I no longer fight it; I simply notice and
bring the attention back, without getting frustrated that it wandered.
`,
  `# English study plan — advanced level

The level is already solid; the goal now is nuance — idioms, a more natural
pronunciation, less "textbook" phrasing.

- Watching series without subtitles, or with English subtitles instead of
  Serbian
- Reading technical documentation aloud now and then, for the pronunciation of
  terminology
- Holding conversations with foreigners whenever the chance comes, instead of
  avoiding them out of discomfort
- Listening to podcasts about topics I already find interesting in Serbian — it
  is easier to follow the content when the subject is familiar

The biggest progress comes from conversation in person, not passive listening —
that is clear to me after a few months of trying different approaches.
`,
  `# Budget for August

- [x] Rent — paid on the first of the month
- [x] Electricity and internet — paid
- [ ] Phone instalment
- [ ] Annual car insurance — due at the end of the month
- [ ] Move the fixed percentage into savings as soon as the salary arrives

This month the extra cost is the car insurance, which is why the budget for
going out is smaller than usual — acceptable, it happens at the same time every
year, and it should not surprise me next time.
`,
  `# Tracking savings

I started keeping a simple record instead of relying on a feeling of how much I
save. On the first of every month I write down the balance in the savings
account and make a short note of what affected the difference from the previous
month.

The first thing I noticed — the biggest leak is not large one-off purchases but
small frequent costs I do not remember individually (coffee out, food delivery).
The next step is to track those separately for at least a month to see the real
total.
`,
  `# Ideas for extra income

- Freelance programming in the evenings and at weekends — the most realistic,
  and it uses skills I already have
- Programming tutoring for younger students — less well paid, but flexible
  around exams
- Selling small tools/scripts I already build for myself, if they have a wider
  use
- Writing technical posts for company blogs — I see that some companies pay for
  that

Freelancing is probably the fastest route to a result, but it takes time to
build the first few clients and references.
`,
  `# Comparing banks for savings

A short comparison before I open a new savings account, so that I do not choose
based on the first advert I see.

The differences between banks are not huge in interest rate, but they differ a
good deal in the terms — some require a minimum period before the interest is
paid in full, some charge an account fee if the balance falls below a certain
threshold. It is important to read the small print on early withdrawal, because
that is where the offers that look similar at first glance differ most.

I settled on a bank with no minimum balance, where I can withdraw part of the
money without losing the whole interest — flexibility matters more to me than
the difference of a few dozen dinars in interest.
`,
  `# Router password

Network: DOM-5G. The password is on the sticker on the underside of the router,
not the one I usually use — it was changed after the last restart because of a
problem with the signal.
`,
  `# A quote I liked

> Discipline is choosing between what you want now and what you want most.

I came across this by chance and it stayed with me all day — simple, but it fits
almost every decision I put off.
`,
  `# Idea for a present for my mother

She mentioned she needs a new French press for coffee; the old one is cracked.
Along with it, perhaps a bag of good coffee from that small roastery in the
centre that she once praised.
`,
  `# Air-conditioning technician — contact

A recommendation from a neighbour; he comes the same day if you call before
noon. I called about servicing before the summer, not an urgent breakdown — I am
writing the number down so I do not have to look for it in the neighbours' group
again.
`,
  `# Reminder — renew the passport

It expires in four months — close enough to start the process now, before it
becomes urgent before a trip. Book an appointment at the police department, and
bring the old identity card and proof that the fee was paid.
`,
  `# A random thought before sleep

It is strange how often an idea arrives exactly when the light goes off and
there is no will left to get up and write it down. Maybe I should keep a notebook
literally next to the pillow.
`,
  `# Films to watch

- [x] Oppenheimer
- [x] Dune: Part Two
- [ ] The Zone of Interest
- [ ] The Past Is a Foreign Country (if it is on any platform)
- [ ] Searching — a recommendation from a friend

I added two new titles after a recommendation — the list keeps filling up faster
than it empties.
`,
];
