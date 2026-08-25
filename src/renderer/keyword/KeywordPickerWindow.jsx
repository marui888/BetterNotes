import { useEffect, useMemo, useState } from 'react'

const BRACKET_OPTIONS = [
  { id: 'square2', label: '[[ ]]', before: '[[', after: ']]' },
  { id: 'brace2', label: '{{ }}', before: '{{', after: '}}' },
  { id: 'paren2', label: '(( ))', before: '((', after: '))' },
  { id: 'none', label: 'None', before: '', after: '' },
]

const SEPARATOR_OPTIONS = [
  { id: 'space', label: 'Space', value: ' ' },
  { id: 'comma', label: 'Comma', value: ', ' },
  { id: 'semicolon', label: 'Semicolon', value: '; ' },
  { id: 'newline', label: 'Newline', value: '\n' },
  { id: 'none', label: 'None', value: '' },
]

const SORT_OPTIONS = [
  { id: 'file', label: 'File Order' },
  { id: 'zh', label: 'Chinese' },
]

function buildKeywordText(keywords, bracketId, separatorId) {
  const bracket = BRACKET_OPTIONS.find((item) => item.id === bracketId) || BRACKET_OPTIONS[0]
  const separator = SEPARATOR_OPTIONS.find((item) => item.id === separatorId) || SEPARATOR_OPTIONS[0]
  return keywords
    .map((keyword) => `${bracket.before}${keyword}${bracket.after}`)
    .join(separator.value)
}

function compareKeywordChinese(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortKeywords(keywords, sortId) {
  const nextKeywords = [...keywords]
  if (sortId === 'zh') return nextKeywords.sort(compareKeywordChinese)
  return nextKeywords
}

function getDefaultGroupType(groups, defaultKeywordFile) {
  const fileName = String(defaultKeywordFile || '').trim()
  if (!fileName) return ''

  const fileNameWithoutExt = fileName.replace(/\.[^.]+$/, '')
  const match = groups.find((group) => (
    group.fileName === fileName || group.type === fileNameWithoutExt
  ))
  return match?.type || ''
}

export default function KeywordPickerWindow() {
  const [groups, setGroups] = useState([])
  const [activeType, setActiveType] = useState('')
  const [selectedKeywords, setSelectedKeywords] = useState([])
  const [bracketId, setBracketId] = useState('square2')
  const [separatorId, setSeparatorId] = useState('space')
  const [sortId, setSortId] = useState('file')
  const [message, setMessage] = useState('')

  const loadKeywords = (force = false, preferDefault = false) => {
    setMessage(force ? 'Refreshing keywords...' : 'Loading keywords...')
    window.keywordApi?.listKeywords?.({ force }).then((result) => {
      if (!result?.ok) {
        setMessage(`Keyword load failed: ${result?.reason || 'unknown error'}`)
        setGroups([])
        return
      }

      const nextGroups = Array.isArray(result.groups) ? result.groups : []
      const defaultType = getDefaultGroupType(nextGroups, result.defaultKeywordFile)
      setGroups(nextGroups)
      setActiveType((current) => (
        preferDefault && defaultType
          ? defaultType
          : nextGroups.some((group) => group.type === current)
          ? current
          : nextGroups[0]?.type || ''
      ))
      setSelectedKeywords([])
      setMessage(nextGroups.length === 0 ? 'No keyword files.' : '')
    }).catch((error) => {
      setMessage(`Keyword load failed: ${error?.message || error}`)
    })
  }

  useEffect(() => {
    loadKeywords(false, true)
  }, [])

  useEffect(() => (
    window.keywordApi?.onOpen?.(() => loadKeywords(false, true))
  ), [])

  const activeGroup = useMemo(
    () => groups.find((group) => group.type === activeType) || groups[0] || null,
    [activeType, groups]
  )
  const activeKeywords = useMemo(
    () => sortKeywords(activeGroup?.keywords || [], sortId),
    [activeGroup, sortId]
  )

  const toggleKeyword = (keyword) => {
    setSelectedKeywords((current) => (
      current.includes(keyword)
        ? current.filter((item) => item !== keyword)
        : [...current, keyword]
    ))
  }

  const insertKeywords = (hideAfter) => {
    if (selectedKeywords.length === 0) {
      setMessage('No keyword selected.')
      return
    }

    const text = buildKeywordText(selectedKeywords, bracketId, separatorId)
    window.keywordApi?.insertKeywords?.({ text, hideAfter })
    setSelectedKeywords([])
  }

  return (
    <section className="keyword-window">
      <div className="keyword-tabs" role="tablist" aria-label="Keyword files">
        {groups.length === 0 ? (
          <div className="keyword-empty-tab">Keywords</div>
        ) : groups.map((group) => (
          <button
            aria-selected={group.type === activeType}
            className={group.type === activeType ? 'keyword-tab active' : 'keyword-tab'}
            key={group.filePath || group.fileName}
            onClick={() => {
              setActiveType(group.type)
              setSelectedKeywords([])
            }}
            title={group.fileName}
            type="button"
          >
            {group.type}
          </button>
        ))}
        <button
          className="keyword-refresh-button"
          onClick={() => loadKeywords(true)}
          type="button"
        >
          Refresh
        </button>
      </div>

      <div className="keyword-body">
        {activeKeywords.length ? (
          <div className="keyword-grid" key={activeGroup?.filePath || activeGroup?.type || 'keywords'}>
            {activeKeywords.map((keyword, index) => (
              <button
                className={selectedKeywords.includes(keyword) ? 'keyword-item selected' : 'keyword-item'}
                key={`${activeGroup?.filePath || activeGroup?.type}-${index}-${keyword}`}
                onClick={() => toggleKeyword(keyword)}
                title={keyword}
                type="button"
              >
                {keyword}
              </button>
            ))}
          </div>
        ) : (
          <div className="keyword-empty">{message || 'No keywords in this file.'}</div>
        )}
      </div>

      <div className="keyword-controls">
        <div className="keyword-options">
          <fieldset>
            <legend>Bracket</legend>
            {BRACKET_OPTIONS.map((option) => (
              <label key={option.id}>
                <input
                  checked={bracketId === option.id}
                  name="keyword-bracket"
                  onChange={() => setBracketId(option.id)}
                  type="radio"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Separator</legend>
            {SEPARATOR_OPTIONS.map((option) => (
              <label key={option.id}>
                <input
                  checked={separatorId === option.id}
                  name="keyword-separator"
                  onChange={() => setSeparatorId(option.id)}
                  type="radio"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Sort</legend>
            {SORT_OPTIONS.map((option) => (
              <label key={option.id}>
                <input
                  checked={sortId === option.id}
                  name="keyword-sort"
                  onChange={() => setSortId(option.id)}
                  type="radio"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="keyword-actions">
          <button onClick={() => insertKeywords(false)} type="button">Insert</button>
          <button className="primary" onClick={() => insertKeywords(true)} type="button">Insert & Hide</button>
          <button onClick={() => window.keywordApi?.hidePicker?.()} type="button">Hide</button>
        </div>
      </div>
    </section>
  )
}
