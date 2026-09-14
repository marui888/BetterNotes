import { useEffect, useRef, useState } from 'react'

export default function FilterHistoryInput({
  className = '',
  error = '',
  history = [],
  onChange,
  onDelete,
  title = '',
  value = '',
}) {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined

    const closeWhenOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }

    window.addEventListener('pointerdown', closeWhenOutside)
    return () => window.removeEventListener('pointerdown', closeWhenOutside)
  }, [open])

  return (
    <div className={['filter-history-field', error ? 'invalid' : '', className].filter(Boolean).join(' ')}>
      <span>Filter</span>
      <div className="filter-history-combobox" ref={rootRef}>
        <input
          aria-autocomplete="list"
          aria-expanded={open}
          onChange={(event) => onChange?.(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') setOpen(false)
          }}
          title={title}
          type="text"
          value={value}
        />
        <button
          aria-label="Show saved filters"
          aria-expanded={open}
          className="filter-history-trigger"
          onClick={() => setOpen((current) => !current)}
          tabIndex={-1}
          title="Saved filters"
          type="button"
        >
          <i className="fa-solid fa-caret-down" aria-hidden="true" />
        </button>
        {open ? (
          <div className="filter-history-menu" role="listbox">
            {history.length === 0 ? (
              <div className="filter-history-empty">No saved filters</div>
            ) : history.map((item) => (
              <div className="filter-history-row" key={item}>
                <button
                  className="filter-history-option"
                  onClick={() => {
                    onChange?.(item)
                    setOpen(false)
                  }}
                  title={item}
                  type="button"
                >
                  {item}
                </button>
                <button
                  aria-label={`Delete filter: ${item}`}
                  className="filter-history-delete"
                  data-tooltip="Delete filter"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onDelete?.(item)
                  }}
                  onPointerDown={(event) => event.preventDefault()}
                  type="button"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <span className="notes-filter-error">Invalid</span> : null}
    </div>
  )
}
