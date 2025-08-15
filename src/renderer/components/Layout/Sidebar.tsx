import React, { forwardRef } from 'react'
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
  onCreateFile?: () => void
  onCreateFolder?: () => void
  onSearch?: () => void
}

const Sidebar = forwardRef<any, SidebarProps>(({ rootDirectory, width, collapsed, onResizeStart, onOpenDirectory, onFileSelect, selectedFilePath, onToggleCollapse, onCreateFile, onCreateFolder, onSearch }, ref) => {
  return (
    <div 
      className={`panel file-tree-panel ${collapsed ? 'collapsed' : ''}`}
      style={{ width }}
    >
      {!collapsed && (
        <div className="panel-content">
          <FileTree
            ref={ref}
            rootPath={rootDirectory}
            onFileSelect={onFileSelect}
            selectedFile={selectedFilePath}
            onDirectorySelect={onOpenDirectory}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onSearch={onSearch}
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
})

export default Sidebar