# ADR-105 — The assistant's voice: Whisper in a worker, and the Serbian voice that does not exist

**Status:** accepted (2026-10-10) · **Owner:** the voice run of the 2.0 wave

Luka's picture of the assistant is a conversation: you are stranded in nature
waiting for a helicopter, and you talk the situation through with something that
is on your own machine. Text is half of that. This ADR fixes the other half —
speech recognition, speech synthesis, where they run, and what a voice arrives
in — and it records one finding that changes what the product can promise: a
Serbian offline voice, with a licence this app may ship, does not exist.

## 1. The finding

Four constraints met in one place, and each of them removes a candidate:

1. **Nothing touches the network.** The assistant is offline by construction
   (`ADR-092`); a voice that fetched a model at first use would be a voice that
   does not work in the situation the product is for.
2. **The engine's licence must suit Apache-2.0.** Nexus ships as an Apache-2.0
   application, and the pack rules are explicit that a GPL program never ships
   inside it, only as a separate `tool` pack of an unmodified upstream build.
3. **A model is a pack.** Weights arrive the way every other large artefact does
   — as a signed `model` pack (`ADR-091`), installed from a folder and verified
   with the release key — so a voice can be added without rebuilding the app.
4. **Inference must not run on the main thread.** A Whisper decode is seconds of
   one core, and main is the process that answers IPC and paints the window.

## 2. Speech to text: Whisper, through the library already in the tree

**The engine is `@huggingface/transformers`** (Apache-2.0, already a dependency
of `apps/desktop`, running ONNX on the CPU or WebGPU). It is the smaller
decision of the two, because choosing it adds no dependency, no native module
and no new licence to the notices.

**The models are the ONNX conversions of Whisper** (`openai/whisper-*`, MIT)
published by Xenova under Apache-2.0:
`Xenova/whisper-tiny`, `Xenova/whisper-base`, `Xenova/whisper-small`. Each is
downloaded in its 8-bit weight-only form (`_quantized`, which is the file suffix
`dtype: "q8"` asks for), because the fp32 pair is roughly four times the size
for a difference in transcript that a user will not hear over a microphone.

### What was measured, on this machine

`apps/desktop/src/main/assistant/voice/inference.smoke.test.ts`, run once by hand
with `NEXUS_VOICE_SMOKE=1` on 2026-10-10. The real-time factor is audio seconds
per wall second: higher is faster, and below 1 means the model falls further
behind the longer the user talks.

| Feed | whisper-tiny | whisper-base | whisper-small |
| --- | --- | --- | --- |
| A Serbian reading (Common Voice, 11.64 s) | **5.09x** | **3.92x** | not measured |
| Two more Serbian clips (4.82 s, 4.48 s) | not measured | 2.19x, 2.35x | not measured |
| The synthesized English sentence (4.35 s) | **3.01x** | **2.61x** | **1.22x** |
| Model load, first call | 1 293 ms | 1 188 ms | 1 952 ms |

The same clip on the same model is not the same number twice: `whisper-base` was
measured at 2.22x, 2.61x and 2.67x on three runs of the English sentence, which
is what a shared machine with a warm page cache does. The ORDERING is the
finding, not the third digit.

On the clean English sentence `whisper-base` and `whisper-small` both returned
„The helicopter is coming at dawn and the wire is clean." and `whisper-tiny`
returned it word for word, so at base size and above the model has stopped being
the limit for a good recording. On Serbian the difference in QUALITY was the
larger one: `whisper-base` produced
„Pre mnogo godina u venecu elanskom gradiću barki simeto u zavrozapadnom delu
venecuele počela je cela ova priča, kad je tamo pristiga o putujući cirkus." —
the names are wrong and the grammar is loose, which is what a base-size model
does with a hard language — while `whisper-tiny` produced
„Primnogo godina, uvenice uberkisimeto u se veroza, podnom deluvenice uele, poče
laje cela ovapriča." Both are usable as a draft a user corrects; the base model
is the one whose draft a Serbian speaker can read.

**So the recommendation is `whisper-base`:** on Serbian it is half as fast as
tiny and produces a transcript a Serbian speaker can read, and on English it is
indistinguishable from `whisper-small` at more than twice the speed.
`whisper-tiny` is the choice for a machine where 2.6x is not enough headroom,
and `whisper-small` — 1.22x here, and 242 MiB against base's 77 MiB — is for a
user who wants the best Serbian transcript and can spare the time.

### The audio format, and why the resampler is a windowed sinc

