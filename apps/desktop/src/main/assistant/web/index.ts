import type {
  AssistantLocale,
  Citation,
  Tool,
  ToolContext,
  ToolResult,
  WebService,
} from "@nexus/core";

import type { NetworkMode } from "../../net/offline.js";
import { webCitation } from "./citation.js";
import {
  BAD_ARGS,
  confirmRead,
  confirmSearch,
  DATA_LABEL,
  EMPTY_PAGE,
  MODE_BLOCKED,
  NO_RESULTS,
  OFF,
  pageHeading,
  problemText,
  REFUSED,
  searchHeading,
  text,
  TOOL_READ_DESCRIPTION,
  TOOL_SEARCH_DESCRIPTION,
  truncatedNote,
  type ProblemDetail,
} from "./copy.js";
import { extractReadable } from "./extract.js";
import { createWebFetcher, type WebFetcher, type WebHttp } from "./fetch.js";
import { modeAllowsWebSearch, readWebConfig, webSearchActive, type WebConfig } from "./gate.js";
import { WEB_LIMITS } from "./limits.js";
import {
  buildSearchPlan,
  isWebProviderId,
  requestHost,
  WEB_PROVIDER_IDS,
  WEB_USER_AGENT,
  type WebProviderId,
  type WebSearchResult,
} from "./providers.js";
import type { WebSecrets } from "./secrets.js";
import { vetUrlShape, type AddressResolver } from "./target.js";
import { fenceUntrusted } from "./untrusted.js";

/**
 * THE WEB SERVICE: TWO TOOLS, AND THE WHOLE GATE IN FRONT OF THEM (ADR-097).
 *
 * `createWebService` is the factory the contract names (`web/index.ts`), and it
 * returns exactly `WebService` - `tools(): readonly Tool[]` - so the module that
 * composes the assistant wires it like any other part. Everything either tool
 * can do is in the seven files beside this one, and this file is the sequence:
 *
 *   1. **Validate the call.** A tool's `arguments` is `unknown` until it is
 *      read, and the model is not a trusted caller: `asSearchArgs`/`asReadArgs`
 *      below are the whole of the check, and a call that fails it ends as a
 *      sentence the model reads rather than as a throw.
 *   2. **Ask the gate.** `webSearchActive(mode, config)` is the switch AND the
 *      mode, read from disk at THIS moment (`gate.ts` records why this one is
 *      live where `network.json` is not). Off means no confirmation, no DNS
 *      lookup and no request - the user is asked to approve nothing.
 *   3. **Ask the user.** Both tools are `effect: "network"`, so each call goes
 *      through `ToolContext.confirm` with a one-line summary that names the
 *      host and the query (or the whole URL). A refusal is a normal result:
 *      `ok: false`, one sentence, and no request.
 *   4. **Fetch, vetting every hop** (`fetch.ts`), **extract** (`extract.ts`) and
 *      **hand over fenced, labelled data** (`untrusted.ts`) with citations to
 *      the pages it came from.
 *
 * WHAT THIS FILE DOES NOT DO, and the decision behind each:
 *
 *   - **No „allow for this conversation".** The contract's `ConfirmRequest` has
 *     no field for a remembered answer and `ToolContext.confirm` takes no
 *     conversation identity, so a service that offered one would be inventing a
 *     seam the module does not have. ADR-097 records the decision and where it
 *     belongs: the page, which is the only place that knows what a conversation
 *     is, and the next wave.
 *   - **No cache.** A fetched page is not stored anywhere: not in the profile
 *     database, not in a temporary file. The answer is built from what the
 *     request returned and nothing survives it, which is also why „user data
 *     never leaves" needs no exception here - what this feature sends is a
 *     query the user approved, and what it keeps is nothing.
 *   - **No external link.** A URL is text with its host named, because this is
 *     what the MODEL reads: a citation in an answer is not a control, and the
 *     chat page is where a link is drawn (`ExternalLink`, ADR-107). Opening an
 *     address is the user's own browser's job and goes through the app's one
 *     door.
 */

export interface WebServiceDeps {
  /** `userData`: where `assistant-web.json` and the key blob live. */
  readonly userData: string;
  /** The mode this launch may ACT on - `activeNetworkMode` in main, never the stored file. */
  readonly mode: () => NetworkMode;
  /** `dns.lookup(…, { all: true })` in main; a table in tests. */
  readonly resolve: AddressResolver;
  /** The single socket in this feature: `createHttpsTransport()` in main. */
  readonly http: WebHttp;
  /** The Brave key: `createWebSecrets(userData, createSafeStorageCipher())` in main. */
  readonly secrets: WebSecrets;
}

