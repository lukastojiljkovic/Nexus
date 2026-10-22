# Fixtures for `languages.test.mjs`

Cut from the upstream files on 2026-10-22. The tests read these instead of the network.

| File | Source | What was cut |
| --- | --- | --- |
| `special_tokens_map.json` | `https://huggingface.co/Xenova/nllb-200-distilled-600M/resolve/main/special_tokens_map.json` | Verbatim. Its `additional_special_tokens` list holds the NLLB language codes. |
| `flores-languages.md` | `https://raw.githubusercontent.com/facebookresearch/flores/main/flores200/README.md` | Lines 67 to 274: the `## Languages in FLORES-200` section, heading included. |