Everything downstream is **16 kHz mono `Float32Array`**, because that is the one
rate both ends of this service are defined at: Whisper's feature extractor
resamples to 16 kHz (`preprocessor_config.json` says `sampling_rate: 16000`) and
the VITS voices return 16 kHz. `resamplePcm` converts anything else, with an
exact output length (`round(input * out / in)`) so that a three-second clip and
its transcript agree about how long three seconds is.

The kernel is a Hann-windowed sinc scaled by the rate ratio, not linear
interpolation, and the reason is measurable rather than aesthetic: downsampling
a 48 kHz recording to 16 kHz by interpolation folds everything above 8 kHz back
into the band, and that is where a room's hiss and a voice's sibilants live. The
test pins the difference: a 10 kHz tone at 48 kHz comes out of this resampler
below 0.05 amplitude instead of folding down to 6 kHz at full amplitude. The
taps are clamped to the buffer and the weights renormalised over what is left —
reading outside as silence was tried and is arithmetically wrong, because the
excluded taps carry negative coefficients and a constant signal came out 2 %
loud at the buffer's edge.

## 3. Text to speech: the engine is VITS, and the Serbian voice does not exist

**The engine is the `text-to-audio` pipeline** (VITS) of the same Apache-2.0
library. **The voices are packs,** one per voice, exactly as the STT models are.

The brief named three candidates and asked for evidence. All three were checked,
and two of them are refused on it:

- **`facebook/mms-tts-srp` does not exist, and neither does any South-Slavic
  MMS voice.** `https://huggingface.co/api/models/facebook/mms-tts-srp` and
  `.../Xenova/mms-tts-srp` both answer **HTTP 401** (the Hub's answer for a
  repository that is not public), and the official supported-language table
  `https://dl.fbaipublicfiles.com/mms/tts/all-tts-languages.html` — fetched
  2026-10-10 — contains **no `srp`, `hrv`, `bos`, `hbs` or `cnr` row and no
  language name containing „Serb", „Croat" or „Bosn".** MMS-TTS covers 1 100+
  languages, and Serbian is not one of them. The licence the brief cites is real
  — `facebook/mms-tts-eng`'s own card says `license: cc-by-nc-4.0` — but there
  is no Serbian checkpoint to apply it to.
- **Piper is refused twice over.** The engine that the Piper project now
  develops is `OHF-Voice/piper1-gpl`, and the GitHub API reports its licence as
  **GPL-3.0** (`spdx_id: "GPL-3.0"`), so it cannot ship inside an Apache-2.0
  app. The older `rhasspy/piper` is MIT but **archived** (the API's
  `archived: true`, last push 2025-08-26) and it still phonemizes through
  `espeak-ng`, whose licence the API reports as **GPL-3.0** as well: the MIT
  wrapper is not the program that runs. The Piper voice filed under `sr`
  (`rhasspy/piper-voices` → `sr/sr_RS/serbski_institut/medium`, whose
  `MODEL_CARD` gives the dataset as
  `https://creativecommons.org/licenses/by-nc-sa/4.0/` — and which the addendum
  below shows is trained on **Lower Sorbian**, not Serbian, data) is trained on
  espeak phonemes (`phoneme_type: "espeak"`, `espeak.voice: "sr"` in its own
  `.onnx.json`), so even though CC BY-NC-SA would be allowed for a pack, the
  code that turns text into the phoneme ids it wants is the GPL program this app
  may not ship.
- **`punosevacm/srpski-vits-finetuned-*` has no licence.** The three Serbian
  VITS fine-tunes on the Hub carry no `license` field at all, and the pack rules
  require evidence for every source. A well-meant upload with no licence
  statement is a source that cannot be used, not a source that is probably fine.

**So the TTS path is built, tested and proven, and there is no Serbian voice to
put in it.** The worked example, and the pack this repository can build today,
is `mms-tts-eng` (CC BY-NC 4.0, inherited from `facebook/mms-tts-eng` and stated
in its card). Adding a Serbian voice the day one appears with a shippable
licence is one entry in `scripts/packs/voice/sources.json` and one run of the
builder — no code change, which is the whole point of the pack mechanism.

The service is written so that this is a REFUSAL and not a surprise: a request
to speak Serbian with no Serbian voice installed fails with `pack-missing`, and
never falls back to the English voice. An English VITS reading Serbian
orthography through English phonemes is not a worse Serbian voice, it is a
different language.

### What was measured, and the one uncomfortable number

`mms-tts-eng` took **7 006 ms to synthesize 4.43 s of speech: 0.63x real time.**
On this machine the voice is SLOWER than the person listening to it, and that is
a property of a 38 MB VITS model on a CPU rather than of the wiring. Two things
follow, and both are in the design rather than in a promise: the sentence
splitter (`splitSentences`) exists so speech starts on the first sentence rather
than on the whole answer, and the module must be able to show that it is
speaking rather than waiting — a spinner over silence is the failure mode of
every slow TTS.

