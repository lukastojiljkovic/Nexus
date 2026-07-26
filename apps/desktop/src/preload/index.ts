import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel, type NexusApi } from "../shared/ipc.js";

/**
 * The renderer's only bridge to the main process (SEC-EL-02). Each method wraps
 * exactly one allowlisted channel — there is deliberately no generic
 * `invoke(channel, ...)` passthrough. The object is frozen so the renderer
 * cannot reshape the surface after exposure.
 */
const api: NexusApi = {
  getAuthStatus: () => ipcRenderer.invoke(IpcChannel.authStatus),
  createAccount: (passcode) => ipcRenderer.invoke(IpcChannel.authCreate, { passcode }),
  unlockWithPasscode: (passcode) => ipcRenderer.invoke(IpcChannel.authUnlock, { passcode }),
  unlockWithRecovery: (recoveryCode, newPasscode) =>
    ipcRenderer.invoke(IpcChannel.authRecover, { recoveryCode, newPasscode }),
  changePasscode: (currentPasscode, nextPasscode) =>
    ipcRenderer.invoke(IpcChannel.authChangePasscode, { currentPasscode, nextPasscode }),
  regenerateRecoveryCode: () => ipcRenderer.invoke(IpcChannel.authRegenerateRecovery),
  lock: () => ipcRenderer.invoke(IpcChannel.authLock),
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
  startFocus: (profileId, subjectId) =>
    ipcRenderer.invoke(IpcChannel.focusStart, { profileId, subjectId }),
  stopFocus: (profileId) => ipcRenderer.invoke(IpcChannel.focusStop, { profileId }),
  focusStatus: (profileId) => ipcRenderer.invoke(IpcChannel.focusStatus, { profileId }),
  cancelFocus: (profileId) => ipcRenderer.invoke(IpcChannel.focusCancel, { profileId }),
  listFocusRange: (profileId, fromDate, toDate) =>
    ipcRenderer.invoke(IpcChannel.focusListRange, { profileId, fromDate, toDate }),
  deleteFocus: (profileId, id) => ipcRenderer.invoke(IpcChannel.focusDelete, { profileId, id }),
  restoreFocus: (profileId, id) => ipcRenderer.invoke(IpcChannel.focusRestore, { profileId, id }),
  studyStats: (profileId, fromDate, toDate) =>
    ipcRenderer.invoke(IpcChannel.statsStudy, { profileId, fromDate, toDate }),
  listCenterNotifications: (profileId) =>
    ipcRenderer.invoke(IpcChannel.notificationsCenterList, { profileId }),
  snoozeNotification: (profileId, id, preset) =>
    ipcRenderer.invoke(IpcChannel.notificationsSnooze, { profileId, id, preset }),
  dismissNotification: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.notificationsDismiss, { profileId, id }),
  getNotificationSettings: (profileId) =>
    ipcRenderer.invoke(IpcChannel.notificationsSettingsGet, { profileId }),
  updateNotificationSettings: (profileId, changes) =>
    ipcRenderer.invoke(IpcChannel.notificationsSettingsUpdate, { profileId, changes }),
  setNotificationSourceEnabled: (profileId, source, enabled) =>
    ipcRenderer.invoke(IpcChannel.notificationsSourceToggle, { profileId, source, enabled }),
  onNotificationsChanged: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.notificationsChanged, handler);
    return () => ipcRenderer.removeListener(IpcChannel.notificationsChanged, handler);
  },
  listNotes: (profileId, filter) =>
    ipcRenderer.invoke(
      IpcChannel.notesList,
      filter && "folderId" in filter ? { profileId, folderId: filter.folderId } : { profileId },
    ),
  createNote: (profileId) => ipcRenderer.invoke(IpcChannel.notesCreate, { profileId }),
  loadNote: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesLoad, { profileId, id: noteId }),
  appendNoteUpdate: (profileId, noteId, update, title) =>
    ipcRenderer.invoke(IpcChannel.notesAppendUpdate, { profileId, id: noteId, update, title }),
  deleteNote: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesDelete, { profileId, id: noteId }),
  restoreNote: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesRestore, { profileId, id: noteId }),
  listNoteFolders: (profileId) => ipcRenderer.invoke(IpcChannel.noteFoldersList, { profileId }),
  createNoteFolder: (profileId, input) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersCreate, { profileId, input }),
  updateNoteFolder: (profileId, id, fields) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersUpdate, { profileId, id, fields }),
  moveNoteFolder: (profileId, id, newParentId) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersMove, { profileId, id, newParentId }),
  deleteNoteFolder: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersDelete, { profileId, id }),
  listNoteTags: (profileId) => ipcRenderer.invoke(IpcChannel.noteTagsList, { profileId }),
  createNoteTag: (profileId, name) =>
    ipcRenderer.invoke(IpcChannel.noteTagsCreate, { profileId, name }),
  renameNoteTag: (profileId, id, name) =>
    ipcRenderer.invoke(IpcChannel.noteTagsRename, { profileId, id, name }),
  deleteNoteTag: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.noteTagsDelete, { profileId, id }),
  listNoteTagLinks: (profileId) => ipcRenderer.invoke(IpcChannel.noteTagLinksList, { profileId }),
  attachNoteTag: (profileId, noteId, tagId) =>
    ipcRenderer.invoke(IpcChannel.noteTagsAttach, { profileId, noteId, tagId }),
  detachNoteTag: (profileId, noteId, tagId) =>
    ipcRenderer.invoke(IpcChannel.noteTagsDetach, { profileId, noteId, tagId }),
  setNoteFolder: (profileId, noteId, folderId) =>
    ipcRenderer.invoke(IpcChannel.notesSetFolder, { profileId, noteId, folderId }),
  setNotePinned: (profileId, noteId, pinned) =>
    ipcRenderer.invoke(IpcChannel.notesSetPinned, { profileId, noteId, pinned }),
  setNoteLinks: (profileId, noteId, targetIds) =>
    ipcRenderer.invoke(IpcChannel.notesSetLinks, { profileId, id: noteId, targetIds }),
  listNoteBacklinks: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesBacklinks, { profileId, id: noteId }),
  listNoteVersions: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesVersions, { profileId, id: noteId }),
  loadNoteVersion: (profileId, noteId, coveredSeq) =>
    ipcRenderer.invoke(IpcChannel.notesVersionLoad, { profileId, id: noteId, coveredSeq }),
  captureNoteVersion: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesVersionCapture, { profileId, id: noteId }),
  listNoteTemplates: (profileId) =>
    ipcRenderer.invoke(IpcChannel.notesTemplatesList, { profileId }),
  saveNoteTemplate: (profileId, name, content) =>
    ipcRenderer.invoke(IpcChannel.notesTemplateSave, { profileId, name, content }),
  renameNoteTemplate: (profileId, id, name) =>
    ipcRenderer.invoke(IpcChannel.notesTemplateRename, { profileId, id, name }),
  deleteNoteTemplate: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.notesTemplateDelete, { profileId, id }),
  syncNoteCards: (profileId, noteId, deckId, cards) =>
    ipcRenderer.invoke(IpcChannel.notesCardsSync, { profileId, id: noteId, deckId, cards }),
  setNoteCardDeck: (profileId, noteId, deckId) =>
    ipcRenderer.invoke(IpcChannel.notesCardDeckSet, { profileId, id: noteId, deckId }),
  listNoteAttachments: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.noteAttachmentsList, { profileId, id: noteId }),
  attachNoteFile: (profileId, noteId, fileName, bytes) =>
    ipcRenderer.invoke(IpcChannel.noteAttachmentsAdd, { profileId, id: noteId, fileName, bytes }),
  removeNoteAttachment: (profileId, noteId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.noteAttachmentsRemove, { profileId, id: noteId, attachmentId }),
  openNoteAttachment: (profileId, noteId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.noteAttachmentsOpen, { profileId, id: noteId, attachmentId }),
  saveNoteAttachmentAs: (profileId, noteId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.noteAttachmentsSaveAs, { profileId, id: noteId, attachmentId }),
  searchQuery: (profileId, query, limit) =>
    ipcRenderer.invoke(IpcChannel.searchQuery, { profileId, query, limit }),
  searchRecent: (profileId, limit) =>
    ipcRenderer.invoke(IpcChannel.searchRecent, { profileId, limit }),
  rebuildSearchIndex: (profileId) =>
    ipcRenderer.invoke(IpcChannel.searchRebuild, { profileId }),
  exportData: (profileId) => ipcRenderer.invoke(IpcChannel.imexExport, { profileId }),
  appInfo: () => ipcRenderer.invoke(IpcChannel.appInfo),
};

contextBridge.exposeInMainWorld("nexus", Object.freeze(api));