/**
 * The schema the model sees, in English.
 *
 * Parameter descriptions are model-facing and not user-facing, so they are not
 * bilingual: the whole prompt is English, the model answers in the user's
 * language, and `ToolSpec.description` - the one field a people-facing list
 * might draw - is `AssistantText` and comes from `copy.ts`.
 *
 * The tables below carry NO type annotation, and that is a constraint of the
 * package rather than a style: `JsonSchema` as `@nexus/core`'s index exports it
 * is the WIDGETS schema (`contracts/widgets.ts` - `type`, `properties`,
 * `items`, `enum`, `required`), because a named export shadows the assistant
 * contract's `export type *`; annotating these tables with that name is refused
 * for `description` and `additionalProperties`, both of which a JSON Schema for
 * a model may carry and a widget's declaration may not. An object literal type
 * is assignable to the contract's `Readonly<Record<string, unknown>>` by
 * inference, which is how every part of the assistant is expected to write one.
 */
const SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "What to search the web for, in the user's own words.",
    },
    provider: {
      type: "string",
      enum: [...WEB_PROVIDER_IDS],
      description:
        "Where to search. `wikipedia` (the default) needs no account; `searxng` uses the instance " +
        "the user configured; `brave` uses the user's own API key and costs them money per query.",
    },
    language: {
      type: "string",
      enum: ["sr", "en"],
      description: "Which Wikipedia to search, when it differs from the language of the conversation.",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const READ_PARAMETERS = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "The absolute https URL of the page to read, usually one a previous search returned.",
    },
  },
  required: ["url"],
  additionalProperties: false,
};

/** A URL as long as a URL may be, and short enough that a request cannot be a payload. */
const MAX_URL_CHARS = 2048;

interface SearchArgs {
  readonly query: unknown;
  readonly provider: WebProviderId | null;
  readonly language: AssistantLocale | null;
  readonly malformed: boolean;
}

/**
 * A `web.search` call, read strictly where the schema is strict.
 *
 * An unknown EXTRA key is ignored rather than refused - models add a field
 * explaining themselves, and failing a search over one would be this service
 * being pedantic at the user's expense. A known key with the wrong type, or a
 * `provider`/`language` outside the enumerated set, is malformed: the query
 * would go somewhere the user did not approve, or nowhere at all, and the model
 * is told so in one sentence.
 */
function asSearchArgs(raw: unknown): SearchArgs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { query: null, provider: null, language: null, malformed: true };
  }
  const record = raw as Record<string, unknown>;
  const provider = record["provider"];
  const language = record["language"];
  const malformed =
    (provider !== undefined && !isWebProviderId(provider)) ||
    (language !== undefined && language !== "sr" && language !== "en");
  return {
    query: record["query"],
    provider: isWebProviderId(provider) ? provider : null,
    language: language === "sr" || language === "en" ? language : null,
    malformed,
  };
}

/** A `web.read` call's URL, or `null` when it is not one. */
function asReadArgs(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const url = (raw as Record<string, unknown>)["url"];
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_CHARS) return null;
  return trimmed;
}

/** One refusal: a sentence, `ok: false`, no request made. */
function refusal(content: string): ToolResult {
  return { ok: false, content };
}

/** The reason a call never left the machine: the switch, or the mode. */
function gateText(locale: AssistantLocale, mode: NetworkMode, config: WebConfig): string | null {
  if (webSearchActive(mode, config)) return null;
  // Two different sentences, because the two causes are answered differently: a
  // user who has the switch off needs to find the setting, and a user whose mode
  // is „Offline only" has to change the mode and restart.
  return config.enabled && !modeAllowsWebSearch(mode)
    ? text(locale, MODE_BLOCKED)
    : text(locale, OFF);
}

/** One line per result - position, title, URL, snippet - under the query they answer. */
function formatResults(locale: AssistantLocale, query: string, results: readonly WebSearchResult[]): string {
  const lines = results.map((result, index) => {
    const position = index + 1;
    const snippet = result.snippet === "" ? [] : [result.snippet];
    // The URL is plain text on its own line: it is what the model cites and what
    // the user copies, and the chat page is where a link is drawn (ADR-107).
    return [`${String(position)}. ${result.title}`, `   ${result.url}`, ...snippet.map((line) => `   ${line}`)].join("\n");
  });
  return [searchHeading(locale, query), ...lines].join("\n");
}

/** A citation for a search result: Wikipedia is `wiki`, everything else is the local `web` kind. */
function resultCitation(provider: WebProviderId, result: WebSearchResult): Citation {
  return webCitation(provider === "wikipedia" ? "wiki" : "web", result.url, result.title);
}

/** Where a problem came from, for `problemText`: one HTTP status and one provider, or neither. */
function detailFor(provider: WebProviderId | null, status: number | null): ProblemDetail {
  return { status, provider };
}

