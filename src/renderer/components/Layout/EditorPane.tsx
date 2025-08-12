import React, { useRef } from 'react'
import { MonacoEditor } from '../Editor'

export interface EditorTabModel {
  id: string
  name: string
  path: string | null
  content: string
  hasUnsavedChanges: boolean
}

interface EditorPaneProps {
  activeTab: EditorTabModel | null
  theme: string
  onChange: (value: string | undefined) => void
}

const EditorPane: React.FC<EditorPaneProps> = ({ activeTab, theme, onChange }) => {
  const editorApiRef = useRef<{
    wrapSelection: (p: string, s?: string) => void
    toggleBold: () => void
    toggleItalic: () => void
    insertLink: () => void
    insertList: (t: 'bullet'|'number'|'check') => void
    insertCodeBlock: () => void
  } | null>(null)

  if (!activeTab) {
    return <div style={{ padding: 16, color: 'var(--text-secondary)' }}>No file open</div>
  }

  return (
    <div className="panel editor-panel">
      <div className="panel-header">
        <div className="tab-bar" />
      </div>
      <div className="panel-content">
        <div style={{height:'100%', display:'flex', flexDirection:'column'}}>
          <div style={{display:'flex', gap:8, padding:8, borderBottom:'1px solid var(--border-color)'}}>
            <button className="search-btn" onClick={()=>editorApiRef.current?.toggleBold()}>B</button>
            <button className="search-btn" onClick={()=>editorApiRef.current?.toggleItalic()}>I</button>
            <button className="search-btn" onClick={()=>editorApiRef.current?.insertLink()}>Link</button>
            <button className="search-btn" onClick={()=>editorApiRef.current?.insertList('bullet')}>• List</button>
            <button className="search-btn" onClick={()=>editorApiRef.current?.insertList('number')}>1. List</button>
            <button className="search-btn" onClick={()=>editorApiRef.current?.insertList('check')}>[ ]</button>
            <button className="search-btn" onClick={()=>editorApiRef.current?.insertCodeBlock()}>Code</button>
          </div>
          <div style={{flex:1}}>
            <MonacoEditor
              value={activeTab.content}
              onChange={onChange}
              language="markdown"
              theme={theme}
              onReady={(api)=>{editorApiRef.current=api}}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditorPane