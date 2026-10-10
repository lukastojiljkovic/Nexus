# ADR-096 — the assistant's model runtime: llama.cpp in a utility process, the curated catalogue, and how a model is chosen

**Status:** accepted (2026-10-10) · **Owner:** founder

## 1. The finding

Luka's idea (10 October) is a helper that runs **entirely on the user's machine**:
llama.cpp, a model the user picks, a knowledge base over the app's own content,
tools, a voice, and vision if the library allows it. `packages/core/src/assistant/
contract.ts` fixes the seams between the eight parts being built at once; this ADR
is the runtime's half — the process the model runs in, the list of models Nexus
offers, how one is chosen for a machine, how a model arrives on disk, and what
loading one actually does.

Four facts shaped every decision below, and each was measured rather than
assumed on 2026-10-10:

1. **`node-llama-cpp` 3.22.1 is the installed version** (`apps/desktop/package.json`),
   and it is the newest one published (`registry.npmjs.org`, `dist-tags.latest`,
   published 2026-09-28). It bundles llama.cpp release `v0.5.0` (`llama.llamaCppRelease`).
2. **`require("node-llama-cpp")` does not work at all.** The package is ESM-only and
   its module graph has a top-level await, so Node 24 refuses with
   `ERR_REQUIRE_ASYNC_MODULE` — measured in `apps/desktop` with
   `node -e "require('node-llama-cpp')"`. This matters because the main-process
   bundle is CommonJS.
3. **A native addon cannot be loaded from inside an asar**, and neither can an
   ESM package be resolved from one. Both are why the runtime loads the library by
   an absolute path into `app.asar.unpacked` (see §7).
