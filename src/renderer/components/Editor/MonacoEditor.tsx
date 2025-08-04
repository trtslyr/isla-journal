import React, { useRef, useEffect } from 'react'
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

interface MonacoEditorProps {
  value: string
  onChange: (value: string | undefined) => void
  language?: string
  readOnly?: boolean
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({
  value,
  onChange,
  language = 'markdown',
  readOnly = false
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
        'editor.lineHighlightBackground': '#2d2d30',
        'editor.selectionBackground': '#264f78',
        'editor.selectionHighlightBackground': '#264f7880',
        'editorCursor.foreground': '#d4d4d4',
        'editorWhitespace.foreground': '#404040',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
        'editor.findMatchBackground': '#515c6a',
        'editor.findMatchHighlightBackground': '#ea5c0055',
        'editor.findRangeHighlightBackground': '#3a3d4166',
        'editorHoverWidget.background': '#252526',
        'editorHoverWidget.border': '#454545',
        'editorSuggestWidget.background': '#252526',
        'editorSuggestWidget.border': '#454545',
        'editorSuggestWidget.selectedBackground': '#094771',
      }
    })

    // Set JetBrains Mono font
    monaco.editor.getModel(monaco.Uri.parse('file:///main.md'))?.updateOptions({
      tabSize: 2,
      insertSpaces: true,
    })
  }

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Editor
        height="100%"
        defaultLanguage={language}
        value={value}
        onChange={onChange}
        onMount={handleEditorDidMount}
        beforeMount={handleEditorWillMount}
        theme="isla-dark"
        options={{
          fontFamily: 'JetBrains Mono, Consolas, "Courier New", monospace',
          fontSize: 14,
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