# Fixtures for `languages.test.mjs`

Cut from the upstream files on 2026-10-22. The tests read these instead of the network.

| File | Source | What was cut |
| --- | --- | --- |
| `special_tokens_map.json` | `https://huggingface.co/Xenova/nllb-200-distilled-600M/resolve/main/special_tokens_map.json` | Verbatim. Its `additional_special_tokens` list holds the NLLB language codes. |
| `whisper-generation_config.json` | `https://huggingface.co/openai/whisper-small/resolve/main/generation_config.json` | Verbatim. Its `lang_to_id` keys are the Whisper language tokens. |
| `flores-languages.md` | `https://raw.githubusercontent.com/facebookresearch/flores/main/flores200/README.md` | Lines 67 to 274: the `## Languages in FLORES-200` section, heading included. |
| `mms-api-models.json` | `https://huggingface.co/api/models?author=facebook&search=mms-tts&limit=2000` (both pages) | Twelve entries, reduced to their `id`, chosen to cover a per-language repo, script splits, a dialect split and the bare `facebook/mms-tts` repo. |
| `mms-tokenizer-configs.json` | `https://huggingface.co/facebook/mms-tts-<suffix>/resolve/main/tokenizer_config.json` | Eight repos, keyed by repo id; each value is that repo's file verbatim. Two (`kor`, `amh`) have `is_uroman: true`, the rest `false`. |
