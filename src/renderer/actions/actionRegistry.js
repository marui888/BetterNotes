const actions = new Map()
const listeners = new Set()
const actionCatalog = new Map([
  ['video.seekStart', { id: 'video.seekStart', label: 'Seek Start', scope: 'video', description: 'Seek to current start time.' }],
  ['video.jumpBack', { id: 'video.jumpBack', label: 'Jump Back', scope: 'video', description: 'Jump backward by playback-rate scaled distance.' }],
  ['video.setStart', { id: 'video.setStart', label: 'Set Start', scope: 'video', description: 'Set current start time from playback position.' }],
  ['video.setEnd', { id: 'video.setEnd', label: 'Set End', scope: 'video', description: 'Set current end time from playback position.' }],
  ['video.jumpForward', { id: 'video.jumpForward', label: 'Jump Forward', scope: 'video', description: 'Jump forward by playback-rate scaled distance.' }],
  ['video.toggleFocus', { id: 'video.toggleFocus', label: 'Toggle Focus', scope: 'video', description: 'Toggle focus between notes list and note content.' }],
  ['video.appendMark', { id: 'video.appendMark', label: 'Append Mark', scope: 'video', description: 'Append current start, end, and content as a note.' }],
  ['video.appendQuickMark', { id: 'video.appendQuickMark', label: 'Append Quick Mark', scope: 'video', description: 'Append quick mark from current playback position.' }],
  ['video.toggleControlMode', { id: 'video.toggleControlMode', label: 'Toggle Control Mode', scope: 'video', description: 'Toggle video control shortcut mode.' }],
  ['video.togglePlay', { id: 'video.togglePlay', label: 'Play / Pause', scope: 'video', description: 'Toggle video playback.' }],
  ['video.togglePlayAlt', { id: 'video.togglePlayAlt', label: 'Play / Pause Alt', scope: 'video', description: 'Toggle video playback with alternate shortcut.' }],
  ['video.saveNotes', { id: 'video.saveNotes', label: 'Save Notes', scope: 'video', description: 'Save current video notes.' }],
  ['video.saveNotesAlt', { id: 'video.saveNotesAlt', label: 'Save Notes Alt', scope: 'video', description: 'Save current video notes with alternate shortcut.' }],
  ['video.jumpBackShort', { id: 'video.jumpBackShort', label: 'Short Back', scope: 'video', description: 'Jump backward by short playback-rate scaled distance.' }],
  ['video.jumpForwardShort', { id: 'video.jumpForwardShort', label: 'Short Forward', scope: 'video', description: 'Jump forward by short playback-rate scaled distance.' }],
  ['video.jumpBackLong', { id: 'video.jumpBackLong', label: 'Long Back', scope: 'video', description: 'Jump backward by long playback-rate scaled distance.' }],
  ['video.jumpForwardLong', { id: 'video.jumpForwardLong', label: 'Long Forward', scope: 'video', description: 'Jump forward by long playback-rate scaled distance.' }],
  ['video.speedUp', { id: 'video.speedUp', label: 'Speed Up', scope: 'video', description: 'Increase playback speed.' }],
  ['video.speedDown', { id: 'video.speedDown', label: 'Speed Down', scope: 'video', description: 'Decrease playback speed.' }],
  ['video.volumeUp', { id: 'video.volumeUp', label: 'Volume Up', scope: 'video', description: 'Increase video volume.' }],
  ['video.volumeDown', { id: 'video.volumeDown', label: 'Volume Down', scope: 'video', description: 'Decrease video volume.' }],
  ['video.toggleView', { id: 'video.toggleView', label: 'Toggle View', scope: 'video', description: 'Cycle video view layout.' }],
  ['video.toggleLeftTab', { id: 'video.toggleLeftTab', label: 'Toggle Left Tab', scope: 'video', description: 'Toggle Notes and MP4 Files tabs.' }],
  ['video.updateContent', { id: 'video.updateContent', label: 'Update Content', scope: 'video', description: 'Update selected note content.' }],
  ['video.updateRange', { id: 'video.updateRange', label: 'Update Range', scope: 'video', description: 'Update selected note range from current playback position.' }],
  ['video.writeCurrentRange', { id: 'video.writeCurrentRange', label: 'Write Current Range', scope: 'video', description: 'Write curStart and curEnd to selected note.' }],
  ['text.lookupMDict', { id: 'text.lookupMDict', label: 'MDict', scope: 'text', description: 'Send word to MDict.' }],
  ['text.rotateMDict', { id: 'text.rotateMDict', label: 'Rotate Dict', scope: 'text', description: 'Rotate MDict dictionary.' }],
  ['text.lookupWebster', { id: 'text.lookupWebster', label: 'Webster', scope: 'text', description: 'Send word to Webster and read.' }],
  ['text.lookup', { id: 'text.lookup', label: 'LookUp', scope: 'text', description: 'Send the selected word to configured dictionaries.' }],
  ['text.pasteAndLookup', { id: 'text.pasteAndLookup', label: 'Paste & LookUp', scope: 'text', description: 'Paste clipboard text and send it to configured dictionaries.' }],
  ['text.getMDictThenLookup', { id: 'text.getMDictThenLookup', label: 'Get MDict then Lookup', scope: 'text', description: 'Read MDict input and send it to configured dictionaries.' }],
  ['text.saveTo', { id: 'text.saveTo', label: 'SaveTo', scope: 'text', description: 'Append independent input to the selected special text file.' }],
  ['text.saveToEn', { id: 'text.saveToEn', label: 'SaveToEn', scope: 'text', description: 'Append independent input to the monthly English note file.' }],
  ['text.saveToZh', { id: 'text.saveToZh', label: 'SaveToZh', scope: 'text', description: 'Append independent input to the monthly Chinese note file.' }],
  ['text.captureWebster', { id: 'text.captureWebster', label: 'Capture', scope: 'text', description: 'Capture Webster output.' }],
  ['text.detectBlue', { id: 'text.detectBlue', label: 'Blue', scope: 'text', description: 'Detect blue text in Webster output.' }],
  ['text.readBlue', { id: 'text.readBlue', label: 'ReadBlue', scope: 'text', description: 'Read the last blue Webster text.' }],
  ['text.startAutoLookup', { id: 'text.startAutoLookup', label: 'Start', scope: 'text', description: 'Start automatic word lookup.' }],
  ['text.stopAutoLookup', { id: 'text.stopAutoLookup', label: 'Stop', scope: 'text', description: 'Stop automatic word lookup.' }],
  ['text.previousWord', { id: 'text.previousWord', label: 'Previous Word', scope: 'text', description: 'Select the previous word.' }],
  ['text.nextWord', { id: 'text.nextWord', label: 'Next Word', scope: 'text', description: 'Select the next word.' }],
])