### Addendum, 2026-10-10: the Piper route, re-checked link by link, and the name corrected below

Luka decided on 10 October that a GPL program MAY ship as a separate `tool` pack
(ADR-094: an unmodified upstream build, in its own signed folder, source
linked) and that a pack may carry a non-commercial source. Section 3's refusal
was therefore re-checked against the upstream APIs and the files themselves,
and what follows is measured, not read.

* **The engine Piper develops now is GPL-3.0 and publishes no Windows build.**
  `https://api.github.com/repos/OHF-Voice/piper1-gpl` answers
  `license.spdx_id: "GPL-3.0"` and `archived: false`; its newest
  release (`https://api.github.com/repos/OHF-Voice/piper1-gpl/releases`, `v1.8.0`,
  2026-09-04) attaches only Python wheels, among them
  `piper_tts-1.8.0-cp39-abi3-win_amd64.whl`, 34 119 688 bytes. A wheel is not an
  unmodified Windows build of a program: it needs a Python interpreter and pip,
  and neither is something a `tool` pack may be.
* **The archived MIT build IS an unmodified upstream Windows build, and it
  carries espeak-ng's data.** `https://api.github.com/repos/rhasspy/piper` answers
  `license.spdx_id: "MIT"` with `archived: true`, and its last release
  `2023.11.14-2` attaches `piper_windows_amd64.zip` — **22 477 236 bytes,
  SHA-256
  `f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea`**
  — from
  `https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip`,
  fetched and hashed on 2026-10-10. The archive holds 363 entries: `piper/piper.exe`,
  `piper/espeak-ng.dll`, `piper/piper_phonemize.dll`, the ONNX runtime, and 356
  files under `piper/espeak-ng-data/` — among them `sr_dict` and
  `lang/zls/sr`, which is the Serbian dictionary the phonemizer needs. That
  zip is the GPL program espeak-ng, which ADR-094 allows as a SEPARATE tool
  pack and never inside the app.
