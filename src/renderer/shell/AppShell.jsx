import { useEffect, useRef } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'
import ImageMode from '../modes/ImageMode'
import SearchMode from '../modes/SearchMode'
import TextMode from '../modes/TextMode'
import VideoMode from '../modes/VideoMode'
import AppTooltip from '../components/AppTooltip'

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

function ModeView({ mode }) {
  if (mode === APP_MODES.IMAGE) return <ImageMode />
  if (mode === APP_MODES.TEXT) return <TextMode />
  if (mode === APP_MODES.SEARCH) return <SearchMode />
  return <VideoMode />
}

export default function AppShell() {
  const mode = useAppStore((state) => state.mode)
  const setMode = useAppStore((state) => state.setMode)
  const leaveGuard = useAppStore((state) => state.leaveGuard)
  const initializeRecentState = useAppStore((state) => state.initializeRecentState)
  const leaveGuardRef = useRef(leaveGuard)
  const previousModeRef = useRef(mode)

  useEffect(() => {
    console.log(`[startup:renderer] AppShell mounted +${Math.round(performance.now())}ms`)
  }, [])

  useEffect(() => {
    initializeRecentState?.()
  }, [initializeRecentState])

  useEffect(() => {
    leaveGuardRef.current = leaveGuard
  }, [leaveGuard])

  useEffect(() => {
    if (!window.appApi?.onRequestClose) {
      return undefined
    }

    return window.appApi.onRequestClose(async () => {
      const canClose = await (leaveGuardRef.current?.() ?? true)
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
    if (nextMode === mode) return

    const canLeave = await (leaveGuard?.() ?? true)
    if (!canLeave) return

    setMode(nextMode)
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
              onClick={() => switchMode(item)}
              type="button"
            >
              <i className={modeIconClasses[item]} aria-hidden="true" />
            </button>
          ))}
        </div>
      </nav>

      <main className="mode-view">
        <ModeView mode={mode} />
      </main>

      <AppTooltip />
    </div>
  )
}
