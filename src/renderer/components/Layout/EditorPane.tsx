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
  onNewEditor?: () => void
  onRenameFile?: (newName: string) => void
}

const EditorPane: React.FC<EditorPaneProps> = ({ activeTab, theme, onChange, onNewEditor, onRenameFile }) => {
  const editorApiRef = useRef<{
    wrapSelection: (p: string, s?: string) => void
    toggleBold: () => void
    toggleItalic: () => void
    insertLink: () => void
    insertList: (t: 'bullet'|'number'|'check') => void
    insertCodeBlock: () => void
    insertHeading?: (level: 1|2|3|4|5|6) => void
    insertQuote?: () => void
    insertHorizontalRule?: () => void
    toggleInlineCode?: () => void
  } | null>(null)

  if (!activeTab) {
    return (
      <div style={{ padding: 16, color: 'var(--text-secondary)', height:'100%', display:'flex', flexDirection:'column' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ fontWeight:600 }}>Editor</div>
          <button className="search-btn" onClick={onNewEditor}>[+] New Editor</button>
        </div>
        <div>No file open</div>
      </div>
    )
  }

  return (
    <div className="panel editor-panel" style={{ height: '100%', flex: 1 }}>
      {/* Slim top bar to spawn another editor pane */}
      <div className="panel-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 8px' }}>
        <button className="search-btn" onClick={onNewEditor}>[+] New Editor</button>
        <div style={{opacity:0.6, fontSize:12}}>{activeTab.path || activeTab.name}</div>
      </div>
      {/* Title input and tool bar inside editor space */}
      <div className="panel-header" style={{ padding:'4px 8px', borderTop:'1px solid var(--border-light)' }}>
        <input
          className="settings-input"
          style={{
            width:'100%',
            fontSize: '20px',
            fontWeight: 700,
            background:'transparent',
            border:'0',
            outline:'none',
            padding:'8px 6px'
          }}
          value={activeTab.name}
          onChange={(e)=> onRenameFile?.(e.target.value)}
        />
        <div className="tab-bar" style={{ gap: 6, padding: 4 }}>
          <button className="search-btn" title="Heading 1" onClick={()=>editorApiRef.current?.insertHeading?.(1)}>H1</button>
          <button className="search-btn" title="Heading 2" onClick={()=>editorApiRef.current?.insertHeading?.(2)}>H2</button>
          <button className="search-btn" title="Heading 3" onClick={()=>editorApiRef.current?.insertHeading?.(3)}>H3</button>
          <span style={{ width: 8 }} />
          <button className="search-btn" title="Bold (Ctrl/Cmd+B)" onClick={()=>editorApiRef.current?.toggleBold()}>B</button>
          <button className="search-btn" title="Italic (Ctrl/Cmd+I)" onClick={()=>editorApiRef.current?.toggleItalic()}>I</button>
          <button className="search-btn" title="Inline code" onClick={()=>editorApiRef.current?.toggleInlineCode?.()}>`</button>
          <span style={{ width: 8 }} />
          <button className="search-btn" title="Link" onClick={()=>editorApiRef.current?.insertLink()}>Link</button>
          <button className="search-btn" title="Bulleted list" onClick={()=>editorApiRef.current?.insertList('bullet')}>• List</button>
          <button className="search-btn" title="Numbered list" onClick={()=>editorApiRef.current?.insertList('number')}>1. List</button>
          <button className="search-btn" title="Task list" onClick={()=>editorApiRef.current?.insertList('check')}>[ ]</button>
          <span style={{ width: 8 }} />
          <button className="search-btn" title="Block quote" onClick={()=>editorApiRef.current?.insertQuote?.()}>❝</button>
          <button className="search-btn" title="Code block" onClick={()=>editorApiRef.current?.insertCodeBlock()}>Code</button>
          <button className="search-btn" title="Horizontal rule" onClick={()=>editorApiRef.current?.insertHorizontalRule?.()}>―</button>
        </div>
      </div>
      <div className="panel-content">
        <div style={{height:'100%', display:'flex', flexDirection:'column'}}>
          <div style={{flex:1}}>
            <MonacoEditor
              value={activeTab.content}
              onChange={onChange}
              language="markdown"
              theme={theme}
              path={activeTab.path || activeTab.id}
              key={activeTab.path || activeTab.id}
              onReady={(api)=>{editorApiRef.current=api}}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditorPane