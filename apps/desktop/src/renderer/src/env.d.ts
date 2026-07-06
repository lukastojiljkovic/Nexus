/// <reference types="vite/client" />
import type { NexusApi } from "../../shared/ipc.js";

declare global {
  interface Window {
    /** The frozen IPC bridge exposed by the preload (SEC-EL-02). */
    nexus: NexusApi;
    /** Set once the initial IPC round trip resolves; read by the --smoke check. */
    __nexusReady?: boolean;
    /** Set if the initial IPC round trip fails; read by the --smoke check. */
    __nexusError?: boolean;
  }
}

export {};
