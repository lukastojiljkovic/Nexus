/**
 * The one User-Agent this assistant sends, and the policy it answers.
 *
 * Wikimedia's policy (https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy)
 * is one sentence long in the part that matters here: „Scripts should use an
 * informative User-Agent string with contact information, or they may be blocked
 * without notice." The generic format it asks for is „<client name>/<version>
 * (<contact information>)", so this string names the client, the release it ships
 * in, the project and a way to make contact.
 *
 * **Why a module of its own.** Both of this assistant's outbound callers send it —
 * the web service's providers and page reads (`web/providers.ts`, `web/index.ts`)
 * and the model runtime's Hub requests (`runtime/electron.ts`) — because a request
 * from this process should be identifiable wherever it lands. The runtime does not
 * search the web, so the string cannot live in `web/`.
 *
 * **Why the version is a parameter.** It is the RUNNING build's version and only
 * Electron knows it (`app.getVersion()`, read at the two seams that already import
 * it), so it is handed in rather than read here: this file, like every file beside
 * it, must stay testable without Electron.
 */
export function nexusUserAgent(version: string): string {
  return `Nexus/${version} (https://github.com/lukastojiljkovic/Nexus; luka.d.stojiljkovic@gmail.com)`;
}
