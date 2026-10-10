import { useEffect, useRef, useState } from 'react'
import SimpleContextMenu from '../components/SimpleContextMenu'

const PLAN_PAGE_SIZE = 250

function getPlanItemPageOffset(item) {
  const itemOrder = Math.max(1, Number(item?.itemOrder) || 1)
  return Math.floor((itemOrder - 1) / PLAN_PAGE_SIZE) * PLAN_PAGE_SIZE
}

function createInitialState(initialState) {
  return {
    selectedPlanId: Number(initialState?.selectedPlanId) || null,
    offset: Math.max(0, Number(initialState?.offset) || 0),
    expandedItemId: Number(initialState?.expandedItemId) || null,
    filterFilePath: String(initialState?.filterFilePath || ''),
    filterFileName: String(initialState?.filterFileName || ''),
    reviewMode: Boolean(initialState?.reviewMode),
    historyOpen: Boolean(initialState?.historyOpen),
    expandedHistorySessionId: Number(initialState?.expandedHistorySessionId) || null,
    planSelectionCleared: Boolean(initialState?.planSelectionCleared),
  }
}

function formatFilterSummary(snapshot = {}) {
  const conditions = snapshot?.conditions
  if (conditions) {
    const parts = []
    if (conditions.source?.folderPath) parts.push(`Folder: ${conditions.source.folderPath}`)
    if (conditions.file?.relativePath) parts.push(`File: ${conditions.file.relativePath}`)
    if (conditions.tag?.name) parts.push(`Tag: ${conditions.tag.name}`)
    if (conditions.word?.value) parts.push(`Word: ${conditions.word.value}`)
    if (conditions.noteType) parts.push(`Type: ${conditions.noteType}`)
    if (conditions.year) parts.push(`Year: ${conditions.year}`)
    if (conditions.month) parts.push(`Month: ${conditions.month}`)
    if (conditions.computerName) parts.push(`Computer: ${conditions.computerName}`)
    if (conditions.wps) parts.push(`WPS: ${conditions.wps}`)
    if (conditions.comment) parts.push(`Comment: ${conditions.comment}`)
    return parts.length > 0 ? parts.join(' · ') : 'All effective Sources'
  }

  const filters = snapshot?.filters || snapshot
  const parts = []
  if (filters.sourceId) parts.push(`Folder #${filters.sourceId}`)
  if (filters.fileId) parts.push(`File #${filters.fileId}`)
  if (filters.tagId) parts.push(`Tag #${filters.tagId}`)
  if (filters.word) parts.push(`Word: ${filters.word}`)
  return parts.length > 0 ? parts.join(' · ') : 'All effective Sources'
}

