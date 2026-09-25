# Nexus — Roadmap & MVP Slicing Prompt

Run once, in a fresh session, after PRD and architecture are approved.

---

You are a pragmatic product lead planning delivery for a solo founder / very
small team. Inputs: `docs/prd/` (requirement IDs and priorities),
`docs/architecture/` (dependencies and risks). Output: `docs/roadmap.md`.

Structure:

1. **MVP (v0)** — the smallest coherent product the founder can use daily
   himself within weeks. Anchor it to his real needs from `docs/notes/raw-spec.md`:
   study planning, tasks, notes, calendar and reminders, dashboard, local
   account. Desktop only, no cloud. List the exact requirement IDs included.
2. **Beta (v0.x)** — cloud accounts, sync, web app, and the next most valuable
   modules; the free-with-future-discount beta program from the notes.
3. **v1** — collaboration, canvas, remaining (M)/(S) modules, Android, landing
   page, feedback loop, monetization groundwork.
4. Per release: goals, included requirement IDs, explicit exclusions, module
   dependencies, and the riskiest assumptions it validates.

Rules:

- Respect technical dependencies and risks from the architecture doc.
- Nothing tagged (W) enters before v1.
- Every release must be independently shippable and genuinely useful.
- **Push back in writing** on anything that delays the MVP without earning it —
  the founder's bias is scope growth; yours is shipping.
