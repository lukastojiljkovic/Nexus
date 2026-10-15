# cookbook

Your own recipes and the cuisines of the world from packs: ingredients, steps, photos and nutrition values.

## Manifest

- **id** — `cookbook`
- **prefix** — `COOK`
- **group** — `life`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops by group: recipes (`list`, `get`, `create`, `update`, `remove`, `search`); pack recipes (`listRecipesPacks`, `browsePack`, `getPackRecipe`, `savePackRecipe`); foods (`listFoodsPacks`, `suggestFoods`, `setFoodMatch`, `clearFoodMatch`, `nutrition`); and `setUnitSystem`, `setAwake`, `attachPhoto`, `removePhoto`.
- **Store** — `RecipeStore` in [`packages/db/src/cookbook/`](../../../../../packages/db/src/cookbook/), migration [`076-cookbook.ts`](../../../../../packages/db/src/migrations/076-cookbook.ts). Photos are carried by the blob hook (ADR-108).
- **Content pack** — `dataset` packs carrying `recipes.json` and `foods.json`, read by [`main/packData.ts`](main/packData.ts).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with the view helpers in [`renderer/cookbook.ts`](renderer/cookbook.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-078](../../../../../docs/architecture/adr/078-nutrition.md), [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-108](../../../../../docs/architecture/adr/108-kit-blobs.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/cookbook.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/cookbook.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`cookbook.ts`](../../main/assistant/tools/cookbook.ts).