export function createWebService(deps: WebServiceDeps): WebService {
  const fetcher: WebFetcher = createWebFetcher({
    mode: deps.mode,
    config: () => readWebConfig(deps.userData),
    resolve: deps.resolve,
    http: deps.http,
  });

  const search: Tool = {
    name: "web.search",
    description: TOOL_SEARCH_DESCRIPTION,
    parameters: SEARCH_PARAMETERS,
    effect: "network",
    async run(args: unknown, context: ToolContext): Promise<ToolResult> {
      const call = asSearchArgs(args);
      // Two different refusals, because they are two different mistakes: a CALL
      // this service cannot read (a `provider` outside the enumerated set, a
      // `language` the app does not speak, arguments that are not an object) and
      // a call whose QUERY is unusable. The model reads one sentence either way,
      // and the sentence names the thing that was wrong.
      if (call.malformed) return refusal(text(context.locale, BAD_ARGS));

      const config = readWebConfig(deps.userData);
      const blocked = gateText(context.locale, deps.mode(), config);
      if (blocked !== null) return refusal(blocked);

      const provider: WebProviderId = call.provider ?? "wikipedia";
      const locale: AssistantLocale = call.language ?? context.locale;
      const apiKey = provider === "brave" ? deps.secrets.apiKey("brave") : null;
      const plan = buildSearchPlan(provider, call.query, locale, config, apiKey);
      if (!plan.ok) return refusal(problemText(plan.problem, context.locale, detailFor(provider, null)));

      // The shape check BEFORE the dialog: a request the gate refuses on its
      // face is a request the user is not asked to approve.
      const shaped = vetUrlShape(plan.request.url, deps.mode(), config);
      if (!shaped.ok) return refusal(problemText(shaped.problem, context.locale, detailFor(provider, null)));

      const host = requestHost(plan.request.url);
      const approved = await context.confirm({
        tool: "web.search",
        summary: confirmSearch(context.locale, String(call.query), host),
        effect: "network",
      });
      if (!approved) return refusal(text(context.locale, REFUSED));

      const fetched = await fetcher.fetchText(plan.request.url, {
        headers: plan.request.headers,
        signal: context.signal,
        bytes: WEB_LIMITS.searchBytes,
        timeoutMs: WEB_LIMITS.searchTimeoutMs,
      });
      if (!fetched.ok) {
        return refusal(problemText(fetched.problem, context.locale, detailFor(provider, fetched.status)));
      }

      const results = plan.parse(fetched.text);
      if (results.length === 0) {
        return { ok: true, content: text(context.locale, NO_RESULTS) };
      }
      const body = formatResults(context.locale, String(call.query), results);
      return {
        ok: true,
        content: `${text(context.locale, DATA_LABEL)}\n${fenceUntrusted("web.search", body)}`,
        citations: results.map((result) => resultCitation(provider, result)),
      };
    },
  };

  const read: Tool = {
    name: "web.read",
    description: TOOL_READ_DESCRIPTION,
    parameters: READ_PARAMETERS,
    effect: "network",
    async run(args: unknown, context: ToolContext): Promise<ToolResult> {
      const url = asReadArgs(args);
      if (url === null) return refusal(text(context.locale, BAD_ARGS));

      const config = readWebConfig(deps.userData);
      const blocked = gateText(context.locale, deps.mode(), config);
      if (blocked !== null) return refusal(blocked);

      const shaped = vetUrlShape(url, deps.mode(), config);
      if (!shaped.ok) return refusal(problemText(shaped.problem, context.locale, detailFor(null, null)));

      const approved = await context.confirm({
        tool: "web.read",
        summary: confirmRead(context.locale, url),
        effect: "network",
      });
      if (!approved) return refusal(text(context.locale, REFUSED));

      const fetched = await fetcher.fetchText(url, {
        headers: { accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5", "user-agent": WEB_USER_AGENT },
        signal: context.signal,
        bytes: WEB_LIMITS.readBytes,
        timeoutMs: WEB_LIMITS.readTimeoutMs,
      });
      if (!fetched.ok) return refusal(problemText(fetched.problem, context.locale, detailFor(null, fetched.status)));

      const page = extractReadable(fetched.text);
      if (page.text === "") return refusal(text(context.locale, EMPTY_PAGE));

      const clipped = page.text.length > WEB_LIMITS.readChars;
      const body = clipped ? page.text.slice(0, WEB_LIMITS.readChars) : page.text;
      const heading = pageHeading(context.locale, fetched.url);
      const note = clipped ? `\n${truncatedNote(context.locale, WEB_LIMITS.readChars)}` : "";
      return {
        ok: true,
        content: `${text(context.locale, DATA_LABEL)}\n${fenceUntrusted("web.read", `${heading}\n${body}${note}`)}`,
        citations: [webCitation("web", fetched.url, page.title)],
      };
    },
  };

  return { tools: () => [search, read] };
}
