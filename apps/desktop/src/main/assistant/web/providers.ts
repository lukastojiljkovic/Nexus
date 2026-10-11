import type { AssistantLocale } from "@nexus/core";

import { inlineText } from "./extract.js";
import type { WebConfig } from "./gate.js";
import { WEB_LIMITS } from "./limits.js";

/**
 * THE THREE PROVIDERS, AND WHY THEY ARE THESE THREE (ADR-097).
 *
 * A provider is a REQUEST BUILDER and a RESPONSE PARSER, and nothing else: no
 * socket, no policy, no retry. Everything that decides whether a request may be
 * made at all lives in `gate.ts`/`target.ts`/`fetch.ts`, and everything a user
 * reads lives in `copy.ts`, which is what lets every request below be asserted
 * as an exact URL against a fixture.
 *
 *   1. **Wikipedia** is the default, because it needs nothing from the user:
 *      no account, no key, no instance, no configuration. It is also the one
 *      source whose licence and method agree with an offline-first app.
 *      Wikimedia's User-Agent policy is quoted in {@link WEB_USER_AGENT} and
 *      honoured by every request this module builds, not only Wikipedia's.
 *   2. **SearXNG** is whatever instance the user runs or trusts, and it is the
 *      answer for a user who wants general web results without an account
 *      anywhere. Its JSON API is documented; whether a given instance has it
 *      ENABLED is not, and the copy for a `403` says so in one sentence rather
 *      than leaving the user with a status code.
 *   3. **Brave Search** is the one that costs money and needs an account, so it
 *      runs only on a key the user pasted in, and that key is a secret this
 *      module never puts in a URL, a citation or a sentence (`secrets.ts`).
 *
 * WHAT IS NOT HERE, and the reasons are checked rather than assumed:
 *
 *   - **DuckDuckGo.** Its terms of service require authorization to use its
 *     services („We expect you to use our Services as authorized, or we may
 *     otherwise suspend access", https://duckduckgo.com/terms, last updated
 *     2025-07-01), and the instructions it publishes for machines disallow
 *     exactly what a search client needs:
 *     https://duckduckgo.com/robots.txt carries `Disallow: /html`,
 *     `Disallow: /lite` and `Disallow: /*?` with the comment „Block query
 *     strings on other pages; allow them at the root (covers SERP's ?q= and any
 *     other root-level params)" — there is no endpoint left that a query may be
 *     sent to. Fetching around a published instruction is what this product
 *     does not do, so DuckDuckGo is out on its own terms and not on taste.
 *   - **Google.** Its terms forbid „using automated means to access content
 *     from any of our services in violation of the machine-readable
 *     instructions on our web pages (for example, robots.txt files that
 *     disallow crawling, training, or other activities)"
 *     (https://policies.google.com/terms), and the instruction for the endpoint
 *     a search would need is published at https://www.google.com/robots.txt as
 *     `Disallow: /search`. A general web-search API is a paid product with its
 *     own terms, which is Brave's row above.
 *   - **A scraper of any engine's result page.** Beyond the two named above,
 *     this is the shape the product refuses in general: reading a page the
 *     assistant was asked to read is one thing, and automating somebody's
 *     search endpoint against their published rules is another.
 */

/** The providers `web.search` accepts, in the order the copy lists them. */
export const WEB_PROVIDER_IDS = ["wikipedia", "searxng", "brave"] as const;

export type WebProviderId = (typeof WEB_PROVIDER_IDS)[number];

/**
 * The User-Agent every request carries, and the policy it answers.
 *
 * Wikimedia's policy (https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy)
 * is one sentence long in the part that matters here: „Scripts should use an
 * informative User-Agent string with contact information, or they may be
 * blocked without notice." The generic format it asks for is „<client
 * name>/<version> (<contact information>)", so this string names the client,
 * the release it ships in, the project and a way to make contact. It is sent on
 * every request and not only Wikipedia's, because a request from this process
 * should be identifiable wherever it lands.
 */
export const WEB_USER_AGENT =
  "Nexus/1.5.0 (https://github.com/lukastojiljkovic/Nexus; luka.d.stojiljkovic@gmail.com)";

/** One search result, as every parser below produces it and the tools format it. */
export interface WebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/** What a provider asks the transport to do. `url` is already the full request URL. */
export interface WebSearchRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Why a provider could not build a request. Machine codes; `copy.ts` maps each. */
export type ProviderProblem =
  /** The query is empty, too long, or not a string. */
  | "query"
  /** `searxng` was asked for and no instance is configured. */
  | "not-configured"
  /** `brave` was asked for and no key is stored. */
  | "no-key";

