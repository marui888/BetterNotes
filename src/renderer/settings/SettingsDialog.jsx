import { useEffect, useMemo, useState } from 'react'
import { APP_MODES } from '../../stores/appStore'
import { normalizeAppSettings, SHORTCUT_SCOPES, useSettingsStore } from '../../stores/settingsStore'
import { subscribeActions } from '../actions/actionRegistry'
import { formatShortcutEvent } from '../hooks/useShortcutManager'

const MAIN_TABS = {
  GENERAL: 'general',
  SHORTCUTS: 'shortcuts',
}

const modeLabels = {
  [APP_MODES.VIDEO]: 'Video',
  [APP_MODES.IMAGE]: 'Picture',
  [APP_MODES.TEXT]: 'Text',
  [APP_MODES.SEARCH]: 'Management',
}

const shortcutTabs = [
  { id: SHORTCUT_SCOPES.VIDEO, label: 'VIDEO' },
  { id: SHORTCUT_SCOPES.IMAGE, label: 'PICTURE' },
  { id: SHORTCUT_SCOPES.TEXT, label: 'TEXT' },
  { id: SHORTCUT_SCOPES.SEARCH, label: 'MANAGEMENT' },
  { id: SHORTCUT_SCOPES.GLOBAL, label: 'GLOBAL' },
]

const VIDEO_CONTROL_SEGMENTED_ACTION_IDS = [
  'video.toggleControlModeChord',
  'video.toggleSubtitleHidden',
  'video.toggleVideoViewHidden',
  'video.toggleView',
  'video.toggleHvLayout',
]

const VIDEO_NOTE_SEGMENTED_ACTION_IDS = [
  'video.appendMark',
  'video.appendQuickMark',
  'video.insertQuickBefore',
  'video.insertQuickAfter',
]

function splitSegmentedShortcut(shortcut) {
  const parts = String(shortcut || '').trim().split(/\s+/).filter(Boolean)
  return {
    firstKey: parts[0] || '',
    secondKey: parts.slice(1).join(' '),
  }
}

function buildSegmentedShortcut(firstKey, secondKey) {
  const first = String(firstKey || '').trim()
  const second = String(secondKey || '').trim()
  return first && second ? `${first} ${second}` : ''
}

function SettingsTabButton({ active, children, onClick }) {
  return (
    <button
      className={active ? 'settings-tab active' : 'settings-tab'}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}
    </button>
  )
}

function getShortcutConflicts(shortcuts) {
  const conflicts = {}
  Object.entries(shortcuts || {}).forEach(([scope, rows]) => {
    const shortcutToActions = {}
    Object.entries(rows || {}).forEach(([actionId, shortcut]) => {
      if (!shortcut) return
      if (!shortcutToActions[shortcut]) shortcutToActions[shortcut] = []
      shortcutToActions[shortcut].push(actionId)
    })

    conflicts[scope] = new Set(
      Object.values(shortcutToActions)
        .filter((actionIds) => actionIds.length > 1)
        .flat()
    )
  })

  return conflicts
}

function validateGlobalActivationShortcut(shortcut) {
  const value = typeof shortcut === 'string' ? shortcut.trim() : ''
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
  const modifiers = new Set(['Ctrl', 'Control', 'Alt', 'Shift', 'Meta'])
  const modifierCount = parts.filter((part) => modifiers.has(part)).length
  const normalKeyCount = parts.length - modifierCount

  if (parts.length !== 3 || modifierCount !== 2 || normalKeyCount !== 1) {
    return {
      ok: false,
      reason: 'Global activation shortcut must be exactly 3 keys, such as Ctrl+Alt+F.',
    }
  }
  return { ok: true }
}

