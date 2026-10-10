---
id: assistant
title: Assistant
location: { module: assistant }
keywords: [assistant, model, chat, offline, gguf, llama]
---
The assistant is a conversation with a model that runs on this computer. The model is picked for the hardware (intelligence, balance or speed), downloaded once, and then works with no internet.

How to use it:

1. "Models": see the pick for this machine, then download a model (only in the Downloads network mode), import a `.gguf` file, or search Hugging Face. Every file is verified against its SHA-256.
2. "New conversation" opens a thread. Type a question and press Enter; Shift+Enter begins a new line. While the answer streams, "Stop" ends the turn.
3. "Recipes" start a prepared conversation (plan my day, turn a note into tasks, what should I read about this, stranded: help me through it).
4. "Sources" sit under an answer: a click opens the app page the answer came from, and an address from the web opens in your own browser.

The assistant knows your notes, tasks, events, attachment text, the app's own manual and the installed content packs. Private notes are excluded. When an answer draws on a safety pack, the safety notice and the number 112 sit under it.

Tools that change data or go to the network ask for confirmation before acting; a refusal is an ordinary answer and nothing changes. Web search stays off until you turn it on in Settings, on the "Assistant" card, and it works only in the `updates` or `downloads` network mode.

Related: settings-modules, network-and-updates, content-packs, search
