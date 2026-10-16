import { useEffect, useMemo, useRef, useState } from 'react'

const EMPTY_FILTERS = {
  sourceId: '',
  fileId: '',
  tagId: '',
  word: '',
  comment: '',
  characterType: '',
}

function createInitialState(initialState) {
  const filters = {
    sourceId: String(initialState?.filters?.sourceId || ''),
    fileId: String(initialState?.filters?.fileId || ''),
    tagId: String(initialState?.filters?.tagId || ''),
    word: String(initialState?.filters?.word || ''),
    comment: String(initialState?.filters?.comment || ''),
    characterType: String(initialState?.filters?.characterType || ''),
  }
  return {
    filters,
    appliedFilters: {
      sourceId: String(initialState?.appliedFilters?.sourceId ?? filters.sourceId),
      fileId: String(initialState?.appliedFilters?.fileId ?? filters.fileId),
      tagId: String(initialState?.appliedFilters?.tagId ?? filters.tagId),
      word: String(initialState?.appliedFilters?.word ?? filters.word),
      comment: String(initialState?.appliedFilters?.comment ?? filters.comment),
      characterType: String(initialState?.appliedFilters?.characterType ?? filters.characterType),
    },
    offset: Math.max(0, Number(initialState?.offset) || 0),
    expandedWordId: Number(initialState?.expandedWordId) || null,
    loadedFilterPath: String(initialState?.loadedFilterPath || ''),
    loadedFilterName: String(initialState?.loadedFilterName || ''),
    formatDisplay: ['formatted', 'unformatted'].includes(initialState?.formatDisplay)
      ? initialState.formatDisplay
      : initialState?.unformattedOnly === true ? 'unformatted' : 'all',
    sortType: ['source', 'occurrences'].includes(initialState?.sortType) ? initialState.sortType : 'text',
    sortDirection: initialState?.sortDirection === 'desc' ? 'desc' : 'asc',
    loadedFilterFilters: initialState?.loadedFilterFilters ? {
      sourceId: String(initialState.loadedFilterFilters.sourceId || ''),
      fileId: String(initialState.loadedFilterFilters.fileId || ''),
      tagId: String(initialState.loadedFilterFilters.tagId || ''),
      word: String(initialState.loadedFilterFilters.word || ''),
      comment: String(initialState.loadedFilterFilters.comment || ''),
      characterType: String(initialState.loadedFilterFilters.characterType || ''),
    } : null,
  }
}

function formatSourceStats(source) {
  return `${source.fileCount} files · ${source.wordCount} words · ${source.occurrenceCount} records`
}

function formatMarkers(markers) {
  return (Array.isArray(markers) ? markers : []).filter(Boolean).join(' · ')
}

function sanitizeLibraryFilters(filters, filterOptions) {
  const sourceIds = new Set((filterOptions.sources || []).map((source) => String(source.id)))
  const tagIds = new Set((filterOptions.tags || []).map((tag) => String(tag.id)))
  const sourceId = sourceIds.has(String(filters.sourceId || '')) ? String(filters.sourceId) : ''
  const availableFiles = (filterOptions.files || []).filter((file) => (
    !sourceId || String(file.sourceId) === sourceId
  ))
  const fileIds = new Set(availableFiles.map((file) => String(file.id)))

  return {
    sourceId,
    fileId: fileIds.has(String(filters.fileId || '')) ? String(filters.fileId) : '',
    tagId: tagIds.has(String(filters.tagId || '')) ? String(filters.tagId) : '',
    word: String(filters.word || ''),
    comment: String(filters.comment || ''),
    characterType: ['english', 'chinese', 'mixed'].includes(filters.characterType)
      ? filters.characterType
      : '',
  }
}

function areLibraryFiltersEqual(first, second) {
  return first.sourceId === second.sourceId
    && first.fileId === second.fileId
    && first.tagId === second.tagId
    && first.word === second.word
    && first.comment === second.comment
    && first.characterType === second.characterType
}

