import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  Select,
  TextArea,
  TextField,
} from "@nexus/ui";
import {
  COOKBOOK_COURSES,
  type CookbookCourse,
  foldSearchText,
  parseIngredientLine,
} from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { numberFormat } from "../../../renderer/src/intl.js";
import { useFocusTrap } from "../../../renderer/src/useFocusTrap.js";
import { manifest } from "../shared/manifest.js";
import type {
  CookbookView,
  FoodSuggestionView,
  NutritionView,
  PackRecipeSummaryView,
  PackRecipeView,
  RecipeDraft,
  RecipeIngredientDraft,
  RecipeSummaryView,
  RecipeView,
  RecipesPackView,
} from "../shared/ipc.js";
import {
  clampServings,
  courseLabel,
  factorFor,
  formatTime,
  lineText,
  scaleLines,
  stepIndex,
  totalMinutes,
} from "./cookbook.js";
import { copy } from "./copy.js";
import "./cookbook.css";

/**
 * KUVARICA (COOKBOOK, stage 2) — the module's page.
 *
 * **Four things on one screen, and each is a question.** What recipes do I have
 * (and what can I make with what is in the fridge); one recipe at scale; what
 * the world's cuisines hold; and what this dish carries per serving. They are
 * sections of one page rather than four pages because they are read together:
 * the servings stepper changes the ingredient list AND the figures beside it,
 * and a corpus two clicks away would hide the one feature that makes the module
 * worth opening with somebody else's recipe.
 *
 * **Nothing on screen is computed by a second implementation.** Scaling is
 * `@nexus/core`'s `scaleIngredients` (through `cookbook.ts`), the parse is the
 * module's own `parseIngredientLine`, the nutrition is main's — this file draws
 * what it is handed and does arithmetic only where a page must (a factor, a step
 * index).
 *
 * **The cooking view replaces the page rather than sitting on it.** A step read
 * from across a kitchen is the whole surface while it is open, so it is drawn
 * alone: large type, one step, arrow keys, Escape to leave, and the display asked
 * to stay awake for exactly as long as it is mounted.
 *
 * **Every list has an empty state that says what to do next**, and every failure
 * says which read failed and what to try — never a raw exception.
 */

