import React, { useEffect, useMemo, useState } from 'react'

interface Props {
  activeFilePath: string | null
  content: string
}

const StatusBar: React.FC<Props> = ({ activeFilePath, content }) => {
  const [model, setModel] = useState<string | null>(null)
  const [embStats, setEmbStats] = useState<{ embeddedCount: number; chunkCount: number } | null>(null)
  const [saving, setSaving] = useState<boolean>(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [cursor, setCursor] = useState<{ line: number; column: number }>({ line: 1, column: 1 })
  const [selection, setSelection] = useState<{ chars: number; words: number }>({ chars: 0, words: 0 })
  const [wrap, setWrap] = useState<boolean>(true)

  // Document stats
  const stats = useMemo(() => {
    const text = content || ''
    const words = (text.trim().match(/\b\w+\b/g) || []).length
    const chars = text.length
    const minutes = Math.max(1, Math.round(words / 200))
    return { words, chars, minutes }
  }, [content])

  useEffect(() => {
    let timer: any
    const poll = async () => {
      try {
        const m = await window.electronAPI?.llmGetCurrentModel?.()
        setModel(m)
        const es = await window.electronAPI?.embeddingsGetStats?.()
        if (es) setEmbStats({ embeddedCount: es.embeddedCount, chunkCount: es.chunkCount })
      } catch {}
      timer = setTimeout(poll, 1500)
    }
    poll()
    return () => timer && clearTimeout(timer)
  }, [])

  // Listen to autosave lifecycle via global hooks if desired
  useEffect(() => {
    const saveListener = () => { setSaving(true); setTimeout(()=>setSaving(false), 600) }
    ;(window as any).addEventListener?.('isla:saving', saveListener)
    return () => { (window as any).removeEventListener?.('isla:saving', saveListener) }
  }, [])

  useEffect(() => {
    // naive save detection: update when content length stabilizes after 1s
    const id = setTimeout(() => setLastSavedAt(new Date()), 1200)
    return () => clearTimeout(id)
  }, [content])

  // Receive cursor and selection from editor (wired in Monaco onDidChangeCursorSelection emitting a custom event)
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { lineNumber, column, selectionText } = e.detail || {}
      setCursor({ line: lineNumber || 1, column: column || 1 })
      const chars = (selectionText || '').length
      const words = (selectionText || '').trim() ? (selectionText.trim().match(/\b\w+\b/g) || []).length : 0
      setSelection({ chars, words })
    }
    window.addEventListener('isla:cursor', handler as any)
    return () => window.removeEventListener('isla:cursor', handler as any)
  }, [])

  // Load wrap from settings
  useEffect(() => {
    (async () => {
      try {
        const raw = await window.electronAPI?.settingsGet?.('editorWordWrap')
        if (raw != null) setWrap(raw === 'on')
      } catch {}
    })()
  }, [])

  const toggleWrap = async () => {
    const next = !wrap
    setWrap(next)
    try {
      await window.electronAPI?.settingsSet?.('editorWordWrap', next ? 'on' : 'off')
      // Notify editor via custom event to update options
      window.dispatchEvent(new CustomEvent('isla:editorOption', { detail: { wordWrap: next ? 'on' : 'off' } }))
    } catch {}
  }

  const coverage = embStats && embStats.chunkCount > 0
    ? Math.round((embStats.embeddedCount / embStats.chunkCount) * 100)
    : 0

  return (
    <div style={{
      height: 28,
      borderTop: '1px solid var(--border-color)',
      background: 'var(--bg-secondary)',
      color: 'var(--text-secondary)',
      display: 'flex', alignItems: 'center', padding: '0 8px', gap: 12,
      fontSize: 12
    }}>
      {/* Left */}
      <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1 }}>
        <span title={activeFilePath || ''} style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {activeFilePath ? activeFilePath : 'No file'}
        </span>
        {saving && <span style={{ color:'var(--accent-blue)' }}>saving…</span>}
        {!saving && lastSavedAt && <span>saved {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      {/* Center */}
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <span>Ln {cursor.line}, Col {cursor.column}</span>
        {selection.chars > 0 && <span>Sel {selection.words}w/{selection.chars}c</span>}
        <span>{stats.words} words</span>
        <span>{stats.chars} chars</span>
        <span>{stats.minutes} min read</span>
        <button className="search-btn" title="Toggle word wrap" onClick={toggleWrap}>{wrap ? 'Wrap: on' : 'Wrap: off'}</button>
      </div>

      {/* Right */}
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <span title="Current LLM model">🤖 {model || 'no model'}</span>
        <span title="Embeddings coverage">🧠 {coverage}%</span>
        <button
          className="search-btn"
          title="Rebuild embeddings"
          onClick={()=>window.electronAPI?.embeddingsRebuildAll?.()}
        >Reindex</button>
      </div>
    </div>
  )
}

export default StatusBar