export default function TextLibraryTab({ initialState, onOpenOccurrence, onSessionStateChange }) {
  const initialRef = useRef(createInitialState(initialState))
  const [sources, setSources] = useState([])
  const [filterOptions, setFilterOptions] = useState({ sources: [], files: [], tags: [] })
  const [filters, setFilters] = useState(initialRef.current.filters)
  const [appliedFilters, setAppliedFilters] = useState(initialRef.current.appliedFilters)
  const [words, setWords] = useState([])
  const [total, setTotal] = useState(0)
  const [formatCounts, setFormatCounts] = useState({ formatted: 0, unformatted: 0, all: 0 })
  const [offset, setOffset] = useState(initialRef.current.offset)
  const [limit, setLimit] = useState(250)
  const [expandedWordId, setExpandedWordId] = useState(initialRef.current.expandedWordId)
  const [loading, setLoading] = useState(true)
  const [sourceBusyId, setSourceBusyId] = useState(null)
  const [selectedSourceIds, setSelectedSourceIds] = useState([])
  const [refreshingSources, setRefreshingSources] = useState(false)
  const [message, setMessage] = useState('')
  const [loadedFilterPath, setLoadedFilterPath] = useState(initialRef.current.loadedFilterPath)
  const [loadedFilterName, setLoadedFilterName] = useState(initialRef.current.loadedFilterName)
  const [loadedFilterFilters, setLoadedFilterFilters] = useState(initialRef.current.loadedFilterFilters)
  const [formatDisplay, setFormatDisplay] = useState(initialRef.current.formatDisplay)
  const [sortType, setSortType] = useState(initialRef.current.sortType)
  const [sortDirection, setSortDirection] = useState(initialRef.current.sortDirection)

  const visibleFiles = useMemo(() => {
    if (!filters.sourceId) return filterOptions.files
    return filterOptions.files.filter((file) => String(file.sourceId) === filters.sourceId)
  }, [filterOptions.files, filters.sourceId])

  const sourceSelectionPending = useMemo(() => {
    const activeIds = sources.filter((source) => source.isEnabled).map((source) => source.id).sort((a, b) => a - b)
    const draftIds = [...selectedSourceIds].sort((a, b) => a - b)
    return activeIds.length !== draftIds.length
      || activeIds.some((sourceId, index) => sourceId !== draftIds[index])
  }, [selectedSourceIds, sources])

  const filterDraftPending = !areLibraryFiltersEqual(filters, appliedFilters)
  const loadedFilterDirty = Boolean(
    loadedFilterPath
    && loadedFilterFilters
    && !areLibraryFiltersEqual(filters, loadedFilterFilters)
  )

  useEffect(() => {
    onSessionStateChange?.({
      filters,
      appliedFilters,
      offset,
      expandedWordId,
      loadedFilterPath,
      loadedFilterName,
      loadedFilterFilters,
      formatDisplay,
      sortType,
      sortDirection,
    })
  }, [
    appliedFilters,
    expandedWordId,
    filters,
    loadedFilterFilters,
    loadedFilterName,
    loadedFilterPath,
    offset,
    onSessionStateChange,
    formatDisplay,
    sortType,
    sortDirection,
  ])

  const loadSources = async ({ syncSelection = false } = {}) => {
    const result = await window.wordLibraryApi?.listSources?.()
    if (!result?.ok) throw new Error(result?.reason || 'list-sources-failed')
    const nextSources = Array.isArray(result.sources) ? result.sources : []
    setSources(nextSources)
    if (syncSelection) {
      setSelectedSourceIds(nextSources.filter((source) => source.isEnabled).map((source) => source.id))
    }
    return nextSources
  }

  const loadFilterOptions = async () => {
    const result = await window.wordLibraryApi?.getFilterOptions?.()
    if (!result?.ok) throw new Error(result?.reason || 'load-filter-options-failed')
    const nextOptions = {
      sources: Array.isArray(result.sources) ? result.sources : [],
      files: Array.isArray(result.files) ? result.files : [],
      tags: Array.isArray(result.tags) ? result.tags : [],
    }
    setFilterOptions(nextOptions)
    return nextOptions
  }

  const queryLibrary = async (nextFilters = filters, nextOffset = 0, nextFormatDisplay = formatDisplay,
    nextSortType = sortType, nextSortDirection = sortDirection) => {
    setLoading(true)
    try {
      const result = await window.wordLibraryApi?.query?.(nextFilters, {
        offset: nextOffset,
        limit: 250,
        formatDisplay: nextFormatDisplay,
        sortType: nextSortType,
        sortDirection: nextSortDirection,
      })
      if (!result?.ok) throw new Error(result?.reason || 'word-library-query-failed')
      setWords(Array.isArray(result.words) ? result.words : [])
      setTotal(Number(result.total || 0))
      setFormatCounts({
        formatted: Number(result.formatCounts?.formatted || 0),
        unformatted: Number(result.formatCounts?.unformatted || 0),
        all: Number(result.formatCounts?.all || 0),
      })
      setLimit(Number(result.limit || 250))
      setOffset(Number(result.offset || 0))
      setAppliedFilters({ ...nextFilters })
      setMessage('')
      return result
    } catch (error) {
      setWords([])
      setTotal(0)
      setFormatCounts({ formatted: 0, unformatted: 0, all: 0 })
      setMessage(`Library query failed: ${error?.message || error}`)
      return null
    } finally {
      setLoading(false)
    }
  }

  const refreshLibrary = async (nextFilters = filters, nextOffset = 0, options = {}) => {
    setLoading(true)
    try {
      const [, nextFilterOptions] = await Promise.all([
        loadSources({ syncSelection: options.syncSelection === true }),
        loadFilterOptions(),
      ])
      const sanitizedFilters = sanitizeLibraryFilters(nextFilters, nextFilterOptions)
      if (!areLibraryFiltersEqual(nextFilters, sanitizedFilters)) {
        setFilters(sanitizedFilters)
      }
      await queryLibrary(sanitizedFilters, nextOffset, options.formatDisplay ?? formatDisplay,
        options.sortType ?? sortType, options.sortDirection ?? sortDirection)
    } catch (error) {
      setMessage(`Library refresh failed: ${error?.message || error}`)
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshLibrary(initialRef.current.filters, initialRef.current.offset, {
      syncSelection: true,
      formatDisplay: initialRef.current.formatDisplay,
      sortType: initialRef.current.sortType,
      sortDirection: initialRef.current.sortDirection,
    })
  }, [])

  const handleAddSource = async () => {
    setMessage('')
    const result = await window.wordLibraryApi?.addSource?.()
    if (result?.canceled) return
    if (!result?.ok) {
      setMessage(`Could not add Source: ${result?.reason || 'unknown error'}`)
      return
    }
    setMessage(result.alreadyExists ? 'Source already exists.' : 'Candidate Source added. Check it to build its index.')
    await loadSources()
  }

  const handleToggleSource = (sourceId, isEnabled) => {
    setSelectedSourceIds((current) => (
      isEnabled
        ? [...new Set([...current, sourceId])]
        : current.filter((item) => item !== sourceId)
    ))
  }

  const handleStartRefresh = async () => {
    setRefreshingSources(true)
    setMessage('Start / Refresh is updating effective Sources and rebuilding their indexes...')
    try {
      const result = await window.wordLibraryApi?.refreshSources?.(selectedSourceIds)
      if (!result?.ok) throw new Error(result?.reason || 'refresh-sources-failed')
      const nextFilters = filters.sourceId && !selectedSourceIds.includes(Number(filters.sourceId))
        ? { ...filters, sourceId: '', fileId: '' }
        : filters
      if (nextFilters !== filters) setFilters(nextFilters)
      const indexedFiles = (result.scans || []).reduce((sum, scan) => sum + Number(scan.fileCount || 0), 0)
      const indexedRecords = (result.scans || []).reduce(
        (sum, scan) => sum + Number(scan.occurrenceCount || 0),
        0
      )
      await refreshLibrary(nextFilters, 0, { syncSelection: true })
      setMessage(
        `Start / Refresh complete: ${result.enabledSourceIds?.length || 0} Sources, `
        + `${indexedFiles} TXT files, ${indexedRecords} records.`
      )
    } catch (error) {
      setMessage(`Start / Refresh failed: ${error?.message || error}`)
      await loadSources({ syncSelection: true }).catch(() => {})
    } finally {
      setRefreshingSources(false)
    }
  }

  const handleDeleteSource = async (source) => {
    setSourceBusyId(source.id)
    setMessage('')
    try {
      const result = await window.wordLibraryApi?.deleteSource?.(source.id)
      if (result?.canceled) return
      if (!result?.ok) throw new Error(result?.reason || 'delete-source-failed')
      const nextFilters = String(filters.sourceId) === String(source.id)
        ? { ...filters, sourceId: '', fileId: '' }
        : filters
      if (nextFilters !== filters) setFilters(nextFilters)
      setSelectedSourceIds((current) => current.filter((sourceId) => sourceId !== source.id))
      setMessage('Source registration and index deleted. TXT files were not changed.')
      await refreshLibrary(nextFilters, 0)
    } catch (error) {
      setMessage(`Could not delete Source: ${error?.message || error}`)
    } finally {
      setSourceBusyId(null)
    }
  }

  const handleSourceFilterChange = (value) => {
    setFilters((current) => ({ ...current, sourceId: value, fileId: '' }))
  }

  const handleClearFilters = () => {
    if (!window.confirm('Clear all filter conditions?')) return
    setFilters(EMPTY_FILTERS)
    setExpandedWordId(null)
    queryLibrary(EMPTY_FILTERS, 0)
  }

  const handleSaveFilter = async () => {
    setMessage('')
    try {
      const result = await window.wordLibraryApi?.saveFilterFile?.(appliedFilters)
      if (result?.canceled) return
      if (!result?.ok) throw new Error(result?.reason || 'save-word-filter-file-failed')
      setLoadedFilterPath(result.filePath || '')
      setLoadedFilterName(result.fileName || '')
      setLoadedFilterFilters({ ...appliedFilters })
      setMessage(`Filter saved: ${result.fileName || result.filePath}`)
    } catch (error) {
      setMessage(`Could not save Filter: ${error?.message || error}`)
    }
  }

  const handleLoadFilter = async () => {
    setMessage('')
    try {
      const result = await window.wordLibraryApi?.loadFilterFile?.()
      if (result?.canceled) return
      if (!result?.ok) throw new Error(result?.reason || 'load-word-filter-file-failed')
      const nextFilters = {
        sourceId: String(result.filters?.sourceId || ''),
        fileId: String(result.filters?.fileId || ''),
        tagId: String(result.filters?.tagId || ''),
        word: String(result.filters?.word || ''),
        comment: String(result.filters?.comment || ''),
        characterType: String(result.filters?.characterType || ''),
      }
      setFilters(nextFilters)
      setLoadedFilterPath(result.filePath || '')
      setLoadedFilterName(result.fileName || '')
      setLoadedFilterFilters(nextFilters)
      setMessage(
        `Filter loaded but not applied: ${result.fileName || result.filePath} (${result.matchedCount || 0} matches).`
      )
    } catch (error) {
      setMessage(`Could not load Filter: ${error?.message || error}`)
    }
  }

  const openOccurrenceExternally = async (occurrence) => {
    const rawLine = String(occurrence?.rawLine ?? '')
    const filePath = String(occurrence?.filePath || '')
    if (!rawLine || !filePath || !window.textApi?.writeClipboardText || !window.textApi?.openTextFileExternal) {
      setMessage('Could not copy and open this word occurrence.')
      window.debugApi?.log(`Word occurrence external open unavailable: ${filePath || '(missing file path)'}`)
      return
    }

    try {
      const copyResult = await window.textApi.writeClipboardText(rawLine)
      if (!copyResult?.ok) throw new Error(copyResult?.reason || 'clipboard-write-failed')
      const openResult = await window.textApi.openTextFileExternal(filePath)
      if (!openResult?.ok) throw new Error(openResult?.reason || 'open-text-file-failed')
      setMessage('Word occurrence copied; TXT opened with the default app.')
    } catch (error) {
      const reason = error?.message || String(error)
      setMessage('Could not copy and open this word occurrence.')
      window.debugApi?.log(`Word occurrence copy/open failed: ${filePath}\n${reason}`)
    }
  }

  const shownStart = total > 0 ? offset + 1 : 0
  const shownEnd = Math.min(offset + words.length, total)
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0
  const currentPage = total > 0 ? Math.min(totalPages, Math.floor(offset / limit) + 1) : 0

  return (
    <div className="text-library-tab" role="tabpanel">
      <section className="text-library-sources">
        <div className="text-library-section-header">
          <strong>Sources</strong>
          {sourceSelectionPending ? <span className="text-library-pending">Pending</span> : null}
          <div className="text-library-header-actions">
            <button
              aria-label="Add Source"
              className="text-icon-button"
              data-tooltip="Add Source folder"
              disabled={refreshingSources}
              onClick={handleAddSource}
              type="button"
            >
              <i className="fa-solid fa-folder-plus" aria-hidden="true" />
            </button>
            <button
              aria-label="Start or refresh Source indexes"
              className="text-library-start-button"
              data-tooltip="Apply Source checkboxes and rebuild all effective Source indexes"
              disabled={refreshingSources}
              onClick={handleStartRefresh}
              type="button"
            >
              <i className={refreshingSources ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-play'} aria-hidden="true" />
              <span>Start / Refresh</span>
            </button>
          </div>
        </div>

        <div className="text-library-source-list">
          {sources.length === 0 ? (
            <div className="text-empty-row">No candidate Sources</div>
          ) : sources.map((source) => {
            const busy = sourceBusyId === source.id
            const selected = selectedSourceIds.includes(source.id)
            return (
              <div className="text-library-source-row" key={source.id} title={source.folderPath}>
                <input
                  aria-label={`Enable ${source.displayName}`}
                  checked={selected}
                  disabled={busy || refreshingSources}
                  onChange={(event) => handleToggleSource(source.id, event.target.checked)}
                  type="checkbox"
                />
                <div className="text-library-source-text">
                  <strong>{source.displayName}</strong>
                  <span>{busy ? 'Working…' : formatSourceStats(source)}</span>
                  {source.lastScanStatus && source.lastScanStatus !== 'ready' ? (
                    <span className={source.lastScanStatus === 'partial' || source.lastScanStatus === 'failed'
                      ? 'text-library-source-state error'
                      : 'text-library-source-state'}
                    >
                      {source.lastScanStatus}
                    </span>
                  ) : null}
                </div>
                <button
                  aria-label={`Delete ${source.displayName}`}
                  className="text-library-small-button danger"
                  data-tooltip="Delete Source registration and index"
                  disabled={busy || refreshingSources}
                  onClick={() => handleDeleteSource(source)}
                  type="button"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="text-library-filters" aria-label="Library filters">
        <div className="text-library-filter-file-actions">
          <button
            aria-label="Save Filter"
            className="text-icon-button"
            data-tooltip="Save the last successfully applied Filter to a file"
            onClick={handleSaveFilter}
            type="button"
          >
            <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
          </button>
          <button
            aria-label="Load Filter"
            className="text-icon-button"
            data-tooltip="Load Filter conditions from a file without applying them"
            onClick={handleLoadFilter}
            type="button"
          >
            <i className="fa-solid fa-folder-open" aria-hidden="true" />
          </button>
          <button
            aria-label="Clear filters"
            className="text-icon-button"
            data-tooltip="Clear filters"
            onClick={handleClearFilters}
            type="button"
          >
            <i className="fa-solid fa-eraser" aria-hidden="true" />
          </button>
          <button
            aria-label="Apply filters"
            className="text-icon-button"
            data-tooltip="Apply filters"
            onClick={() => queryLibrary(filters, 0)}
            type="button"
          >
            <i className="fa-solid fa-filter" aria-hidden="true" />
          </button>
          <span
            className={loadedFilterDirty || filterDraftPending ? 'text-library-filter-file-state pending' : 'text-library-filter-file-state'}
            title={loadedFilterPath || 'No Filter file loaded'}
          >
            {loadedFilterName || 'Unsaved Filter'}
            {loadedFilterDirty ? ' · Modified' : filterDraftPending ? ' · Not applied' : ''}
          </span>
        </div>
        <select
          aria-label="Folder Source filter"
          className="text-file-select"
          data-tooltip="Filter by Source folder"
          onChange={(event) => handleSourceFilterChange(event.target.value)}
          value={filters.sourceId}
        >
          <option value="">All folders</option>
          {filterOptions.sources.map((source) => (
            <option key={source.id} title={source.folderPath} value={source.id}>{source.displayName}</option>
          ))}
        </select>
        <select
          aria-label="File filter"
          className="text-file-select"
          data-tooltip="Filter by TXT file"
          onChange={(event) => setFilters((current) => ({ ...current, fileId: event.target.value }))}
          value={filters.fileId}
        >
          <option value="">All files</option>
          {visibleFiles.map((file) => (
            <option key={file.id} title={file.filePath} value={file.id}>
              {filters.sourceId
                ? (file.relativePath || file.fileName)
                : `${file.sourceName} / ${file.relativePath || file.fileName}`}
            </option>
          ))}
        </select>
        <select
          aria-label="Tag filter"
          className="text-file-select"
          data-tooltip="Filter by word property or tag"
          onChange={(event) => setFilters((current) => ({ ...current, tagId: event.target.value }))}
          value={filters.tagId}
        >
          <option value="">All tags</option>
          {filterOptions.tags.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.name}</option>
          ))}
        </select>
        <input
          aria-label="Word filter"
          className="text-library-word-filter"
          data-tooltip="Case-insensitive word search; canonical identity remains case-sensitive"
          onChange={(event) => setFilters((current) => ({ ...current, word: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') queryLibrary(filters, 0)
          }}
          placeholder="Word contains…"
          type="text"
          value={filters.word}
        />
        <select
          aria-label="Word character type"
          className="text-file-select text-library-character-filter"
          data-tooltip="Filter Word text by its Unicode letter types"
          onChange={(event) => setFilters((current) => ({ ...current, characterType: event.target.value }))}
          value={filters.characterType}
        >
          <option value="">Characters: Any</option>
          <option value="english">English only</option>
          <option value="chinese">Contains Chinese</option>
          <option value="mixed">English + Chinese</option>
        </select>
        <input
          aria-label="Comment filter"
          className="text-library-word-filter"
          data-tooltip="Case-insensitive search in occurrence comments"
          onChange={(event) => setFilters((current) => ({ ...current, comment: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') queryLibrary(filters, 0)
          }}
          placeholder="Comment contains…"
          type="text"
          value={filters.comment}
        />
        <select
          aria-label="Sort type"
          className="text-file-select text-library-sort-select"
          data-tooltip="Sort the complete result before pagination"
          onChange={(event) => {
            const next = event.target.value
            setSortType(next)
            setExpandedWordId(null)
            queryLibrary(appliedFilters, 0, formatDisplay, next, sortDirection)
          }}
          value={sortType}
        >
          <option value="text">Sort: Text</option>
          <option value="source">Source / File / Line</option>
          <option value="occurrences">Occurrences</option>
        </select>
        <button
          aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
          className="text-icon-button"
          data-tooltip={sortDirection === 'asc' ? 'Ascending; click for descending' : 'Descending; click for ascending'}
          onClick={() => {
            const next = sortDirection === 'asc' ? 'desc' : 'asc'
            setSortDirection(next)
            setExpandedWordId(null)
            queryLibrary(appliedFilters, 0, formatDisplay, sortType, next)
          }}
          type="button"
        >
          <i className={sortDirection === 'asc' ? 'fa-solid fa-arrow-up' : 'fa-solid fa-arrow-down'} aria-hidden="true" />
        </button>
        <select
          aria-label="Display filter"
          className="text-file-select text-library-display-filter"
          data-tooltip="Temporary display filter; it is not saved in Filter files"
          onChange={(event) => {
            const next = event.target.value
            setFormatDisplay(next)
            setExpandedWordId(null)
            queryLibrary(appliedFilters, 0, next)
          }}
          value={formatDisplay}
        >
          <option value="all">Display: All</option>
          <option value="formatted">Formatted</option>
          <option value="unformatted">Unformatted</option>
        </select>
      </section>

      <section className="text-library-results">
        <div className="text-library-result-title">
          <strong>筛选结果单词</strong>
          {loading ? <span>Loading…</span> : <div className="text-library-result-summary">
            <span>Fm: {formatCounts.formatted} / Ufm: {formatCounts.unformatted} / All: {formatCounts.all}</span>
            <span>{shownStart}–{shownEnd} / {total}</span>
          </div>}
        </div>
        <div className="text-library-word-list">
          {!loading && words.length === 0 ? (
            <div className="text-empty-row">No matching words</div>
          ) : words.map((word) => {
            const expanded = expandedWordId === word.id
            const containsUnformatted = word.occurrences.some((occurrence) => occurrence.isUnformatted)
            return (
              <article className={`text-library-word-group${expanded ? ' expanded' : ''}${containsUnformatted ? ' unformatted' : ''}`} key={word.id}>
                <button
                  className="text-library-word-header"
                  onClick={() => setExpandedWordId(expanded ? null : word.id)}
                  title={word.normalizedWord}
                  type="button"
                >
                  <i className={expanded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'} aria-hidden="true" />
                  <strong>{word.displayWord}</strong>
                  <span>{word.occurrenceCount}</span>
                </button>
                {expanded ? (
                  <div className="text-library-occurrences">
                    {word.occurrences.map((occurrence) => {
                      const markerText = formatMarkers(occurrence.markers)
                      return (
                        <div className={`text-library-occurrence${occurrence.isUnformatted ? ' unformatted' : ''}`} key={occurrence.id} title={occurrence.filePath}>
                          <div className="text-library-occurrence-head two-actions">
                            <span>{occurrence.sourceName} / {occurrence.relativePath} : {occurrence.lineNumber}</span>
                            <button
                              aria-label="Open occurrence in Words"
                              className="text-library-small-button"
                              data-tooltip="Open this occurrence in WORDS"
                              onClick={() => onOpenOccurrence?.(occurrence)}
                              type="button"
                            >
                              <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                            </button>
                            <button
                              aria-label="Copy note and open TXT"
                              className="text-library-small-button"
                              data-tooltip="Copy note and open TXT"
                              onClick={() => openOccurrenceExternally(occurrence)}
                              type="button"
                            >
                              <i className="fa-solid fa-file-lines" aria-hidden="true" />
                            </button>
                          </div>
                          {markerText ? <div className="text-library-occurrence-tags">{markerText}</div> : null}
                          <div className="text-library-occurrence-content">
                            {occurrence.annotation || occurrence.rawLine || occurrence.sourceWord}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <footer className="text-library-footer">
        <span className={message.includes('failed') || message.includes('Could not') ? 'error' : ''}>{message}</span>
        <span className="text-library-page-info">
          Page {currentPage}/{totalPages} · {limit} words/page
        </span>
        <div>
          <button
            disabled={loading || offset <= 0}
            onClick={() => queryLibrary(appliedFilters, Math.max(0, offset - limit))}
            type="button"
          >
            Previous
          </button>
          <button
            disabled={loading || offset + words.length >= total}
            onClick={() => queryLibrary(appliedFilters, offset + limit)}
            type="button"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  )
}