export default function CookbookPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<CookbookView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The open recipe's own read, or null while none is open. */
  const [detail, setDetail] = useState<RecipeView | null>(null);
  const [servings, setServings] = useState(1);
  /** What the search box found, or null while the box is empty. */
  const [hits, setHits] = useState<readonly RecipeSummaryView[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<null | { id: string | null }>(null);
  const [cooking, setCooking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * One read of the list, into state. Every mutation answers with the same
   * shape, so the page has exactly one way to learn what main holds — what it
   * was told, never what it hoped.
   */
  const run = useCallback(
    async (
      action: (api: typeof window.nexus.modules.cookbook) => Promise<CookbookView>,
    ): Promise<void> => {
      try {
        setView(await action(window.nexus.modules.cookbook));
        setError(null);
      } catch (failure) {
        setError(copy.errors.mutate);
        console.error("Nexus: a cookbook change failed:", failure);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.cookbook.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the cookbook could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (id: string): Promise<void> => {
      try {
        const recipe = await window.nexus.modules.cookbook.get({ profileId, id });
        setDetail(recipe);
        setServings(recipe.servings);
        setError(null);
      } catch (failure) {
        setError(copy.errors.recipe);
        console.error("Nexus: a recipe could not be loaded:", failure);
      }
    },
    [profileId],
  );

  /** Re-reads the open recipe, so a change made through the list is visible on it too. */
  const reloadDetail = useCallback(
    async (id: string): Promise<void> => {
      try {
        setDetail(await window.nexus.modules.cookbook.get({ profileId, id }));
      } catch (failure) {
        console.error("Nexus: the open recipe could not be re-read:", failure);
      }
    },
    [profileId],
  );

  /** The search box: main ranks title, then tag, then ingredient. */
  const search = useCallback(
    async (text: string): Promise<void> => {
      setQuery(text);
      if (text.trim().length === 0) {
        setHits(null);
        return;
      }
      try {
        setHits(await window.nexus.modules.cookbook.search({ profileId, query: text }));
      } catch (failure) {
        console.error("Nexus: the cookbook search failed:", failure);
      }
    },
    [profileId],
  );

  if (cooking && detail !== null) {
    return (
      <CookingView
        recipe={detail}
        servings={servings}
        profileId={profileId}
        onClose={() => setCooking(false)}
      />
    );
  }

  const recipes = view?.recipes ?? [];
  const shown = hits ?? recipes;

  return (
    <div className="cookbook">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="cookbook"
        actions={
          <Button variant="primary" onClick={() => setEditing({ id: null })}>
            {copy.list.add}
          </Button>
        }
      />
      {error !== null && (
        <p className="cookbook__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <>
          <Card className="cookbook__card" title={copy.list.title}>
            <TextField
              label={copy.list.search}
              value={query}
              onChange={(event) => void search(event.target.value)}
            />
            <p className="nx-hint">{copy.list.searchHint}</p>
            {recipes.length === 0 ? (
              <EmptyState
                variant="inline"
                title={copy.list.emptyTitle}
                description={copy.list.emptyBody}
              />
            ) : shown.length === 0 ? (
              <p className="nx-hint">{copy.list.noResults}</p>
            ) : (
              <div className="cookbook__list">
                {shown.map((recipe) => (
                  <ListRow
                    key={recipe.id}
                    leading={<Icon name="cookbook" />}
                    trailing={
                      <span className="cookbook__row-actions">
                        <Chip>{courseLabel(recipe.course)}</Chip>
                        {timeOf(recipe) !== null && <Chip>{timeOf(recipe)}</Chip>}
                        <Button size="sm" variant="primary" onClick={() => void open(recipe.id)}>
                          {copy.list.open}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            void open(recipe.id).then(() => setCooking(true));
                          }}
                        >
                          {copy.list.cook}
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          title={recipe.favourite ? copy.list.untick : copy.list.tick}
                          onClick={() =>
                            void run((api) =>
                              api.update({
                                profileId,
                                id: recipe.id,
                                patch: { favourite: !recipe.favourite },
                              }),
                            )
                          }
                        >
                          <Icon name="star" />
                        </Button>
                      </span>
                    }
                    muted={!recipe.favourite}
                  >
                    <span className="cookbook__row-title">{recipe.title}</span>
                    <span className="cookbook__row-meta">
                      {copy.list.servings}: {numberFormat().format(recipe.servings)}
                      {recipe.source === "imported" && ` · ${copy.detail.source}`}
                    </span>
                  </ListRow>
                ))}
              </div>
            )}
          </Card>

          {detail !== null && (
            <>
              <RecipeDetail
                recipe={detail}
                servings={servings}
                onServings={setServings}
                onCook={() => setCooking(true)}
                onEdit={() => setEditing({ id: detail.id })}
                onDelete={() => setDeleting(true)}
                onClose={() => setDetail(null)}
                onPhoto={() =>
                  void run(async (api) => {
                    const next = await api.attachPhoto({ profileId, id: detail.id });
                    await reloadDetail(detail.id);
                    return next;
                  })
                }
                onRemovePhoto={() =>
                  void run(async (api) => {
                    const next = await api.removePhoto({ profileId, id: detail.id });
                    await reloadDetail(detail.id);
                    return next;
                  })
                }
              />
              <Nutrition
                profileId={profileId}
                recipe={detail}
                matches={view.foodMatches}
                // A link is remembered on the PROFILE, so both reads are stale
                // after one: the recipe's figures and the list's matches.
                onChanged={(id) => {
                  void refresh();
                  void reloadDetail(id);
                }}
              />
            </>
          )}

          <Packs profileId={profileId} onSaved={(id) => void open(id)} />
        </>
      )}

      {editing !== null && (
        <RecipeEditor
          profileId={profileId}
          recipe={editing.id === null ? null : detail}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            void refresh();
            void open(id);
          }}
        />
      )}

      {deleting && detail !== null && (
        <ConfirmDelete
          title={detail.title}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            const id = detail.id;
            setDeleting(false);
            setDetail(null);
            void run((api) => api.remove({ profileId, id }));
          }}
        />
      )}
    </div>
  );
}

/** A recipe's total time, or null when it states none. */
function timeOf(recipe: RecipeSummaryView): string | null {
  const total = totalMinutes(recipe);
  return total === null ? null : formatTime(total);
}

// --- One recipe ---------------------------------------------------------------

