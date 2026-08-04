import { useEffect, useRef, useState } from 'react'

export default function DebugWindow() {
  const [items, setItems] = useState([])
  const listRef = useRef(null)

  useEffect(() => {
    document.body.classList.add('debug-body')
    return () => document.body.classList.remove('debug-body')
  }, [])

  useEffect(() => {
    if (!window.debugApi?.onAppend) {
      return undefined
    }

    return window.debugApi.onAppend((item) => {
      setItems((currentItems) => [
        ...currentItems,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          createdAt: item?.createdAt || new Date().toLocaleTimeString(),
          message: item?.message || '',
        },
      ])
    })
  }, [])

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'end' })
  }, [items])

  return (
    <main className="debug-window">
      <header className="debug-window-header">
        <strong>Debug Info</strong>
        <div className="debug-window-actions">
          <button type="button" onClick={() => setItems([])}>Clear</button>
          <button
            aria-label="Close Debug Info"
            className="debug-close-button"
            type="button"
            onClick={() => window.debugApi?.close?.()}
          >
            x
          </button>
        </div>
      </header>
      <section className="debug-log-list" ref={listRef}>
        {items.length === 0 ? (
          <div className="debug-empty">No debug info</div>
        ) : items.map((item) => (
          <article className="debug-log-item" key={item.id}>
            <div className="debug-log-time">{item.createdAt}</div>
            <pre>{item.message}</pre>
          </article>
        ))}
      </section>
    </main>
  )
}
