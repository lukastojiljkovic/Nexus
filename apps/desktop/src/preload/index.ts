import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel, type NexusApi } from "../shared/ipc.js";

/**
 * The renderer's only bridge to the main process (SEC-EL-02). Each method wraps
 * exactly one allowlisted channel — there is deliberately no generic
 * `invoke(channel, ...)` passthrough. The object is frozen so the renderer
 * cannot reshape the surface after exposure.
 */
const api: NexusApi = {
  listProfiles: () => ipcRenderer.invoke(IpcChannel.profilesList),
  renameProfile: (id, name) =>
    ipcRenderer.invoke(IpcChannel.profilesRename, { id, name }),
  getFlags: (profileId) => ipcRenderer.invoke(IpcChannel.flagsGet, { profileId }),
  setFlag: (profileId, moduleId, enabled) =>
    ipcRenderer.invoke(IpcChannel.flagsSet, { profileId, moduleId, enabled }),
  appInfo: () => ipcRenderer.invoke(IpcChannel.appInfo),
};

contextBridge.exposeInMainWorld("nexus", Object.freeze(api));
