# ADR-113 — The assistant's tiers are ordered by active parameters, and Gemma 4 E2B is the speed pick

**Status:** accepted (2026-10-15). **Owner:** founder.
**Supersedes [ADR-096](096-assistant-model-runtime.md) §4 in part** — the one
paragraph that ordered the three tiers by file size. Everything else ADR-096
decided stands untouched: the utility process, the catalogue's measured fields,
the fit arithmetic at 8192 tokens, a full offload winning over a bigger model on
the processor, and the refusal when nothing fits.

## 1. The finding

ADR-096 §4 ordered the picks by FILE SIZE, on an argument that was true when it
was written: *every chat entry is a four-bit quantisation, so file size IS
capacity.* That holds for a dense transformer and fails for Gemma 4's E-models.
Their files carry Per-Layer Embeddings — a small embedding table per decoder
layer — and Google's own card says what that costs a token: „These embedding
tables are large but are only used for quick lookups, which is why the effective
parameter count is much smaller than the total" (`google/gemma-4-E2B-it`, §"Dense
Models"). A lookup table is bytes on disk and bytes in VRAM; it is not matrix work
per token, and a rule that reads bytes cannot tell the two apart.

The consequence is a wrong answer a user would have seen. Gemma 4 E2B's file is
3.12 GiB and Qwen3.5 4B's is 2.55 GiB, so a size-ordered list puts E2B **above**
the 4B — on the maintainer's laptop that meant `speed` = Qwen3.5 4B and `balance`
= Gemma 4 E2B, while the two cards state 2.3 B effective parameters and 4 B. The
tier labelled „speed" would have named the model with more work per token, and
the tier labelled „balance" the one with less. It is a defect with no
local symptom: every number the rule read was correct.

**The decision.** Every catalogue entry carries `activeParameters` — the number of
parameters one token's forward pass runs through, as the model's own card states
it — and the three tiers are drawn from that number: `speed` the fewest,
`intelligence` the most, `balance` the middle of what is left. File size survives
only as a tie-break, and the id after it.

## 2. `activeParameters`: one human field, and the card is its source

It is a plain integer (bytes would be the wrong unit) with a stated meaning, and
the meaning is what keeps it honest: a **dense** model's whole count, a
**mixture-of-experts** model's active count, a **Gemma E-model's effective** count.
Which of the three applies is the card's claim, not this repository's arithmetic,
and no value here was derived from a file's size. Every one is quoted below with
the sentence it came from, read from the model's base repository on 2026-10-15.

