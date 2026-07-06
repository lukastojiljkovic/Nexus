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
  listTasks: (profileId) => ipcRenderer.invoke(IpcChannel.tasksList, { profileId }),
  createTask: (profileId, task) =>
    ipcRenderer.invoke(IpcChannel.tasksCreate, { profileId, task }),
  updateTask: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.tasksUpdate, { profileId, id, changes }),
  setTaskDone: (profileId, id, done) =>
    ipcRenderer.invoke(IpcChannel.tasksSetDone, { profileId, id, done }),
  deleteTask: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.tasksDelete, { profileId, id }),
  restoreTask: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.tasksRestore, { profileId, id }),
  listEvents: (profileId) => ipcRenderer.invoke(IpcChannel.eventsList, { profileId }),
  createEvent: (profileId, event) =>
    ipcRenderer.invoke(IpcChannel.eventsCreate, { profileId, event }),
  updateEvent: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.eventsUpdate, { profileId, id, changes }),
  deleteEvent: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.eventsDelete, { profileId, id }),
  restoreEvent: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.eventsRestore, { profileId, id }),
  appInfo: () => ipcRenderer.invoke(IpcChannel.appInfo),
};

contextBridge.exposeInMainWorld("nexus", Object.freeze(api));