function notifyListeners() {
  const snapshot = getRegisteredActions()
  listeners.forEach((listener) => listener(snapshot))
}

export function registerAction(action) {
  if (!action?.id || typeof action.handler !== 'function') {
    return () => {}
  }

  actions.set(action.id, {
    scope: 'global',
    label: action.id,
    description: '',
    ...(actionCatalog.get(action.id) || {}),
    ...action,
  })
  notifyListeners()

  return () => {
    const currentAction = actions.get(action.id)
    if (currentAction?.handler === action.handler) {
      actions.delete(action.id)
      notifyListeners()
    }
  }
}

export function registerActions(nextActions) {
  const unregisterCallbacks = nextActions.map((action) => registerAction(action))
  return () => unregisterCallbacks.forEach((unregister) => unregister())
}

export async function runAction(actionId) {
  const action = actions.get(actionId)
  if (!action) {
    return { ok: false, reason: 'action-not-found', actionId }
  }

  await action.handler()
  return { ok: true }
}

export function getRegisteredActions() {
  const mergedActions = new Map(actionCatalog)
  actions.forEach((action, actionId) => {
    mergedActions.set(actionId, action)
  })

  return [...mergedActions.values()].map(({ handler, ...metadata }) => metadata)
}

export function getActionsByScope(scope) {
  return getRegisteredActions().filter((action) => action.scope === scope)
}

export function subscribeActions(listener) {
  listeners.add(listener)
  listener(getRegisteredActions())
  return () => listeners.delete(listener)
}