| Entry | `activeParameters` | Card, and the sentence |
| --- | --- | --- |
| Qwen3.5 4B Q4_K_M | `4000000000` | [`Qwen/Qwen3.5-4B`](https://huggingface.co/Qwen/Qwen3.5-4B), „Model Overview → Language Model: **Number of Parameters: 4B**" |
| Qwen3.5 9B Q4_K_M | `9000000000` | [`Qwen/Qwen3.5-9B`](https://huggingface.co/Qwen/Qwen3.5-9B), „**Number of Parameters: 9B**" |
| Qwen3.5 27B Q4_K_M | `27000000000` | [`Qwen/Qwen3.5-27B`](https://huggingface.co/Qwen/Qwen3.5-27B), „**Number of Parameters: 27B**" |
| Gemma 4 E2B QAT q4_0 | `2300000000` | [`google/gemma-4-E2B-it`](https://huggingface.co/google/gemma-4-E2B-it), the dense-models table: „**Total Parameters** \| 2.3B effective (5.1B with embeddings)" |
| Gemma 4 E4B QAT q4_0 | `4500000000` | [`google/gemma-4-E4B-it`](https://huggingface.co/google/gemma-4-E4B-it), the same table: „**4.5B effective** (8B with embeddings)" |
| Gemma 4 12B QAT q4_0 | `11950000000` | [`google/gemma-4-12B-it`](https://huggingface.co/google/gemma-4-12B-it), the dense-models table, column „12B Unified": „**Total Parameters** \| … \| **11.95B** \| 30.7B" |
| Slava Qwen3 14B Serbian Q4_K_M | `14800000000` | [`OpenPipe/Qwen3-14B-Instruct`](https://huggingface.co/OpenPipe/Qwen3-14B-Instruct), „**Number of Parameters: 14.8B**" — reached by the chain the card names, see below |
| Qwen3 Embedding 0.6B Q8_0 | `600000000` | [`Qwen/Qwen3-Embedding-0.6B`](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), „**Number of Parameters: 0.6B**" |

**Three readings worth writing down, because a later refresh will meet them
again.**

- **The Qwen3.5 family's cards mention mixture-of-experts and these four entries
  are not it.** The family bullet says „Gated Delta Networks combined with sparse
  Mixture-of-Experts", and the four sizes here are the dense ones: each card's own
  „Hidden Layout" lists one FFN per layer with a single „Intermediate Dimension",
  and each `config.json` declares no expert count at all (checked for all four).
  So „Number of Parameters" is the whole count of a dense model — the first of the
  three readings above, not the MoE one. The catalogue offers no MoE entry today;
  the day one arrives, its `activeParameters` is the „Active Parameters" figure
  the card states — the E2B card's own MoE table prints „Total Parameters 25.2B"
  beside „Active Parameters 3.8B" for the 26B A4B, which is the model that needs
  this rule most.
- **The Slava entry's own card states no count, and the count is the base's.**
  `mradermacher/Slava-Qwen3-14B-Serbian-GGUF` names `IvanCvetanovic/Slava-Qwen3-14B-Serbian`
  as its base, whose card names `OpenPipe/Qwen3-14B-Instruct` as its own, and that
  card states 14.8B. A full fine-tune keeps its base's architecture and therefore
  its count; the value is the base's stated number rather than an estimate of a
  fine-tune's.
- **The „E" is the card's own word, and the encoders are not inside it.** The
  Gemma 4 card prints the two effective counts, defines the letter in the same
  section („The „E" in E2B and E4B stands for „effective" parameters"), and counts
  the vision (~150M) and audio (~300M) encoders on separate rows. This runtime
  loads no encoder at all (ADR-096 §6 keeps `vision` off for every entry), so the
  number the field carries is the effective one — which is also the one the name
  promises.

## 3. Where the field lives, and what may not carry it

`activeParameters` is the catalogue's own field, not the contract's.
`packages/core/src/assistant/contract.ts`'s `ModelEntry` is also what a Hugging
Face **search result** and an **imported file** answer with, and neither of those
has a card this app read — the search reads a listing, the import reads a GGUF
header. Putting the field on the contract would invite exactly the invented number
the field exists to prevent, so it lives where `fit` already lives:
`catalogue.ts` extends `ModelEntry` with it and exposes it through
`activeParametersOf`, the way `fitOf` exposes the fit. `recommend.ts` reads it
through that function and no other way, so one module still knows the shape of
what is stored, and an entry with no count is skipped the same way an entry with
no fit is — a search result and an import never reach the chooser, because they
have neither.

**The bundled list's reader refuses an entry without a count**, and the refresher
refuses one before it spends a request (`scripts/assistant-catalogue.mjs`,
`activeParametersOf`). That is the same shape as the licence rule in
`catalogue.ts`: the file that ships inside the app is written by a tool that
refuses this, so a catalogue entry without it is a mistake in the list rather than
a fact about a model. An INSTALLED entry may still lack it — the registry holds
whatever was installed — and that costs nothing, because the installed list never
reaches the chooser; only the catalogue does.

## 4. What the list gained and lost

**Added: Gemma 4 E2B (QAT q4_0)**, `gemma-4-e2b-it-q4-0`, from
`google/gemma-4-E2B-it-qat-q4_0-gguf` — the model the maintainer's decision makes
the speed pick, and the reason this ADR exists.

**Withdrawn: Qwen3.5 2B and Qwen3-VL 4B Instruct.** Qwen3.5 4B supersedes the
Qwen3-VL 4B (which was the older architecture and carried its own projector), and
Qwen3.5 has its own projector, so the vision pair the catalogue needs is the one
on the 4B entry. The 2B leaves because the tier it filled — the smallest thing
that fits a small machine — is now E2B's.

**A withdrawn entry does not touch a file somebody installed.** The installed list
is read from `models/installed.json` (`install.ts`'s `readInstalled`), never from
the catalogue, and `loadChat`, `remove` and the file-existence check all go
through that registry. So a model whose entry leaves the catalogue is still
listed, still loads, and can still be removed — the only thing lost is the pick.
`host.test.ts` pins it by name („keeps a model whose entry left the catalogue:
listed, loadable and removable") on `qwen3.5-2b-q4-k-m`, the id this run withdrew.

## 5. What the tiers now come out as

The five profiles `recommend.test.ts` builds, with the fits the 2026-10-15
refresh wrote into `catalogue.json` (whose own `checked` field reads 2026-10-14,
the date `--fit` takes from UTC):

| Machine | `speed` | `balance` | `intelligence` |
| --- | --- | --- | --- |
| RTX 4070 Laptop, 6.26 GiB of free VRAM (measured, ADR-096 §4) | Gemma 4 E2B | Qwen3.5 4B | Gemma 4 E4B |
| 8 GiB of RAM, no GPU (6 GiB free) | Qwen3.5 4B | Qwen3.5 4B | Qwen3.5 4B |
| 32 GiB of RAM, a 12 GiB GPU | Gemma 4 E2B | Gemma 4 E4B | Slava Qwen3 14B Serbian |
| 64 GiB of RAM, no GPU | Gemma 4 E2B | Qwen3.5 9B | Qwen3.5 27B |
| 16 GiB of RAM, a 4 GiB GPU | Qwen3.5 4B | Qwen3.5 4B | Qwen3.5 4B |

The last two rows are the rules rather than the picks. The 4 GiB machine is the
offload-first case ADR-096 §4 already carried: E2B, E4B, the 9B and the 12B all
fit that machine's RAM for a CPU run and none of them is offered, because one
model fits the CARD. The 64 GiB machine is this ADR's own: with every chat entry
in the pool, the ends and the middle of the counts (2.3, 4, 4.5, 9, 11.95, 14.8,
27 B) are what the tiers name. The 8 GiB machine is worth reading as a loss: the
2B entry used to fit it, and with 6 GiB of RAM free the budget is 3.6 GiB, which
only Qwen3.5 4B (3.33 GiB) meets — E2B needs 3.68 GiB and misses it — so that
machine now gets one model named three times where it used to get a smaller one.
That is the price of withdrawing the 2B, stated rather than hidden, and reversible
by restoring that entry.

## 6. What this costs, and what it does not do

- **The order is now a claim, not a measurement.** A file's size changes only when
  upstream re-quantises it; a card's parameter count changes when a card is
  edited, and the tiers would follow it. The claim is therefore quoted here with
  its source, and a refresh that changes one is a change to review like any other.
- **A count can still be read wrongly by a human.** The three readings above are
  the ones this list needed; the tool refuses a missing or non-positive value, and
  it cannot refuse a value that is the wrong kind of count. That is what the source
  column is for.
- **It changes nothing else.** No fit is re-measured differently, no constant
  moves (`CHAT_CONTEXT_TOKENS` 8192, `VRAM_FIT_SHARE` 0.9, `CPU_RAM_SHARE` 0.6),
  no search result or imported file becomes rankable, no entry gains `vision`, and
  no model is downloaded or deleted by this run.

## 7. Alternatives considered

1. **Keep file size and subtract the embedding tables for E-models.** The
   comparator would have to know which families carry per-layer embeddings, and
   the correction would be this ADR's arithmetic hidden in a sort function — a
   number nobody can check against a source. The card states the number the rule
   needs, so no arithmetic is required at all.
2. **Rank by a fit figure instead** (`vramBytes`, or `cpuRamBytes`). That is file
   size with the KV cache added, so it carries the same defect, and it also ranks
   by what THIS machine has free rather than by the model — the picks would move
   while the user watched, and a tie would be a coincidence of two machines.
3. **Rank E2B by its total (5.1B with embeddings).** That is the number that
   describes the FILE, and it restores the exact defect: E2B above Qwen3.5 4B.
4. **Put `activeParameters` on the contract's `ModelEntry`.** Refused in §3: the
   contract is also what a search result and an import answer with, and neither
   has a card.
5. **Drop the E-models from the catalogue and keep the size rule.** This was the
   maintainer's decision to make, and he made the other one: on an 8 GB laptop
   card E2B is the model with the least work per token that fits, which is what
   the speed tier is for.
