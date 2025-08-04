import React, { useState, useEffect } from 'react'

interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory'
  modified: string
  size: number
}

interface FileTreeProps {
  rootPath: string | null
  onFileSelect: (filePath: string, fileName: string) => void
  selectedFile: string | null
}

const FileTree: React.FC<FileTreeProps> = ({ rootPath, onFileSelect, selectedFile }) => {
  const [files, setFiles] = useState<FileItem[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDirectory = async (dirPath: string) => {
    try {
      setLoading(true)
      setError(null)
      const items = await window.electronAPI.readDirectory(dirPath)
      setFiles(items)
    } catch (err) {
      setError('Failed to load directory')
      console.error('Error loading directory:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (rootPath) {
      loadDirectory(rootPath)
    }
  }, [rootPath])

  const handleItemClick = async (item: FileItem) => {
    if (item.type === 'directory') {
      // Toggle directory expansion
      const newExpanded = new Set(expandedDirs)
      if (expandedDirs.has(item.path)) {
        newExpanded.delete(item.path)
      } else {
        newExpanded.add(item.path)
      }
      setExpandedDirs(newExpanded)
    } else if (item.type === 'file' && item.name.endsWith('.md')) {
      // Open file in editor
      onFileSelect(item.path, item.name)
    }
  }

  const getFileIcon = (item: FileItem) => {
    if (item.type === 'directory') {
      return expandedDirs.has(item.path) ? '📂' : '📁'
    } else if (item.name.endsWith('.md')) {
      return '📄'
    }
    return '📄'
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString()
  }

  if (!rootPath) {
    return (
      <div className="file-tree">
        <div className="file-tree-empty">
          <p>No journal directory selected</p>
          <button 
            className="open-directory-btn"
            onClick={async () => {
              try {
                const dirPath = await window.electronAPI.openDirectory()
                if (dirPath) {
                  // This would be handled by parent component
                  console.log('Selected directory:', dirPath)
                }
              } catch (error) {
                console.error('Failed to open directory:', error)
                alert('Failed to open directory. Please try again.')
              }
            }}
          >
            📁 Open Directory
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="file-tree">
        <div className="file-tree-loading">
          <p>Loading files...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="file-tree">
        <div className="file-tree-error">
          <p>{error}</p>
          <button onClick={() => loadDirectory(rootPath)}>
            🔄 Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="directory-path">{rootPath.split('/').pop()}</span>
        <button 
          className="refresh-btn"
          onClick={() => loadDirectory(rootPath)}
          title="Refresh"
        >
          🔄
        </button>
      </div>
      
      <div className="file-tree-content">
        {files.length === 0 ? (
          <div className="file-tree-empty">
            <p>No markdown files found</p>
            <p><small>Create a .md file to get started</small></p>
          </div>
        ) : (
          files.map((item) => (
            <div
              key={item.path}
              className={`tree-item ${item.type} ${
                selectedFile === item.path ? 'selected' : ''
              }`}
              onClick={() => handleItemClick(item)}
              title={`${item.name} (${formatFileSize(item.size)}) - Modified: ${formatDate(item.modified)}`}
            >
              <span className="tree-icon">{getFileIcon(item)}</span>
              <span className="tree-name">{item.name}</span>
              {item.type === 'file' && (
                <span className="file-size">{formatFileSize(item.size)}</span>
              )}
            </div>
          ))
        )}
      </div>
      
      <div className="file-tree-actions">
        <button 
          className="action-btn"
          onClick={async () => {
            const fileName = prompt('Enter file name (without .md):')
            if (fileName) {
              try {
                await window.electronAPI.createFile(rootPath, fileName)
                loadDirectory(rootPath) // Refresh the list
              } catch (error) {
                alert('Failed to create file')
              }
            }
          }}
          title="Create new markdown file"
        >
          ➕ New File
        </button>
        
        <button 
          className="action-btn"
          onClick={async () => {
            const dirName = prompt('Enter directory name:')
            if (dirName) {
              try {
                await window.electronAPI.createDirectory(rootPath, dirName)
                loadDirectory(rootPath) // Refresh the list
              } catch (error) {
                alert('Failed to create directory')
              }
            }
          }}
          title="Create new directory"
        >
          📁 New Folder
        </button>
      </div>
    </div>
  )
}

export default FileTree 