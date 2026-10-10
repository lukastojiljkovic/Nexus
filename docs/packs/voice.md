# `voice` packs — the assistant's speech models

Four packs are buildable today: three Whisper speech-to-text models and one
voice for text-to-speech. All of them are `kind: "model"` packs (`ADR-091`), and
what makes them *voice* packs is one file the builder writes into each of them,
`voice.json` (`ADR-105` §5).

## What the builder does

```text
node scripts/packs/voice/build.mjs --voice whisper-base,mms-tts-eng --update-sources
node scripts/packs/voice/build.mjs --all
```

It downloads each voice's files into `%TEMP%\nexus-pack-cache\<id>\` (reused on
a second run, and a cached file whose SHA-256 does not match the one
`sources.json` records is fetched again and refuses if it still differs),
assembles the pack folder at `%TEMP%\nexus-packs\<id>\`, writes the metadata
file `scripts/pack-sign.mjs` takes at `%TEMP%\nexus-packs\<id>.meta.json`, and
prints every file it fetched, its size and the total time.

**It does not sign anything.** Signing needs the release key, which lives on the
maintainer's machine and in the repository's Actions secrets:

```text
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\whisper-base ^
     --meta %TEMP%\nexus-packs\whisper-base.meta.json --key <release-key.pem>
```

The signed folder is then installable through the „Paketi sadržaja" card, or
downloadable by the download service (`ADR-092`) once a content host is added.

## The packs, and what each contains

Measured by the builder's own output on 2026-10-10, on this machine.

| Pack | Kind | Model | Files | Size |
| --- | --- | --- | --- | --- |
| `whisper-tiny` | stt | `Xenova/whisper-tiny` | 12 + `voice.json` | 45 209 723 B |
| `whisper-base` | stt | `Xenova/whisper-base` | 12 + `voice.json` | 81 265 497 B |
| `whisper-small` | stt | `Xenova/whisper-small` | 12 + `voice.json` | 253 462 913 B |
| `mms-tts-eng` | tts | `Xenova/mms-tts-eng` | 5 + `voice.json` | 38 366 629 B |

A Whisper pack holds the quantised encoder and decoder
(`onnx/encoder_model_quantized.onnx`,
`onnx/decoder_model_merged_quantized.onnx` — the `_quantized` suffix is what
`dtype: "q8"` resolves to) and the ten small files the pipeline reads
(`config.json`, `generation_config.json`, `preprocessor_config.json`,
`tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`,
`added_tokens.json`, `normalizer.json`, `vocab.json`, `merges.txt`). The voice
pack holds `onnx/model_quantized.onnx` and its four tokenizer files.

All four were built and hashed on 2026-10-10, and all three Whisper sizes were
measured on the same audio: `ADR-105` §2 has the real-time factors, and it is
where the reason for recommending `whisper-base` is written down.

## Licences, and the evidence for each

Every source's licence page, the sentence quoted from it and the SHA-256 of every
downloaded file are in `scripts/packs/voice/sources.json`; that file is the
record, and it is written to be checked rather than trusted. The two that matter:

| Repository | Licence | Evidence |
| --- | --- | --- |
| `Xenova/whisper-tiny|base|small` | Apache-2.0 | the conversion's own card: `license: apache-2.0`, over `openai/whisper-*` (MIT) |
| `Xenova/mms-tts-eng` | CC-BY-NC-4.0 | `facebook/mms-tts-eng`'s card: `license: cc-by-nc-4.0`, and „This repository contains the **English (eng)** language text-to-speech (TTS) model checkpoint." |

Nexus stays free with no ads and no paid tier, so a NON-COMMERCIAL source may
ship as a pack with its licence named and its attribution shown — which is what
`pack.json` carries for every pack the card lists. The Apache-2.0 models are the
conversion work of `Xenova/whisper-*` over `openai/whisper-*` (MIT); the app
itself stays Apache-2.0 and ships none of this content in its installer.

## There is no Serbian voice, and this is the evidence

`ADR-105` §3 records the finding in full. In short, three candidates were
checked on 2026-10-10 and none of them can ship:

- **MMS-TTS has no Serbian voice.** `facebook/mms-tts-srp` and
  `Xenova/mms-tts-srp` answer HTTP 401, and the official supported-language table
  (`https://dl.fbaipublicfiles.com/mms/tts/all-tts-languages.html`) has no `srp`,
  `hrv`, `bos`, `hbs` or `cnr` row at all.
- **Piper's engine is GPL-3.0** (`OHF-Voice/piper1-gpl`), and the phonemizer it
  needs, `espeak-ng`, is GPL-3.0 too — and this app ships no GPL program. The
  older MIT `rhasspy/piper` is archived and still needs `espeak-ng`.
- **The Serbian VITS fine-tunes on the Hub declare no licence**, and a source
  with no licence statement is a source that cannot be used.

So `mms-tts-eng` is the only voice that can be built today, and
`textToSpeech().speak(text, "sr")` refuses with `pack-missing` rather than
reading Serbian through an English voice. The day a Serbian voice appears with a
shippable licence, it is one entry in `sources.json` and one run of the builder.

## Tests

`node node_modules/vitest/vitest.mjs run --configLoader runner --config vitest.scripts.config.mjs scripts/packs/voice/build.test.mjs`

Twenty tests over the real upstream `config.json` of two voices, committed under
`fixtures/` (4 KB, Apache-2.0 and CC-BY-NC-4.0 respectively, which both allow a
cut this size): the descriptor the builder writes, the metadata `pack-sign.mjs`
accepts, the refusals (a config whose `model_type` disagrees with the entry, an
unpinned revision, a source with no licence evidence, a cache file whose bytes
do not match the recorded hash) and the assertion that a pack is never written
outside the packs folder.