4. **It has no multimodal path.** `LlamaChat`, `LlamaChatSession`, `LlamaContext`
   and the GGUF reader in 3.22.1 have no image input, no projector parameter and
   no mention of `image`, `vision` or `mmproj` anywhere in `dist/` — verified by
   grepping the installed package. Upstream tracks it in
   [withcatai/node-llama-cpp#88](https://github.com/withcatai/node-llama-cpp/issues/88)
   ("feat: pass an image as part of the evaluation"), **open**, labelled
   `new feature` and `roadmap`, and assigned to the **v4.0.0 milestone** as of
   2026-10-10. That is the version that adds it; it is not released, so **`vision`
   is off for every entry and this runtime is built without it** (§6).

## 2. Inference runs in a `utilityProcess`, and nowhere else

llama.cpp blocks the thread it runs on for the whole of a generation — seconds
for a short answer, minutes for a long one. That thread must not be the one that
owns the window, the database and every IPC handler, so the runtime's shape is
Electron's `utilityProcess.fork`, exactly as the module kit forked the
Elektronika runner.

**`apps/desktop/src/main/assistant/runtime/worker.ts` is the whole of that
process**, and it owns nothing: no database, no `userData`, no key, no network,
no Electron API. It is forked from `out/main/assistant-model-host.js`
(`electron.vite.config.ts` builds it as a second MAIN entry, which is why that
config now names its inputs) and it holds one `LlamaEngine`.

**Main never loads the native addon.** `host.ts`, `install.ts`, `huggingface.ts`,
`recommend.ts`, `catalogue.ts`, `gguf.ts` and `protocol.ts` import no llama.cpp —
the only two files that do are `llama.ts` and, through it, `worker.ts`. That is
also why a **hardware reading is a worker request** rather than a main-process
call: the probe loads the backend and asks the addon what it can see, and doing
that in main would put the addon's memory in the window's process for the sake of
one screen.

**The wire is typed and validated on both sides** (`protocol.ts`). Requests carry
a `seq` for correlation and `callId` for a running call; events carry the same
ids back. Both sides run the same validators, and the reasons differ: the worker
validates because a process receives whatever is posted to it, and main validates
because a worker that has gone wrong is exactly the kind of sender that produces
a `NaN` size or a `stopReason` nobody defined. Every string crossing is bounded,
and a `v` field names the protocol version, so a **stale worker file beside a
newer main process is refused with a sentence** rather than misread — a real
hazard here, because a `utilityProcess` is forked from a file that an older build
may have left behind.

## 3. The curated catalogue

`apps/desktop/src/main/assistant/runtime/catalogue.json` is the list Nexus
offers: **nine entries, all Apache-2.0 except one**, each naming a repository, a
single GGUF file, its context length, its capabilities, its languages, its
licence, and — for a vision model — the projector file the repository pairs with
it. The date in it (`checked`) is the day its measured fields were refreshed.

| Entry | Parameters (file) | Context (file) | Licence | Serbian named? |
| --- | --- | --- | --- | --- |
| Qwen3.5 2B Q4_K_M | 1.19 GiB | 262 144 | Apache-2.0 | not named |
| Qwen3.5 4B Q4_K_M | 2.55 GiB | 262 144 | Apache-2.0 | not named |
| Qwen3.5 9B Q4_K_M | 5.29 GiB | 262 144 | Apache-2.0 | not named |
| Qwen3.5 27B Q4_K_M | 15.59 GiB | 262 144 | Apache-2.0 | not named |
| Gemma 4 E4B QAT q4_0 | 4.80 GiB | 131 072 | Apache-2.0 | not named |
| Gemma 4 12B QAT q4_0 | 6.50 GiB | 262 144 | Apache-2.0 | not named |
| Qwen3-VL 4B Instruct Q4_K_M | 2.33 GiB | 262 144 | Apache-2.0 | not named |
| Slava Qwen3 14B Serbian Q4_K_M | 8.38 GiB | 40 960 | CC-BY-NC-SA-4.0 | **yes — `sr`** |
| Qwen3 Embedding 0.6B Q8_0 | 0.60 GiB | 32 768 | Apache-2.0 | not named |

**It is part of the signed, attested release, so it needs no signature of its
own.** The file ships inside `app.asar`, whose SHA-256 is embedded in the
executable and checked at load (`enableEmbeddedAsarIntegrityValidation`), and the
installer that carries it is signed and accompanied by `SHA256SUMS.txt` and its
Ed25519 signature — both from the same release the catalogue is built in. A
second signature inside the file would be a second thing to verify with the same
key and no additional claim.

Every measured field comes from a source that cannot be typed by hand:

| Field | Source |
| --- | --- |
| `sha256`, `sizeBytes`, `projector.*` | `https://huggingface.co/api/models/<repo>/tree/main` — the LFS `oid` and `size` |
| `contextTokens` | the GGUF file's own `<arch>.context_length`, read by an HTTP Range request to its first bytes |
| `languages` | the repository card's `cardData.language`, codes only, refused if a card writes a name |
| `fit.*` | `GgufInsights.estimateModelResourceRequirementsV2` / `estimateContextResourceRequirementsV2`, at 8192 tokens |

`scripts/assistant-catalogue.mjs` refreshes them (`--fit` for the estimates,
`--check` to fail on drift), and its test runs on a fixture of the Hub's own
reply shape. A repository that does not publish its digests — a gated one answers
with 64 asterisks — is a REFUSAL rather than a skipped field: `meta-llama`
repositories answer `401` to an unauthenticated read, which is why **no Llama
entry exists in this catalogue**: an installer must be able to verify what it
downloads, and nobody here can read the hash to write down.

**Licences, and the one with use restrictions.** Eight entries are Apache-2.0 as
their cards state; Gemma 4's card names Apache-2.0 with the Gemma 4 licence page
as `license_link` (`google/gemma-4-E4B-it-qat-q4_0-gguf`, `license: apache-2.0`,
`https://ai.google.dev/gemma/docs/gemma_4_license`), so the older Gemma Terms
that restricted Gemma 3 do not apply to it. The ninth, Slava Qwen3 14B Serbian,
is **CC-BY-NC-SA-4.0** (`mradermacher/Slava-Qwen3-14B-Serbian-GGUF`,
`cardData.license`, `https://creativecommons.org/licenses/by-nc-sa/4.0/`) — a
NonCommercial model, offered because it is the only entry whose card declares
Serbian (`language: ["sr"]`) and a user may only choose it knowingly. **The
licence is carried per entry and must be shown before a download**; the runtime
refuses a catalogue whose entry states no licence at all, and it is the reason
that rule exists.

**Language claims, quoted rather than paraphrased.** Qwen3.5's card says
"Global Linguistic Coverage: Expanded support to **201 languages and dialects**"
and "Qwen3.5 excels in tool calling capabilities" (`unsloth/Qwen3.5-4B-GGUF`,
model card). Gemma 4's says "**Function Calling** – Native support for structured
tool use" and "maintains multilingual support in **over 140 languages**"
(`google/gemma-4-E4B-it-qat-q4_0-gguf`, card text). **Neither card names Serbian
or Serbo-Croatian**, which is why every Qwen and Gemma entry carries
`languages: []` rather than a hopeful `["sr"]` — and why the Slava entry, whose
card does declare it, is the one that carries the code.

## 4. Recommendations are arithmetic on the machine

`recommend.ts` answers one pick per tier — intelligence, balance, speed — with
the reason in both languages, and it is pure: it reads a `HardwareProfile` and
the catalogue's stored fits and computes.

**The rule.** Weights plus the KV cache, at **8192 tokens** (§5 explains the
number), must fit in the card's free VRAM, or in **60 % of free RAM** for a CPU
run. `vramBytes` is charged with a **10 % margin** on the free figure, which is a
round number above the 8 % `getLlama` itself pads by (`vramPadding`), so a pick
that fits here also fits the library's own `gpuLayers: "auto"` placement. Both
shares are stated constants in the file, and the reason text says which of the
two was spent and how much.

**A full offload wins over a bigger model on the CPU.** The picks come from the
models that fit in VRAM whenever any does. A CPU run is an order of magnitude
slower per token, so "the biggest model that fits somewhere" would hand a user
the slowest assistant on the machine that could have run a faster one.

**Size orders the tiers**, because every chat entry is a four-bit quantization:
the smallest that fits is `speed`, the largest `intelligence`, the middle of what
is left `balance`. No family is favoured. When exactly one model fits, all three
tiers name it with the reason each tier means, and when nothing fits the chooser
answers an empty list and `noRecommendation` carries the sentence — in both
languages, with the smallest model's need and the machine's free memory — rather
than recommending a model that will thrash. That function also tells apart "this
machine is too small" from "the list itself is unreadable", because the second
is not a memory problem and saying "buy more RAM" for it would be a wrong answer.

**Tested on four machines, three of them stated and one of them measured.** The
measured one is this laptop, and the brief guessed wrong about it: 31.6 GiB of
RAM rather than 16, and 8188 MiB of VRAM rather than 6 GiB
(`nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv`,
2026-10-10). Its picks are Gemma 4 E4B, Qwen3-VL 4B and Qwen3.5 2B, all fully
offloaded. The three stated machines are 8 GiB of RAM with no GPU, 32 GiB with a
12 GiB GPU, and 64 GiB with no GPU — and a fifth case pins the offload-first rule
by showing a bigger model that fits the CPU being passed over. Every expected
pick is written into `recommend.test.ts`, so a catalogue refresh that changes a
pick fails that test on purpose: the failure is the review.

## 5. Hardware is llama.cpp's own reading, taken once per session

`hardware.ts` reports RAM total and free, `llama.cpuMathCores` (10 on this
16-thread i7-13620H — the cores llama.cpp counts as useful for math, not the
thread count), and the card. Two consequences of the library's shape are visible
in it, and both are handled rather than hidden:

- **VRAM is one aggregate figure plus a list of names.** `getVramState()` answers
  `{total, used, free, unifiedSize}` for the whole system. On this machine
  `total` is 23.6 GiB, of which 15.8 GiB is `unifiedSize` — the Intel iGPU's slice
  of system RAM, which no model can be loaded into. So `dedicated = total −
  unifiedSize` and free = `dedicated − used`, which charged wholly to the card and
  therefore UNDER-states its free VRAM: conservative in the direction that refuses
  a model rather than one that thrashes.
- **The backend is the one that LOADS.** `getLlamaGpuTypes("supported")` answers
  what this machine can actually run. Here it is `["vulkan", false]`: the CUDA
  prebuilt binaries are installed and **fail their own load test**, which is
  expected — they need CUDA Toolkit 13.1 or higher
  (`docs/guide/CUDA.md` at v3.22.1: "The pre-built binaries are compiled with
  CUDA Toolkits 12.4 and 13.1 … make sure you have CUDA Toolkit 13.1 or higher").
  A machine whose CUDA binaries do not load falls back to Vulkan rather than
  refusing to run.

`getLlama` is called with **`build: "never"` and `skipDownload: true`**, which is
the difference between a clear refusal and a network request or a C++ compile in
a product that promises neither. (Upstream would, by default, download a
llama.cpp release or build one from source when no prebuilt binary works.)

The reading is cached for the session (`createHardwareCache`) because it costs a
native load and every screen wants the same answer; a FAILED reading is not
cached, so the next caller tries again instead of inheriting a failure.

## 6. Loading, chat, and the context

**8192 tokens is the context, and it is the same number the fits are measured
at.** The Qwen3.5 family is trained for 262 144 and its card advises at least
128 K to preserve thinking, but at that length the KV cache alone is several times
the weights: a catalogue that sized for the trained context would recommend models
nobody can run. 8192 is stated once as `CHAT_CONTEXT_TOKENS`, `--fit` writes it
into every entry, and `catalogue.test.ts` holds the two together. A model is
loaded with `min(documented, 8192)`, and a header that states nothing (a search
result, whose header nobody has read) is loaded at 8192 rather than at zero.

**`LlamaChat`, not `LlamaChatSession`.** The session class executes a tool: its
`functions` option takes handlers and it feeds the results back into the same
generation. The contract's `ChatModel.complete` must instead RETURN the calls it
asked for and let the agent loop decide whether to run them, so the runtime drives
the lower-level `LlamaChat` — which parses the calls, reports them, and stops.

**Function calling when the template allows, the text fallback when it does not.**
Whether a wrapper can call functions at all is the library's own test
(`chatWrapper.settings.functions != null`, as `LlamaChat` itself writes it), never
a guess at a template. For the four chat families in the catalogue the resolved
wrappers are `Qwen` (Qwen3.5 and Qwen3-VL), `Gemma 4`, and `JinjaTemplate`
(Slava) — **all four support function calling**, measured with
`resolveChatWrapper({fileInfo})` against each file's own header. For a template
the library cannot drive that way, `messages.ts` describes the tools in a system
block and asks for one fenced `tool_call` JSON object, and a streaming filter
keeps the fence out of what the user reads. **`TOOL_CALL_FENCE` is the seam**: the
fence tag is defined in the runtime because the runtime is what writes it, and
`agent-core`'s fallback parser reads the same tag — one string, two readers, and
the day a model needs it the two must agree.

**A tool call and its result are ONE history item**, because that is what
llama.cpp's templates render: the contract carries them as an assistant message
and a `tool` message (which is what the loop has to emit to stream a result while
the answer is still being written) and `chatHistoryFrom` folds them by
`toolCallId`, never by position. Tool descriptions reach the model in English:
the templates, the JSON Schema and the instruction-following are English, and the
Serbian half of a tool's description is what the USER reads.

**Streaming passes the whole response through.** `onResponseChunk` rather than
`onTextChunk`, and `text` is the full response in order. The measured reason:
Qwen3.5-2B's answer to "Say hi" spends its first tokens in a `thought` segment,
so a text-chunk-only implementation streams nothing and returns an empty answer
while 256 tokens are generated (5.3 s, measured). The contract has one text field
and no place for a reasoning segment, so the runtime passes everything through and
names the line that would split the two the day the contract grows a `reasoning`
field. **A hand-off worth stating: the agent loop's `maxTokens` is what bounds a
turn, and with a reasoning model a small budget buys thinking and no answer.**

**Vision is off, everywhere, on purpose.** No entry declares `vision` (the
validator and a catalogue test both refuse one that does), the projector each
vision model's repository pairs with it IS recorded — so the entry is complete
the day the runtime can use one — and a `complete` whose messages carry an image
is refused IN MAIN, before any bytes cross into the worker, with the code
`unsupported-images`. The engine refuses it too, as the second half of the same
rule. The version that adds it is the v4.0.0 line (§1), not released on
2026-10-10.

**One chat model and one embedder, at most.** A second chat model cannot be
useful at once and would double the memory the chooser just spent its arithmetic
on. The embedder is allowed to sit BESIDE a chat model, because the knowledge
search needs it while an answer is being written and it is 0.60 GiB against the
smallest chat entry's 1.19 GiB. `unloadAll` drops both AND the llama instance
itself: measured on the maintainer's laptop with Qwen3.5-2B, VRAM in use fell
from 3 520 770 048 bytes to 1 622 192 128 (the desktop's own baseline of
1 610 612 736) and the process's RSS from 1638 MB to 448 MB.

**Embeddings are L2-normalised by the runtime**, because the contract promises it
and llama.cpp's own normalisation is a build/server setting this runtime does not
control; the merge is measured in `messages.ts`'s test with the width the worker
reports after loading the model.

## 7. Packaging: what the binaries add, and where they go

`electron-builder.yml` unpacks the whole of `node-llama-cpp` and every
`@node-llama-cpp` platform package, because a native addon cannot be loaded from
inside an asar and an ESM package cannot be resolved from one either. The worker
therefore loads the library by an ABSOLUTE path into `app.asar.unpacked`
(`librarySpecifier()` in `llama.ts`, which recognises the packaged path and falls
back to the bare specifier in development and under Vitest). Loading it through a
real dynamic `import()` rather than a static one is not a style choice:
`require("node-llama-cpp")` fails outright (§1).

**Measured from `node_modules` on 2026-10-10**, bytes summed over each package's
files:

| Package | Size | Shipped? |
| --- | --- | --- |
| `node-llama-cpp` (JS, templates, `llama/` sources) | 4.2 MB | yes |
| `node-llama-cpp/llama/gitRelease.bundle` | 33.6 MB | **no** — nothing here builds from source |
| `@node-llama-cpp/win-x64` (CPU) | 29.3 MB | yes |
| `@node-llama-cpp/win-x64-vulkan` | 70.9 MB | yes |
| `@node-llama-cpp/win-x64-cuda` | 167.9 MB | yes |
| `@node-llama-cpp/win-x64-cuda-ext` (a 350.9 MB `ggml-cuda.dll`) | 350.9 MB | yes |
| `@node-llama-cpp/win-arm64` | 10.5 MB | **no** — an x64 build cannot load it |

**The binaries add 623.2 MB unpacked** to the installer, and 518.8 MB of that is
the CUDA pair. It is kept because upstream's own Electron template ships exactly
`${os}-${arch}*` and a user who HAS installed CUDA Toolkit 13.1 would otherwise
have no way to get CUDA acceleration at all — dropping the two lines is the
one-line change if the installer's size ever wins. This is a measured trade
rather than an accident, and the numbers are in the config file itself, beside
the patterns. The rest of `llama/` stays even though nothing here builds from
source, because `dist/bindings/utils/binariesGithubRelease.js` reads
`llama/binariesGithubRelease.json` in a **module-scope top-level await**: dropping
the directory would make `import("node-llama-cpp")` throw before a single token
was generated, which is a defect that would only ever appear in a packaged build.

## 8. Downloads, and importing a file

**Downloads go through the download service** (ADR-092) and only in the
`downloads` network mode: it is what checks the mode, consults the host allowlist
on every hop, refuses a download with no expected SHA-256, checks the free space
before the first byte, hashes while it writes, DELETES the file on a mismatch, and
reports progress. This runtime adds the half the service cannot know: which volume
the model will live on, a free-space check against the model's own directory, the
rename from the service's staging area into `<userData>/models/<id>/<file>`, and
the registry that remembers it. **No second hash is computed** — re-reading
sixteen gigabytes to check what the service just verified would buy a minute of
the user's time and nothing else.

`DOWNLOAD_HOSTS` and `check:egress` are untouched: this run adds no host, because
the download service's existing rule already admits exactly the host the file
comes from — see §9.

**`models/installed.json` is derived bookkeeping**: read tolerantly (a corrupt
entry is skipped, a corrupt file is an empty list, because a bookkeeping file must
not be able to stop the app from loading a model that is sitting right there),
written whole through a temporary that is renamed into place.

**An imported `.gguf` is REGISTERED, NOT COPIED.** The path comes from an open
dialog in main and nowhere else; the file is read twice and never written — once
for its header, with a bounded reader of at most 32 MB (`gguf.ts`), and once to
hash it. `remove` therefore FORGETS an imported file and never deletes it: the
user chose that file, and deleting data this app did not create is the one thing
it must not do. A downloaded model's own directory is deleted, because that IS
this app's data. The header reader answers the architecture, the context length,
the chat template, whether the file IS a projector (`general.type: "mmproj"`, a
`clip` architecture — measured on Qwen3-VL's `mmproj`), whether the model declares
image input (`general.tags`, the visible signal in the three vision files here)
and whether it is an embedding model (`*.pooling_type`), and importing a projector
is refused rather than registered as a chat model.

## 9. The Hugging Face search

`huggingface.ts` reads the Hub's public API through the SAME dedicated session and
the same host rule as a download, refuses outside the `downloads` mode before it
builds a URL, and validates every URL against `isSessionRequestAllowed` before
requesting it. Three details are decisions rather than plumbing:

- **Every hash comes from the listing.** A file whose LFS `oid` is absent or
  masked is not offered, because an entry whose hash nobody can read is a download
  this app cannot verify.
- **A split model is recognised and NOT offered.** `-00001-of-0000N` parts are one
  model in N files, and the contract's `ModelEntry` describes ONE file with one
  hash and one size, so the runtime cannot download a split model at all — listing
  four parts as four models would offer a user three downloads that cannot be
  loaded on their own. The parts are grouped by `parseSplitPart`, the group is
  omitted, and the catalogue has no split entry either.
- **A search result carries `contextTokens: 0`** — "not known yet" — because no
  listing says what the file's own header will say, and `0` is read as "use the
  runtime's default context" rather than as a zero-token context.

**No host is added to `DOWNLOAD_HOSTS`, and the reason is a measurement rather
than an omission.** ADR-092's list is a compiled-in constant and `check:egress`
does not carry a host list at all; the model files and the API come from
`huggingface.co`, whose redirect chain the session's rule already governs, and
adding a host to a compiled-in list is a change that belongs to the run which
actually needs it. The `curl.exe -sIL` check the brief asks for cannot be run in
this sandbox at all (`schannel: SEC_E_NO_CREDENTIALS`), so the chain was read with
Node's `fetch` instead: a `resolve/main/<file>` request answers `206` with a
`content-range` header from the same host, and the API's own endpoints answer
`200` directly. If a later run finds a hop outside `huggingface.co`, the fix is
one line in that array and one test.

## 10. What this costs, and what it does not do

- **623.2 MB of installer** (§7), most of it CUDA for a backend that requires a
  toolkit most users will not have.
- **One chat model at a time**, and a model swap is a full load (§6).
- **No vision**, on any entry, until the v4.0.0 line ships (§1).
- **A split model cannot be downloaded**, though it is recognised (§9).
- **An imported model has no measured fit**, so the chooser skips it: nobody here
  measured it, and a recommendation would be a guess about a file's memory.
- **A load cannot be cancelled mid-way.** llama.cpp offers no cancel for reading
  and mapping gigabytes, so a signal that fires during a load is honoured the
  moment the load finishes: the model is unloaded again and the caller is told
  the turn was aborted.
- **The runtime does not police a reasoning model's thinking** (§6); the loop's
  `maxTokens` is what bounds a turn, and that is a hand-off to `agent-core`.
