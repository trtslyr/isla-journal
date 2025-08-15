import React, { useRef, useState } from 'react'
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
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitle, setEditingTitle] = useState('')
  
  const handleTitleClick = () => {
    if (activeTab?.path) {
      setEditingTitle(activeTab.name.replace(/\.md$/i, ''))
      setIsEditingTitle(true)
    }
  }
  
  const handleTitleSubmit = async () => {
    if (editingTitle.trim() && activeTab?.path && onCommitRename) {
      const newName = editingTitle.trim()
      await onCommitRename(newName)
    }
    setIsEditingTitle(false)
  }
  
  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
    }
  }
  
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
      <div style={{ padding: 16, color: 'var(--text-secondary)', height:'100%', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center' }}>
        <div>No file open</div>
      </div>
    )
  }

  return (
    <div className="panel editor-panel" style={{ height: '100%', flex: 1 }}>
      {/* If no file selected for this tab, show placeholder */}
      {(!activeTab.path) ? (
        <div className="panel-content" style={{ padding: 16, color: 'var(--text-secondary)' }}>
          No file selected
        </div>
      ) : (
      <div className="panel-header" style={{ padding:'4px 8px', borderTop:'1px solid var(--border-light)' }}>
        {isEditingTitle ? (
          <input
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
            autoFocus
            style={{
              width: '100%',
              fontSize: '20px',
              fontWeight: 700,
              padding: '8px 6px',
              border: '1px solid var(--accent-blue)',
              borderRadius: '4px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              outline: 'none'
            }}
          />
        ) : (
          <div
            style={{
              width:'100%',
              fontSize: '20px',
              fontWeight: 700,
              padding:'8px 6px',
              cursor: activeTab?.path ? 'pointer' : 'default'
            }}
            title={activeTab?.path ? 'Click to rename file' : (activeTab.path || activeTab.name)}
            onClick={handleTitleClick}
          >
            {activeTab.name.replace(/\.md$/i, '')}
          </div>
        )}

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