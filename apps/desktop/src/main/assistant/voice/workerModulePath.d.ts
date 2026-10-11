/**
 * electron-vite's `?modulePath` import.
 *
 * The query suffix is understood by electron-vite's own plugin, and the
 * declaration lives beside the one file that uses it rather than in the app's
 * `main/env.d.ts`: an ambient module that exists for one caller is a fact about
 * that caller, and `env.d.ts` states the two build-time variables the whole
 * main process reads.
 */
declare module "*?modulePath" {
  /** The path of the module's own emitted bundle. */
  const modulePath: string;
  export default modulePath;
}
