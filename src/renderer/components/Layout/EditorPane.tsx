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
  onCommitRename?: (newName: string) => void
  // New: chrome-like tabs
  tabs?: EditorTabModel[]
  activeTabId?: string
  onSelectTab?: (tabId: string) => void
  onCloseTab?: (tabId: string) => void
}

const EditorPane: React.FC<EditorPaneProps> = ({ activeTab, theme, onChange, onNewEditor, onRenameFile, onCommitRename, tabs = [], activeTabId, onSelectTab, onCloseTab }) => {
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
      {/* Chrome-like tab strip with [+] fixed on the left */}
      <div className="panel-header" style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 8px' }}>
        <button
          className="search-btn"
          onClick={onNewEditor}
          title="New Editor"
          style={{ padding:'0 6px', width:28, height:24, lineHeight:'20px', fontSize:16, flex:'0 0 auto' }}
        >
          ＋
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:6, overflowX:'auto', flex:1 }}>
          {(tabs || []).map(tab => (
            <div
              key={tab.id}
              onClick={() => onSelectTab?.(tab.id)}
              style={{
                display:'flex', alignItems:'center', gap:6,
                maxWidth:240,
                padding:'6px 10px', borderRadius:8,
                cursor:'pointer',
                background: tab.id === activeTabId ? 'var(--surface)' : 'transparent',
                border: '1px solid var(--border-light)'
              }}
              title={tab.path || tab.name}
            >
              <div style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight: tab.id === activeTabId ? 600 : 500}}>
                {tab.name}{tab.hasUnsavedChanges ? '*' : ''}
              </div>
              <button
                className="search-btn"
                onClick={(e) => { e.stopPropagation(); onCloseTab?.(tab.id) }}
                title="Close"
              >×</button>
            </div>
          ))}
        </div>
      </div>
      {/* If no file selected for this tab, show placeholder */}
      {(!activeTab.path) ? (
        <div className="panel-content" style={{ padding: 16, color: 'var(--text-secondary)' }}>
          No file selected
        </div>
      ) : (
      <div className="panel-header" style={{ padding:'4px 8px', borderTop:'1px solid var(--border-light)' }}>
        <div
          style={{
            width:'100%',
            fontSize: '20px',
            fontWeight: 700,
            padding:'8px 6px'
          }}
          title={activeTab.path || activeTab.name}
        >
          {activeTab.name.replace(/\.md$/i, '')}
        </div>
        {/* Read-only date meta */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'0 6px 6px 6px', color:'var(--text-secondary)', fontSize:12 }}>
          <span id="editor-file-date" />
        </div>
      </div>
      )}
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