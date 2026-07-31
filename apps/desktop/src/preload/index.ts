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
  createAccount: (label, passcode) => ipcRenderer.invoke(IpcChannel.authCreate, { label, passcode }),
  createAdditionalAccount: (label, passcode) =>
    ipcRenderer.invoke(IpcChannel.authCreateAdditional, { label, passcode }),
  selectAccount: (accountId) => ipcRenderer.invoke(IpcChannel.authSelectAccount, { accountId }),
  renameAccount: (accountId, label) =>
    ipcRenderer.invoke(IpcChannel.authRenameAccount, { accountId, label }),
  deleteAccount: (accountId) => ipcRenderer.invoke(IpcChannel.authDeleteAccount, { accountId }),
  unlockWithPasscode: (passcode) => ipcRenderer.invoke(IpcChannel.authUnlock, { passcode }),
  unlockWithRecovery: (recoveryCode, newPasscode) =>
    ipcRenderer.invoke(IpcChannel.authRecover, { recoveryCode, newPasscode }),
  changePasscode: (currentPasscode, nextPasscode) =>
    ipcRenderer.invoke(IpcChannel.authChangePasscode, { currentPasscode, nextPasscode }),
  regenerateRecoveryCode: () => ipcRenderer.invoke(IpcChannel.authRegenerateRecovery),
  lock: () => ipcRenderer.invoke(IpcChannel.authLock),
  listProfiles: () => ipcRenderer.invoke(IpcChannel.profilesList),
  createProfile: (kind, name) =>
    ipcRenderer.invoke(IpcChannel.profilesCreate, { kind, name }),
  deleteProfile: (id) => ipcRenderer.invoke(IpcChannel.profilesDelete, { id }),
  verifyProfileSwitch: (passcode) =>
    ipcRenderer.invoke(IpcChannel.profilesVerifySwitch, { passcode }),
  setActiveProfile: (profileId) =>
    ipcRenderer.invoke(IpcChannel.profilesSetActive, { profileId }),
  renameProfile: (id, name) =>
    ipcRenderer.invoke(IpcChannel.profilesRename, { id, name }),
  pickProfilePicture: (profileId) =>
    ipcRenderer.invoke(IpcChannel.profilesPicturePick, { profileId }),
  clearProfilePicture: (profileId) =>
    ipcRenderer.invoke(IpcChannel.profilesPictureClear, { profileId }),
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
  completeTaskOccurrence: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.tasksCompleteOccurrence, { profileId, id }),
  listTaskLists: (profileId) => ipcRenderer.invoke(IpcChannel.taskListsList, { profileId }),
  createTaskList: (profileId, name, parentId) =>
    ipcRenderer.invoke(IpcChannel.taskListsCreate, { profileId, name, parentId }),
  renameTaskList: (profileId, id, name) =>
    ipcRenderer.invoke(IpcChannel.taskListsRename, { profileId, id, name }),
  setTaskListView: (profileId, id, view) =>
    ipcRenderer.invoke(IpcChannel.taskListsSetView, { profileId, id, view }),
  setTaskListViewConfig: (profileId, id, config) =>
    ipcRenderer.invoke(IpcChannel.taskListsSetViewConfig, { profileId, id, config }),
  moveTaskList: (profileId, id, parentId, beforeId, afterId) =>
    ipcRenderer.invoke(IpcChannel.taskListsMove, { profileId, id, parentId, beforeId, afterId }),
  deleteTaskList: (profileId, id, mode) =>
    ipcRenderer.invoke(IpcChannel.taskListsDelete, { profileId, id, mode }),
  restoreTaskList: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.taskListsRestore, { profileId, id }),
  createTaskSection: (profileId, listId, name) =>
    ipcRenderer.invoke(IpcChannel.taskSectionsCreate, { profileId, listId, name }),
  renameTaskSection: (profileId, id, name) =>
    ipcRenderer.invoke(IpcChannel.taskSectionsRename, { profileId, id, name }),
  moveTaskSection: (profileId, id, beforeId, afterId) =>
    ipcRenderer.invoke(IpcChannel.taskSectionsMove, { profileId, id, beforeId, afterId }),
  deleteTaskSection: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.taskSectionsDelete, { profileId, id }),
  moveTaskToList: (profileId, id, listId) =>
    ipcRenderer.invoke(IpcChannel.tasksMoveToList, { profileId, id, listId }),
  moveTaskToSection: (profileId, id, sectionId) =>
    ipcRenderer.invoke(IpcChannel.tasksMoveToSection, { profileId, id, sectionId }),
  reorderTask: (profileId, id, beforeId, afterId) =>
    ipcRenderer.invoke(IpcChannel.tasksReorder, { profileId, id, beforeId, afterId }),
  bulkMoveTasksToList: (profileId, ids, listId, sectionId) =>
    ipcRenderer.invoke(IpcChannel.tasksBulkMove, { profileId, ids, listId, sectionId }),
  bulkSetTaskPriority: (profileId, ids, priority) =>
    ipcRenderer.invoke(IpcChannel.tasksBulkPriority, { profileId, ids, priority }),
  bulkSetTaskDueDate: (profileId, ids, dueDate) =>
    ipcRenderer.invoke(IpcChannel.tasksBulkDue, { profileId, ids, dueDate }),
  bulkDeleteTasks: (profileId, ids) =>
    ipcRenderer.invoke(IpcChannel.tasksBulkDelete, { profileId, ids }),
  bulkRestoreTasks: (profileId, ids) =>
    ipcRenderer.invoke(IpcChannel.tasksBulkRestore, { profileId, ids }),
  listTaskTags: (profileId) => ipcRenderer.invoke(IpcChannel.taskTagsList, { profileId }),
  createTaskTag: (profileId, name) =>
    ipcRenderer.invoke(IpcChannel.taskTagsCreate, { profileId, name }),
  renameTaskTag: (profileId, id, name) =>
    ipcRenderer.invoke(IpcChannel.taskTagsRename, { profileId, id, name }),
  deleteTaskTag: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.taskTagsDelete, { profileId, id }),
  listTaskTagLinks: (profileId) => ipcRenderer.invoke(IpcChannel.taskTagLinksList, { profileId }),
  attachTaskTag: (profileId, taskId, tagId) =>
    ipcRenderer.invoke(IpcChannel.taskTagsAttach, { profileId, taskId, tagId }),
  detachTaskTag: (profileId, taskId, tagId) =>
    ipcRenderer.invoke(IpcChannel.taskTagsDetach, { profileId, taskId, tagId }),
  listTaskAttachments: (profileId, taskId) =>
    ipcRenderer.invoke(IpcChannel.taskAttachmentsList, { profileId, id: taskId }),
  attachTaskFiles: (profileId, taskId) =>
    ipcRenderer.invoke(IpcChannel.taskAttachmentsAdd, { profileId, id: taskId }),
  removeTaskAttachment: (profileId, taskId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.taskAttachmentsRemove, { profileId, id: taskId, attachmentId }),
  openTaskAttachment: (profileId, taskId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.taskAttachmentsOpen, { profileId, id: taskId, attachmentId }),
  saveTaskAttachmentAs: (profileId, taskId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.taskAttachmentsSaveAs, { profileId, id: taskId, attachmentId }),
  taskAttachmentCounts: (profileId) =>
    ipcRenderer.invoke(IpcChannel.taskAttachmentsCounts, { profileId }),
  listTaskTemplates: (profileId) =>
    ipcRenderer.invoke(IpcChannel.taskTemplatesList, { profileId }),
  saveTaskTemplateFromTask: (profileId, taskId, name) =>
    ipcRenderer.invoke(IpcChannel.taskTemplatesSaveFromTask, { profileId, taskId, name }),
  applyTaskTemplate: (profileId, templateId, listId, sectionId) =>
    ipcRenderer.invoke(IpcChannel.taskTemplatesApply, { profileId, templateId, listId, sectionId }),
  deleteTaskTemplate: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.taskTemplatesDelete, { profileId, id }),
  listTaskDependencies: (profileId) =>
    ipcRenderer.invoke(IpcChannel.taskDependenciesList, { profileId }),
  addTaskDependency: (profileId, blockerId, blockedId) =>
    ipcRenderer.invoke(IpcChannel.taskDependenciesAdd, { profileId, blockerId, blockedId }),
  removeTaskDependency: (profileId, blockerId, blockedId) =>
    ipcRenderer.invoke(IpcChannel.taskDependenciesRemove, { profileId, blockerId, blockedId }),
  listEvents: (profileId) => ipcRenderer.invoke(IpcChannel.eventsList, { profileId }),
  createEvent: (profileId, event) =>
    ipcRenderer.invoke(IpcChannel.eventsCreate, { profileId, event }),
  updateEvent: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.eventsUpdate, { profileId, id, changes }),
  deleteEvent: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.eventsDelete, { profileId, id }),
  restoreEvent: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.eventsRestore, { profileId, id }),
  addEventRecurrenceExdate: (profileId, id, date) =>
    ipcRenderer.invoke(IpcChannel.eventsAddRecurrenceExdate, { profileId, id, date }),
  splitEventRecurrence: (profileId, id, occurrenceDate) =>
    ipcRenderer.invoke(IpcChannel.eventsSplitRecurrence, { profileId, id, occurrenceDate }),
  listEventTemplates: (profileId) =>
    ipcRenderer.invoke(IpcChannel.eventTemplatesList, { profileId }),
  captureEventTemplate: (profileId, eventId, name) =>
    ipcRenderer.invoke(IpcChannel.eventTemplatesCapture, { profileId, eventId, name }),
  applyEventTemplate: (profileId, templateId, dayKey) =>
    ipcRenderer.invoke(IpcChannel.eventTemplatesApply, { profileId, templateId, dayKey }),
  deleteEventTemplate: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.eventTemplatesDelete, { profileId, id }),
  calendarOverlay: (profileId, from, to) =>
    ipcRenderer.invoke(IpcChannel.calendarOverlay, { profileId, from, to }),
  calendarSettings: (profileId) =>
    ipcRenderer.invoke(IpcChannel.calendarGetSettings, { profileId }),
  setCalendarSettings: (profileId, settings) =>
    ipcRenderer.invoke(IpcChannel.calendarSetSettings, { profileId, ...settings }),
  listPeople: (profileId) => ipcRenderer.invoke(IpcChannel.peopleList, { profileId }),
  createPerson: (profileId, person) =>
    ipcRenderer.invoke(IpcChannel.peopleCreate, { profileId, person }),
  updatePerson: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.peopleUpdate, { profileId, id, changes }),
  deletePerson: (profileId, id) => ipcRenderer.invoke(IpcChannel.peopleDelete, { profileId, id }),
  restorePerson: (profileId, id) => ipcRenderer.invoke(IpcChannel.peopleRestore, { profileId, id }),
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
  listSubjectAttachments: (profileId, subjectId) =>
    ipcRenderer.invoke(IpcChannel.subjectAttachmentsList, { profileId, id: subjectId }),
  attachSubjectFiles: (profileId, subjectId) =>
    ipcRenderer.invoke(IpcChannel.subjectAttachmentsAdd, { profileId, id: subjectId }),
  removeSubjectAttachment: (profileId, subjectId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.subjectAttachmentsRemove, {
      profileId,
      id: subjectId,
      attachmentId,
    }),
  openSubjectAttachment: (profileId, subjectId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.subjectAttachmentsOpen, {
      profileId,
      id: subjectId,
      attachmentId,
    }),
  saveSubjectAttachmentAs: (profileId, subjectId, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.subjectAttachmentsSaveAs, {
      profileId,
      id: subjectId,
      attachmentId,
    }),
  listSubjectLinkedNotes: (profileId, subjectId) =>
    ipcRenderer.invoke(IpcChannel.subjectNotesLinked, { profileId, id: subjectId }),
  linkSubjectNote: (profileId, subjectId, noteId) =>
    ipcRenderer.invoke(IpcChannel.subjectNotesLink, { profileId, id: subjectId, noteId }),
  unlinkSubjectNote: (profileId, subjectId, noteId) =>
    ipcRenderer.invoke(IpcChannel.subjectNotesUnlink, { profileId, id: subjectId, noteId }),
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
  createClozeCards: (profileId, deckId, text) =>
    ipcRenderer.invoke(IpcChannel.cardsCreateCloze, { profileId, deckId, text }),
  createProblemCard: (profileId, deckId, front, stepsText) =>
    ipcRenderer.invoke(IpcChannel.cardsCreateProblem, { profileId, deckId, front, stepsText }),
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
  studySettings: (profileId) => ipcRenderer.invoke(IpcChannel.studySettingsGet, { profileId }),
  setStudySettings: (profileId, settings) =>
    ipcRenderer.invoke(IpcChannel.studySettingsSet, { profileId, ...settings }),
  listPlans: (profileId) => ipcRenderer.invoke(IpcChannel.plansList, { profileId }),
  createPlan: (profileId, plan) =>
    ipcRenderer.invoke(IpcChannel.plansCreate, { profileId, plan }),
  updatePlan: (profileId, id, changes) =>
    ipcRenderer.invoke(IpcChannel.plansUpdate, { profileId, id, changes }),
  deletePlan: (profileId, id) => ipcRenderer.invoke(IpcChannel.plansDelete, { profileId, id }),
  restorePlan: (profileId, id) => ipcRenderer.invoke(IpcChannel.plansRestore, { profileId, id }),
  syncAllPlans: (profileId) => ipcRenderer.invoke(IpcChannel.plansSyncAll, { profileId }),
  scopeCutProposal: (profileId, planId) =>
    ipcRenderer.invoke(IpcChannel.plansScopeCutProposal, { profileId, planId }),
  acceptScopeCut: (profileId, planId, topicIds) =>
    ipcRenderer.invoke(IpcChannel.plansAcceptScopeCut, { profileId, planId, topicIds }),
  listBlocksByPlan: (profileId, planId) =>
    ipcRenderer.invoke(IpcChannel.blocksListByPlan, { profileId, planId }),
  listBlocksInRange: (profileId, fromDate, toDate) =>
    ipcRenderer.invoke(IpcChannel.blocksRange, { profileId, fromDate, toDate }),
  setBlockStatus: (profileId, id, status) =>
    ipcRenderer.invoke(IpcChannel.blocksSetStatus, { profileId, id, status }),
  setBlockPinned: (profileId, id, pinned) =>
    ipcRenderer.invoke(IpcChannel.blocksSetPinned, { profileId, id, pinned }),
  listExamTopics: (profileId, examId) =>
    ipcRenderer.invoke(IpcChannel.topicsListByExam, { profileId, examId }),
  createExamTopic: (profileId, examId, name) =>
    ipcRenderer.invoke(IpcChannel.topicsCreate, { profileId, examId, name }),
  renameExamTopic: (profileId, id, name) =>
    ipcRenderer.invoke(IpcChannel.topicsRename, { profileId, id, name }),
  setExamTopicConfidence: (profileId, id, confidence) =>
    ipcRenderer.invoke(IpcChannel.topicsSetConfidence, { profileId, id, confidence }),
  setExamTopicDeck: (profileId, id, deckId) =>
    ipcRenderer.invoke(IpcChannel.topicsSetDeck, { profileId, id, deckId }),
  moveExamTopic: (profileId, id, direction) =>
    ipcRenderer.invoke(IpcChannel.topicsMove, { profileId, id, direction }),
  deleteExamTopic: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.topicsDelete, { profileId, id }),
  restoreExamTopicToPlan: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.topicsRestoreToPlan, { profileId, id }),
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
  subjectStudyLog: (profileId, subjectId, fromDay, toDay) =>
    ipcRenderer.invoke(IpcChannel.studyLog, { profileId, subjectId, fromDay, toDay }),
  listCenterNotifications: (profileId) =>
    ipcRenderer.invoke(IpcChannel.notificationsCenterList, { profileId }),
  // `preset` may be omitted — main then snoozes by the profile's own default
  // (NTF-009). Spelled with a conditional rather than always sending the key,
  // so an absent preset arrives as an absent key rather than as an explicit
  // `undefined` the validator would have to read as "use the default" too.
  snoozeNotification: (profileId, id, preset) =>
    ipcRenderer.invoke(
      IpcChannel.notificationsSnooze,
      preset === undefined ? { profileId, id } : { profileId, id, preset },
    ),
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
  onNotificationAppetiteAsk: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.notificationsAppetiteAsk, handler);
    return () => ipcRenderer.removeListener(IpcChannel.notificationsAppetiteAsk, handler);
  },
  answerNotificationAppetite: (profileId, sources) =>
    ipcRenderer.invoke(IpcChannel.notificationsAppetiteAnswer, { profileId, sources }),
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
  deleteNote: (profileId, noteId, cards = "keep") =>
    ipcRenderer.invoke(IpcChannel.notesDelete, { profileId, id: noteId, cards }),
  duplicateNote: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesDuplicate, { profileId, id: noteId }),
  restoreNote: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesRestore, { profileId, id: noteId }),
  countNoteCards: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesCardsCount, { profileId, id: noteId }),
  countNoteChecklistItems: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.notesChecklistCount, { profileId, id: noteId }),
  convertNoteChecklistToTasks: (profileId, noteId, listId) =>
    ipcRenderer.invoke(IpcChannel.notesChecklistToTasks, { profileId, id: noteId, listId }),
  listNoteFolders: (profileId) => ipcRenderer.invoke(IpcChannel.noteFoldersList, { profileId }),
  createNoteFolder: (profileId, input) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersCreate, { profileId, input }),
  updateNoteFolder: (profileId, id, fields) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersUpdate, { profileId, id, fields }),
  moveNoteFolder: (profileId, id, newParentId) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersMove, { profileId, id, newParentId }),
  deleteNoteFolder: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersDelete, { profileId, id }),
  setNoteFolderTemplate: (profileId, id, templateId) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersSetTemplate, { profileId, id, templateId }),
  setNoteFolderCaptureDefault: (profileId, id) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersSetCapture, { profileId, id }),
  setNoteFolderView: (profileId, id, view) =>
    ipcRenderer.invoke(IpcChannel.noteFoldersSetView, { profileId, id, view }),
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
  previewAttachment: (profileId, module, id, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.docPreview, { profileId, module, id, attachmentId }),
  readAttachmentText: (profileId, module, id, attachmentId) =>
    ipcRenderer.invoke(IpcChannel.docReadText, { profileId, module, id, attachmentId }),
  dashboardSettings: (profileId) =>
    ipcRenderer.invoke(IpcChannel.dashboardGetSettings, { profileId }),
  pickDashboardBackground: (profileId) =>
    ipcRenderer.invoke(IpcChannel.dashboardPickBackground, { profileId }),
  clearDashboardBackground: (profileId) =>
    ipcRenderer.invoke(IpcChannel.dashboardClearBackground, { profileId }),
  setDashboardDim: (profileId, dim) =>
    ipcRenderer.invoke(IpcChannel.dashboardSetDim, { profileId, dim }),
  dashboardWidgets: (profileId, setId) =>
    ipcRenderer.invoke(IpcChannel.dashboardWidgetsList, { profileId, setId }),
  addDashboardWidget: (profileId, widgetId, size, setId) =>
    ipcRenderer.invoke(IpcChannel.dashboardWidgetsAdd, { profileId, widgetId, size, setId }),
  removeDashboardWidget: (profileId, instanceId, setId) =>
    ipcRenderer.invoke(IpcChannel.dashboardWidgetsRemove, { profileId, instanceId, setId }),
  setDashboardWidgetSize: (profileId, instanceId, size, setId) =>
    ipcRenderer.invoke(IpcChannel.dashboardWidgetsSetSize, { profileId, instanceId, size, setId }),
  setDashboardWidgetConfig: (profileId, instanceId, config, setId) =>
    ipcRenderer.invoke(IpcChannel.dashboardWidgetsSetConfig, {
      profileId,
      instanceId,
      config,
      setId,
    }),
  moveDashboardWidget: (profileId, instanceId, beforeId, afterId, setId) =>
    ipcRenderer.invoke(IpcChannel.dashboardWidgetsMove, {
      profileId,
      instanceId,
      beforeId,
      afterId,
      setId,
    }),
  dashboardSets: (profileId) =>
    ipcRenderer.invoke(IpcChannel.dashboardSetsList, { profileId }),
  createDashboardSet: (profileId, name) =>
    ipcRenderer.invoke(IpcChannel.dashboardSetCreate, { profileId, name }),
  renameDashboardSet: (profileId, setId, name) =>
    ipcRenderer.invoke(IpcChannel.dashboardSetRename, { profileId, setId, name }),
  deleteDashboardSet: (profileId, setId) =>
    ipcRenderer.invoke(IpcChannel.dashboardSetDelete, { profileId, setId }),
  setActiveDashboardSet: (profileId, setId) =>
    ipcRenderer.invoke(IpcChannel.dashboardSetActivate, { profileId, setId }),
  searchQuery: (profileId, query, limit) =>
    ipcRenderer.invoke(IpcChannel.searchQuery, { profileId, query, limit }),
  searchRecent: (profileId, limit) =>
    ipcRenderer.invoke(IpcChannel.searchRecent, { profileId, limit }),
  searchPage: (profileId, query) =>
    ipcRenderer.invoke(IpcChannel.searchPage, { profileId, query }),
  rebuildSearchIndex: (profileId) =>
    ipcRenderer.invoke(IpcChannel.searchRebuild, { profileId }),
  exportData: (profileId, passphrase, modules) =>
    ipcRenderer.invoke(IpcChannel.imexExport, { profileId, passphrase, modules }),
  exportCalendarIcs: (profileId) => ipcRenderer.invoke(IpcChannel.imexExportIcs, { profileId }),
  pickRestoreArchive: () => ipcRenderer.invoke(IpcChannel.imexRestorePick),
  previewRestore: (profileId, passphrase) =>
    ipcRenderer.invoke(IpcChannel.imexRestorePreview, { profileId, passphrase }),
  applyRestore: (profileId, token) =>
    ipcRenderer.invoke(IpcChannel.imexRestoreApply, { profileId, token }),
  undoRestore: (profileId) => ipcRenderer.invoke(IpcChannel.imexRestoreUndo, { profileId }),
  restoreStatus: (profileId) => ipcRenderer.invoke(IpcChannel.imexRestoreStatus, { profileId }),
  cancelRestore: () => ipcRenderer.invoke(IpcChannel.imexRestoreCancel),
  pickImportArchive: () => ipcRenderer.invoke(IpcChannel.imexImportPick),
  previewImport: (profileId, passphrase) =>
    ipcRenderer.invoke(IpcChannel.imexImportPreview, { profileId, passphrase }),
  replanImport: (profileId, token, choices) =>
    ipcRenderer.invoke(IpcChannel.imexImportReplan, { profileId, token, choices }),
  applyImport: (profileId, token) =>
    ipcRenderer.invoke(IpcChannel.imexImportApply, { profileId, token }),
  cancelImport: () => ipcRenderer.invoke(IpcChannel.imexImportCancel),
  pickApkgFile: () => ipcRenderer.invoke(IpcChannel.imexImportApkgPick),
  previewApkgImport: (profileId, subject) =>
    ipcRenderer.invoke(IpcChannel.imexImportApkgPreview, { profileId, subject }),
  applyApkgImport: (profileId, token) =>
    ipcRenderer.invoke(IpcChannel.imexImportApkgApply, { profileId, token }),
  cancelApkgImport: () => ipcRenderer.invoke(IpcChannel.imexImportApkgCancel),
  pickCsvFile: () => ipcRenderer.invoke(IpcChannel.imexImportCsvPick),
  previewCsvImport: (profileId, delimiter, hasHeader) =>
    ipcRenderer.invoke(IpcChannel.imexImportCsvPreview, { profileId, delimiter, hasHeader }),
  mapCsvImport: (profileId, roles, list) =>
    ipcRenderer.invoke(IpcChannel.imexImportCsvMap, { profileId, roles, list }),
  applyCsvImport: (profileId, token) =>
    ipcRenderer.invoke(IpcChannel.imexImportCsvApply, { profileId, token }),
  cancelCsvImport: () => ipcRenderer.invoke(IpcChannel.imexImportCsvCancel),
  pickIcsFile: () => ipcRenderer.invoke(IpcChannel.imexImportIcsPick),
  previewIcsImport: (profileId, importDuplicates) =>
    ipcRenderer.invoke(IpcChannel.imexImportIcsPreview, { profileId, importDuplicates }),
  applyIcsImport: (profileId, token) =>
    ipcRenderer.invoke(IpcChannel.imexImportIcsApply, { profileId, token }),
  cancelIcsImport: () => ipcRenderer.invoke(IpcChannel.imexImportIcsCancel),
  previewLlmImport: (profileId, kind, text, deck) =>
    ipcRenderer.invoke(IpcChannel.imexImportLlmPreview, { profileId, kind, text, deck }),
  replanLlmImport: (profileId, token, importDuplicates) =>
    ipcRenderer.invoke(IpcChannel.imexImportLlmReplan, { profileId, token, importDuplicates }),
  applyLlmImport: (profileId, token) =>
    ipcRenderer.invoke(IpcChannel.imexImportLlmApply, { profileId, token }),
  cancelLlmImport: () => ipcRenderer.invoke(IpcChannel.imexImportLlmCancel),
  importMarkdownNotes: (profileId, folderId, source) =>
    ipcRenderer.invoke(IpcChannel.imexImportMarkdown, { profileId, folderId, source }),
  backupSettings: (profileId) => ipcRenderer.invoke(IpcChannel.backupGetSettings, { profileId }),
  setBackupSettings: (profileId, settings) =>
    ipcRenderer.invoke(IpcChannel.backupSetSettings, { profileId, ...settings }),
  pickBackupFolder: (profileId) => ipcRenderer.invoke(IpcChannel.backupPickFolder, { profileId }),
  setBackupPassphrase: (profileId, passphrase) =>
    ipcRenderer.invoke(IpcChannel.backupSetPassphrase, { profileId, passphrase }),
  runBackupNow: (profileId) => ipcRenderer.invoke(IpcChannel.backupRunNow, { profileId }),
  privStatus: (profileId) => ipcRenderer.invoke(IpcChannel.privStatus, { profileId }),
  privSetup: (profileId, credential, usesAccountPasscode, regenerateKit) =>
    ipcRenderer.invoke(IpcChannel.privSetup, {
      profileId,
      credential,
      usesAccountPasscode,
      regenerateKit,
    }),
  privUnlock: (profileId, credential) =>
    ipcRenderer.invoke(IpcChannel.privUnlock, { profileId, credential }),
  privLock: () => ipcRenderer.invoke(IpcChannel.privLock),
  privList: (profileId) => ipcRenderer.invoke(IpcChannel.privList, { profileId }),
  privRead: (profileId, id) => ipcRenderer.invoke(IpcChannel.privRead, { profileId, id }),
  privWrite: (profileId, id, envelope) =>
    ipcRenderer.invoke(IpcChannel.privWrite, { profileId, id, envelope }),
  privDelete: (profileId, id) => ipcRenderer.invoke(IpcChannel.privDelete, { profileId, id }),
  privSearch: (profileId, query) =>
    ipcRenderer.invoke(IpcChannel.privSearch, { profileId, query }),
  privSetLockPrefs: (profileId, autoLockMinutes, lockOnMinimize) =>
    ipcRenderer.invoke(IpcChannel.privSetLockPrefs, {
      profileId,
      autoLockMinutes,
      lockOnMinimize,
    }),
  privPickAttachment: (profileId) =>
    ipcRenderer.invoke(IpcChannel.privAttachmentPick, { profileId }),
  privMoveIn: (profileId, noteId) =>
    ipcRenderer.invoke(IpcChannel.privMoveIn, { profileId, noteId }),
  privMoveOut: (profileId, id) => ipcRenderer.invoke(IpcChannel.privMoveOut, { profileId, id }),
  setGlobalShortcut: (chord) => ipcRenderer.invoke(IpcChannel.shortcutsSetGlobal, { chord }),
  onGlobalCapture: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(IpcChannel.shortcutsGlobalCapture, handler);
    return () => ipcRenderer.removeListener(IpcChannel.shortcutsGlobalCapture, handler);
  },
  appInfo: () => ipcRenderer.invoke(IpcChannel.appInfo),
};

contextBridge.exposeInMainWorld("nexus", Object.freeze(api));