export default function SettingsDialog({ onClose }) {
  const settings = useSettingsStore((state) => state.settings)
  const saveSettings = useSettingsStore((state) => state.saveSettings)
  const [draft, setDraft] = useState(() => normalizeAppSettings(settings))
  const [mainTab, setMainTab] = useState(MAIN_TABS.GENERAL)
  const [shortcutTab, setShortcutTab] = useState(SHORTCUT_SCOPES.VIDEO)
  const [message, setMessage] = useState('')
  const [alertDialog, setAlertDialog] = useState(null)
  const [registeredActions, setRegisteredActions] = useState([])
  const [keywordFileOptions, setKeywordFileOptions] = useState([])

  useEffect(() => {
    setDraft(normalizeAppSettings(settings))
  }, [settings])

  useEffect(() => subscribeActions(setRegisteredActions), [])

  useEffect(() => {
    let canceled = false
    const keywordFolder = String(draft.general.keywordFolder || '').trim()

    if (!keywordFolder || !window.keywordApi?.listKeywords) {
      setKeywordFileOptions([])
      return () => {
        canceled = true
      }
    }

    window.keywordApi.listKeywords({ keywordFolder, force: true }).then((result) => {
      if (canceled) return
      const groups = Array.isArray(result?.groups) ? result.groups : []
      setKeywordFileOptions(groups.map((group) => group.fileName).filter(Boolean))
    }).catch(() => {
      if (!canceled) setKeywordFileOptions([])
    })

    return () => {
      canceled = true
    }
  }, [draft.general.keywordFolder])

  const shortcutConflicts = useMemo(
    () => getShortcutConflicts(draft.shortcuts),
    [draft.shortcuts]
  )

  const shortcutRows = useMemo(() => {
    const shortcutValues = draft.shortcuts?.[shortcutTab] || {}
    return registeredActions
      .filter((action) => action.scope === shortcutTab)
      .map((action) => ({
        ...action,
        shortcut: shortcutValues[action.id] || '',
      }))
  }, [draft.shortcuts, registeredActions, shortcutTab])

  const shortcutGroups = useMemo(() => {
    if (shortcutTab === SHORTCUT_SCOPES.VIDEO) {
      const controlSegmentedRows = VIDEO_CONTROL_SEGMENTED_ACTION_IDS
        .map((actionId) => shortcutRows.find((action) => action.id === actionId))
        .filter(Boolean)
      const noteSegmentedRows = VIDEO_NOTE_SEGMENTED_ACTION_IDS
        .map((actionId) => shortcutRows.find((action) => action.id === actionId))
        .filter(Boolean)
      const noteFirstKey = noteSegmentedRows
        .map((action) => splitSegmentedShortcut(action.shortcut).firstKey)
        .find(Boolean) || 'Ctrl+S'
      return [
        {
          key: 'video-normal',
          title: '普通快捷键',
          rows: shortcutRows.filter((action) => !action.segmentedShortcut),
        },
        {
          key: 'video-control-segmented',
          title: '分段快捷键',
          firstKey: draft.shortcuts?.[SHORTCUT_SCOPES.VIDEO]?.['video.toggleControlMode'] || '',
          firstKeyReadOnly: true,
          rows: controlSegmentedRows,
          segmented: true,
        },
        {
          key: 'video-note-segmented',
          title: 'Note Actions Segmented Shortcut',
          firstKey: noteFirstKey,
          firstKeyReadOnly: false,
          rows: noteSegmentedRows,
          segmented: true,
        },
      ]
    }

    if (shortcutTab !== SHORTCUT_SCOPES.GLOBAL) {
      return [{ title: '', rows: shortcutRows }]
    }

    const segmentedRows = shortcutRows.filter((action) => action.segmentedShortcut)
    const firstKey = segmentedRows
      .map((action) => splitSegmentedShortcut(action.shortcut).firstKey)
      .find(Boolean) || 'Ctrl+K'

    return [
      {
        key: 'global-normal',
        title: '普通快捷键',
        rows: shortcutRows.filter((action) => !action.segmentedShortcut),
      },
      {
        key: 'global-segmented',
        title: '分段快捷键',
        firstKey,
        firstKeyReadOnly: false,
        rows: segmentedRows,
        segmented: true,
      },
    ]
  }, [draft.shortcuts, shortcutRows, shortcutTab])

  const setShortcut = (scope, actionId, shortcut) => {
    setMessage('')
    setDraft((current) => {
      const currentBucket = current.shortcuts?.[scope] || {}
      const nextBucket = {
        ...currentBucket,
        [actionId]: shortcut,
      }

      if (scope === SHORTCUT_SCOPES.VIDEO && actionId === 'video.toggleControlMode') {
        VIDEO_CONTROL_SEGMENTED_ACTION_IDS.forEach((segmentedActionId) => {
          const { secondKey } = splitSegmentedShortcut(currentBucket[segmentedActionId])
          nextBucket[segmentedActionId] = buildSegmentedShortcut(shortcut, secondKey)
        })
      }

      return {
        ...current,
        shortcuts: {
          ...current.shortcuts,
          [scope]: nextBucket,
        },
      }
    })
  }

  const captureShortcut = (scope, actionId, shortcut) => {
    setShortcut(scope, actionId, shortcut)
  }

  const setSegmentedFirstKey = (group, firstKey) => {
    setMessage('')
    setDraft((current) => {
      const currentBucket = current.shortcuts?.[shortcutTab] || {}
      const nextBucket = { ...currentBucket }
      group.rows.forEach((action) => {
        const { secondKey } = splitSegmentedShortcut(currentBucket[action.id])
        nextBucket[action.id] = buildSegmentedShortcut(firstKey, secondKey)
      })
      return {
        ...current,
        shortcuts: {
          ...current.shortcuts,
          [shortcutTab]: nextBucket,
        },
      }
    })
  }

  const chooseMonthlyNotesFolder = async () => {
    if (!window.appApi?.selectFolder) {
      setMessage('Folder API unavailable')
      return
    }

    const result = await window.appApi.selectFolder()
    if (!result?.ok || result.canceled) return

    setMessage('')
    setDraft((current) => ({
      ...current,
      general: {
        ...current.general,
        monthlyNotesFolder: result.folderPath || '',
      },
    }))
  }

  const chooseSpecialTextFolder = async () => {
    if (!window.appApi?.selectFolder) {
      setMessage('Folder API unavailable')
      return
    }

    const result = await window.appApi.selectFolder()
    if (!result?.ok || result.canceled) return

    setMessage('')
    setDraft((current) => ({
      ...current,
      general: {
        ...current.general,
        specialTextFolder: result.folderPath || '',
      },
    }))
  }

  const chooseKeywordFolder = async () => {
    if (!window.appApi?.selectFolder) {
      setMessage('Folder API unavailable')
      return
    }

    const result = await window.appApi.selectFolder()
    if (!result?.ok || result.canceled) return

    setMessage('')
    setDraft((current) => ({
      ...current,
      general: {
        ...current.general,
        keywordFolder: result.folderPath || '',
        defaultKeywordFile: '',
      },
    }))
  }

  const choosePicModeWideMoveFolder = async () => {
    if (!window.appApi?.selectFolder) {
      setMessage('Folder API unavailable')
      return
    }

    const result = await window.appApi.selectFolder()
    if (!result?.ok || result.canceled) return

    setMessage('')
    setDraft((current) => ({
      ...current,
      general: {
        ...current.general,
        picModeWideMoveFolder: result.folderPath || '',
      },
    }))
  }

  const chooseExtraSubtitleFolder = async () => {
    if (!window.appApi?.selectFolder) {
      setMessage('Folder API unavailable')
      return
    }

    const result = await window.appApi.selectFolder()
    if (!result?.ok || result.canceled) return

    setMessage('')
    setDraft((current) => ({
      ...current,
      general: {
        ...current.general,
        extraSubtitleFolder: result.folderPath || '',
      },
    }))
  }

  const saveDraft = async () => {
    const hasConflicts = Object.values(shortcutConflicts).some((items) => items.size > 0)
    if (hasConflicts) {
      setMessage('Shortcut conflict')
      return null
    }

    const activationShortcut = draft.general.globalActivationShortcut
    const shortcutValidation = validateGlobalActivationShortcut(activationShortcut)
    if (!shortcutValidation.ok) {
      setMessage('Global activation shortcut invalid')
      window.debugApi?.log(`Global activation shortcut invalid: ${activationShortcut || '(empty)'}`)
      setAlertDialog({
        title: 'Global Shortcut',
        message: shortcutValidation.reason,
      })
      return null
    }

    const savedSettings = await saveSettings(draft)
    const registerResult = await window.appApi?.registerGlobalActivationShortcut?.(
      savedSettings.general.globalActivationShortcut
    )
    if (registerResult && !registerResult.ok) {
      const errorMessage = `Register failed: ${savedSettings.general.globalActivationShortcut} (${registerResult.reason})`
      setMessage('Global shortcut register failed')
      window.debugApi?.log(`Global activation shortcut register failed: ${errorMessage}`)
      setAlertDialog({
        title: 'Global Shortcut',
        message: errorMessage,
      })
      return null
    }

    setMessage('Saved')
    return savedSettings
  }

  const saveAndExit = async () => {
    const savedSettings = await saveDraft()
    if (savedSettings) onClose()
  }

  const renderShortcutRow = (action) => (
    <div
      className={shortcutConflicts[shortcutTab]?.has(action.id)
        ? 'settings-shortcut-row conflict'
        : 'settings-shortcut-row'}
      key={action.id}
    >
      <span>{action.label || action.id}</span>
      <div className="settings-shortcut-input-wrap">
        <input
          value={action.shortcut || ''}
          placeholder="Click and press keys"
          onKeyDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (event.key === 'Backspace' || event.key === 'Delete') {
              setShortcut(shortcutTab, action.id, '')
              return
            }
            if (event.key === 'Escape') {
              setMessage('')
              return
            }
            const shortcut = formatShortcutEvent(event)
            if (shortcut) captureShortcut(shortcutTab, action.id, shortcut)
          }}
          onChange={() => {}}
        />
        <button
          type="button"
          onClick={() => setShortcut(shortcutTab, action.id, '')}
        >
          Clear
        </button>
      </div>
    </div>
  )

  const renderSegmentedShortcutRow = (action, group) => {
    const { secondKey } = splitSegmentedShortcut(action.shortcut)
    return (
      <div
        className={shortcutConflicts[shortcutTab]?.has(action.id)
          ? 'settings-shortcut-row settings-segmented-shortcut-row conflict'
          : 'settings-shortcut-row settings-segmented-shortcut-row'}
        key={action.id}
      >
        <span>{action.label || action.id}</span>
        <div className="settings-shortcut-input-wrap">
          <input
            value={secondKey}
            placeholder="Letter"
            onKeyDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (event.key === 'Backspace' || event.key === 'Delete') {
                setShortcut(shortcutTab, action.id, '')
                return
              }
              if (event.key === 'Escape') {
                setMessage('')
                return
              }
              const shortcut = formatShortcutEvent(event)
              if (!/^[A-Z]$/.test(shortcut)) {
                if (shortcut) setMessage('Second key must be one letter')
                return
              }
              setShortcut(shortcutTab, action.id, buildSegmentedShortcut(group.firstKey, shortcut))
            }}
            onChange={() => {}}
          />
          <button
            type="button"
            onClick={() => setShortcut(shortcutTab, action.id, '')}
          >
            Clear
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-dialog-layer" role="presentation">
      <section className="settings-dialog" aria-label="Global settings">
        <div className="settings-main">
          <div className="settings-main-tabs" role="tablist" aria-label="Settings tabs">
            <SettingsTabButton
              active={mainTab === MAIN_TABS.GENERAL}
              onClick={() => setMainTab(MAIN_TABS.GENERAL)}
            >
              General
            </SettingsTabButton>
            <SettingsTabButton
              active={mainTab === MAIN_TABS.SHORTCUTS}
              onClick={() => setMainTab(MAIN_TABS.SHORTCUTS)}
            >
              Shortcuts
            </SettingsTabButton>
          </div>

          <div className="settings-tab-page">
            {mainTab === MAIN_TABS.GENERAL ? (
              <div className="settings-general-sections">
                <section className="settings-section">
                  <div className="settings-section-title">Common</div>
                  <div className="settings-form-grid">
                    <label htmlFor="settings-global-activation-shortcut">Global Activation Shortcut</label>
                    <input
                      id="settings-global-activation-shortcut"
                      value={draft.general.globalActivationShortcut}
                      placeholder="Ctrl+Alt+F"
                      onKeyDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        const shortcut = formatShortcutEvent(event)
                        if (!shortcut) return
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            globalActivationShortcut: shortcut,
                          },
                        }))
                      }}
                      onChange={() => {}}
                    />
                    <label htmlFor="settings-keyword-folder">Keyword Folder</label>
                    <div className="settings-folder-row">
                      <input
                        id="settings-keyword-folder"
                        value={draft.general.keywordFolder}
                        onChange={(event) => {
                          setMessage('')
                          setDraft((current) => ({
                            ...current,
                            general: {
                              ...current.general,
                              keywordFolder: event.target.value,
                              defaultKeywordFile: '',
                            },
                          }))
                        }}
                      />
                      <button
                        data-tooltip="Choose folder"
                        onClick={chooseKeywordFolder}
                        type="button"
                      >
                        <i className="fa-solid fa-folder-open" aria-hidden="true" />
                      </button>
                    </div>
                    <label htmlFor="settings-default-keyword-file">Default Keyword File</label>
                    <select
                      id="settings-default-keyword-file"
                      value={draft.general.defaultKeywordFile}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            defaultKeywordFile: event.target.value,
                          },
                        }))
                      }}
                    >
                      <option value="">None</option>
                      {draft.general.defaultKeywordFile && !keywordFileOptions.includes(draft.general.defaultKeywordFile) ? (
                        <option value={draft.general.defaultKeywordFile}>{draft.general.defaultKeywordFile}</option>
                      ) : null}
                      {keywordFileOptions.map((fileName) => (
                        <option key={fileName} value={fileName}>{fileName}</option>
                      ))}
                    </select>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-title">Common-Segmented Shortcut</div>
                  <div className="settings-form-grid">
                    <label htmlFor="settings-segmented-shortcut-wait">Waiting Time (sec)</label>
                    <input
                      id="settings-segmented-shortcut-wait"
                      type="number"
                      min="0.5"
                      max="10"
                      step="0.5"
                      value={draft.general.segmentedShortcutWaitSec}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            segmentedShortcutWaitSec: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-shortcut-hint-font-size">Hint Font Size (px)</label>
                    <input
                      id="settings-shortcut-hint-font-size"
                      type="number"
                      min="9"
                      max="32"
                      step="1"
                      value={draft.general.shortcutHintFontSize}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            shortcutHintFontSize: event.target.value,
                          },
                        }))
                      }}
                    />
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-title">Video</div>
                  <div className="settings-form-grid">
                    <label htmlFor="settings-extra-subtitle-folder">Extra Subtitle Folder</label>
                    <div className="settings-folder-row">
                      <input
                        id="settings-extra-subtitle-folder"
                        placeholder="Absolute path, or relative to current folder"
                        value={draft.general.extraSubtitleFolder}
                        onChange={(event) => {
                          setMessage('')
                          setDraft((current) => ({
                            ...current,
                            general: {
                              ...current.general,
                              extraSubtitleFolder: event.target.value,
                            },
                          }))
                        }}
                      />
                      <button
                        data-tooltip="Choose folder"
                        onClick={chooseExtraSubtitleFolder}
                        type="button"
                      >
                        <i className="fa-solid fa-folder-open" aria-hidden="true" />
                      </button>
                    </div>
                    <label htmlFor="settings-subtitle-display-mode">Subtitle Display Mode</label>
                    <select
                      id="settings-subtitle-display-mode"
                      value={draft.general.subtitleDisplayMode || 'native'}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            subtitleDisplayMode: event.target.value,
                          },
                        }))
                      }}
                    >
                      <option value="native">Native</option>
                      <option value="rolling">Rolling</option>
                    </select>
                    <label htmlFor="settings-rolling-subtitle-font-size">Rolling Subtitle Font Size</label>
                    <input
                      id="settings-rolling-subtitle-font-size"
                      min="10"
                      max="48"
                      step="1"
                      type="number"
                      value={draft.general.rollingSubtitleFontSize}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            rollingSubtitleFontSize: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-pick-sub-auto-select-current">Pick Sub Auto-select Current</label>
                    <label className="settings-checkbox-row" htmlFor="settings-pick-sub-auto-select-current">
                      <input
                        checked={draft.general.pickSubAutoSelectCurrent === true}
                        id="settings-pick-sub-auto-select-current"
                        type="checkbox"
                        onChange={(event) => {
                          setMessage('')
                          setDraft((current) => ({
                            ...current,
                            general: {
                              ...current.general,
                              pickSubAutoSelectCurrent: event.target.checked,
                            },
                          }))
                        }}
                      />
                      <span>Enabled</span>
                    </label>
                    <label htmlFor="settings-subtitle-center-view-blur">Subtitle Center View Blur</label>
                    <input
                      id="settings-subtitle-center-view-blur"
                      min="0"
                      max="40"
                      step="1"
                      type="number"
                      value={draft.general.subtitleCenterViewBlurPx}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            subtitleCenterViewBlurPx: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-subtitle-center-view-dim">Subtitle Center View Dim</label>
                    <input
                      id="settings-subtitle-center-view-dim"
                      min="0"
                      max="1"
                      step="0.05"
                      type="number"
                      value={draft.general.subtitleCenterViewDim}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            subtitleCenterViewDim: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-video-notes-font-size">Notes FontSize</label>
                    <input
                      id="settings-video-notes-font-size"
                      min="9"
                      max="18"
                      step="1"
                      type="number"
                      value={draft.general.videoNotesFontSize}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            videoNotesFontSize: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-video-notes-pool-font-size">Notes Pool FontSize</label>
                    <input
                      id="settings-video-notes-pool-font-size"
                      min="9"
                      max="18"
                      step="1"
                      type="number"
                      value={draft.general.videoNotesPoolFontSize}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            videoNotesPoolFontSize: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-locate-note-past-limit">Locate Note Past Limit (sec)</label>
                    <input
                      id="settings-locate-note-past-limit"
                      min="0"
                      max="3600"
                      step="1"
                      title="Maximum seconds to search before the current playback position"
                      type="number"
                      value={draft.general.locateNotePastLimitSec}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            locateNotePastLimitSec: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-locate-note-future-limit">Locate Note Future Limit (sec)</label>
                    <input
                      id="settings-locate-note-future-limit"
                      min="0"
                      max="3600"
                      step="1"
                      title="Maximum seconds to search after the current playback position"
                      type="number"
                      value={draft.general.locateNoteFutureLimitSec}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            locateNoteFutureLimitSec: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-play-all-subtitle-suffix">PlayAll Subtitle Suffix</label>
                    <input
                      id="settings-play-all-subtitle-suffix"
                      placeholder=".en.vtt"
                      value={draft.general.playAllSubtitleSuffix}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            playAllSubtitleSuffix: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-subtitle-convert-timeout">Subtitle Convert Timeout</label>
                    <input
                      id="settings-subtitle-convert-timeout"
                      min="1"
                      max="60"
                      step="1"
                      type="number"
                      value={draft.general.subtitleConvertPromptTimeoutSec}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            subtitleConvertPromptTimeoutSec: event.target.value,
                          },
                        }))
                      }}
                    />
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-title">Picture</div>
                  <div className="settings-form-grid">
                    <label htmlFor="settings-image-auto-load-delay">Image Auto Load Delay</label>
                    <input
                      id="settings-image-auto-load-delay"
                      min="100"
                      step="100"
                      type="number"
                      value={draft.general.imageAutoLoadDelayMs}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            imageAutoLoadDelayMs: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-locally-move-folder">Locally Move Folder</label>
                    <input
                      id="settings-locally-move-folder"
                      value={draft.general.locallyMoveFolder}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            locallyMoveFolder: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-picmode-wide-move-folder">PicMode-wide Move Folder</label>
                    <div className="settings-folder-row">
                      <input
                        id="settings-picmode-wide-move-folder"
                        value={draft.general.picModeWideMoveFolder}
                        onChange={(event) => {
                          setMessage('')
                          setDraft((current) => ({
                            ...current,
                            general: {
                              ...current.general,
                              picModeWideMoveFolder: event.target.value,
                            },
                          }))
                        }}
                      />
                      <button
                        data-tooltip="Choose folder"
                        onClick={choosePicModeWideMoveFolder}
                        type="button"
                      >
                        <i className="fa-solid fa-folder-open" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-title">Text</div>
                  <div className="settings-form-grid">
                    <label htmlFor="settings-text-auto-play-all">AutoPlay All</label>
                    <label className="settings-checkbox-row" htmlFor="settings-text-auto-play-all">
                      <input
                        checked={draft.general.textAutoPlayAll}
                        id="settings-text-auto-play-all"
                        type="checkbox"
                        onChange={(event) => {
                          setMessage('')
                          setDraft((current) => ({
                            ...current,
                            general: {
                              ...current.general,
                              textAutoPlayAll: event.target.checked,
                            },
                          }))
                        }}
                      />
                      <span>Enabled</span>
                    </label>
                    <label htmlFor="settings-text-auto-lookup-delay">AutoPlay Delay</label>
                    <input
                      id="settings-text-auto-lookup-delay"
                      min="200"
                      step="100"
                      type="number"
                      value={draft.general.textAutoLookupDelayMs}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            textAutoLookupDelayMs: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-words-review-font-size">Words Review Font Size</label>
                    <input
                      id="settings-words-review-font-size"
                      min="10"
                      max="32"
                      step="1"
                      type="number"
                      value={draft.general.wordsReviewFontSize}
                      onChange={(event) => {
                        setMessage('')
                        setDraft((current) => ({
                          ...current,
                          general: {
                            ...current.general,
                            wordsReviewFontSize: event.target.value,
                          },
                        }))
                      }}
                    />
                    <label htmlFor="settings-webster-spell-out">Webster Spell Out</label>
                    <label className="settings-checkbox-row" htmlFor="settings-webster-spell-out">
                      <input
                        checked={draft.general.websterSpellOut}
                        id="settings-webster-spell-out"
                        type="checkbox"
                        onChange={(event) => {
                          setMessage('')
                          setDraft((current) => ({
                            ...current,
                            general: {
                              ...current.general,
                              websterSpellOut: event.target.checked,
                            },
                          }))
                        }}
                      />
                      <span>Enabled</span>
                    </label>
                    <label>Dicts For AutoPlay</label>
                    <div className="settings-checkbox-group">
                      <label className="settings-checkbox-row">
                        <input
                          checked={draft.general.textAutoPlayDicts?.mdict !== false}
                          type="checkbox"
                          onChange={(event) => {
                            setMessage('')
                            setDraft((current) => ({
                              ...current,
                              general: {
                                ...current.general,
                                textAutoPlayDicts: {
                                  ...(current.general.textAutoPlayDicts || {}),
                                  mdict: event.target.checked,
                                },
                              },
                            }))
                          }}
                        />
                        <span>MDict</span>
                      </label>
                      <label className="settings-checkbox-row">
                        <input
                          checked={draft.general.textAutoPlayDicts?.webster !== false}
                          type="checkbox"
                          onChange={(event) => {
                            setMessage('')
                            setDraft((current) => ({
                              ...current,
                              general: {
                                ...current.general,
                                textAutoPlayDicts: {
                                  ...(current.general.textAutoPlayDicts || {}),
                                  webster: event.target.checked,
                                },
                              },
                            }))
                          }}
                        />
                        <span>Webster</span>
                      </label>
                    </div>
                    <label htmlFor="settings-monthly-notes-folder">Monthly Text Folder</label>
                    <div className="settings-folder-row">
                      <input
                        id="settings-monthly-notes-folder"
                        value={draft.general.monthlyNotesFolder}
                        onChange={(event) => {
                          setMessage('')
                          setDraft((current) => ({
                            ...current,
                            general: {
                              ...current.general,
                              monthlyNotesFolder: event.target.value,
                            },
                          }))
                        }}
                      />
                      <button
                        data-tooltip="Choose folder"
                        onClick={chooseMonthlyNotesFolder}
                        type="button"
                      >
                        <i className="fa-solid fa-folder-open" aria-hidden="true" />
                      </button>
                    </div>
                    <label htmlFor="settings-special-text-folder">Special Text Folder</label>
                    <div className="settings-folder-row">
                      <input
                        id="settings-special-text-folder"
                        value={draft.general.specialTextFolder}
                        onChange={(event) => {
                          setMessage('')
                          setDraft((current) => ({
                            ...current,
                            general: {
                              ...current.general,
                              specialTextFolder: event.target.value,
                            },
                          }))
                        }}
                      />
                      <button
                        data-tooltip="Choose folder"
                        onClick={chooseSpecialTextFolder}
                        type="button"
                      >
                        <i className="fa-solid fa-folder-open" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="settings-shortcuts">
                <div className="settings-shortcut-tabs" role="tablist" aria-label="Shortcut scopes">
                  {shortcutTabs.map((tab) => (
                    <SettingsTabButton
                      active={shortcutTab === tab.id}
                      key={tab.id}
                      onClick={() => setShortcutTab(tab.id)}
                    >
                      {tab.label}
                    </SettingsTabButton>
                  ))}
                </div>

                <div className="settings-shortcut-page">
                  {shortcutRows.length === 0 ? (
                    <div className="settings-empty">No shortcut items configured yet.</div>
                  ) : (
                    shortcutGroups.map((group) => (
                      <section className="settings-shortcut-group" key={group.key || group.title || 'default'}>
                        {group.title ? (
                          <div className="settings-shortcut-group-title">
                            <span>{group.title}</span>
                          </div>
                        ) : null}
                        {group.segmented ? (
                          <label className="settings-segmented-first-key">
                            <span>First key:</span>
                            {group.firstKeyReadOnly ? (
                              <kbd>{group.firstKey || 'Not set'}</kbd>
                            ) : (
                              <input
                                value={group.firstKey}
                                placeholder="Click and press keys"
                                onKeyDown={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  if (event.key === 'Escape') return
                                  const shortcut = formatShortcutEvent(event)
                                  if (shortcut) setSegmentedFirstKey(group, shortcut)
                                }}
                                onChange={() => {}}
                              />
                            )}
                          </label>
                        ) : null}
                        {group.rows.length === 0 ? (
                          <div className="settings-empty compact">No shortcut items.</div>
                        ) : group.rows.map((action) => (
                          group.segmented
                            ? renderSegmentedShortcutRow(action, group)
                            : renderShortcutRow(action)
                        ))}
                      </section>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-actions">
          <span className="settings-message">{message}</span>
          <button type="button" onClick={saveDraft}>Save</button>
          <button className="primary" type="button" onClick={saveAndExit}>Save&amp;Exit</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </section>
      {alertDialog ? (
        <div className="settings-alert-layer" role="presentation">
          <div className="settings-alert" role="dialog" aria-modal="true">
            <div className="settings-alert-title">{alertDialog.title}</div>
            <div className="settings-alert-message">{alertDialog.message}</div>
            <div className="settings-alert-actions">
              <button type="button" onClick={() => setAlertDialog(null)}>OK</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
