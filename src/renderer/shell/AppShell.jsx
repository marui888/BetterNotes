import { useEffect, useRef, useState } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import ImageMode from '../modes/ImageMode'
import SearchMode from '../modes/SearchMode'
import TextMode from '../modes/TextMode'
import VideoMode from '../modes/VideoMode'
import AppTooltip from '../components/AppTooltip'
import SettingsDialog from '../settings/SettingsDialog'
import useShortcutManager from '../hooks/useShortcutManager'

const modeTooltips = {
  [APP_MODES.VIDEO]: 'Video',
  [APP_MODES.IMAGE]: 'Picture',
  [APP_MODES.TEXT]: 'Text',
  [APP_MODES.SEARCH]: 'Search',
}

const modeIconClasses = {
  [APP_MODES.VIDEO]: 'fa-solid fa-video',
  [APP_MODES.IMAGE]: 'fa-solid fa-image',
  [APP_MODES.TEXT]: 'fa-solid fa-font',
  [APP_MODES.SEARCH]: 'fa-solid fa-magnifying-glass',
}

const guardOrder = [APP_MODES.VIDEO, APP_MODES.IMAGE, APP_MODES.TEXT, APP_MODES.SEARCH]

export default function AppShell() {
  const mode = useAppStore((state) => state.mode)
  const setMode = useAppStore((state) => state.setMode)
  const leaveGuards = useAppStore((state) => state.leaveGuards)
  const sessionProviders = useAppStore((state) => state.sessionProviders)
  const setRestoreSessionState = useAppStore((state) => state.setRestoreSessionState)
  const textAutoPlayRunning = useAppStore((state) => state.textAutoPlayRunning)
  const initializeRecentState = useAppStore((state) => state.initializeRecentState)
  const initializeSettings = useSettingsStore((state) => state.initializeSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [restorePrompt, setRestorePrompt] = useState(null)
  const leaveGuardsRef = useRef(leaveGuards)
  const sessionProvidersRef = useRef(sessionProviders)
  const modeRef = useRef(mode)
  const previousModeRef = useRef(mode)
  const defaultModeAppliedRef = useRef(false)

  useShortcutManager(mode, settingsOpen)

  useEffect(() => {
    console.log(`[startup:renderer] AppShell mounted +${Math.round(performance.now())}ms`)
  }, [])

  useEffect(() => {
    initializeRecentState?.()
  }, [initializeRecentState])

  useEffect(() => {
    let canceled = false
    initializeSettings?.().then((settings) => {
      if (canceled || defaultModeAppliedRef.current) return
      defaultModeAppliedRef.current = true
      if (settings?.general?.defaultMode && settings.general.defaultMode !== mode) {
        setMode(settings.general.defaultMode)
      }
    })

    return () => {
      canceled = true
    }
  }, [initializeSettings, mode, setMode])

  useEffect(() => {
    let canceled = false
    if (!window.appApi?.loadLastSessionState) {
      window.debugApi?.log('Last session API is not available.')
      return undefined
    }

    window.appApi.loadLastSessionState().then((result) => {
      if (canceled) return
      if (!result?.ok || !result.sessionState) {
        window.debugApi?.log(`Last session not restored: ${result?.reason || 'not found'}`)
        return
      }

      window.debugApi?.log('Last session found. Restore prompt shown.')
      setRestorePrompt(result.sessionState)
    }).catch((error) => {
      window.debugApi?.log(`Last session load failed: ${error?.message || error}`)
    })

    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    if (!window.appApi?.onShowSettings) {
      return undefined
    }

    return window.appApi.onShowSettings(() => setSettingsOpen(true))
  }, [])

  useEffect(() => {
    leaveGuardsRef.current = leaveGuards
  }, [leaveGuards])

  useEffect(() => {
    sessionProvidersRef.current = sessionProviders
  }, [sessionProviders])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const collectSessionState = () => {
    const providers = sessionProvidersRef.current || {}
    const modes = {}
    Object.entries(providers).forEach(([itemMode, provider]) => {
      try {
        modes[itemMode] = provider?.() || {}
      } catch (error) {
        window.debugApi?.log(`Session snapshot failed: ${itemMode} ${error?.message || error}`)
      }
    })

    return {
      activeMode: modeRef.current,
      modes,
    }
  }

  const runCloseGuards = async () => {
    const guards = leaveGuardsRef.current || {}
    for (const itemMode of guardOrder) {
      const guard = guards[itemMode]
      if (!guard) continue
      const canClose = await (guard?.() ?? true)
      if (!canClose) return false
    }
    return true
  }

  useEffect(() => {
    if (!window.appApi?.onRequestClose) {
      return undefined
    }

    return window.appApi.onRequestClose(async () => {
      const canClose = await runCloseGuards()
      if (canClose) {
        try {
          await window.appApi?.saveLastSessionState?.(collectSessionState())
          window.debugApi?.log('Last session saved.')
        } catch (error) {
          window.debugApi?.log(`Last session save failed: ${error?.message || error}`)
        }
      }
      window.appApi.closeResponse?.(canClose)
    })
  }, [])

  useEffect(() => {
    const previousMode = previousModeRef.current

    if (mode === APP_MODES.TEXT) {
      window.appApi?.dockTextModeWindow?.()
    } else if (previousMode === APP_MODES.TEXT) {
      window.appApi?.restoreWindowAfterTextMode?.()
    }

    previousModeRef.current = mode
  }, [mode])

  const switchMode = async (nextMode) => {
    if (textAutoPlayRunning) return
    if (nextMode === mode) return
    setMode(nextMode)
  }

  const restoreLastSession = () => {
    const sessionState = restorePrompt
    setRestorePrompt(null)
    setRestoreSessionState(sessionState)
    if (Object.values(APP_MODES).includes(sessionState?.activeMode)) {
      setMode(sessionState.activeMode)
    }
  }

  const discardLastSession = () => {
    setRestorePrompt(null)
    setRestoreSessionState(null)
  }

  return (
    <div className="app-shell">
      <nav className="app-dock" aria-label="Mode switch">
        <div className="mode-tabs">
          {Object.values(APP_MODES).map((item) => (
            <button
              aria-label={modeTooltips[item]}
              className={item === mode ? 'mode-tab active' : 'mode-tab'}
              data-tooltip={modeTooltips[item]}
              key={item}
              disabled={textAutoPlayRunning}
              onClick={() => switchMode(item)}
              type="button"
            >
              <i className={modeIconClasses[item]} aria-hidden="true" />
            </button>
          ))}
        </div>
      </nav>

      <main className="mode-view">
        <div className={mode === APP_MODES.VIDEO ? 'mode-panel active' : 'mode-panel'}>
          <VideoMode />
        </div>
        <div className={mode === APP_MODES.IMAGE ? 'mode-panel active' : 'mode-panel'}>
          <ImageMode />
        </div>
        <div className={mode === APP_MODES.TEXT ? 'mode-panel active' : 'mode-panel'}>
          <TextMode />
        </div>
        <div className={mode === APP_MODES.SEARCH ? 'mode-panel active' : 'mode-panel'}>
          <SearchMode />
        </div>
      </main>

      {settingsOpen ? (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onDefaultModeSaved={(defaultMode) => {
            if (Object.values(APP_MODES).includes(defaultMode)) {
              defaultModeAppliedRef.current = true
            }
          }}
        />
      ) : null}

      {restorePrompt ? (
        <div className="startup-restore-layer">
          <div className="startup-restore-dialog" role="dialog" aria-modal="true">
            <div className="startup-restore-title">Restore Last Session</div>
            <div className="startup-restore-message">
              Restore the state saved when the app was last closed?
            </div>
            <div className="startup-restore-actions">
              <button className="primary" onClick={restoreLastSession} type="button">Restore</button>
              <button onClick={discardLastSession} type="button">Discard</button>
            </div>
          </div>
        </div>
      ) : null}

      <AppTooltip />
    </div>
  )
}
