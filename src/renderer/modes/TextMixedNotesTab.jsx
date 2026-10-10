import { useEffect, useMemo, useRef, useState } from 'react'

const EMPTY_FILTERS = {
  sourceId: '', fileId: '', noteType: '', year: '', month: '',
  computerName: '', wps: '', comment: '',
}

const equalFilters = (a, b) => Object.keys(EMPTY_FILTERS).every((key) => String(a?.[key] || '') === String(b?.[key] || ''))

function initial(initialState) {
  const filters = { ...EMPTY_FILTERS, ...(initialState?.filters || {}) }
  return {
    filters,
    appliedFilters: { ...filters, ...(initialState?.appliedFilters || {}) },
    offset: Math.max(0, Number(initialState?.offset) || 0),
    expandedWordId: Number(initialState?.expandedWordId) || null,
    loadedFilterPath: String(initialState?.loadedFilterPath || ''),
    loadedFilterName: String(initialState?.loadedFilterName || ''),
    formatDisplay: ['formatted', 'unformatted'].includes(initialState?.formatDisplay)
      ? initialState.formatDisplay
      : initialState?.unformattedOnly === true ? 'unformatted' : 'all',
    sortType: ['source', 'occurrences'].includes(initialState?.sortType) ? initialState.sortType : 'text',
    sortDirection: initialState?.sortDirection === 'desc' ? 'desc' : 'asc',
    loadedFilterFilters: initialState?.loadedFilterFilters ? { ...EMPTY_FILTERS, ...initialState.loadedFilterFilters } : null,
  }
}

const stats = (source) => `${source.fileCount} files · ${source.wordCount} WPS · ${source.occurrenceCount} records`

