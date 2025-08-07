import React, { useMemo } from 'react'

interface Props {
  markdown: string
}

// Lazy import marked and DOMPurify to reduce initial bundle
let _marked: any
let _dompurify: any

async function ensureLibs() {
  if (!_marked) {
    _marked = (await import('marked')).marked
    _marked.setOptions({ breaks: true, gfm: true })
  }
  if (!_dompurify) {
    const createDOMPurify = (await import('dompurify')).default
    _dompurify = createDOMPurify(window as any)
  }
}

const MarkdownPreview: React.FC<Props> = ({ markdown }) => {
  const [html, setHtml] = React.useState<string>('')

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      await ensureLibs()
      const raw = _marked.parse(markdown || '')
      const safe = _dompurify.sanitize(raw, {
        ALLOWED_URI_REGEXP: /^(?:(?:https?|file|data):|[a-zA-Z][a-zA-Z0-9+.-]*:)/
      })
      if (!cancelled) setHtml(safe)
    })()
    return () => { cancelled = true }
  }, [markdown])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

export default MarkdownPreview