function RecipeDetail({
  recipe,
  servings,
  onServings,
  onCook,
  onEdit,
  onDelete,
  onClose,
  onPhoto,
  onRemovePhoto,
}: {
  recipe: RecipeView;
  servings: number;
  onServings: (value: number) => void;
  onCook: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onPhoto: () => void;
  onRemovePhoto: () => void;
}) {
  const factor = factorFor(recipe, servings);
  const total = timeOf(recipe);

  return (
    <Card className="cookbook__card" title={copy.detail.title}>
      <div className="cookbook__detail-head">
        <h2 className="cookbook__detail-title">{recipe.title}</h2>
        <Button size="sm" variant="quiet" onClick={onClose}>
          {copy.packs.close}
        </Button>
      </div>
      <div className="cookbook__chips">
        <Chip>{courseLabel(recipe.course)}</Chip>
        {total !== null && <Chip>{total}</Chip>}
        {recipe.tags.map((tag) => (
          <Chip key={tag} variant="data">
            {tag}
          </Chip>
        ))}
      </div>

      <div className="cookbook__servings">
        <TextField
          label={copy.detail.servings}
          className="cookbook__servings-field"
          inputMode="numeric"
          value={String(servings)}
          onChange={(event) => onServings(clampServings(Number(event.target.value)))}
        />
        <Button size="sm" title={copy.detail.less} onClick={() => onServings(clampServings(servings - 1))}>
          <Icon name="minus" />
        </Button>
        <Button size="sm" title={copy.detail.more} onClick={() => onServings(clampServings(servings + 1))}>
          <Icon name="plus" />
        </Button>
      </div>
      {servings !== recipe.servings && <p className="nx-hint">{copy.detail.scaled}</p>}

      <div className="cookbook__times">
        {recipe.prepMinutes !== null && (
          <span>
            {copy.detail.prep}: {formatTime(recipe.prepMinutes)}
          </span>
        )}
        {recipe.cookMinutes !== null && (
          <span>
            {copy.detail.cook}: {formatTime(recipe.cookMinutes)}
          </span>
        )}
      </div>

      <section className="cookbook__section cookbook__photo">
        <h3 className="cookbook__section-title">{copy.detail.photo}</h3>
        {recipe.photo === null ? (
          <>
            <p className="nx-hint">{copy.detail.photoNone}</p>
            <Button size="sm" onClick={onPhoto}>
              {copy.detail.photoAdd}
            </Button>
          </>
        ) : (
          <>
            <img
              className="cookbook__photo-image"
              src={`nx-blob://${recipe.photo.sha256}`}
                // The dish, not the word for a file: the picture is what the
                // recipe looks like, and a reader who cannot see it is owed
                // that rather than „Photo".
                alt={recipe.title}
            />
            <Button size="sm" variant="quiet" onClick={onRemovePhoto}>
              {copy.detail.photoRemove}
            </Button>
          </>
        )}
      </section>

      <section className="cookbook__section">
        <h3 className="cookbook__section-title">{copy.detail.ingredients}</h3>
        {recipe.ingredients.length === 0 ? (
          <p className="nx-hint">{copy.detail.noIngredients}</p>
        ) : (
          <ul className="cookbook__ingredients">
            {recipe.ingredients.map((line) => (
              <li key={line.id}>{lineText(line, factor)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="cookbook__section">
        <h3 className="cookbook__section-title">{copy.detail.steps}</h3>
        {recipe.steps.length === 0 ? (
          <p className="nx-hint">{copy.detail.noSteps}</p>
        ) : (
          <ol className="cookbook__steps">
            {recipe.steps.map((step) => (
              <li key={step.id}>
                {step.text}
                {step.timerMinutes !== null && (
                  <span className="cookbook__step-timer"> {formatTime(step.timerMinutes)}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {recipe.notes.trim().length > 0 && (
        <section className="cookbook__section">
          <h3 className="cookbook__section-title">{copy.detail.notes}</h3>
          <p className="nx-hint">{recipe.notes}</p>
        </section>
      )}

      <section className="cookbook__section">
        <h3 className="cookbook__section-title">{copy.detail.source}</h3>
        {recipe.licence === null ? (
          <p className="nx-hint">{copy.detail.own}</p>
        ) : (
          <dl className="cookbook__licence">
            <dt>{copy.detail.source}</dt>
            <dd>
              <a href={recipe.licence.url} target="_blank" rel="noreferrer">
                {recipe.licence.title}
              </a>
            </dd>
            <dt>{copy.detail.licence}</dt>
            <dd>{recipe.licence.licenceId}</dd>
            <dt>{copy.detail.attribution}</dt>
            <dd>{recipe.licence.attribution}</dd>
          </dl>
        )}
      </section>

      <div className="cookbook__actions">
        <Button variant="primary" onClick={onCook}>
          {copy.list.cook}
        </Button>
        <Button onClick={onEdit}>{copy.list.edit}</Button>
        <Button variant="danger" onClick={onDelete}>
          {copy.list.remove}
        </Button>
      </div>
    </Card>
  );
}

// --- Kuvanje ------------------------------------------------------------------

/**
 * The cooking view: one step, large, with the recipe's amounts beside it.
 *
 * It asks main to keep the display awake for exactly as long as it is mounted —
 * requested on mount and released on unmount, so closing the view (or the
 * window) cannot leave a blocker running behind a screen nobody is reading.
 */
function CookingView({
  recipe,
  servings,
  profileId,
  onClose,
}: {
  recipe: RecipeView;
  servings: number;
  profileId: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const factor = factorFor(recipe, servings);
  const steps = recipe.steps;
  const total = steps.length;

  useEffect(() => {
    const api = window.nexus.modules.cookbook;
    void api.setAwake({ profileId, awake: true }).catch((error: unknown) => {
      console.error("Nexus: the screen could not be kept awake:", error);
    });
    return () => {
      void api.setAwake({ profileId, awake: false }).catch((error: unknown) => {
        console.error("Nexus: the screen could not be released:", error);
      });
    };
  }, [profileId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => stepIndex(current, 1, total));
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => stepIndex(current, -1, total));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, total]);

  const step = steps[index];

  return (
    <div className="cookbook cookbook--cooking">
      <PageHeader title={copy.cooking.title} subtitle={recipe.title} sigil="cookbook" />
      <p className="nx-hint">{copy.cooking.awake}</p>
      {step === undefined ? (
        <p className="cookbook__cooking-step">{copy.detail.noSteps}</p>
      ) : (
        <>
          <p className="cookbook__cooking-count">
            {copy.cooking.step} {numberFormat().format(index + 1)} {copy.cooking.of}{" "}
            {numberFormat().format(total)}
          </p>
          <p className="cookbook__cooking-step">{step.text}</p>
          {step.timerMinutes !== null && (
            <p className="cookbook__cooking-timer">
              {copy.cooking.timer}: {formatTime(step.timerMinutes)}
            </p>
          )}
        </>
      )}
      <div className="cookbook__actions">
        <Button
          disabled={index === 0}
          onClick={() => setIndex((current) => stepIndex(current, -1, total))}
        >
          {copy.cooking.previous}
        </Button>
        <Button
          variant="primary"
          disabled={index >= total - 1}
          onClick={() => setIndex((current) => stepIndex(current, 1, total))}
        >
          {copy.cooking.next}
        </Button>
        <Button onClick={onClose}>{copy.cooking.done}</Button>
      </div>
      <p className="nx-hint">{copy.cooking.keys}</p>
      <Card className="cookbook__card" title={copy.cooking.ingredients}>
        <ul className="cookbook__ingredients">
          {scaleLines(recipe.ingredients, recipe.servings, servings).map((line) => (
            <li key={line.id}>{lineText(line, factor)}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// --- Hranljive vrednosti ------------------------------------------------------

/**
 * The nutrition card: what one serving carries, what was left out, and the one
 * control the figures need — the link from an ingredient's NAME to a food.
 *
 * The link is the user's own answer and it is remembered per name, so a recipe
 * that says „mleveno meso" once needs no second answer. Every line the module
 * cannot weigh is named with its reason rather than dropped: a per-serving
 * figure that quietly omitted an ingredient is the one wrong number this surface
 * must never show.
 */
function Nutrition({
  profileId,
  recipe,
  matches,
  onChanged,
}: {
  profileId: string;
  recipe: RecipeView;
  matches: readonly { name: string; foodId: string; foodName: string }[];
  onChanged: (id: string) => void;
}) {
  const [nutrition, setNutrition] = useState<NutritionView | null>(null);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<readonly FoodSuggestionView[]>([]);
  const [grams, setGrams] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNutrition(await window.nexus.modules.cookbook.nutrition({ profileId, id: recipe.id }));
      setFailed(false);
    } catch (failure) {
      setFailed(true);
      console.error("Nexus: the nutrition could not be computed:", failure);
    }
  }, [profileId, recipe.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setSuggestions([]);
      return;
    }
    let active = true;
    void window.nexus.modules.cookbook
      .suggestFoods({ profileId, query: text })
      .then((found) => {
        if (active) setSuggestions(found);
      })
      .catch((failure: unknown) => {
        console.error("Nexus: the food suggestions could not be read:", failure);
      });
    return () => {
      active = false;
    };
  }, [profileId, query]);

  const names = useMemo(
    () => [...new Set(recipe.ingredients.map((line) => line.name))],
    [recipe.ingredients],
  );

  async function link(name: string, foodId: string): Promise<void> {
    const gramsValue = grams.trim() === "" ? null : Number(grams.replace(",", "."));
    try {
      await window.nexus.modules.cookbook.setFoodMatch({
        profileId,
        name,
        foodId,
        gramsPerUnit: gramsValue !== null && Number.isFinite(gramsValue) ? gramsValue : null,
      });
      setQuery("");
      setSuggestions([]);
      setGrams("");
      setProblem(null);
      onChanged(recipe.id);
      await load();
    } catch (failure) {
      setProblem(copy.errors.mutate);
      console.error("Nexus: the ingredient link was not saved:", failure);
    }
  }

  if (failed) return <p className="cookbook__error">{copy.errors.recipe}</p>;

  return (
    <Card className="cookbook__card" title={copy.nutrition.title}>
      {nutrition === null ? (
        <p className="nx-hint">{copy.page.loading}</p>
      ) : nutrition.noFoodsPack ? (
        <EmptyState
          variant="inline"
          title={copy.nutrition.noPack}
          description={copy.nutrition.noPackBody}
        />
      ) : (
        <>
          <p className="nx-hint">{copy.nutrition.perServing}</p>
          <dl className="cookbook__nutrition">
            <dt>{copy.nutrition.kcal}</dt>
            <dd>{round(nutrition.perServing.kcal)} {copy.nutrition.kcalUnit}</dd>
            <dt>{copy.nutrition.protein}</dt>
            <dd>{round(nutrition.perServing.protein)} {copy.nutrition.gram}</dd>
            <dt>{copy.nutrition.carbs}</dt>
            <dd>{round(nutrition.perServing.carbs)} {copy.nutrition.gram}</dd>
            <dt>{copy.nutrition.fat}</dt>
            <dd>{round(nutrition.perServing.fat)} {copy.nutrition.gram}</dd>
            <dt>{copy.nutrition.fibre}</dt>
            <dd>{round(nutrition.perServing.fiber)} {copy.nutrition.gram}</dd>
            <dt>{copy.nutrition.sugar}</dt>
            <dd>{round(nutrition.perServing.sugar)} {copy.nutrition.gram}</dd>
            <dt>{copy.nutrition.salt}</dt>
            <dd>{round(nutrition.perServing.sodiumMg)} {copy.nutrition.milligram}</dd>
          </dl>
          {nutrition.uncounted.length > 0 && (
            <section className="cookbook__section">
              <h3 className="cookbook__section-title">{copy.nutrition.uncounted}</h3>
              <ul className="cookbook__ingredients">
                {nutrition.uncounted.map((line) => (
                  <li key={line.name}>
                    {line.name} — {uncountedReason(line.reason)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="cookbook__section">
        <h3 className="cookbook__section-title">{copy.nutrition.linkLabel}</h3>
        <Select
          label={copy.nutrition.linkLabel}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">{copy.nutrition.linkSearch}</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <TextField
          label={copy.nutrition.linkSearch}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <TextField
          label={copy.nutrition.gramsPerUnit}
          inputMode="decimal"
          value={grams}
          onChange={(event) => setGrams(event.target.value)}
        />
        <p className="nx-hint">{copy.nutrition.gramsHint}</p>
        {query.trim().length >= 2 && suggestions.length === 0 && (
          <p className="nx-hint">{copy.nutrition.suggestionNone}</p>
        )}
        {problem !== null && <p className="cookbook__error">{problem}</p>}
        <div className="cookbook__suggestions">
          {suggestions.map((suggestion) => (
            <Button
              key={`${suggestion.packId}:${suggestion.id}`}
              size="sm"
              disabled={target === ""}
              onClick={() => void link(target, suggestion.id)}
            >
              {target === "" ? copy.nutrition.link : `${copy.nutrition.link}: ${suggestion.name}`}
            </Button>
          ))}
        </div>
        {matches.length > 0 && (
          <ul className="cookbook__ingredients">
            {matches.map((match) => (
              <li key={match.name}>
                {match.name} — {match.foodName}{" "}
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() =>
                    void window.nexus.modules.cookbook
                      .clearFoodMatch({ profileId, name: match.name })
                      .then(async () => {
                        onChanged(recipe.id);
                        await load();
                      })
                  }
                >
                  {copy.nutrition.unlink}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );

  function uncountedReason(reason: NutritionView["uncounted"][number]["reason"]): string {
    switch (reason) {
      case "unlinked":
        return copy.nutrition.unlinked;
      case "unknown-food":
        return copy.nutrition.unknownFood;
      case "unknown-grams":
        return copy.nutrition.unknownGrams;
    }
  }
}

/** One decimal place, through `Intl` — a per-serving figure is a reading, not a measurement. */
function round(value: number): string {
  return numberFormat({ maximumFractionDigits: 1 }).format(value);
}

// --- Kuhinje sveta ------------------------------------------------------------

function Packs({ profileId, onSaved }: { profileId: string; onSaved: (id: string) => void }) {
  const [packs, setPacks] = useState<readonly RecipesPackView[] | null>(null);
  const [packId, setPackId] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly PackRecipeSummaryView[]>([]);
  const [opened, setOpened] = useState<PackRecipeView | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void window.nexus.modules.cookbook
      .listRecipesPacks({ profileId })
      .then((found) => {
        if (!active) return;
        setPacks(found);
        setPackId(found[0]?.id ?? "");
      })
      .catch((failure: unknown) => {
        setFailed(true);
        console.error("Nexus: the recipe packs could not be listed:", failure);
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  const browse = useCallback(
    async (id: string, text: string): Promise<void> => {
      setOpened(null);
      setSaved(false);
      if (id === "") {
        setHits([]);
        return;
      }
      try {
        setHits(await window.nexus.modules.cookbook.browsePack({ profileId, packId: id, query: text }));
      } catch (failure) {
        console.error("Nexus: a recipe pack could not be browsed:", failure);
      }
    },
    [profileId],
  );

  useEffect(() => {
    if (packId !== "") void browse(packId, query);
  }, [browse, packId, query]);

  if (failed) return <p className="cookbook__error">{copy.errors.load}</p>;

  return (
    <Card className="cookbook__card" title={copy.packs.title}>
      {packs === null ? (
        <p className="nx-hint">{copy.page.loading}</p>
      ) : packs.length === 0 ? (
        <EmptyState variant="inline" title={copy.packs.empty} description={copy.packs.emptyBody} />
      ) : (
        <>
          <Select
            label={copy.packs.pack}
            value={packId}
            onChange={(event) => setPackId(event.target.value)}
          >
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {declaredText(pack.title)} ({numberFormat().format(pack.recipeCount)}{" "}
                {copy.packs.count})
              </option>
            ))}
          </Select>
          <TextField
            label={copy.packs.query}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {hits.length === 0 ? (
            <p className="nx-hint">{copy.packs.noResults}</p>
          ) : (
            <div className="cookbook__list">
              {hits.map((recipe) => (
                <ListRow
                  key={recipe.id}
                  leading={<Icon name="external" />}
                  trailing={
                    <span className="cookbook__row-actions">
                      <Button
                        size="sm"
                        onClick={() =>
                          void window.nexus.modules.cookbook
                            .getPackRecipe({ profileId, packId, id: recipe.id })
                            .then(setOpened)
                            .catch((failure: unknown) => {
                              console.error("Nexus: a pack recipe could not be read:", failure);
                            })
                        }
                      >
                        {copy.packs.open}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void window.nexus.modules.cookbook
                            .savePackRecipe({ profileId, packId, id: recipe.id })
                            .then((answer) => {
                              setSaved(true);
                              onSaved(answer.recipeId);
                            })
                            .catch((failure: unknown) => {
                              console.error("Nexus: a pack recipe could not be saved:", failure);
                            })
                        }
                      >
                        {copy.packs.save}
                      </Button>
                    </span>
                  }
                >
                  <span className="cookbook__row-title" lang={recipe.language}>
                    {recipe.title}
                  </span>
                  <span className="cookbook__row-meta">
                    {copy.packs.servings}:{" "}
                    {recipe.servings === null
                      ? copy.packs.notStated
                      : numberFormat().format(recipe.servings)}
                  </span>
                </ListRow>
              ))}
            </div>
          )}
          {saved && <p className="nx-hint">{copy.packs.saved}</p>}
          {opened !== null && (
            <section className="cookbook__section">
              <div className="cookbook__detail-head">
                <h3 className="cookbook__section-title" lang={opened.language}>
                  {opened.title}
                </h3>
                <Button size="sm" variant="quiet" onClick={() => setOpened(null)}>
                  {copy.packs.close}
                </Button>
              </div>
              <ul className="cookbook__ingredients">
                {opened.ingredients.map((line, index) => (
                  <li key={`${opened.id}-${String(index)}`}>{line}</li>
                ))}
              </ul>
              <ol className="cookbook__steps">
                {opened.steps.map((step, index) => (
                  <li key={`${opened.id}-s${String(index)}`}>{step}</li>
                ))}
              </ol>
              <dl className="cookbook__licence">
                <dt>{copy.packs.source}</dt>
                <dd>
                  <a href={opened.source.url} target="_blank" rel="noreferrer">
                    {opened.source.title}
                  </a>
                </dd>
                <dt>{copy.detail.licence}</dt>
                <dd>{opened.source.licence}</dd>
                <dt>{copy.detail.attribution}</dt>
                <dd>{opened.source.attribution}</dd>
              </dl>
            </section>
          )}
        </>
      )}
    </Card>
  );
}

// --- Izmena -------------------------------------------------------------------

/**
 * The editor, as a dialog: one form for a new recipe and for an existing one.
 *
 * **Ingredients are typed as LINES and parsed on save**, by the module's own
 * `parseIngredientLine` — the same function the page runs on the way out and the
 * column stores beside the raw text. A line whose parse would leave no name is
 * refused under the box rather than saved as an ingredient called nothing.
 *
 * **The links survive a re-edit.** A food link belongs to the ingredient's NAME,
 * so saving after a text change carries each line's link and weight across by
 * folded name: retyping „2 kašike" as „3 kašike" must not cost the user the food
 * they chose.
 */
function RecipeEditor({
  profileId,
  recipe,
  onClose,
  onSaved,
}: {
  profileId: string;
  recipe: RecipeView | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });
  const [title, setTitle] = useState(recipe?.title ?? "");
  const [course, setCourse] = useState<CookbookCourse>(recipe?.course ?? "main");
  const [servings, setServings] = useState(String(recipe?.servings ?? 4));
  const [prep, setPrep] = useState(recipe?.prepMinutes === null || recipe?.prepMinutes === undefined ? "" : String(recipe.prepMinutes));
  const [cook, setCook] = useState(recipe?.cookMinutes === null || recipe?.cookMinutes === undefined ? "" : String(recipe.cookMinutes));
  const [ingredients, setIngredients] = useState(
    (recipe?.ingredients ?? [])
      .map((line) => (line.rawText.trim() === "" ? "" : line.rawText))
      .filter((text) => text !== "")
      .join("\n"),
  );
  const [steps, setSteps] = useState(
    (recipe?.steps ?? []).map((step) => ({
      text: step.text,
      timerMinutes:
        step.timerMinutes === null ? "" : String(step.timerMinutes),
    })),
  );
  const [tags, setTags] = useState((recipe?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(recipe?.notes ?? "");
  const [problem, setProblem] = useState<"name" | "ingredients" | "steps" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  function drafts(): RecipeIngredientDraft[] | null {
    const previous = new Map(
      (recipe?.ingredients ?? []).map((line) => [foldSearchText(line.name), line] as const),
    );
    const lines: RecipeIngredientDraft[] = [];
    for (const raw of ingredients.split("\n")) {
      const text = raw.trim();
      if (text === "") continue;
      const parsed = parseIngredientLine(text);
      if (parsed === null || parsed.name.trim() === "") return null;
      const carried = previous.get(foldSearchText(parsed.name));
      lines.push({
        rawText: text,
        quantity: parsed.quantity,
        quantityMax: parsed.quantityMax,
        unit: parsed.unit,
        name: parsed.name,
        preparation: parsed.preparation,
        group: parsed.group,
        foodRef: carried?.foodRef ?? null,
        gramsPerUnit: carried?.gramsPerUnit ?? null,
      });
    }
    return lines;
  }

  async function save(): Promise<void> {
    if (title.trim() === "") {
      setProblem("name");
      return;
    }
    const lines = drafts();
    if (lines === null) {
      setProblem("ingredients");
      return;
    }
    if (steps.some((step) => step.text.trim() === "")) {
      setProblem("steps");
      return;
    }
    const draft: RecipeDraft = {
      title: title.trim(),
      description: recipe?.description ?? "",
      cuisine: recipe?.cuisine ?? "",
      course,
      servings: clampServings(Number(servings)),
      prepMinutes: minuteOf(prep),
      cookMinutes: minuteOf(cook),
      ingredients: lines,
      steps: steps.map((step) => ({ text: step.text.trim(), timerMinutes: minuteOf(step.timerMinutes) })),
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
      rating: recipe?.rating ?? null,
      notes: notes,
      favourite: recipe?.favourite ?? false,
    };
    setBusy(true);
    try {
      if (recipe === null) {
        const answer = await window.nexus.modules.cookbook.create({ profileId, recipe: draft });
        onSaved(answer.recipeId);
      } else {
        await window.nexus.modules.cookbook.update({ profileId, id: recipe.id, patch: draft });
        onSaved(recipe.id);
      }
    } catch (failure) {
      setProblem("name");
      console.error("Nexus: the recipe was not saved:", failure);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="cookbook__overlay">
      <div className="cookbook__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="cookbook__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="cookbook__panel-title">
          {recipe === null ? copy.editor.newTitle : copy.editor.title}
        </h2>
        <TextField
          label={copy.editor.name}
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
        />
        {problem === "name" && <p className="cookbook__error">{copy.editor.errorName}</p>}
        <Select
          label={copy.editor.course}
          value={course}
          onChange={(event) => setCourse(event.target.value as CookbookCourse)}
        >
          {COOKBOOK_COURSES.map((value) => (
            <option key={value} value={value}>
              {courseLabel(value)}
            </option>
          ))}
        </Select>
        <div className="cookbook__triple">
          <TextField
            label={copy.editor.servings}
            inputMode="numeric"
            value={servings}
            onChange={(event) => setServings(event.target.value)}
          />
          <TextField
            label={copy.editor.prep}
            inputMode="numeric"
            value={prep}
            onChange={(event) => setPrep(event.target.value)}
          />
          <TextField
            label={copy.editor.cook}
            inputMode="numeric"
            value={cook}
            onChange={(event) => setCook(event.target.value)}
          />
        </div>
        <TextArea
          label={copy.editor.ingredients}
          rows={6}
          value={ingredients}
          onChange={(event) => setIngredients(event.target.value)}
        />
        <p className="nx-hint">{copy.editor.ingredientsHint}</p>
        {problem === "ingredients" && (
          <p className="cookbook__error">{copy.editor.errorIngredients}</p>
        )}
        <div className="cookbook__step-editor">
          <h3 className="cookbook__section-title">{copy.editor.steps}</h3>
          {steps.map((step, index) => (
            <div key={index} className="cookbook__step-row">
              <TextField
                label={`${copy.cooking.step} ${numberFormat().format(index + 1)}`}
                value={step.text}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((entry, at) =>
                      at === index ? { ...entry, text: event.target.value } : entry,
                    ),
                  )
                }
              />
              <TextField
                label={copy.editor.stepTimer}
                className="cookbook__step-minutes"
                inputMode="numeric"
                value={step.timerMinutes}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((entry, at) =>
                      at === index ? { ...entry, timerMinutes: event.target.value } : entry,
                    ),
                  )
                }
              />
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setSteps((current) => current.filter((_entry, at) => at !== index))}
              >
                <Icon name="trash" />
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setSteps((current) => [...current, { text: "", timerMinutes: "" }])}>
            {copy.list.add}
          </Button>
        </div>
        {problem === "steps" && <p className="cookbook__error">{copy.editor.errorSteps}</p>}
        <TextField
          label={copy.editor.tags}
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
        <TextArea
          label={copy.editor.notes}
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className="cookbook__actions">
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {copy.editor.save}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            {copy.editor.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A minutes field as a number the store holds, or null for an empty box. */
function minuteOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(10_080, Math.round(value));
}

// --- Potvrda brisanja ---------------------------------------------------------

/** The house confirmation, drawn with this module's own classes so the dialog needs no stylesheet it did not load. */
function ConfirmDelete({
  title,
  onConfirm,
  onCancel,
}: {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  return createPortal(
    <div className="cookbook__overlay">
      <div className="cookbook__backdrop" onClick={onCancel} />
      <div
        ref={panelRef}
        className="cookbook__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="cookbook__panel-title">
          {copy.confirm.title}
        </h2>
        <p className="cookbook__panel-name">„{title}“</p>
        <p className="nx-hint">{copy.confirm.question}</p>
        <div className="cookbook__actions">
          <Button variant="danger" onClick={onConfirm}>
            {copy.confirm.confirm}
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            {copy.confirm.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