export type ProviderOutcome =
  | { readonly ok: true; readonly request: WebSearchRequest; readonly parse: (body: string) => readonly WebSearchResult[] }
  | { readonly ok: false; readonly problem: ProviderProblem };

/** True when `value` is a provider this build knows. */
export function isWebProviderId(value: unknown): value is WebProviderId {
  return typeof value === "string" && (WEB_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * A query as it may be sent, or `null`.
 *
 * Whitespace is collapsed rather than rejected (a model that wraps a query over
 * two lines means one query), and the length cap is `limits.ts`'s. What is
 * refused is a query that is not a string at all and one that is empty once the
 * whitespace comes off, because both mean the model asked a question with no
 * question in it.
 */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const query = raw.replace(/\s+/g, " ").trim();
  if (query === "" || query.length > WEB_LIMITS.queryChars) return null;
  return query;
}

/** The bare host a request URL points at, for a confirm line that names where the query goes. */
export function requestHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The Wikipedia project a locale reads from: the app's two languages, one wiki each. */
function wikipediaHost(locale: AssistantLocale): string {
  return `${locale}.wikipedia.org`;
}

/**
 * A Wikipedia search, through `action=query&list=search`.
 *
 * `formatversion=2` is pinned rather than left to the default: in the default
 * (version 1) shape `query.search` is an OBJECT keyed by index and each entry
 * carries an `index`; in version 2 it is an ARRAY in rank order. The parser
 * below reads exactly one of the two, and pinning the version is what keeps
 * „read exactly one" true rather than lucky. A reply that is nonetheless in the
 * other shape parses to no results rather than to garbage.
 *
 * `srlimit` is the result cap, so the reply is no larger than what will be
 * shown. The page URL is the `?curid=` form: it is the id the API answered
 * with, it resolves on both scripts of the same wiki, and it does not depend on
 * the title's punctuation surviving a round trip.
 */
export function wikipediaSearchRequest(query: string, locale: AssistantLocale): WebSearchRequest {
  const url = new URL(`https://${wikipediaHost(locale)}/w/api.php`);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(WEB_LIMITS.searchResults));
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  return {
    url: url.toString(),
    headers: { accept: "application/json", "user-agent": WEB_USER_AGENT },
  };
}

/**
 * The `query.search[]` array of a Wikipedia search reply.
 *
 * A `snippet` is HTML with the matched words in `<span class="searchmatch">`,
 * so it is read through `inlineText`; an entry with no page id or no title is
 * dropped rather than guessed at, because the URL is what makes a result
 * readable at all and a made-up one would be a citation to nothing.
 *
 * `locale` is a PARAMETER and not module state: which wiki a reply came from is
 * the caller's business, and a mutable module-level default would make two
 * searches in two languages depend on which one ran first.
 */
export function parseWikipediaSearch(body: string, locale: AssistantLocale): readonly WebSearchResult[] {
  const parsed = parseJson(body);
  if (parsed === null || typeof parsed !== "object") return [];
  const query = (parsed as { query?: unknown }).query;
  if (typeof query !== "object" || query === null) return [];
  const search = (query as { search?: unknown }).search;
  if (!Array.isArray(search)) return [];
  const results: WebSearchResult[] = [];
  for (const entry of search) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { title?: unknown; pageid?: unknown; snippet?: unknown };
    const title = typeof record.title === "string" ? inlineText(record.title) : "";
    const pageId = typeof record.pageid === "number" && Number.isInteger(record.pageid) ? record.pageid : null;
    if (title === "" || pageId === null || pageId <= 0) continue;
    results.push({
      title,
      url: `https://${wikipediaHost(locale)}/?curid=${String(pageId)}`,
      snippet: typeof record.snippet === "string" ? inlineText(record.snippet) : "",
    });
    if (results.length >= WEB_LIMITS.searchResults) break;
  }
  return results;
}

/**
 * A SearXNG search against the instance the user configured.
 *
 * The documented call is `GET /search?q=…&format=json`
 * (https://docs.searxng.org/dev/search_api.html), and the same page says the
 * thing a user will actually meet: „Requesting an unset format will return a
 * 403 Forbidden error. Be aware that many public instances have these formats
 * disabled." A `403` is therefore reported as its own sentence (see
 * `copy.ts`) rather than as a generic failure.
 */
