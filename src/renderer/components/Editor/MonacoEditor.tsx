import React, { useRef, useEffect } from 'react'
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

interface MonacoEditorProps {
  value: string
  onChange: (value: string | undefined) => void
  language?: string
  readOnly?: boolean
  theme?: string // Add theme prop
  onReady?: (api: {
    wrapSelection: (prefix: string, suffix?: string) => void
    toggleBold: () => void
    toggleItalic: () => void
    insertLink: () => void
    insertList: (type: 'bullet' | 'number' | 'check') => void
    insertCodeBlock: () => void
  }) => void
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({
  value,
  onChange,
  language = 'markdown',
  readOnly = false,
  theme = 'dark', // Default to dark theme
  onReady
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  const exposeCommands = () => {
    if (!editorRef.current || !onReady) return
    const editor = editorRef.current

    const wrapSelection = (prefix: string, suffix?: string) => {
      const model = editor.getModel()
      if (!model) return
      const sel = editor.getSelection()
      if (!sel) return
      const text = model.getValueInRange(sel)
      const after = `${prefix}${text}${suffix ?? prefix}`
      editor.executeEdits('wrap', [{ range: sel, text: after, forceMoveMarkers: true }])
      editor.focus()
    }

    const toggleBold = () => wrapSelection('**')
    const toggleItalic = () => wrapSelection('*')

    const insertLink = () => {
      const model = editor.getModel(); if (!model) return
      const sel = editor.getSelection(); if (!sel) return
      const text = model.getValueInRange(sel) || 'text'
      const md = `[${text}](https://)`
      editor.executeEdits('link', [{ range: sel, text: md, forceMoveMarkers: true }])
      editor.focus()
    }

    const insertList = (type: 'bullet' | 'number' | 'check') => {
      const model = editor.getModel(); if (!model) return
      const sel = editor.getSelection(); if (!sel) return
      const prefix = type === 'bullet' ? '- ' : type === 'number' ? '1. ' : '- [ ] '
      const md = `${prefix}${model.getValueInRange(sel)}`
      editor.executeEdits('list', [{ range: sel, text: md, forceMoveMarkers: true }])
      editor.focus()
    }

    const insertCodeBlock = () => {
      const model = editor.getModel(); if (!model) return
      const sel = editor.getSelection(); if (!sel) return
      const text = model.getValueInRange(sel)
      const md = '```\n' + (text || '') + '\n```\n'
      editor.executeEdits('code', [{ range: sel, text: md, forceMoveMarkers: true }])
      editor.focus()
    }

    onReady({ wrapSelection, toggleBold, toggleItalic, insertLink, insertList, insertCodeBlock })
  }

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    
    // Focus the editor
    editor.focus()
    
    // Configure editor for better writing experience
    editor.updateOptions({
      wordWrap: 'on',
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      contextmenu: true,
      selectOnLineNumbers: false,
      automaticLayout: true,
    })

    // Paste image handler
    editor.onPaste(async (e) => {
      try {
        const dt = (e.event as ClipboardEvent).clipboardData
        if (!dt) return
        const items = Array.from(dt.items)
        const imgItem = items.find(it => it.type.startsWith('image/'))
        if (!imgItem) return

        const blob = imgItem.getAsFile()
        if (!blob) return
        const arrayBuffer = await blob.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

        // Determine save directory: try current file directory from parent context if exposed
        // As a fallback, save next to selectedDirectory root
        const rootDir = await (window as any).electronAPI?.settingsGet?.('selectedDirectory')
        if (!rootDir) return

        const ext = blob.type.split('/')[1] || 'png'
        const savedPath = await (window as any).electronAPI?.saveImage?.(rootDir, 'image', base64, ext)
        if (!savedPath) return

        const fileUri = `file://${savedPath.replace(/\\/g, '/')}`
        const md = `![](${fileUri})`

        const sel = editor.getSelection()
        const range = sel || editor.getModel()!.getFullModelRange()
        editor.executeEdits('paste-image', [{ range, text: md, forceMoveMarkers: true }])
      } catch (err) {
        console.error('Paste image failed:', err)
      }
    })

    exposeCommands()
  }

  // Watch for font setting changes and update editor
  useEffect(() => {
    if (editorRef.current) {
      const { fontFamily, fontSize } = getFontSettings()
      editorRef.current.updateOptions({
        fontFamily,
        fontSize
      })
    }
  }, []) // We'll trigger this manually when settings change

  // Add a listener for font changes (check periodically)
  useEffect(() => {
    const interval = setInterval(() => {
      if (editorRef.current) {
        const { fontFamily, fontSize } = getFontSettings()
        editorRef.current.updateOptions({
          fontFamily,
          fontSize
        })
      }
    }, 1000) // Check every second

    return () => clearInterval(interval)
  }, [])

  const handleEditorWillMount: BeforeMount = (monaco) => {
    // Define VS Code Dark+ theme colors
    monaco.editor.defineTheme('isla-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'd4d4d4', background: '1e1e1e' },
        { token: 'comment', foreground: '6a9955' },
        { token: 'keyword', foreground: '569cd6' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'number', foreground: 'b5cea8' },
        { token: 'regexp', foreground: 'd16969' },
        { token: 'type', foreground: '4ec9b0' },
        { token: 'variable', foreground: '9cdcfe' },
        { token: 'variable.predefined', foreground: '4fc1ff' },
        { token: 'constant', foreground: '4fc1ff' },
        { token: 'operator', foreground: 'd4d4d4' },
        { token: 'delimiter', foreground: 'd4d4d4' },
        { token: 'attribute.name', foreground: '92c5f7' },
        { token: 'attribute.value', foreground: 'ce9178' },
        { token: 'tag', foreground: '569cd6' },
        // Markdown specific
        { token: 'keyword.md', foreground: '569cd6' },
        { token: 'string.md', foreground: 'ce9178' },
        { token: 'variable.md', foreground: '4ec9b0' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#858585',
        'editorCursor.foreground': '#d4d4d4',
        'editor.selectionBackground': '#264f78',
        'editor.inactiveSelectionBackground': '#3a3d41',
        'editorWhitespace.foreground': '#404040',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
        'editor.selectionHighlightBackground': '#add6ff26'
      }
    })

    // Define Cream & Brown Light theme
    monaco.editor.defineTheme('isla-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: '1A1A1A', background: 'F5F2E8' },
        { token: 'comment', foreground: '8B5A3C' },
        { token: 'keyword', foreground: '8B5A3C' },
        { token: 'string', foreground: 'A0664B' },
        { token: 'number', foreground: '8B5A3C' },
        { token: 'regexp', foreground: 'CC4125' },
        { token: 'type', foreground: '8B5A3C' },
        { token: 'variable', foreground: '4A4A4A' },
        { token: 'variable.predefined', foreground: '8B5A3C' },
        { token: 'constant', foreground: '8B5A3C' },
        { token: 'operator', foreground: '1A1A1A' },
        { token: 'delimiter', foreground: '1A1A1A' },
        { token: 'attribute.name', foreground: '8B5A3C' },
        { token: 'attribute.value', foreground: 'A0664B' },
        { token: 'tag', foreground: '8B5A3C' },
        // Markdown specific
        { token: 'keyword.md', foreground: '8B5A3C' },
        { token: 'string.md', foreground: 'A0664B' },
        { token: 'variable.md', foreground: '8B5A3C' },
      ],
      colors: {
        'editor.background': '#F5F2E8',        // Light cream background
        'editor.foreground': '#1A1A1A',        // Dark text
        'editorLineNumber.foreground': '#8A8A8A',
        'editorCursor.foreground': '#8B5A3C',   // Brown cursor
        'editor.selectionBackground': '#DDD7C8', // Hover cream for selection
        'editor.inactiveSelectionBackground': '#E5E0D3',
        'editorWhitespace.foreground': '#C0C0C0',
        'editorIndentGuide.background': '#E0E0E0',
        'editorIndentGuide.activeBackground': '#8B5A3C',
        'editor.selectionHighlightBackground': '#DDD7C840'
      }
    })

    // Set up language configurations
    monaco.languages.setLanguageConfiguration('markdown', {
      wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    })

    monaco.languages.setMonarchTokensProvider('markdown', {
      tokenizer: {
        root: [
          [/^(\s{0,3})(#+)((?:[^\\#]|\\.)*)$/, ['white', 'keyword', 'string']],
          [/^\s*(>+)/, 'comment'],
          [/^(\t|[ ]{4})[^ ].*$/, 'string'],
          [/^(\s*)(\*)((?:[^\\*]|\\.)*)$/, ['white', 'keyword', 'string']],
          [/^(\s*)([*+-])([ \t].*)$/, ['white', 'keyword', 'string']],
          [/^(\s*)(\d+\.)([ \t].*)$/, ['white', 'number', 'string']],
          [/(\*\*|__)([^\\*_]|\\.)+(\*\*|__)/, 'strong'],
          [/(\*|_)([^\\*_]|\\.)+(\*|_)/, 'emphasis'],
          [/(`+)([^`]|\\.)*(`+)/, 'string'],
          [/\[([^\]]+)\]\(([^)]+)\)/, 'variable'],
        ]
      },
    })
  }

  // Determine Monaco theme based on app theme
  const getMonacoTheme = () => {
    if (theme === 'light') return 'isla-light'
    if (theme === 'auto') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      return prefersDark ? 'isla-dark' : 'isla-light'
    }
    return 'isla-dark' // default to dark
  }

  // Get font settings from CSS variables
  const getFontSettings = () => {
    const computedStyle = getComputedStyle(document.documentElement)
    const fontFamily = computedStyle.getPropertyValue('--app-font-family').trim() || 'JetBrains Mono, Consolas, "Courier New", "Segoe UI", monospace'
    const fontSize = parseInt(computedStyle.getPropertyValue('--app-font-size').replace('px', '')) || 14
    
    return { fontFamily, fontSize }
  }

  const { fontFamily, fontSize } = getFontSettings()

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Editor
        height="100%"
        defaultLanguage={language}
        value={value}
        onChange={onChange}
        onMount={handleEditorDidMount}
        beforeMount={handleEditorWillMount}
        theme={getMonacoTheme()}
        options={{
          fontFamily: fontFamily,
          fontSize: fontSize,
          lineHeight: 1.6,
          wordWrap: 'on',
          lineNumbers: 'off',
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          contextmenu: true,
          selectOnLineNumbers: false,
          automaticLayout: true,
          readOnly,
          padding: { top: 16, bottom: 16 },
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false,
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />
    </div>
  )
}

export default MonacoEditor 