* **The folder says Serbia; the DATA is Lower Sorbian, and the dataset's own
  README is what says so.** `rhasspy/piper-voices` —
  `sr/sr_RS/serbski_institut/medium`: its
  [MODEL_CARD](https://huggingface.co/rhasspy/piper-voices/raw/main/sr/sr_RS/serbski_institut/medium/MODEL_CARD)
  gives `Language: sr_RS (Serbian, Serbia)`, 2 speakers and 22 050 Hz, names the
  dataset `https://github.com/marytts/serbski-institut-dsb-data` under
  [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — and
  adds, one line lower, „Finetuned from U.S. English lessac voice (medium
  quality)". The model's own `.onnx.json` declares `phoneme_type: "espeak"`,
  `espeak.voice: "sr"` and `audio.sample_rate: 22050` (fetched 2026-10-10).
  **Read the dataset, not the card and not the folder.** The dataset
  repository's own [README](https://github.com/marytts/serbski-institut-dsb-data)
  — also fetched 2026-10-10 — opens „Lower Sorbian voice data for MaryTTS" and
  describes a „Lower Sorbian speech database for TTS voices in MaryTTS, recorded
  in 2022 at the Sorbian Institute" (`https://www.serbski-institut.de/`); its
  copyright line names the Sorbian Institute. **`dsb` is the ISO 639 code of
  Lower Sorbian** (Upper Sorbian is `hsb`), a West Slavic language of Lusatia in
  Germany, and the Sorbian Institute is in Bautzen — not in Serbia and not
  related to `sr`. So the weights are a fine-tune of an English voice on Lower
  Sorbian speech, labelled `sr_RS` by the pipeline that published them.
  (CORRECTION, 2026-10-10: an earlier version of this addendum read the same card
  and concluded „the voice is Serbian, and its own config is what says so". A
  card's language line is a claim about a folder; the dataset's README is
  evidence about the recordings, and it says Lower Sorbian.)

Two facts come straight off those files rather than from an assumption, and
neither of them rescues the route: the voice emits **22 050 Hz**, where every VITS
voice in this build is 16 000 Hz; and the engine is driven as a PROGRAM —
something like `piper.exe --model <voice>.onnx --output_file <wav>` with the text
on stdin, reading text and writing a WAV file inside the folder the pack names —
which is ADR-094's own `stdio` protocol.

**So the route does NOT hold for Serbian, and §3's refusal stands.** A Piper
voice trained on Lower Sorbian speech is not a Serbian voice: a Serbian sentence
sent to it is not read in Serbian, however the card labels the folder and however
`espeak.voice: "sr"` reads. **No Serbian offline voice with a licence this app
may ship is known as of 2026-10-10**, and nothing §3 measured has changed: the
VITS path is built, tested and proven, `mms-tts-eng` remains the only voice this
repository can build, `textToSpeech().speak(text, "sr")` still refuses with
`pack-missing`, and the day a Serbian voice appears with a shippable licence it
is one entry in `scripts/packs/voice/sources.json` and one run of the builder.

The `tool` pack mechanism this addendum re-checked is a separate finding and
stands on its own: `rhasspy/piper`'s archived MIT Windows zip IS a shippable
`tool` pack under ADR-094 (espeak-ng's data included), and it is NOT built here.
It buys nothing for Serbian until a Serbian Piper voice exists, and when one
does it is the same one focused piece of work this section named: a builder under
`scripts/packs/piper/`, a `voice` pack entry with its attribution, and the voice
service's third engine.
## 4. Where it runs: a `utilityProcess`, never main

**The models run in an Electron `utilityProcess`,** and main only ever holds a
`VoiceHost` handle. The alternatives were a renderer worker and the main
thread, and each is refused for a reason that is a property of this app:

- **A renderer worker cannot read the pack.** A voice pack is a folder on disk
  under `userData/packs`, and the renderer is sandboxed with no filesystem
  access and a dead network (`offline.ts`). Handing it the weights would mean
  either a second IPC path for gigabytes or a second copy of the model in a
  renderer cache, which is exactly what `ADR-091` §5 refuses for content packs.
- **Main is the thread that must stay responsive.** `onnxruntime` runs a graph
  to completion on the thread that started it. A base-size Whisper decode on
  main is three seconds in which the window does not paint and no IPC is
  answered — and the voice mode's whole point is that the assistant is talking
  while it works.
- **A utility process can be killed without taking the app down.** Model memory
  is the largest allocation this app makes; a worker that dies is a `no-worker`
  reply and a fresh fork, not a crash dialog.

The seam is a port: `VoiceHost.run(request, signal)` in `host.ts` (the
`utilityProcess` implementation), `inference.ts` (the only file that touches
ONNX), and `worker.ts` (the entry a `utilityProcess` runs, which owns one loaded
model and a serial queue). electron-vite resolves the worker's own bundle
through a `?modulePath` import, so the built app starts a real file rather than
a function inside the main bundle.

**Cancellation is at the boundary, not inside the model**, and the code says so
rather than implying otherwise: an aborted request rejects the caller's promise
at once, the microphone closes, and the worker's answer is discarded when it
arrives. There is no interruption point inside an ONNX graph, so the CPU is
given back when the current sentence finishes and not before.

## 5. What a voice pack contains, and the one file that is ours

A voice pack is a `model` pack (`ADR-091`) of **the model's files exactly as
upstream published them** plus **`voice.json`**, written by
`scripts/packs/voice/build.mjs`:

```json
{
  "format": 1,
  "kind": "stt",
  "engine": "whisper",
  "languages": ["sr", "en"],
  "sampleRate": 16000,
  "upstream": { "repo": "Xenova/whisper-base", "revision": "main" }
}
```

**Why a file and not a manifest field.** The pack manifest is the shape every
pack shares, and it deliberately carries nothing about what a model IS. A field
there would be a second place to state a model's kind, engine and languages, and
the first place — the model's own `config.json` — would then have to be
reconciled with it somewhere. `voice.json` is instead a content file: listed in
the signed manifest, hashed and copied by the same code that hashes the weights,
so a pack cannot be relabelled in transit, and the builder refuses to write one
whose `engine` disagrees with the model's own `model_type`.

`apps/desktop/src/main/assistant/voice/packs.ts` reads it and decides which pack
a request gets. Two rules are worth stating outside the code:

- **A language is never approximated.** `pickSttPack`/`pickTtsPack` take the
  first pack that DECLARES the language, and answer `null` rather than falling
  back. An English-only Whisper asked for Serbian answers with confident
  English words for Serbian speech, which is the one failure a user cannot see.
- **A folder that is not absolute is refused.** transformers.js decides what a
  model argument means by its shape, and a string like `Xenova/whisper-base` is
  a repository id it would fetch. `voicePackDirectoryProblem` refuses anything
  that is not an absolute path before the library sees it, so the offline
  guarantee does not rest on the library's parser.

The packs this repository can build, with their measured sizes (the builder's
own output on 2026-10-10): `whisper-tiny` 45 209 723 B, `whisper-base`
81 265 497 B, `mms-tts-eng` 38 366 629 B. `docs/packs/voice.md` holds the file
lists and the licences; `sources.json` holds each source's URL, fetch date,
SHA-256 and the verbatim licence sentence that lets it ship.

## 6. The helpers the chat page will need

Three pieces are pure functions with tests, because the page that uses them
arrives in the next wave and a page is a bad place to discover off-by-one
arithmetic:

- **`splitSentences(text, locale)`** cuts an answer into the pieces a voice can
  start speaking, keeping each terminator, refusing to cut a decimal (`3.5`), an
  abbreviation (`npr.`, `e.g.`, `str.`) or an initial (`J. Smith`), treating a
  newline as a break, and hard-cutting a sentence longer than
  `MAX_SPEECH_CHARS` (240) at a comma or a space. 240 characters is roughly
  fifteen seconds at a normal rate, which is a long sentence and a short wait.
- **`detectSpeechSegments` and `createStreamingVad`** answer „has the user
  stopped talking", the second one frame at a time for a live microphone. The
  detector is ENERGY-BASED with an adaptive noise floor, and the honest
  trade-off is written down: Silero VAD (MIT, ONNX) is a better classifier, and
  it would mean a second ONNX session competing for the same CPU as the Whisper
  decoder, on every 32 ms frame. What this cannot do is tell a television from a
  person; what it can do is measure level against a floor that follows the room
  (down at once, up slowly and only on non-speech frames), which is the thing a
  fixed threshold gets wrong on real hardware. The tests pin exact boundaries on
  synthetic silence, tones and noise: a 300 ms tone inside 200 ms of silence, at
  20 ms frames, is exactly samples 3 200 to 8 000, and 100 ms of noise is
  dropped as a click.
- **`PushToTalk` and `HandsFreeGate`** are the two ways a user talks. Both take
  the time as an argument rather than reading a clock, so a test drives an hour
  of audio in microseconds and the page cannot measure time twice.

## 7. Consequences

- **Nothing new is reachable from the UI, and that is the plan.** This is a
  library with its factory (`createVoiceService`), its worker, its pack builder
  and its tests; the module's `register.ts` wires it in the next wave, and
  `contract.ts` was not touched.
- **`check:egress` is unaffected.** No file here constructs a request: the
  models come from a folder-installed pack, `inference.ts` sets
  `env.allowRemoteModels = false` at every load, and the smoke test reads
  folders it was pointed at rather than downloading anything.
- **No new dependency, so no new notice.** `@huggingface/transformers` was
  already in the tree; the pack builder uses Node's own `fetch` and `crypto`.
- **The packaging has one thing to do that this ADR cannot.** In a packaged
  build the worker is a separate bundle that `require`s
  `@huggingface/transformers`, and its ONNX runtime ships a native `.node`
  file: that file has to be unpacked from the asar archive, exactly as
  `better-sqlite3-multiple-ciphers` already is. Do not launch the app without it.
- **A voice answer in Serbian cannot be spoken today.** The page must offer the
  voice controls for the languages that have a pack and say why the others have
  none, rather than leaving a button that does nothing.
- **The proof of the whole TTS path is a test, not a promise:** the round trip
  (`speak` → WAV → `transcribe`) returned
  `"Water is the first thing to carry."` exactly.

## 8. Alternatives rejected

- **Running the models on the main thread.** §4: a decode is a frozen window.
- **A renderer worker.** §4: no filesystem, and the renderer's network is dead
  on purpose.
- **`espeak-ng` through a `tool` pack.** It would be legal to ship espeak-ng as
  a separate `tool` pack of an unmodified upstream build, and the Lower Sorbian
  Piper voice (see the addendum) would then run — but it would run as an
  external program over a
  phoneme-per-word pipe, in a feature that must work with no network, on a pack
  nobody has built, for one language. The complexity is not worth one voice,
  and the VITS path already works for every language that has a checkpoint.
- **`mms-tts-srp`, as the brief suggested.** It does not exist; §3, with the
  API's own answers and the official language table.
- **Silero VAD.** §6: a second ONNX session on the same CPU, for a decision
  this machine's signals do not need.
- **Synthesizing a whole answer before playing any of it.** It doubles the
  time-to-first-sound of a model that is already at 0.63x real time.
- **Falling back to the English voice for Serbian.** §3: it produces a
  different language, confidently.
- **Shipping the model inside the installer.** `ADR-091`'s argument, at a
  hundred megabytes per voice: the installer is not where content belongs.