export default function TextStudyPlanTab({
  initialState,
  libraryApi,
  showEmptyOccurrences = false,
  showDictionaryAction = true,
  itemLabel = 'word',
  occurrenceFontSize = 14,
  occurrenceMinFontSize = 10,
  onReviewWordLookup,
  onSessionStateChange,
}) {
  const api = libraryApi || window.wordLibraryApi
  const itemPlural = itemLabel === 'word' ? 'words' : `${itemLabel} items`
  const initialRef = useRef(createInitialState(initialState))
  const planSelectorRef = useRef(null)
  const reviewPanelRef = useRef(null)
  const resultsPanelRef = useRef(null)
  const reviewSplitDragRef = useRef(null)
  const occurrenceListRef = useRef(null)
  const reviewWordLookupRef = useRef(onReviewWordLookup)
  const lastAutoLookupKeyRef = useRef('')
  const resolvedOccurrenceFontSize = Math.max(
    10,
    Math.min(32, Math.round(Number(occurrenceFontSize) || 14))
  )
  const resolvedOccurrenceMinFontSize = Math.min(
    resolvedOccurrenceFontSize,
    Math.max(8, Math.min(32, Math.round(Number(occurrenceMinFontSize) || 10)))
  )
  const [plans, setPlans] = useState([])
  const [selectedPlanId, setSelectedPlanId] = useState(initialRef.current.selectedPlanId)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(initialRef.current.offset)
  const [limit, setLimit] = useState(250)
  const [expandedItemId, setExpandedItemId] = useState(initialRef.current.expandedItemId)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newPlanName, setNewPlanName] = useState('')
  const [message, setMessage] = useState('')
  const [filterFilePath, setFilterFilePath] = useState(initialRef.current.filterFilePath)
  const [filterFileName, setFilterFileName] = useState(initialRef.current.filterFileName)
  const [filterDefinition, setFilterDefinition] = useState(null)
  const [filterMatchCount, setFilterMatchCount] = useState(null)
  const [activeSession, setActiveSession] = useState(null)
  const [reviewMode, setReviewMode] = useState(initialRef.current.reviewMode)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(initialRef.current.historyOpen)
  const [historySummary, setHistorySummary] = useState(null)
  const [historySessions, setHistorySessions] = useState([])
  const [historyEvents, setHistoryEvents] = useState({})
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedHistorySessionId, setExpandedHistorySessionId] = useState(
    initialRef.current.expandedHistorySessionId
  )
  const [planSelectorOpen, setPlanSelectorOpen] = useState(false)
  const [planSelectionCleared, setPlanSelectionCleared] = useState(
    initialRef.current.planSelectionCleared
  )
  const [reviewOccurrences, setReviewOccurrences] = useState([])
  const [reviewOccurrencesLoading, setReviewOccurrencesLoading] = useState(false)
  const [reviewOccurrencesError, setReviewOccurrencesError] = useState('')
  const [occurrenceSnapshotRevision, setOccurrenceSnapshotRevision] = useState(0)
  const [planItemContextMenu, setPlanItemContextMenu] = useState(null)
  const [reviewPanelRatio, setReviewPanelRatio] = useState(45)
  const [reviewSplitterDragging, setReviewSplitterDragging] = useState(false)

  useEffect(() => {
    reviewWordLookupRef.current = onReviewWordLookup
  }, [onReviewWordLookup])

  useEffect(() => {
    onSessionStateChange?.({
      selectedPlanId,
      offset,
      expandedItemId,
      filterFilePath,
      filterFileName,
      reviewMode,
      historyOpen,
      expandedHistorySessionId,
      planSelectionCleared,
    })
  }, [
    expandedItemId,
    filterFileName,
    filterFilePath,
    historyOpen,
    expandedHistorySessionId,
    offset,
    onSessionStateChange,
    planSelectionCleared,
    reviewMode,
    selectedPlanId,
  ])

  const loadPlanItems = async (planId, nextOffset = 0) => {
    if (!planId) {
      setSelectedPlan(null)
      setItems([])
      setTotal(0)
      setOffset(0)
      setLoading(false)
      return null
    }

    setLoading(true)
    try {
      const result = await api?.listStudyPlanItems?.(planId, {
        offset: nextOffset,
        limit: PLAN_PAGE_SIZE,
      })
      if (!result?.ok) throw new Error(result?.reason || 'list-study-plan-items-failed')
      setSelectedPlan(result.plan || null)
      setItems(Array.isArray(result.items) ? result.items : [])
      setTotal(Number(result.total || 0))
      setLimit(Number(result.limit || 250))
      setOffset(Number(result.offset || 0))
      setMessage('')
      return result
    } catch (error) {
      setItems([])
      setTotal(0)
      setMessage(`Could not load Study Plan: ${error?.message || error}`)
      return null
    } finally {
      setLoading(false)
    }
  }

  const loadPlans = async (preferredPlanId = selectedPlanId, preferredOffset = 0, options = {}) => {
    try {
      const result = await api?.listStudyPlans?.()
      if (!result?.ok) throw new Error(result?.reason || 'list-study-plans-failed')
      const nextPlans = Array.isArray(result.plans) ? result.plans : []
      setPlans(nextPlans)
      const nextPlanId = options.selectNone
        ? null
        : nextPlans.some((plan) => plan.id === Number(preferredPlanId))
          ? Number(preferredPlanId)
          : nextPlans[0]?.id || null
      setSelectedPlanId(nextPlanId)
      await loadPlanItems(nextPlanId, preferredOffset)
      return nextPlans
    } catch (error) {
      setPlans([])
      setSelectedPlan(null)
      setItems([])
      setTotal(0)
      setLoading(false)
      setMessage(`Could not load Study Plans: ${error?.message || error}`)
      return []
    }
  }

  const loadActiveSession = async () => {
    try {
      const result = await api?.getActiveStudySession?.()
      if (!result?.ok) throw new Error(result?.reason || 'get-active-study-session-failed')
      setActiveSession(result.session || null)
      return result.session || null
    } catch (error) {
      setActiveSession(null)
      setMessage(`Could not load active Study Session: ${error?.message || error}`)
      return null
    }
  }

  const loadReviewHistory = async (planId = selectedPlanId) => {
    if (!planId) {
      setHistorySummary(null)
      setHistorySessions([])
      return null
    }
    setHistoryLoading(true)
    try {
      const result = await api?.listStudyReviewHistory?.(planId, { limit: 50 })
      if (!result?.ok) throw new Error(result?.reason || 'list-study-review-history-failed')
      setHistorySummary(result.summary || null)
      setHistorySessions(Array.isArray(result.sessions) ? result.sessions : [])
      return result
    } catch (error) {
      setHistorySummary(null)
      setHistorySessions([])
      setMessage(`Could not load Review history: ${error?.message || error}`)
      return null
    } finally {
      setHistoryLoading(false)
    }
  }

  const loadHistorySessionEvents = async (sessionId) => {
    try {
      const result = await api?.listStudyReviewEvents?.(sessionId)
      if (!result?.ok) throw new Error(result?.reason || 'list-study-review-events-failed')
      setHistoryEvents((current) => ({ ...current, [sessionId]: result.events || [] }))
      return result.events || []
    } catch (error) {
      setMessage(`Could not load Review events: ${error?.message || error}`)
      return null
    }
  }

  const toggleHistorySession = async (sessionId) => {
    if (expandedHistorySessionId === sessionId) {
      setExpandedHistorySessionId(null)
      return
    }
    setExpandedHistorySessionId(sessionId)
    if (!historyEvents[sessionId]) await loadHistorySessionEvents(sessionId)
  }

  useEffect(() => {
    const initialize = async () => {
      await loadPlans(initialRef.current.selectedPlanId, initialRef.current.offset, {
        selectNone: initialRef.current.planSelectionCleared,
      })
      const session = await loadActiveSession()
      if (session && initialRef.current.reviewMode) {
        setSelectedPlanId(session.planId)
        setPlanSelectionCleared(false)
        await loadPlanItems(session.planId, getPlanItemPageOffset(session.currentItem))
        setReviewMode(true)
      } else if (!session) {
        setReviewMode(false)
      }
    }
    initialize()
  }, [])

  useEffect(() => {
    setExpandedHistorySessionId(null)
    setHistoryEvents({})
    if (historyOpen) loadReviewHistory(selectedPlanId)
  }, [historyOpen, selectedPlanId])

  useEffect(() => {
    if (!planSelectorOpen) return undefined
    const handlePointerDown = (event) => {
      if (!planSelectorRef.current?.contains(event.target)) setPlanSelectorOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [planSelectorOpen])

  useEffect(() => {
    if (!planItemContextMenu) return undefined
    const closeMenu = () => setPlanItemContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [planItemContextMenu])

  useEffect(() => {
    const planId = activeSession?.planId
    const planItemId = activeSession?.currentItem?.id
    if (!reviewMode || !planId || !planItemId) {
      setReviewOccurrences([])
      setReviewOccurrencesError('')
      setReviewOccurrencesLoading(false)
      return undefined
    }

    let canceled = false
    const loadOccurrences = async () => {
      setReviewOccurrencesLoading(true)
      setReviewOccurrences([])
      setReviewOccurrencesError('')
      try {
        const result = await api?.getStudyPlanItemOccurrences?.(planId, planItemId)
        if (!result?.ok) throw new Error(result?.reason || 'load-plan-occurrence-snapshots-failed')
        if (!canceled) setReviewOccurrences(Array.isArray(result.occurrences) ? result.occurrences : [])
      } catch (error) {
        if (!canceled) {
          setReviewOccurrences([])
          setReviewOccurrencesError(
            error?.message === 'occurrence-snapshot-not-available'
              ? 'Occurrence snapshot is not available. Refresh Scope to create it.'
              : `Could not load occurrence snapshots: ${error?.message || error}`
          )
        }
      } finally {
        if (!canceled) setReviewOccurrencesLoading(false)
      }
    }
    loadOccurrences()
    return () => {
      canceled = true
    }
  }, [
    activeSession?.currentItem?.id,
    activeSession?.planId,
    occurrenceSnapshotRevision,
    reviewMode,
  ])

  useEffect(() => {
    const sessionId = activeSession?.id
    const currentItem = activeSession?.currentItem
    if (!reviewMode || !sessionId || !currentItem?.id || !currentItem.displayWord) return

    const lookupKey = `${sessionId}:${currentItem.id}`
    if (lastAutoLookupKeyRef.current === lookupKey) return
    lastAutoLookupKeyRef.current = lookupKey
    reviewWordLookupRef.current?.(currentItem.displayWord, { silentNoTargets: true })
  }, [activeSession?.currentItem?.id, activeSession?.id, reviewMode])

  useEffect(() => {
    const occurrenceList = occurrenceListRef.current
    if (!reviewMode || !activeSession?.currentItem?.id || !occurrenceList) return undefined

    let frameId = 0
    const fitOccurrenceContent = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const currentList = occurrenceListRef.current
        if (!currentList || currentList.clientHeight <= 0) return

        let nextFontSize = resolvedOccurrenceFontSize
        currentList.style.overflowY = 'hidden'
        currentList.style.setProperty('--text-study-occurrence-font-size', `${nextFontSize}px`)
        while (
          nextFontSize > resolvedOccurrenceMinFontSize
          && currentList.scrollHeight > currentList.clientHeight + 1
        ) {
          nextFontSize -= 1
          currentList.style.setProperty('--text-study-occurrence-font-size', `${nextFontSize}px`)
        }
        currentList.style.overflowY = currentList.scrollHeight > currentList.clientHeight + 1
          ? 'auto'
          : 'hidden'
      })
    }

    fitOccurrenceContent()
    const resizeObserver = new ResizeObserver(fitOccurrenceContent)
    resizeObserver.observe(occurrenceList)
    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [
    activeSession?.currentItem?.id,
    resolvedOccurrenceFontSize,
    resolvedOccurrenceMinFontSize,
    reviewMode,
    reviewOccurrences,
    reviewOccurrencesError,
    reviewOccurrencesLoading,
  ])

  const handlePlanSelection = (value) => {
    const planId = Number(value) || null
    if (activeSession?.isActive && activeSession.planId !== planId) {
      const shouldSwitch = window.confirm(
        `Review for "${activeSession.planName}" is still active. Pause it and view another plan?`
      )
      if (!shouldSwitch) return
      setReviewMode(false)
    }
    setSelectedPlanId(planId)
    setPlanSelectionCleared(!planId)
    setPlanSelectorOpen(false)
    setExpandedItemId(null)
    loadPlanItems(planId, 0)
  }

  const handleDeletePlan = async (event, plan) => {
    event.stopPropagation()
    setMessage('')
    try {
      const result = await api?.deleteStudyPlan?.(plan.id)
      if (result?.canceled) return
      if (!result?.ok) throw new Error(result?.reason || 'delete-study-plan-failed')

      const deletedSelectedPlan = selectedPlanId === plan.id
      if (activeSession?.planId === plan.id) {
        setActiveSession(null)
        setReviewMode(false)
      }
      setPlanSelectorOpen(false)
      setExpandedHistorySessionId(null)
      setHistoryEvents({})
      if (deletedSelectedPlan) {
        setPlanSelectionCleared(true)
        setHistoryOpen(false)
        setHistorySummary(null)
        setHistorySessions([])
        await loadPlans(null, 0, { selectNone: true })
      } else {
        await loadPlans(selectedPlanId, offset)
      }
      setMessage(`Study Plan deleted: ${plan.name}.`)
    } catch (error) {
      setMessage(`Could not delete Study Plan: ${error?.message || error}`)
    }
  }

  const cancelCreatePlan = () => {
    setCreating(false)
    setNewPlanName('')
    setFilterFilePath('')
    setFilterFileName('')
    setFilterDefinition(null)
    setFilterMatchCount(null)
  }

  const handleCreatePlan = async () => {
    if (loading) return
    const name = newPlanName.trim()
    if (!name) {
      setMessage('Enter a Study Plan name.')
      return
    }
    if (!filterFilePath || !filterDefinition) {
      setMessage('Choose a valid Filter file first.')
      return
    }

    setLoading(true)
    try {
      const result = await api?.createStudyPlan?.({ name, filterFilePath })
      if (!result?.ok) throw new Error(result?.reason || 'create-study-plan-failed')
      cancelCreatePlan()
      setPlanSelectionCleared(false)
      setExpandedItemId(null)
      await loadPlans(result.plan.id, 0)
      setMessage(`Study Plan created with ${result.addedCount || 0} ${itemPlural}.`)
    } catch (error) {
      setLoading(false)
      setMessage(`Could not create Study Plan: ${error?.message || error}`)
    }
  }

  const handleChooseFilterForPlan = async () => {
    setMessage('')
    try {
      const result = await api?.loadFilterFile?.()
      if (result?.canceled) return
      if (!result?.ok) throw new Error(result?.reason || 'load-word-filter-file-failed')
      setFilterFilePath(result.filePath || '')
      setFilterFileName(result.fileName || '')
      setFilterDefinition(result.definition || null)
      setFilterMatchCount(Number(result.matchedCount || 0))
      setCreating(true)
      setMessage('')
    } catch (error) {
      setMessage(`Could not load Filter: ${error?.message || error}`)
    }
  }

  const handleRefreshScope = async () => {
    if (!selectedPlanId) return
    setLoading(true)
    try {
      const result = await api?.refreshStudyPlanScope?.(selectedPlanId)
      if (!result?.ok) throw new Error(result?.reason || 'refresh-study-plan-scope-failed')
      await loadPlans(selectedPlanId, 0)
      setOccurrenceSnapshotRevision((current) => current + 1)
      setMessage(
        `Scope refreshed: ${result.addedCount || 0} new ${itemPlural}; ${result.matchedCount || 0} currently matched.`
      )
    } catch (error) {
      setLoading(false)
      setMessage(`Could not refresh Scope: ${error?.message || error}`)
    }
  }

  const handleStartOrContinueReview = async () => {
    if (activeSession?.isActive) {
      setSelectedPlanId(activeSession.planId)
      setPlanSelectionCleared(false)
      setExpandedItemId(null)
      await loadPlanItems(
        activeSession.planId,
        getPlanItemPageOffset(activeSession.currentItem)
      )
      setReviewMode(true)
      setMessage(`Continuing Review: ${activeSession.planName}.`)
      return
    }
    if (!selectedPlanId) return

    setReviewBusy(true)
    try {
      const result = await api?.startStudySession?.(selectedPlanId)
      if (!result?.ok) throw new Error(result?.reason || 'start-study-session-failed')
      setActiveSession(result.session || null)
      setReviewMode(true)
      await loadPlanItems(
        result.session.planId,
        getPlanItemPageOffset(result.session.currentItem)
      )
      setMessage(
        `${result.resumed ? 'Continuing' : 'Started'} Review: ${result.session.queueLength} ${itemPlural} in this session.`
      )
      if (historyOpen) await loadReviewHistory(selectedPlanId)
    } catch (error) {
      setMessage(
        error?.message === 'no-review-items'
          ? `No eligible ${itemPlural}: ordinary Reviewed ${itemPlural} stay out; Special ${itemPlural} may return.`
          : `Could not start Review: ${error?.message || error}`
      )
    } finally {
      setReviewBusy(false)
    }
  }

  const handleReviewAction = async (action) => {
    if (!activeSession?.id) return
    const previousReviewItem = activeSession.currentItem
    setReviewBusy(true)
    try {
      const result = await api?.applyStudyReviewAction?.(activeSession.id, action)
      if (!result?.ok) throw new Error(result?.reason || 'study-review-action-failed')
      const nextSession = result.session || null
      setActiveSession(nextSession?.isActive ? nextSession : null)
      if (result.completed || !nextSession?.isActive) {
        setReviewMode(false)
      }
      const synchronizedItem = nextSession?.currentItem || previousReviewItem
      await loadPlans(
        activeSession.planId,
        getPlanItemPageOffset(synchronizedItem)
      )
      if (historyOpen) await loadReviewHistory(activeSession.planId)
      if (historyOpen && expandedHistorySessionId === activeSession.id) {
        await loadHistorySessionEvents(activeSession.id)
      }
      setMessage(
        result.completed
          ? 'Review session completed.'
          : action === 'toggle-special'
            ? `Special ${nextSession?.currentItem?.isSpecial ? 'enabled' : 'disabled'}.`
            : `${action === 'reviewed' ? 'Reviewed' : 'Skipped'}; ${nextSession?.remainingCount || 0} remaining.`
      )
    } catch (error) {
      setMessage(`Review action failed: ${error?.message || error}`)
    } finally {
      setReviewBusy(false)
    }
  }

  const handleEndReview = async () => {
    if (!activeSession?.id) return
    if (!window.confirm('End the active Review session? Remaining words will return in a future session.')) return

    setReviewBusy(true)
    try {
      const result = await api?.endStudySession?.(activeSession.id)
      if (!result?.ok) throw new Error(result?.reason || 'end-study-session-failed')
      setActiveSession(null)
      setReviewMode(false)
      setMessage('Review session ended. Review history was kept.')
      if (historyOpen) await loadReviewHistory(activeSession.planId)
      if (historyOpen && expandedHistorySessionId === activeSession.id) {
        await loadHistorySessionEvents(activeSession.id)
      }
    } catch (error) {
      setMessage(`Could not end Review: ${error?.message || error}`)
    } finally {
      setReviewBusy(false)
    }
  }

  const handleReviewTo = async (item) => {
    if (!selectedPlanId || !item) return
    setReviewBusy(true)
    setMessage('')
    try {
      const result = await api?.reviewTo?.(selectedPlanId, item.id)
      if (result?.canceled) return
      if (!result?.ok) throw new Error(result?.reason || 'review-to-failed')
      setActiveSession(result.session || null)
      setReviewMode(true)
      setPlanSelectionCleared(false)
      setExpandedItemId(null)
      await loadPlanItems(
        result.session.planId,
        getPlanItemPageOffset(result.session.currentItem)
      )
      setMessage(`Review moved to ${item.displayWord}.`)
      if (historyOpen) await loadReviewHistory(selectedPlanId)
      if (historyOpen && expandedHistorySessionId === result.session?.id) {
        await loadHistorySessionEvents(result.session.id)
      }
    } catch (error) {
      setMessage(
        error?.message === 'suspended-study-plan-item'
          ? 'A Suspended word cannot be used as a Review To target.'
          : `Review To failed: ${error?.message || error}`
      )
    } finally {
      setReviewBusy(false)
    }
  }

  const handleReviewSplitterPointerDown = (event) => {
    const reviewPanel = reviewPanelRef.current
    const resultsPanel = resultsPanelRef.current
    if (!reviewPanel || !resultsPanel) return

    event.preventDefault()
    const reviewHeight = reviewPanel.getBoundingClientRect().height
    const resultsHeight = resultsPanel.getBoundingClientRect().height
    const availableHeight = reviewHeight + resultsHeight
    if (availableHeight <= 0) return

    reviewSplitDragRef.current = {
      availableHeight,
      pointerId: event.pointerId,
      startHeight: reviewHeight,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setReviewSplitterDragging(true)
  }

  const handleReviewSplitterPointerMove = (event) => {
    const drag = reviewSplitDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const minReviewHeight = Math.min(100, drag.availableHeight * 0.45)
    const minResultsHeight = Math.min(120, drag.availableHeight * 0.45)
    const requestedHeight = drag.startHeight + event.clientY - drag.startY
    const reviewHeight = Math.max(
      minReviewHeight,
      Math.min(drag.availableHeight - minResultsHeight, requestedHeight)
    )
    const nextRatio = Math.round((reviewHeight / drag.availableHeight) * 1000) / 10
    setReviewPanelRatio(Math.max(15, Math.min(85, nextRatio)))
  }

  const handleReviewSplitterPointerUp = (event) => {
    const drag = reviewSplitDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    reviewSplitDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setReviewSplitterDragging(false)
  }

  const handleReviewSplitterKeyDown = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const adjustment = event.key === 'ArrowUp' ? -5 : 5
    setReviewPanelRatio((current) => Math.max(15, Math.min(85, current + adjustment)))
  }

  const shownStart = total > 0 ? offset + 1 : 0
  const shownEnd = Math.min(offset + items.length, total)
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0
  const currentPage = total > 0 ? Math.min(totalPages, Math.floor(offset / limit) + 1) : 0
  const visibleReviewOccurrences = showEmptyOccurrences
    ? reviewOccurrences
    : reviewOccurrences.filter((occurrence) => (
      (occurrence.markers || []).some((marker) => String(marker || '').trim())
      || String(occurrence.annotation || '').trim()
    ))
  const selectedFilterSnapshot = selectedPlan?.filterSnapshot?.filters
    || selectedPlan?.filterSnapshot?.filterSnapshot
    || selectedPlan?.filterSnapshot
    || {}
  const hasReviewCard = Boolean(activeSession?.isActive && reviewMode && activeSession.currentItem)

  return (
    <div
      className={[
        'text-study-plan-tab',
        hasReviewCard ? 'has-review-card' : '',
        reviewSplitterDragging ? 'splitter-dragging' : '',
      ].filter(Boolean).join(' ')}
      role="tabpanel"
      style={{
        '--text-study-occurrence-font-size': `${resolvedOccurrenceFontSize}px`,
        '--text-study-review-track': `${reviewPanelRatio}fr`,
        '--text-study-results-track': `${100 - reviewPanelRatio}fr`,
      }}
    >
      <section className="text-study-plan-toolbar">
        <button
          aria-label="New Study Plan"
          className="text-study-plan-action"
          data-tooltip="Choose a saved Filter file and create a Study Plan"
          onClick={handleChooseFilterForPlan}
          type="button"
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
          <span>New Plan</span>
        </button>
        <div className="text-study-plan-selector" ref={planSelectorRef}>
          <button
            aria-expanded={planSelectorOpen}
            aria-haspopup="listbox"
            className="text-study-plan-selector-trigger"
            data-tooltip="Select Study Plan"
            onClick={() => setPlanSelectorOpen((current) => !current)}
            type="button"
          >
            <span>{selectedPlan?.name || 'No plan selected'}</span>
            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
          </button>
          {planSelectorOpen ? (
            <div className="text-study-plan-selector-menu" role="listbox">
              <button
                aria-selected={!selectedPlanId}
                className={!selectedPlanId ? 'text-study-plan-selector-empty active' : 'text-study-plan-selector-empty'}
                onClick={() => handlePlanSelection('')}
                role="option"
                type="button"
              >No plan selected</button>
              {plans.map((plan) => (
                <div
                  aria-selected={selectedPlanId === plan.id}
                  className={selectedPlanId === plan.id
                    ? 'text-study-plan-selector-option active'
                    : 'text-study-plan-selector-option'}
                  key={plan.id}
                  role="option"
                >
                  <button
                    className="text-study-plan-selector-name"
                    onClick={() => handlePlanSelection(plan.id)}
                    title={plan.name}
                    type="button"
                  >{plan.name}</button>
                  <button
                    aria-label={`Delete ${plan.name}`}
                    className="text-study-plan-selector-delete"
                    data-tooltip="Delete Study Plan"
                    disabled={loading || reviewBusy}
                    onClick={(event) => handleDeletePlan(event, plan)}
                    type="button"
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <button
          aria-label="Refresh Scope"
          className="text-study-plan-action"
          data-tooltip="Add newly matched words without changing existing progress"
          disabled={!selectedPlanId || loading}
          onClick={handleRefreshScope}
          type="button"
        >
          <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          <span>Refresh Scope</span>
        </button>
        <button
          aria-label={activeSession?.isActive ? 'Continue Review' : 'Start Review'}
          className="text-study-plan-action"
          data-tooltip={activeSession?.isActive
            ? `Continue the active Review for ${activeSession.planName}`
            : 'Start a Review session for the selected plan'}
          disabled={(!selectedPlanId && !activeSession) || loading || reviewBusy}
          onClick={handleStartOrContinueReview}
          type="button"
        >
          <i className={activeSession?.isActive ? 'fa-solid fa-forward' : 'fa-solid fa-play'} aria-hidden="true" />
          <span>{activeSession?.isActive ? 'Continue' : 'Start Review'}</span>
        </button>
        <button
          aria-label="Review History"
          aria-pressed={historyOpen}
          className={historyOpen ? 'text-study-plan-action active' : 'text-study-plan-action'}
          data-tooltip="Show Review session history for the selected plan"
          disabled={!selectedPlanId}
          onClick={() => setHistoryOpen((current) => !current)}
          type="button"
        >
          <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
          <span>History</span>
        </button>
      </section>

      <section className="text-study-plan-summary">
        {selectedPlan ? (
          <>
            <div className="text-study-plan-summary-primary">
              <strong title={selectedPlan.name}>{selectedPlan.name}</strong>
              <span>Unseen: {selectedPlan.unseenCount}</span>
              <span>Reviewed: {selectedPlan.reviewedCount}</span>
              <span>Mastered: {selectedPlan.masteredCount}</span>
              <span>Suspended: {selectedPlan.suspendedCount}</span>
              <span>Special: {selectedPlan.specialCount}</span>
            </div>
            <div className="text-study-plan-summary-secondary">
              <span className="text-study-plan-scope" title={formatFilterSummary(selectedFilterSnapshot)}>
                {formatFilterSummary(selectedFilterSnapshot)}
              </span>
              {activeSession?.isActive ? (
                <div
                  className="text-study-plan-review-status"
                  title={`${reviewMode ? 'Review' : 'Review Paused'} · ${activeSession.planName}`}
                >
                  <span>
                    {Math.min(activeSession.currentIndex + 1, activeSession.queueLength)} / {activeSession.queueLength}
                  </span>
                  {reviewMode ? (
                    <button
                      data-tooltip="Pause the Review without ending the session"
                      disabled={reviewBusy}
                      onClick={() => setReviewMode(false)}
                      type="button"
                    >Pause</button>
                  ) : null}
                  <button
                    className="danger"
                    data-tooltip="End this Review session"
                    disabled={reviewBusy}
                    onClick={handleEndReview}
                    type="button"
                  >End</button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <span>Create a Study Plan from a saved Filter file.</span>
        )}
      </section>

      {activeSession?.isActive ? (
        <section
          className={reviewMode ? 'text-study-review active' : 'text-study-review paused'}
          ref={reviewPanelRef}
        >
          {reviewMode && activeSession.currentItem ? (
            <div className="text-study-review-card">
              <div className="text-study-review-top">
                <div className="text-study-review-word-info">
                  <div className="text-study-review-word">
                    <strong>{activeSession.currentItem.displayWord}</strong>
                    <span>
                      {visibleReviewOccurrences.length}/{activeSession.currentItem.occurrenceCount} occurrences
                    </span>
                  </div>
                </div>
                <div className="text-study-review-actions">
                  {showDictionaryAction ? (
                    <button
                      data-tooltip="Send the current word to the selected Review dictionaries"
                      disabled={reviewBusy}
                      onClick={() => onReviewWordLookup?.(activeSession.currentItem.displayWord)}
                      type="button"
                    >To Dict</button>
                  ) : null}
                  <button
                    data-tooltip="Mark Reviewed and move to the next word"
                    disabled={reviewBusy}
                    onClick={() => handleReviewAction('reviewed')}
                    type="button"
                  >Reviewed</button>
                  <button
                    className={activeSession.currentItem.isSpecial ? 'active' : ''}
                    data-tooltip="Special words may appear again in later Review sessions"
                    disabled={reviewBusy}
                    onClick={() => handleReviewAction('toggle-special')}
                    type="button"
                  >Special</button>
                  <button
                    data-tooltip="Skip only in this Review session"
                    disabled={reviewBusy}
                    onClick={() => handleReviewAction('skip')}
                    type="button"
                  >Skip</button>
                </div>
              </div>
              <div className="text-study-review-occurrences">
                <div className="text-study-review-occurrence-list" ref={occurrenceListRef}>
                  {reviewOccurrencesError ? (
                    <div className="text-study-review-occurrence-message error">{reviewOccurrencesError}</div>
                  ) : reviewOccurrencesLoading ? (
                    <div className="text-study-review-occurrence-message">Loading...</div>
                  ) : !reviewOccurrencesLoading && visibleReviewOccurrences.length === 0 ? (
                    <div className="text-study-review-occurrence-message">
                      No occurrence with properties or notes.
                    </div>
                  ) : visibleReviewOccurrences.map((occurrence) => {
                    const properties = (occurrence.markers || []).filter(Boolean)
                    return (
                      <article
                        className="text-study-review-occurrence"
                        key={occurrence.id}
                        title={occurrence.filePath}
                      >
                        <div className="text-study-review-occurrence-source">
                          {occurrence.sourceName} / {occurrence.relativePath} · Line {occurrence.lineNumber}
                        </div>
                        <div className="text-study-review-occurrence-field">
                          <strong>Prop</strong>
                          <span>{properties.length > 0 ? properties.join(' · ') : '(empty)'}</span>
                        </div>
                        <div className="text-study-review-occurrence-field note">
                          <strong>Note</strong>
                          <span>{occurrence.annotation || '(empty)'}</span>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-study-review-paused-message">
              Use Continue to return to this Review session.
            </div>
          )}
        </section>
      ) : null}

      {historyOpen ? (
        <section className="text-study-history">
          <div className="text-study-history-summary">
            <strong>Review History</strong>
            {historyLoading ? <span>Loading...</span> : (
              <>
                <span>Sessions: {historySummary?.sessionCount || 0}</span>
                <span>Reviewed: {historySummary?.reviewedCount || 0}</span>
                <span>Skipped: {historySummary?.skipCount || 0}</span>
                <span>
                  Last: {historySummary?.lastReviewedAt
                    ? new Date(historySummary.lastReviewedAt).toLocaleString()
                    : 'Never'}
                </span>
              </>
            )}
          </div>
          <div className="text-study-history-list">
            {!historyLoading && historySessions.length === 0 ? (
              <div className="text-empty-row">No Review sessions</div>
            ) : historySessions.map((session) => {
              const expanded = expandedHistorySessionId === session.id
              const events = historyEvents[session.id]
              return (
                <article className="text-study-history-session" key={session.id}>
                  <button
                    className="text-study-history-session-head"
                    onClick={() => toggleHistorySession(session.id)}
                    type="button"
                  >
                    <i className={expanded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'} aria-hidden="true" />
                    <span>{new Date(session.startedAt).toLocaleString()}</span>
                    <span className={`text-study-history-status ${session.status}`}>{session.status}</span>
                    <span>{session.completedCount}/{session.queueLength}</span>
                    <span>R {session.reviewedCount} · S {session.skipCount}</span>
                  </button>
                  {expanded ? (
                    <div className="text-study-history-events">
                      <div className="text-study-history-session-meta">
                        <span>
                          End: {session.endedAt ? new Date(session.endedAt).toLocaleString() : 'Active'}
                        </span>
                        <span>Special: +{session.specialOnCount} / -{session.specialOffCount}</span>
                      </div>
                      {!events ? (
                        <div className="text-empty-row">Loading events...</div>
                      ) : events.length === 0 ? (
                        <div className="text-empty-row">No Review events</div>
                      ) : events.map((event) => (
                        <div className="text-study-history-event" key={event.id}>
                          <span>{new Date(event.createdAt).toLocaleTimeString()}</span>
                          <strong>{event.normalizedWord}</strong>
                          <span>{event.eventType}</span>
                          <span>{event.previousStatus || '—'} → {event.nextStatus || '—'}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {hasReviewCard ? (
        <div
          aria-label="Resize Review card and Study Plan word list"
          aria-orientation="horizontal"
          aria-valuemax="85"
          aria-valuemin="15"
          aria-valuenow={Math.round(reviewPanelRatio)}
          className="text-study-plan-horizontal-splitter"
          data-tooltip="Drag to resize Review card and word list"
          onKeyDown={handleReviewSplitterKeyDown}
          onPointerCancel={handleReviewSplitterPointerUp}
          onPointerDown={handleReviewSplitterPointerDown}
          onPointerMove={handleReviewSplitterPointerMove}
          onPointerUp={handleReviewSplitterPointerUp}
          role="separator"
          tabIndex={0}
        />
      ) : null}

      <section className="text-study-plan-results" ref={resultsPanelRef}>
        <div className="text-study-plan-result-title">
          <strong>{itemLabel === 'WPS' ? '计划学习 WPS' : '计划学习单词'}</strong>
          <span>{loading ? 'Loading…' : `${shownStart}–${shownEnd} / ${total}`}</span>
        </div>
        <div className="text-study-plan-item-list">
          {!loading && items.length === 0 ? (
            <div className="text-empty-row">No {itemPlural} in this Study Plan</div>
          ) : items.map((item) => {
            const expanded = expandedItemId === item.id
            return (
              <article
                className={[
                  'text-study-plan-item',
                  expanded ? 'expanded' : '',
                  activeSession?.currentItem?.id === item.id ? 'reviewing' : '',
                ].filter(Boolean).join(' ')}
                key={item.id}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setPlanItemContextMenu({ x: event.clientX, y: event.clientY, item })
                }}
              >
                <button
                  className="text-study-plan-item-head"
                  onClick={() => setExpandedItemId(expanded ? null : item.id)}
                  type="button"
                >
                  <span>{item.itemOrder}</span>
                  <strong>
                    {item.displayWord}
                    {item.isSpecial ? <i className="fa-solid fa-star" title="Special" aria-label="Special" /> : null}
                  </strong>
                  <span>{item.occurrenceCount} records</span>
                  <span className={`text-study-plan-status ${item.status}`}>{item.status}</span>
                </button>
                {expanded ? (
                  <div className="text-study-plan-item-details">
                    <span>Identity: {item.language} · v{item.normalizationVersion} · {item.normalizedWord}</span>
                    <span>Added: {new Date(item.addedAt).toLocaleString()}</span>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <footer className="text-study-plan-footer">
        <span className={message.includes('failed') || message.includes('Could not') ? 'error' : ''}>{message}</span>
        <span className="text-study-plan-page-info">
          Page {currentPage}/{totalPages} · {limit} {itemPlural}/page
        </span>
        <div>
          <button
            disabled={loading || offset <= 0}
            onClick={() => loadPlanItems(selectedPlanId, Math.max(0, offset - limit))}
            type="button"
          >
            Previous
          </button>
          <button
            disabled={loading || offset + items.length >= total}
            onClick={() => loadPlanItems(selectedPlanId, offset + limit)}
            type="button"
          >
            Next
          </button>
        </div>
      </footer>

      {creating ? (
        <div
          className="text-study-plan-dialog-layer"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !loading) cancelCreatePlan()
          }}
          role="presentation"
        >
          <section
            aria-labelledby="new-study-plan-title"
            aria-modal="true"
            className="text-study-plan-dialog"
            role="dialog"
          >
            <h3 id="new-study-plan-title">New Study Plan</h3>
            <div className="text-study-plan-dialog-filter" title={filterFilePath}>
              <strong>{filterFileName}</strong>
              <span>{formatFilterSummary(filterDefinition)}</span>
              <span>Matching {itemPlural}: {filterMatchCount || 0}</span>
            </div>
            <label htmlFor="new-study-plan-name">Plan name</label>
            <input
              autoFocus
              id="new-study-plan-name"
              maxLength={120}
              onChange={(event) => setNewPlanName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newPlanName.trim()) handleCreatePlan()
              }}
              placeholder="Study Plan name"
              type="text"
              value={newPlanName}
            />
            <div className="text-study-plan-dialog-actions">
              <button
                disabled={loading || !newPlanName.trim() || !filterDefinition}
                onClick={handleCreatePlan}
                type="button"
              >Create</button>
              <button disabled={loading} onClick={cancelCreatePlan} type="button">Cancel</button>
            </div>
          </section>
        </div>
      ) : null}

      {planItemContextMenu ? (
        <SimpleContextMenu
          className="text-study-plan-context-menu"
          items={[{
            label: 'Review To',
            disabled: planItemContextMenu.item.status === 'suspended' || reviewBusy,
            action: () => handleReviewTo(planItemContextMenu.item),
          }]}
          onClose={() => setPlanItemContextMenu(null)}
          position={planItemContextMenu}
        />
      ) : null}
    </div>
  )
}
