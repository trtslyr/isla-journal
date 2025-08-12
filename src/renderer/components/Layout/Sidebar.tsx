import React from 'react'
import { FileTree } from '../FileTree'

interface SidebarProps {
  rootDirectory: string | null
  width: number
  collapsed: boolean
  onResizeStart: () => void
  onOpenDirectory: () => void
  onFileSelect: (filePath: string, fileName: string) => void
  selectedFilePath: string | null
  onToggleCollapse: () => void
}

const Sidebar: React.FC<SidebarProps> = ({ rootDirectory, width, collapsed, onResizeStart, onOpenDirectory, onFileSelect, selectedFilePath, onToggleCollapse }) => {
  return (
    <div 
      className={`panel file-tree-panel ${collapsed ? 'collapsed' : ''}`}
      style={{ width }}
    >
      {!collapsed && (
        <div className="panel-content">
          <FileTree
            rootPath={rootDirectory}
            onFileSelect={onFileSelect}
            selectedFile={selectedFilePath}
            onDirectorySelect={onOpenDirectory}
          />
        </div>
      )}

      <div 
        className="resize-handle resize-handle-right"
        onMouseDown={(e) => {
          e.preventDefault()
          onResizeStart()
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
      />
    </div>
  )
}

export default Sidebar