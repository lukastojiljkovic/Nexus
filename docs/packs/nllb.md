# `nllb` packs — the translator's models

Three packs, one per size, from which the user picks one. Each is a `kind: "model"` pack
(`ADR-091`) that holds the NLLB-200 translation model in ONNX form, quantized to `q8`, and
the files `@huggingface/transformers` reads to load it. The translator runs them offline.

## What the builder does

```text
node scripts/packs/nllb/build.mjs --pack nllb-600m,nllb-1.3b --update-sources
node scripts/packs/nllb/build.mjs --all
```

The 600M files are downloaded at a pinned revision into `~\.nexus-pack-cache\nllb-600m\`. A
cached file whose SHA-256 matches the one `sources.json` records is not fetched again. The
1.3B and 3.3B packs are converted on this machine, so their files are read in place from the
folder `sources.json` names. Each pack folder is rebuilt from scratch in `~\.nexus-packs\<id>\`,
and the metadata `scripts/pack-sign.mjs` takes is written beside it as `<id>.meta.json`.

The builder refuses three things: a file of 2 GiB or more (a release asset cannot be that
large), a file whose hash differs from the one recorded unless `--update-sources` is given,
and a model whose README does not state the licence it ships under. A local folder that does
not yet hold the model is skipped with a message, so `--all` runs past a conversion still in
progress.

**It does not sign anything.** Signing needs the release key:

```text
node scripts/pack-sign.mjs --dir ~\.nexus-packs\nllb-600m ^
     --meta ~\.nexus-packs\nllb-600m.meta.json --key <release-key.pem>
