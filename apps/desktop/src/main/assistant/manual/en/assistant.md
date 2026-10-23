---
id: assistant
title: Assistant
location: { module: assistant }
keywords: [assistant, model, chat, offline, gguf, llama]
---
The assistant is a conversation with a model that runs on this computer. The model is picked for the hardware (intelligence, balance or speed), downloaded once, and then works with no internet.

A model you found through the search or imported yourself serves no tier: open "Models" and press "Use for answers" on its row, and it answers from then on. "Use the recommended model" gives the answer back to the tier.

How to use it:

1. "Models": see the pick for this machine, then download a model (only in the Downloads network mode), import a `.gguf` file, or search Hugging Face. Every file is verified against its SHA-256.
2. "New conversation" opens a thread. Type a question and press Enter; Shift+Enter begins a new line. While the answer streams, "Stop" ends the turn.
3. "Recipes" start a prepared conversation (plan my day, turn a note into tasks, what should I read about this, stranded: help me through it).
4. "Sources" sit under an answer: a click opens the app page the answer came from, and an address from the web opens in your own browser.

How the model runs: the "How the model runs" card in "Models" shows which model is in memory, and "Unload now" frees that memory at once. For this profile, the same card sets the context size in tokens (still capped by what the model was trained on), the temperature, top-p, top-k and repeat penalty, each left empty for the model's own value ("Model defaults" empties them, and "Save" keeps the change). It also sets the minutes after which an idle model leaves memory (15 at first; 0 keeps it until you unload it), and "Summarize long conversations automatically", on at first: when a conversation outgrows what the model reads at once, its earlier messages are summarized before the answer, and the thread marks where. "Summarize earlier messages", beside the message box, does the same on request.

The assistant knows your notes, tasks, events, attachment text, the app's own manual and the installed content packs. Private notes are excluded. When an answer draws on a safety pack, the safety notice and the number 112 sit under it.

The reference libraries you downloaded are read as well: for a question the assistant searches the titles in every library on this computer and takes the opening section of the few articles whose titles match, then cites them.

Tools that change data or go to the network ask for confirmation before acting; a refusal is an ordinary answer and nothing changes. Web search stays off until you turn it on in Settings, on the "Assistant" card, and it works only in the `updates` or `downloads` network mode.

Related: settings-modules, network-and-updates, content-packs, search
