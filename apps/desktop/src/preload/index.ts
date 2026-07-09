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
  listDocuments: (profileId) => ipcRenderer.invoke(IpcChannel.documentsList, { profileId }),
  createDocument: (profileId, document) =>
    ipcRenderer.invoke(IpcChannel.documentsCreate, { profileId, document }),
  updateDocument: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.documentsUpdate, { profileId, id, changes }),
  deleteDocument: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.documentsDelete, { profileId, id }),
  restoreDocument: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.documentsRestore, { profileId, id }),
  renewDocument: (profileId, id, newExpiryDate) =>
    ipcRenderer.invoke(IpcChannel.documentsRenew, { profileId, id, newExpiryDate }),
  listDocumentRenewals: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.documentsRenewals, { profileId, id }),
  listSubjects: (profileId) => ipcRenderer.invoke(IpcChannel.subjectsList, { profileId }),
  createSubject: (profileId, subject) =>
    ipcRenderer.invoke(IpcChannel.subjectsCreate, { profileId, subject }),
  updateSubject: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.subjectsUpdate, { profileId, id, changes }),
  deleteSubject: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.subjectsDelete, { profileId, id }),
  restoreSubject: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.subjectsRestore, { profileId, id }),
  listExams: (profileId) => ipcRenderer.invoke(IpcChannel.examsList, { profileId }),
  createExam: (profileId, exam) =>
    ipcRenderer.invoke(IpcChannel.examsCreate, { profileId, exam }),
  updateExam: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.examsUpdate, { profileId, id, changes }),
  deleteExam: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.examsDelete, { profileId, id }),
  restoreExam: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.examsRestore, { profileId, id }),
  listDecks: (profileId) => ipcRenderer.invoke(IpcChannel.decksList, { profileId }),
  createDeck: (profileId, deck) =>
    ipcRenderer.invoke(IpcChannel.decksCreate, { profileId, deck }),
  updateDeck: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.decksUpdate, { profileId, id, changes }),
  deleteDeck: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.decksDelete, { profileId, id }),
  restoreDeck: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.decksRestore, { profileId, id }),
  listCardsByDeck: (profileId, deckId) =>
    ipcRenderer.invoke(IpcChannel.cardsListByDeck, { profileId, deckId }),
  createCard: (profileId, card) =>
    ipcRenderer.invoke(IpcChannel.cardsCreate, { profileId, card }),
  updateCard: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.cardsUpdate, { profileId, id, changes }),
  deleteCard: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.cardsDelete, { profileId, id }),
  restoreCard: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.cardsRestore, { profileId, id }),
  cardCounts: (profileId) => ipcRenderer.invoke(IpcChannel.cardsCounts, { profileId }),
  reviewQueue: (profileId, scope) =>
    ipcRenderer.invoke(IpcChannel.reviewQueue, { profileId, ...scope }),
  gradeReview: (profileId, id, rating) =>
    ipcRenderer.invoke(IpcChannel.reviewGrade, { profileId, id, rating }),
  undoReview: (profileId, id) => ipcRenderer.invoke(IpcChannel.reviewUndo, { profileId, id }),
  previewReview: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.reviewPreview, { profileId, id }),
  listPlans: (profileId) => ipcRenderer.invoke(IpcChannel.plansList, { profileId }),
  createPlan: (profileId, plan) =>
    ipcRenderer.invoke(IpcChannel.plansCreate, { profileId, plan }),
  updatePlan: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.plansUpdate, { profileId, id, changes }),
  deletePlan: (profileId, id) => ipcRenderer.invoke(IpcChannel.plansDelete, { profileId, id }),
  restorePlan: (profileId, id) => ipcRenderer.invoke(IpcChannel.plansRestore, { profileId, id }),
  syncAllPlans: (profileId) => ipcRenderer.invoke(IpcChannel.plansSyncAll, { profileId }),
  listBlocksByPlan: (profileId, planId) =>
    ipcRenderer.invoke(IpcChannel.blocksListByPlan, { profileId, planId }),
  listBlocksInRange: (profileId, fromDate, toDate) =>
    ipcRenderer.invoke(IpcChannel.blocksRange, { profileId, fromDate, toDate }),
  setBlockStatus: (profileId, id, status) =>
    ipcRenderer.invoke(IpcChannel.blocksSetStatus, { profileId, id, status }),
  appInfo: () => ipcRenderer.invoke(IpcChannel.appInfo),
};

contextBridge.exposeInMainWorld("nexus", Object.freeze(api));