```

## The packs, and what each contains

Every pack holds the same seven files, plus the decoder's weight chunks where it has them:

| File | Role |
| --- | --- |
| `config.json`, `generation_config.json` | model architecture and generation defaults |
| `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json` | the SentencePiece tokenizer |
| `onnx/encoder_model_quantized.onnx` | quantized encoder |
| `onnx/decoder_model_merged_quantized.onnx` | quantized decoder |

A local pack also takes the external-data chunks of its own two graphs -
`<graph>.onnx_data`, `<graph>.onnx_data_1`, ..., the names `@huggingface/transformers`
loads when `use_external_data_format` is the chunk count. The converter leaves the
data of the graphs it exported but the pack does not use (`decoder_model_quantized`,
`decoder_with_past_model_quantized`) in the same folder, and none of it is taken. The
1.3B has no chunks; the 3.3B decoder has two (below).
`quantize_config.json` and `sentencepiece.bpe.model` are not in the pack; the file list is the
one `sources.json` fixes.

Measured by the builder's own output on 2026-10-22, on this machine:

| Pack | Model | Files | Size | Build time |
| --- | --- | --- | --- | --- |
| `nllb-600m` | `facebook/nllb-200-distilled-600M` (from `Xenova/nllb-200-distilled-600M`) | 7 | 911 962 632 B | 44 387 ms, downloaded |
| `nllb-1.3b` | `facebook/nllb-200-distilled-1.3B` (converted here) | 7 | 1 940 515 828 B | 57 556 ms, read in place |
| `nllb-3.3b` | `facebook/nllb-200-3.3B` (converted here) | 9 | 4 466 791 113 B | 13 508 ms, read in place |

The per-file sizes of the two built packs:

| File | `nllb-600m` | `nllb-1.3b` | `nllb-3.3b` |
| --- | ---: | ---: | ---: |
| `config.json` | 873 B | 934 B | 924 B |
| `generation_config.json` | 189 B | 193 B | 193 B |
| `special_tokens_map.json` | 3 548 B | 4 487 B | 4 487 B |
| `tokenizer.json` | 17 331 224 B | 32 240 136 B | 32 240 136 B |
| `tokenizer_config.json` | 544 B | 41 770 B | 41 770 B |
| `onnx/encoder_model_quantized.onnx` | 419 120 483 B | 770 503 603 B | 1 740 060 006 B |
| `onnx/decoder_model_merged_quantized.onnx` | 475 505 771 B | 1 137 724 705 B | 6 877 773 B |
| `onnx/decoder_model_merged_quantized.onnx_data` | — | — | 1 899 626 496 B |
| `onnx/decoder_model_merged_quantized.onnx_data_1` | — | — | 787 939 328 B |

The 600M files were downloaded in that run, and the 1.3B files were hashed in place; the run
wrote their hashes into `sources.json` with `--update-sources`. A second run on the final code
read the cache and the folder and matched every recorded hash, without a refusal.

The languages each pack translates between are the `NLLB_LANGUAGES` table in
`apps/desktop/src/modules/translator/shared/languages.ts`, whose length the metadata's
description reads: 202.

## How the two local packs were converted

Both are converted by the transformers.js 3.7.0 `scripts/convert.py` with
`--quantize --modes q8`, and nothing else is run on the output but the 3.3B decoder's
split (below). The environment sets
`PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python`: the unquantized 1.3B graph is larger than
2 GiB, and the default protobuf backend refuses to serialize it (`EncodeError: Failed to
serialize proto`), where the pure-Python one writes it with its weights as external data. The
1.3B was converted on 2026-10-22 and checked the same day: it loads in
`@huggingface/transformers` with `dtype: { encoder_model: "q8", decoder_model_merged: "q8" }`
and translates English, Serbian and German correctly.

The 3.3B was converted on 2026-10-22 the same way. Its quantized decoder came out as a
6.9 MB graph and one 2 665 885 696 B weight file, which no release asset can hold: the
decoder carries the 256 206-token vocabulary twice, as the input embedding and as the
output projection. `scripts/packs/nllb/split-external-data.py` rewrites the graph so its
tensors live in two files under 1.9 GB each, copying the bytes unchanged:

```text
python scripts/packs/nllb/split-external-data.py <folder>/onnx/decoder_model_merged_quantized.onnx <out>
```

The split model was checked the same day through `@huggingface/transformers` 4.3.1 with
`use_external_data_format: { "decoder_model_merged_quantized.onnx": 2 }`: it loaded in
10 545 ms and translated English to Serbian (Cyrillic) and German, and Serbian to English,
correctly. Two rules came out of that check:

- **The chunk count is read from the pack.** The worker counts the
  `decoder_model_merged_quantized.onnx_data*` files beside the graph and passes that
  count; with none it passes nothing, as for the 600M and the 1.3B.
- **A weight file must not be a hard link.** ONNX Runtime 1.30 refuses external data
  with more than one link ("a potential hardlink attack"), so a pack's files are
  copied into place, never linked.

## Licences, and the evidence for each

All three models are published under `license: "cc-by-nc-4.0"` in the front matter of their
READMEs. The line is quoted, with its page, in `scripts/packs/nllb/sources.json`. The builder reads that
page (from the cache after the first run) and refuses a pack whose page does not state it:

| Model | Evidence |
| --- | --- |
| `facebook/nllb-200-distilled-600M` | `https://huggingface.co/facebook/nllb-200-distilled-600M/raw/main/README.md` |
| `facebook/nllb-200-distilled-1.3B` | `https://huggingface.co/facebook/nllb-200-distilled-1.3B/raw/main/README.md` |
| `facebook/nllb-200-3.3B` | `https://huggingface.co/facebook/nllb-200-3.3B/raw/main/README.md` |

Nexus stays free with no ads and no paid tier, so a NON-COMMERCIAL source may ship as a pack
with its licence named and its attribution shown, as `pack.json` carries it. The 600M
attribution reads „NLLB-200 by Meta AI; ONNX by Xenova"; the two converted packs read
„NLLB-200 by Meta AI; converted to ONNX for Nexus".

## Tests

`node node_modules/vitest/vitest.mjs run --config vitest.scripts.config.mjs scripts/packs/nllb`

The tests use small fixture files written to a temporary folder and no network. They cover
the file list of each pack, the external-data files a local folder adds, the 2 GiB refusal,
the hash refusal and `--update-sources`, a cache hit that fetches nothing, the licence check
(accepted and refused), the metadata through `checkMeta`, and the argument parser.