export function searxngSearchRequest(query: string, origin: string): WebSearchRequest {
  const url = new URL("/search", origin);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  return {
    url: url.toString(),
    headers: { accept: "application/json", "user-agent": WEB_USER_AGENT },
  };
}

/** The `results[]` array of a SearXNG JSON reply, and each row's `title`/`url`/`content`. */
export function parseSearxngSearch(body: string): readonly WebSearchResult[] {
  const parsed = parseJson(body);
  if (parsed === null || typeof parsed !== "object") return [];
  const results = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: WebSearchResult[] = [];
  for (const entry of results) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { title?: unknown; url?: unknown; content?: unknown };
    const url = httpsUrlOrNull(record.url);
    if (url === null) continue;
    out.push({
      title: typeof record.title === "string" ? inlineText(record.title) : "",
      url,
      snippet: typeof record.content === "string" ? inlineText(record.content) : "",
    });
    if (out.length >= WEB_LIMITS.searchResults) break;
  }
  return out;
}

/**
 * A Brave Search web query, with the user's own key.
 *
 * The key travels in `X-Subscription-Token` and NEVER in the query string:
 * <https://api-dashboard.search.brave.com/app/documentation/web-search/get-started>
 * documents exactly that header, and a key in a URL is a key in every access
 * log, every error message and every citation built from the request. `count`
 * is the result cap, which the same page bounds at 20.
 */
export function braveSearchRequest(query: string, apiKey: string, locale: AssistantLocale): WebSearchRequest {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(WEB_LIMITS.searchResults));
  // The reply's own language hints, from the language the user is writing in.
  url.searchParams.set("search_lang", locale);
  return {
    url: url.toString(),
    headers: {
      accept: "application/json",
      "user-agent": WEB_USER_AGENT,
      "x-subscription-token": apiKey,
    },
  };
}

/** The `web.results[]` array of a Brave web-search reply. */
export function parseBraveSearch(body: string): readonly WebSearchResult[] {
  const parsed = parseJson(body);
  if (parsed === null || typeof parsed !== "object") return [];
  const web = (parsed as { web?: unknown }).web;
  if (typeof web !== "object" || web === null) return [];
  const results = (web as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: WebSearchResult[] = [];
  for (const entry of results) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { title?: unknown; url?: unknown; description?: unknown };
    const url = httpsUrlOrNull(record.url);
    if (url === null) continue;
    out.push({
      title: typeof record.title === "string" ? inlineText(record.title) : "",
      url,
      snippet: typeof record.description === "string" ? inlineText(record.description) : "",
    });
    if (out.length >= WEB_LIMITS.searchResults) break;
  }
  return out;
}

/**
 * The provider's plan for one query, or the reason it has none.
 *
 * The key is passed IN and never read here: this module stays a pure pair of
 * functions per provider, and the one place a secret is touched is the service
 * that also builds the tool result. „The parser is pure" is what makes the
 * fixtures below worth writing.
 */
export function buildSearchPlan(
  provider: WebProviderId,
  query: unknown,
  locale: AssistantLocale,
  config: WebConfig,
  apiKey: string | null,
): ProviderOutcome {
  const normalized = normalizeQuery(query);
  if (normalized === null) return { ok: false, problem: "query" };
  if (provider === "wikipedia") {
    return {
      ok: true,
      request: wikipediaSearchRequest(normalized, locale),
      parse: (body) => parseWikipediaSearch(body, locale),
    };
  }
  if (provider === "searxng") {
    if (config.searxng === null) return { ok: false, problem: "not-configured" };
    return { ok: true, request: searxngSearchRequest(normalized, config.searxng), parse: parseSearxngSearch };
  }
  if (apiKey === null) return { ok: false, problem: "no-key" };
  return { ok: true, request: braveSearchRequest(normalized, apiKey, locale), parse: parseBraveSearch };
}

/**
 * An absolute https URL, or `null`.
 *
 * A result this process could not open is not a result: `web.read` accepts
 * https only, so an `http:` link would be offered to the model, chosen, and
 * then refused - and the refusal would be the only thing that happened. The
 * filter is silent, which is why the reason is written down here.
 */
function httpsUrlOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * `JSON.parse`, or `null`.
 *
 * A reply that is not JSON is not an error the user caused, and it is not
 * thrown at them either: the copy for a search with no results is what they
 * read, and the raw body never reaches the model.
 */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
