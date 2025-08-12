import React, { useRef, useEffect } from 'react'
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

interface MonacoEditorProps {
  value: string
  onChange: (value: string | undefined) => void
  language?: string
  readOnly?: boolean
  theme?: string // Add theme prop
  externalCommand?: { type: string; payload?: any; nonce: number }
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({
  value,
  onChange,
  language = 'markdown',
  readOnly = false,
  theme = 'dark', // Default to dark theme
  externalCommand
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

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
  }

  // Execute external formatting commands
  useEffect(() => {
    if (!externalCommand || !editorRef.current) return
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return
    const selections = editor.getSelections()
    if (!selections || selections.length === 0) return
    const sel = selections[0]
    const selectedText = model.getValueInRange(sel)

    const wrapSelection = (left: string, right: string = left) => {
      const text = selectedText || ''
      const newText = `${left}${text}${right}`
      editor.executeEdits('formatting', [{ range: sel, text: newText, forceMoveMarkers: true }])
      const endPos = sel.getStartPosition()
      editor.setPosition({ lineNumber: endPos.lineNumber, column: endPos.column + left.length + (text ? text.length : 0) + right.length })
      editor.focus()
    }

    const prefixLines = (prefix: string) => {
      const startLine = sel.startLineNumber
      const endLine = sel.endLineNumber
      const ops: monaco.editor.IIdentifiedSingleEditOperation[] = []
      for (let ln = startLine; ln <= endLine; ln++) {
        const lineRange = new monaco.Range(ln, 1, ln, 1)
        ops.push({ range: lineRange, text: prefix, forceMoveMarkers: true })
      }
      editor.executeEdits('formatting', ops)
      editor.focus()
    }

    switch (externalCommand.type) {
      case 'bold':
        wrapSelection('**')
        break
      case 'italic':
        wrapSelection('*')
        break
      case 'code':
        wrapSelection('`')
        break
      case 'link': {
        const text = selectedText || 'link text'
        const url = externalCommand.payload?.url || 'https://'
        const newText = `[${text}](${url})`
        editor.executeEdits('formatting', [{ range: sel, text: newText, forceMoveMarkers: true }])
        editor.focus()
        break
      }
      case 'bulleted-list':
        prefixLines('- ')
        break
      case 'checklist':
        prefixLines('- [ ] ')
        break
      case 'heading-1':
        prefixLines('# ')
        break
      case 'heading-2':
        prefixLines('## ')
        break
      case 'heading-3':
        prefixLines('### ')
        break
      default:
        break
    }
  }, [externalCommand?.nonce])

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