export default function TextMixedNotesTab({ initialState, onSessionStateChange }) {
  const initialRef = useRef(initial(initialState))
  const api = window.mixedNotesApi
  const [sources, setSources] = useState([])
  const [selectedSourceIds, setSelectedSourceIds] = useState([])
  const [options, setOptions] = useState({ sources: [], files: [], noteTypes: [], years: [], computers: [] })
  const [filters, setFilters] = useState(initialRef.current.filters)
  const [appliedFilters, setAppliedFilters] = useState(initialRef.current.appliedFilters)
  const [words, setWords] = useState([])
  const [total, setTotal] = useState(0)
  const [formatCounts, setFormatCounts] = useState({ formatted: 0, unformatted: 0, all: 0 })
  const [offset, setOffset] = useState(initialRef.current.offset)
  const [limit, setLimit] = useState(250)
  const [expandedWordId, setExpandedWordId] = useState(initialRef.current.expandedWordId)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busySourceId, setBusySourceId] = useState(null)
  const [message, setMessage] = useState('')
  const [loadedFilterPath, setLoadedFilterPath] = useState(initialRef.current.loadedFilterPath)
  const [loadedFilterName, setLoadedFilterName] = useState(initialRef.current.loadedFilterName)
  const [loadedFilterFilters, setLoadedFilterFilters] = useState(initialRef.current.loadedFilterFilters)
  const [formatDisplay, setFormatDisplay] = useState(initialRef.current.formatDisplay)
  const [sortType, setSortType] = useState(initialRef.current.sortType)
  const [sortDirection, setSortDirection] = useState(initialRef.current.sortDirection)

  const visibleFiles = useMemo(() => filters.sourceId
    ? options.files.filter((file) => String(file.sourceId) === String(filters.sourceId))
    : options.files, [filters.sourceId, options.files])
  const sourcePending = useMemo(() => {
    const current = sources.filter((s) => s.isEnabled).map((s) => s.id).sort((a, b) => a - b)
    const draft = [...selectedSourceIds].sort((a, b) => a - b)
    return current.length !== draft.length || current.some((id, index) => id !== draft[index])
  }, [selectedSourceIds, sources])
  const filterPending = !equalFilters(filters, appliedFilters)
  const loadedDirty = Boolean(loadedFilterFilters && !equalFilters(filters, loadedFilterFilters))

  useEffect(() => onSessionStateChange?.({ filters, appliedFilters, offset, expandedWordId,
    loadedFilterPath, loadedFilterName, loadedFilterFilters, formatDisplay, sortType, sortDirection }), [filters, appliedFilters, offset,
    expandedWordId, loadedFilterPath, loadedFilterName, loadedFilterFilters, onSessionStateChange,
    formatDisplay, sortType, sortDirection])

  const loadSources = async (sync = false) => {
    const result = await api?.listSources?.()
    if (!result?.ok) throw new Error(result?.reason || 'list-sources-failed')
    const next = result.sources || []
    setSources(next)
    if (sync) setSelectedSourceIds(next.filter((source) => source.isEnabled).map((source) => source.id))
    return next
  }

  const loadOptions = async () => {
    const result = await api?.getFilterOptions?.()
    if (!result?.ok) throw new Error(result?.reason || 'load-filter-options-failed')
    const next = {
      sources: result.sources || [], files: result.files || [], noteTypes: result.noteTypes || [],
      years: result.years || [], computers: result.computers || [],
    }
    setOptions(next)
    return next
  }

  const sanitize = (value, nextOptions) => {
    const next = { ...EMPTY_FILTERS, ...value }
    if (!nextOptions.sources.some((source) => String(source.id) === String(next.sourceId))) {
      next.sourceId = ''; next.fileId = ''
    }
    const files = nextOptions.files.filter((file) => !next.sourceId || String(file.sourceId) === String(next.sourceId))
    if (!files.some((file) => String(file.id) === String(next.fileId))) next.fileId = ''
    return next
  }

  const query = async (nextFilters = filters, nextOffset = 0, nextFormatDisplay = formatDisplay,
    nextSortType = sortType, nextSortDirection = sortDirection) => {
    setLoading(true)
    try {
      const result = await api?.query?.(nextFilters, {
        offset: nextOffset, limit: 250, formatDisplay: nextFormatDisplay,
        sortType: nextSortType, sortDirection: nextSortDirection,
      })
      if (!result?.ok) throw new Error(result?.reason || 'mixed-notes-query-failed')
      setWords(result.words || []); setTotal(Number(result.total || 0)); setLimit(Number(result.limit || 250))
      setFormatCounts({ formatted: Number(result.formatCounts?.formatted || 0),
        unformatted: Number(result.formatCounts?.unformatted || 0), all: Number(result.formatCounts?.all || 0) })
      setOffset(Number(result.offset || 0)); setAppliedFilters({ ...nextFilters }); setMessage('')
    } catch (error) {
      setWords([]); setTotal(0); setFormatCounts({ formatted: 0, unformatted: 0, all: 0 })
      setMessage(`Mixed Notes query failed: ${error?.message || error}`)
    } finally { setLoading(false) }
  }

  const refresh = async (nextFilters = filters, nextOffset = 0, sync = false,
    nextFormatDisplay = formatDisplay, nextSortType = sortType, nextSortDirection = sortDirection) => {
    try {
      const [, nextOptions] = await Promise.all([loadSources(sync), loadOptions()])
      const safe = sanitize(nextFilters, nextOptions)
      if (!equalFilters(nextFilters, safe)) setFilters(safe)
      await query(safe, nextOffset, nextFormatDisplay, nextSortType, nextSortDirection)
    } catch (error) { setMessage(`Mixed Notes refresh failed: ${error?.message || error}`); setLoading(false) }
  }

  useEffect(() => { refresh(initialRef.current.filters, initialRef.current.offset, true,
    initialRef.current.formatDisplay, initialRef.current.sortType, initialRef.current.sortDirection) }, [])

  const addSource = async () => {
    const result = await api?.addSource?.()
    if (result?.canceled) return
    if (!result?.ok) return setMessage(result?.message || `Could not add Source: ${result?.reason || 'unknown error'}`)
    setMessage(result.alreadyExists ? 'Source already exists.' : 'Candidate Source added. Check it to build its index.')
    await loadSources()
  }

  const startRefresh = async () => {
    setRefreshing(true); setMessage('Start / Refresh is rebuilding Mixed Notes indexes...')
    try {
      const result = await api?.refreshSources?.(selectedSourceIds)
      if (!result?.ok) throw new Error(result?.message || result?.reason || 'refresh-sources-failed')
      const files = (result.scans || []).reduce((sum, scan) => sum + Number(scan.fileCount || 0), 0)
      const records = (result.scans || []).reduce((sum, scan) => sum + Number(scan.occurrenceCount || 0), 0)
      const plain = (result.scans || []).reduce((sum, scan) => sum + Number(scan.plainLineCount || 0), 0)
      await refresh(filters, 0, true)
      setMessage(`Start / Refresh complete: ${result.enabledSourceIds?.length || 0} Sources, ${files} TXT files, ${records} records, ${plain} plain-line items.`)
    } catch (error) { setMessage(`Start / Refresh failed: ${error?.message || error}`) }
    finally { setRefreshing(false) }
  }

  const deleteSource = async (source) => {
    setBusySourceId(source.id)
    try {
      const result = await api?.deleteSource?.(source.id)
      if (result?.canceled) return
      if (!result?.ok) throw new Error(result?.reason || 'delete-source-failed')
      const next = String(filters.sourceId) === String(source.id) ? { ...filters, sourceId: '', fileId: '' } : filters
      setFilters(next); setSelectedSourceIds((ids) => ids.filter((id) => id !== source.id))
      await refresh(next, 0)
      setMessage('Source registration and index deleted. TXT files were not changed.')
    } catch (error) { setMessage(`Could not delete Source: ${error?.message || error}`) }
    finally { setBusySourceId(null) }
  }

  const saveFilter = async () => {
    const result = await api?.saveFilterFile?.(appliedFilters)
    if (result?.canceled) return
    if (!result?.ok) return setMessage(`Could not save Filter: ${result?.reason || 'unknown error'}`)
    setLoadedFilterPath(result.filePath || ''); setLoadedFilterName(result.fileName || '')
    setLoadedFilterFilters({ ...appliedFilters }); setMessage(`Filter saved: ${result.fileName}`)
  }

  const loadFilter = async () => {
    const result = await api?.loadFilterFile?.()
    if (result?.canceled) return
    if (!result?.ok) return setMessage(`Could not load Filter: ${result?.reason || 'unknown error'}`)
    const next = { ...EMPTY_FILTERS, ...(result.filters || {}) }
    setFilters(next); setLoadedFilterPath(result.filePath || ''); setLoadedFilterName(result.fileName || '')
    setLoadedFilterFilters(next)
    setMessage(`Filter loaded but not applied: ${result.fileName} (${result.matchedCount || 0} matches).`)
  }

  const clearFilters = () => {
    if (!window.confirm('Clear all filter conditions?')) return
    setFilters(EMPTY_FILTERS)
    setExpandedWordId(null)
    query(EMPTY_FILTERS, 0)
  }

  const openOccurrenceExternally = async (occurrence) => {
    const rawLine = String(occurrence?.rawLine ?? '')
    const filePath = String(occurrence?.filePath || '')
    if (!rawLine || !filePath || !window.textApi?.writeClipboardText || !window.textApi?.openTextFileExternal) {
      setMessage('Could not copy and open this Mixed Note.')
      window.debugApi?.log(`Mixed Note external open unavailable: ${filePath || '(missing file path)'}`)
      return
    }

    try {
      const copyResult = await window.textApi.writeClipboardText(rawLine)
      if (!copyResult?.ok) throw new Error(copyResult?.reason || 'clipboard-write-failed')
      const openResult = await window.textApi.openTextFileExternal(filePath)
      if (!openResult?.ok) throw new Error(openResult?.reason || 'open-text-file-failed')
      setMessage('Mixed Note copied; TXT opened with the default app.')
    } catch (error) {
      const reason = error?.message || String(error)
      setMessage('Could not copy and open this Mixed Note.')
      window.debugApi?.log(`Mixed Note copy/open failed: ${filePath}\n${reason}`)
    }
  }

  const shownStart = total ? offset + 1 : 0
  const shownEnd = Math.min(offset + words.length, total)
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0
  const currentPage = total > 0 ? Math.min(totalPages, Math.floor(offset / limit) + 1) : 0
  const set = (key, value) => setFilters((current) => ({ ...current, [key]: value,
    ...(key === 'sourceId' ? { fileId: '' } : {}) }))

  return <div className="text-library-tab" role="tabpanel">
    <section className="text-library-sources">
      <div className="text-library-section-header"><strong>Mixed Notes Sources</strong>
        {sourcePending ? <span className="text-library-pending">Pending</span> : null}
        <div className="text-library-header-actions">
          <button aria-label="Add Source" className="text-icon-button" data-tooltip="Add Mixed Notes Source folder" disabled={refreshing} onClick={addSource} type="button"><i className="fa-solid fa-folder-plus" /></button>
          <button className="text-library-start-button" disabled={refreshing} onClick={startRefresh} type="button"><i className={refreshing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-play'} /><span>Start / Refresh</span></button>
        </div>
      </div>
      <div className="text-library-source-list">
        {!sources.length ? <div className="text-empty-row">No candidate Sources</div> : sources.map((source) => <div className="text-library-source-row" key={source.id} title={source.folderPath}>
          <input checked={selectedSourceIds.includes(source.id)} disabled={refreshing || busySourceId === source.id} onChange={(event) => setSelectedSourceIds((ids) => event.target.checked ? [...new Set([...ids, source.id])] : ids.filter((id) => id !== source.id))} type="checkbox" />
          <div className="text-library-source-text"><strong>{source.displayName}</strong><span>{stats(source)}</span>{source.lastScanStatus && source.lastScanStatus !== 'ready' ? <span className="text-library-source-state error">{source.lastScanStatus}</span> : null}</div>
          <button className="text-library-small-button danger" data-tooltip="Delete Source registration and index" disabled={refreshing || busySourceId === source.id} onClick={() => deleteSource(source)} type="button"><i className="fa-solid fa-xmark" /></button>
        </div>)}
      </div>
    </section>
    <section className="text-library-filters mixed-note-filters" aria-label="Mixed Notes filters">
      <div className="text-library-filter-file-actions">
        <button className="text-icon-button" data-tooltip="Save the applied Mixed Notes Filter" onClick={saveFilter} type="button"><i className="fa-solid fa-floppy-disk" /></button>
        <button className="text-icon-button" data-tooltip="Load Mixed Notes Filter without applying it" onClick={loadFilter} type="button"><i className="fa-solid fa-folder-open" /></button>
        <button aria-label="Clear filters" className="text-icon-button" data-tooltip="Clear filters" onClick={clearFilters} type="button"><i className="fa-solid fa-eraser" /></button>
        <button aria-label="Apply filters" className="text-icon-button" data-tooltip="Apply filters" onClick={() => query(filters, 0)} type="button"><i className="fa-solid fa-filter" /></button>
        <span className={loadedDirty || filterPending ? 'text-library-filter-file-state pending' : 'text-library-filter-file-state'} title={loadedFilterPath}>{loadedFilterName || 'Unsaved Filter'}{loadedDirty ? ' · Modified' : filterPending ? ' · Not applied' : ''}</span>
      </div>
      <select className="text-file-select" value={filters.sourceId} onChange={(e) => set('sourceId', e.target.value)}><option value="">All folders</option>{options.sources.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}</select>
      <select className="text-file-select" value={filters.fileId} onChange={(e) => set('fileId', e.target.value)}><option value="">All files</option>{visibleFiles.map((x) => <option key={x.id} value={x.id}>{filters.sourceId ? x.relativePath : `${x.sourceName} / ${x.relativePath}`}</option>)}</select>
      <select className="text-file-select" value={filters.noteType} onChange={(e) => set('noteType', e.target.value)}><option value="">All types</option>{options.noteTypes.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      <select className="text-file-select" value={filters.year} onChange={(e) => set('year', e.target.value)}><option value="">All years</option>{options.years.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      <select className="text-file-select" value={filters.month} onChange={(e) => set('month', e.target.value)}><option value="">All months</option>{Array.from({ length: 12 }, (_, i) => i + 1).map((x) => <option key={x} value={x}>{x}</option>)}</select>
      <select className="text-file-select" value={filters.computerName} onChange={(e) => set('computerName', e.target.value)}><option value="">All computers</option>{options.computers.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      <input className="text-library-word-filter" placeholder="WPS contains..." value={filters.wps} onChange={(e) => set('wps', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && query(filters, 0)} />
      <input className="text-library-word-filter" placeholder="Comment contains..." value={filters.comment} onChange={(e) => set('comment', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && query(filters, 0)} />
      <select aria-label="Sort type" className="text-file-select text-library-sort-select" data-tooltip="Sort the complete result before pagination" onChange={(event) => {
        const next = event.target.value
        setSortType(next); setExpandedWordId(null); query(appliedFilters, 0, formatDisplay, next, sortDirection)
      }} value={sortType}>
        <option value="text">Sort: Text</option><option value="source">Source / File / Line</option><option value="occurrences">Occurrences</option>
      </select>
      <button aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'} className="text-icon-button" data-tooltip={sortDirection === 'asc' ? 'Ascending; click for descending' : 'Descending; click for ascending'} onClick={() => {
        const next = sortDirection === 'asc' ? 'desc' : 'asc'
        setSortDirection(next); setExpandedWordId(null); query(appliedFilters, 0, formatDisplay, sortType, next)
      }} type="button"><i className={sortDirection === 'asc' ? 'fa-solid fa-arrow-up' : 'fa-solid fa-arrow-down'} aria-hidden="true" /></button>
      <select aria-label="Display filter" className="text-file-select text-library-display-filter" data-tooltip="Temporary display filter; it is not saved in Filter files" onChange={(event) => {
        const next = event.target.value
        setFormatDisplay(next); setExpandedWordId(null); query(appliedFilters, 0, next)
      }} value={formatDisplay}>
        <option value="all">Display: All</option><option value="formatted">Formatted</option><option value="unformatted">Unformatted</option>
      </select>
    </section>
    <section className="text-library-results"><div className="text-library-result-title"><strong>Mixed Notes Results</strong>{loading ? <span>Loading...</span> : <div className="text-library-result-summary"><span>Fm: {formatCounts.formatted} / Ufm: {formatCounts.unformatted} / All: {formatCounts.all}</span><span>{shownStart}–{shownEnd} / {total}</span></div>}</div>
      <div className="text-library-word-list">{!loading && !words.length ? <div className="text-empty-row">No matching WPS</div> : words.map((word) => {
        const expanded = expandedWordId === word.id
        const containsUnformatted = word.occurrences.some((occurrence) => occurrence.isPlainLine)
        return <article className={`text-library-word-group${expanded ? ' expanded' : ''}${containsUnformatted ? ' unformatted' : ''}`} key={word.id}>
          <button className="text-library-word-header" onClick={() => setExpandedWordId(expanded ? null : word.id)} type="button"><i className={expanded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'} /><strong>{word.displayWord}</strong><span>{word.occurrenceCount}</span></button>
          {expanded ? <div className="text-library-occurrences">{word.occurrences.map((occurrence) => <div className={`text-library-occurrence${occurrence.isPlainLine ? ' unformatted' : ''}`} key={occurrence.id} title={occurrence.filePath}>
            <div className="text-library-occurrence-head"><span>{occurrence.sourceName} / {occurrence.relativePath} : {occurrence.lineNumber}</span>
              <button aria-label="Copy note and open TXT" className="text-library-small-button" data-tooltip="Copy note and open TXT" onClick={() => openOccurrenceExternally(occurrence)} type="button"><i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /></button>
            </div>
            {occurrence.markers?.length ? <div className="text-library-occurrence-tags">{occurrence.markers.join(' · ')}</div> : null}
            {occurrence.annotation ? <div className="text-library-occurrence-content">{occurrence.annotation}</div> : null}
          </div>)}</div> : null}
        </article>
      })}</div>
    </section>
    <footer className="text-library-footer"><span className={/failed|Could not/i.test(message) ? 'error' : ''}>{message}</span>
      <span className="text-library-page-info">Page {currentPage}/{totalPages} · {limit} WPS items/page</span><div>
      <button disabled={loading || offset <= 0} onClick={() => query(appliedFilters, Math.max(0, offset - limit))} type="button">Previous</button>
      <button disabled={loading || offset + words.length >= total} onClick={() => query(appliedFilters, offset + limit)} type="button">Next</button>
    </div></footer>
  </div>
}
