import React, { useState, useEffect } from 'react'
import CreateModal from './CreateModal'
import RenameModal from './RenameModal'

interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory'
  modified: string
  size: number
  children?: FileItem[]
  expanded?: boolean
}

interface PinnedItem {
  path: string
  name: string
  type: 'file' | 'directory'
}

interface SearchResult {
  id: number
  file_id: number
  file_path: string
  file_name: string
  content_snippet: string
  rank: number
}

interface FileTreeProps {
  rootPath: string | null
  onFileSelect: (filePath: string, fileName: string) => void
  selectedFile: string | null
  onDirectorySelect: () => void
}

const FileTree: React.FC<FileTreeProps> = ({ rootPath, onFileSelect, selectedFile, onDirectorySelect }) => {
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([])
  // Build indicator (embeddings progress while new root loads)
  const [isBuilding, setIsBuilding] = useState<boolean>(false)
  const [buildTotal, setBuildTotal] = useState<number>(0)
  const [buildEmbedded, setBuildEmbedded] = useState<number>(0)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [lastClickedItem, setLastClickedItem] = useState<string | null>(null)
  
  // Search states
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showSearchResults, setShowSearchResults] = useState(false)
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [createType, setCreateType] = useState<'file' | 'directory'>('file')
  const [renamingItem, setRenamingItem] = useState<{ path: string; name: string; type: 'file' | 'directory' } | null>(null)
  
  // Hover and menu states
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [showContextMenu, setShowContextMenu] = useState<string | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Drag and drop states
  const [draggedItems, setDraggedItems] = useState<string[]>([])
  const [dragOverItem, setDragOverItem] = useState<string | null>(null)
  
  // Load pinned items from settings on mount
  useEffect(() => {
    const loadPinnedItems = async () => {
      try {
        const saved = await window.electronAPI.settingsGet?.('pinnedItems')
        if (saved) {
          const parsed = JSON.parse(saved)
          // Normalize paths by prepending current root if items were saved with base names only
          const root = await window.electronAPI.settingsGet?.('selectedDirectory')
          const normed = Array.isArray(parsed) ? parsed.map((p: any) => {
            if (p?.path && !p.path.startsWith('/')) {
              return { ...p, path: `${root}/${p.path}` }
            }
            return p
          }) : []
          setPinnedItems(normed)
        }
      } catch (error) {
        console.error('Failed to load pinned items:', error)
      }
    }
    loadPinnedItems()
  }, [])

  // Listen for embeddings build progress to show indicator
  useEffect(() => {
    const off = window.electronAPI.onEmbeddingsProgress?.((p) => {
      if (!p) return
      if (p.status === 'starting') {
        setIsBuilding(true)
        setBuildTotal(p.total || 0)
        setBuildEmbedded(p.embedded || 0)
      } else if (p.status === 'running') {
        setIsBuilding(true)
        if (typeof p.total === 'number') setBuildTotal(p.total)
        if (typeof p.embedded === 'number') setBuildEmbedded(p.embedded)
      } else if (p.status === 'done' || p.status === 'error') {
        setBuildEmbedded(p.embedded || 0)
        setBuildTotal(p.total || 0)
        setTimeout(() => setIsBuilding(false), 400)
      }
    })
    return () => { if (off) off() }
  }, [])

  // Save pinned items to settings when changed
  useEffect(() => {
    const savePinnedItems = async () => {
      try {
        await window.electronAPI.settingsSet?.('pinnedItems', JSON.stringify(pinnedItems))
      } catch (error) {
        console.error('Failed to save pinned items:', error)
      }
    }
    // Always save (allow clearing to persist as well)
    savePinnedItems()
  }, [pinnedItems])

  // Cleanup search timeout on unmount
  useEffect(() => {
    return () => {
      if (window.searchTimeout) {
        clearTimeout(window.searchTimeout)
      }
    }
  }, [])

  const cleanFileName = (fileName: string): string => {
    return fileName.replace(/\s+[a-f0-9]{32}\.md$/, '.md')
  }

  const cleanDirectoryName = (dirName: string): string => {
    // Remove trailing long hex identifiers often appended to folder names
    // e.g., "My Folder 134dde5ed759812ab82..." -> "My Folder"
    return dirName.replace(/\s+[a-f0-9]{16,}$/i, '')
  }

  const sortItems = (items: FileItem[]): FileItem[] => {
    return items.sort((a, b) => {
      // First sort by type - directories first, then files
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      
      // Within the same type, sort by modification time (newest first)
      const dateA = new Date(a.modified).getTime()
      const dateB = new Date(b.modified).getTime()
      return dateB - dateA
    })
  }

  const loadDirectory = async (dirPath: string) => {
    if (!dirPath) return
    
    setLoading(true)
    setError(null)
    
    try {
      console.log('📁 [FileTree] Loading directory:', dirPath)
      const result = await window.electronAPI.readDirectory?.(dirPath)
      
      const processedFiles = result.map((item: any) => ({
        ...item,
        name: item.type === 'file' ? cleanFileName(item.name) : cleanDirectoryName(item.name),
        children: item.type === 'directory' ? [] : undefined,
        expanded: false
      }))
      
      // Sort items with newest first
      const sortedFiles = sortItems(processedFiles)
      
      setFiles(sortedFiles)
      console.log('✅ [FileTree] Loaded', sortedFiles.length, 'items')
    } catch (error) {
      console.error('❌ [FileTree] Error loading directory:', error)
      setError('Failed to load directory')
    } finally {
      setLoading(false)
    }
  }

  const loadSubdirectory = async (dirPath: string): Promise<FileItem[]> => {
    try {
      const result = await window.electronAPI.readDirectory?.(dirPath)
      const processedFiles = result.map((item: any) => ({
        ...item,
        name: item.type === 'file' ? cleanFileName(item.name) : cleanDirectoryName(item.name),
        children: item.type === 'directory' ? [] : undefined,
        expanded: false
      }))
      
      // Sort items with newest first
      return sortItems(processedFiles)
    } catch (error) {
      console.error('❌ [FileTree] Error loading subdirectory:', error)
      return []
    }
  }

  useEffect(() => {
    if (rootPath) {
      loadDirectory(rootPath)
      // Ensure root is expanded by default
      setExpandedFolders(new Set([rootPath]))
      // show preparing indicator until embeddings report done
      setIsBuilding(true)
    } else {
      setFiles([])
    }
  }, [rootPath])

  const toggleFolder = async (item: FileItem) => {
    const isCurrentlyExpanded = expandedFolders.has(item.path)
    const newExpanded = new Set(expandedFolders)
    
    if (isCurrentlyExpanded) {
      newExpanded.delete(item.path)
    } else {
      newExpanded.add(item.path)
      const children = await loadSubdirectory(item.path)
      setFiles(prevFiles => {
        const updateChildren = (items: FileItem[]): FileItem[] => {
          return items.map(fileItem => {
            if (fileItem.path === item.path) {
              return { ...fileItem, children, expanded: true }
            }
            if (fileItem.children) {
              return { ...fileItem, children: updateChildren(fileItem.children) }
            }
            return fileItem
          })
        }
        return updateChildren(prevFiles)
      })
    }
    setExpandedFolders(newExpanded)
  }

  const handleItemClick = (item: FileItem, event: React.MouseEvent) => {
    // Handle multi-select with Shift key
    if (event.shiftKey && lastClickedItem) {
      handleRangeSelect(lastClickedItem, item.path)
      return
    }

    // Handle single selection
    if (event.ctrlKey || event.metaKey) {
      const newSelected = new Set(selectedItems)
      if (newSelected.has(item.path)) {
        newSelected.delete(item.path)
      } else {
        newSelected.add(item.path)
      }
      setSelectedItems(newSelected)
    } else {
      setSelectedItems(new Set([item.path]))
    }
    
    setLastClickedItem(item.path)

    if (item.type === 'directory') {
      toggleFolder(item)
    } else {
      onFileSelect(item.path, item.name)
    }
  }

  const handleRangeSelect = (startPath: string, endPath: string) => {
    // Get all visible items in order
    const allItems: string[] = []
    const collectItems = (items: FileItem[]) => {
      items.forEach(item => {
        allItems.push(item.path)
        if (item.type === 'directory' && expandedFolders.has(item.path) && item.children) {
          collectItems(item.children)
        }
      })
    }
    collectItems(files)

    const startIndex = allItems.indexOf(startPath)
    const endIndex = allItems.indexOf(endPath)
    
    if (startIndex !== -1 && endIndex !== -1) {
      const minIndex = Math.min(startIndex, endIndex)
      const maxIndex = Math.max(startIndex, endIndex)
      const rangeItems = allItems.slice(minIndex, maxIndex + 1)
      setSelectedItems(new Set(rangeItems))
    }
  }

  const handleContextMenu = (item: FileItem, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenuPosition({ x: event.clientX, y: event.clientY })
    setShowContextMenu(item.path)
  }

  const handlePinItem = (item: FileItem) => {
    // Only allow favoriting files, not folders
    if (item.type === 'directory') {
      alert('Only files can be favorited, not folders')
      return
    }
    
    if (pinnedItems.length >= 5) {
      alert('Maximum 5 favorites allowed')
      return
    }
    
    const alreadyPinned = pinnedItems.some(pinned => pinned.path === item.path)
    if (alreadyPinned) {
      alert('Item is already a favorite')
      return
    }

    const newPinned: PinnedItem = {
      path: item.path,
      name: item.name,
      type: item.type
    }
    
    setPinnedItems(prev => [...prev, newPinned])
    setShowContextMenu(null)
  }

  const handleUnpinItem = (path: string) => {
    setPinnedItems(prev => prev.filter(item => item.path !== path))
  }

  const handleDeleteItem = async (item: FileItem) => {
    const confirmMessage = `Are you sure you want to delete "${item.name}"?${
      item.type === 'directory' ? ' This will delete the entire folder and its contents.' : ''
    }`
    
    if (!confirm(confirmMessage)) {
      return
    }

    try {
      await window.electronAPI.deleteFile?.(item.path)
      
      // Remove from pinned items if it was pinned
      setPinnedItems(prev => prev.filter(pinned => pinned.path !== item.path))
      
      // Remove from selected items
      setSelectedItems(prev => {
        const newSelected = new Set(prev)
        newSelected.delete(item.path)
        return newSelected
      })
      
      // Refresh the directory to update the file tree
      if (rootPath) {
        await loadDirectory(rootPath)
      }
      
      setShowContextMenu(null)
      console.log('✅ [FileTree] Successfully deleted:', item.name)
    } catch (error) {
      console.error('❌ [FileTree] Failed to delete item:', error)
      alert(`Failed to delete "${item.name}": ${error.message || 'Unknown error'}`)
    }
  }

  const handleRenameItem = (item: FileItem) => {
    setRenamingItem({
      path: item.path,
      name: item.name,
      type: item.type
    })
    setShowRenameModal(true)
    setShowContextMenu(null)
  }

  const handleRenameSubmit = async (newName: string) => {
    if (!renamingItem) return

    try {
      const result = await window.electronAPI.renameFile?.(renamingItem.path, newName)
      
      // Update pinned items if the renamed item was pinned
      setPinnedItems(prev => prev.map(pinned => 
        pinned.path === renamingItem.path 
          ? { ...pinned, path: result?.newPath, name: newName }
          : pinned
      ))
      
      // Update selected items
      setSelectedItems(prev => {
        const newSelected = new Set(prev)
        if (newSelected.has(renamingItem.path)) {
          newSelected.delete(renamingItem.path)
          newSelected.add(result?.newPath || '')
        }
        return newSelected
      })
      
      // Refresh the directory to update the file tree
      if (rootPath) {
        await loadDirectory(rootPath)
      }
      
      setShowRenameModal(false)
      setRenamingItem(null)
      console.log('✅ [FileTree] Successfully renamed:', renamingItem.name, '->', newName)
    } catch (error) {
      console.error('❌ [FileTree] Failed to rename item:', error)
      alert(`Failed to rename "${renamingItem.name}": ${error.message || 'Unknown error'}`)
    }
  }

  const getFileIcon = (item: FileItem) => {
    if (item.type === 'directory') {
      const isExpanded = expandedFolders.has(item.path)
      return isExpanded ? '▼' : '▶'
    } else if (item.name.endsWith('.md')) {
      return '○'
    }
    return '○'
  }

  const createFile = async (fileName: string) => {
    if (!rootPath) return
    
    try {
      await window.electronAPI.createFile?.(rootPath, fileName)
      loadDirectory(rootPath) // Refresh the list
    } catch (error) {
      console.error('Failed to create file:', error)
      alert('Failed to create file: ' + fileName)
    }
  }

  const createFolder = async (folderName: string) => {
    if (!rootPath) return
    
    try {
      await window.electronAPI.createDirectory?.(rootPath, folderName)
      loadDirectory(rootPath) // Refresh the list
    } catch (error) {
      console.error('Failed to create folder:', error)
      alert('Failed to create folder: ' + folderName)
    }
  }

  const handleCreateFile = (name: string) => {
    createFile(name)
    setShowCreateModal(false)
  }

  const handleCreateFolder = (name: string) => {
    createFolder(name)
    setShowCreateModal(false)
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

  // Function to manually load saved directory
  const loadSavedDirectory = async () => {
    try {
      console.log('🔄 [FileTree] Manually loading saved directory...')
      const savedDirectory = await window.electronAPI.settingsGet?.('selectedDirectory')
      console.log('🔍 [FileTree] Found saved directory:', savedDirectory)
      if (savedDirectory) {
        // Trigger the parent to update rootPath by calling onDirectorySelect
        // This is a workaround since we can't directly set the parent's state
        console.log('✅ [FileTree] Saved directory found, calling directory selector...')
        onDirectorySelect()
      } else {
        console.log('❌ [FileTree] No saved directory found')
        onDirectorySelect()
      }
    } catch (error) {
      console.error('❌ [FileTree] Error loading saved directory:', error)
      onDirectorySelect()
    }
  }

  // Search functionality
  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setShowSearchResults(false)
      return
    }

    setIsSearching(true)
    try {
      const results = await window.electronAPI.searchContent?.(query, 20)
      setSearchResults(results)
      setShowSearchResults(true)
      console.log(`🔍 [FileTree] Found ${results.length} search results for: ${query}`)
    } catch (error) {
      console.error('❌ [FileTree] Search error:', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)
    
    // Debounce search - wait 300ms after user stops typing
    clearTimeout(window.searchTimeout)
    window.searchTimeout = setTimeout(() => {
      handleSearch(query)
    }, 300)
  }

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResults([])
    setShowSearchResults(false)
    clearTimeout(window.searchTimeout)
  }

  const renderTreeItems = (items: FileItem[], depth: number = 0): React.ReactNode => {
    return items.map((item) => {
      const isSelected = selectedItems.has(item.path)
      const isHovered = hoveredItem === item.path
      const isPinned = pinnedItems.some(p => p.path === item.path)
      const isDraggedOver = dragOverItem === item.path
      const isDragging = draggedItems.includes(item.path)
      
      return (
        <div key={item.path}>
          <div
            className={`tree-item ${item.type} ${isSelected ? 'selected' : ''} ${isDraggedOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''}`}
            draggable={true}
            onClick={(event) => handleItemClick(item, event)}
            onContextMenu={(event) => handleContextMenu(item, event)}
            onMouseEnter={() => setHoveredItem(item.path)}
            onMouseLeave={() => setHoveredItem(null)}
            onDragStart={(event) => handleDragStart(event, item)}
            onDragEnd={handleDragEnd}
            onDragOver={(event) => handleDragOver(event, item)}
            onDragLeave={handleDragLeave}
            onDrop={(event) => handleDrop(event, item)}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            title={`${item.name} ${item.type === 'file' ? `(${formatFileSize(item.size)}) - Modified: ${formatDate(item.modified)}` : ''}`}
          >
            <span className="tree-name">{item.name.replace(/\.?md$/i,'')}</span>
            {isPinned && <span className="pinned-indicator">fav</span>}
            
            {/* Hover menu */}
            {isHovered && !isDragging && (
              <div 
                className="item-actions"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowContextMenu(item.path)
                  setContextMenuPosition({ x: e.clientX, y: e.clientY })
                }}
              >
                <span className="three-dots">⋯</span>
              </div>
            )}
          </div>
          {item.type === 'directory' && expandedFolders.has(item.path) && item.children && (
            <div className="tree-children">
              {renderTreeItems(item.children, depth + 1)}
            </div>
          )}
        </div>
      )
    })
  }

  const renderPinnedItems = () => {
    if (pinnedItems.length === 0) return null

    return (
        <div className="pinned-section">
          <div className="pinned-header">
            <span className="pinned-title">Favorites</span>
            <span className="pinned-count">({pinnedItems.length}/5)</span>
          </div>
        <div 
          className="pinned-items"
        >
          {pinnedItems.map((item) => (
            <div
              key={item.path}
              className={`pinned-item ${item.type} ${selectedItems.has(item.path) ? 'selected' : ''}`}
              onClick={(event) => {
                try {
                  if (item.type === 'file') {
                    onFileSelect(item.path, item.name)
                  } else if (item.type === 'directory') {
                    // Expand directory if pinned
                    toggleFolder({ ...item, children: item.children || [], expanded: expandedFolders.has(item.path) } as any)
                  }
                } catch (e) {
                  alert(`Failed to open: ${item.name}`)
                }
                setSelectedItems(new Set([item.path]))
              }}
              onMouseEnter={() => setHoveredItem(item.path)}
              onMouseLeave={() => setHoveredItem(null)}
              title={`Favorite: ${item.name}`}
            >
              <span className="tree-icon"></span>
              <span className="tree-name">{item.name}</span>
              
              {/* Unpin button */}
              {hoveredItem === item.path && (
                <button
                  className="unpin-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleUnpinItem(item.path)
                  }}
                  title="Remove favorite"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderSearchResults = (): React.ReactNode => {
    if (isSearching) {
      return (
        <div className="search-loading">
          <p>🔍 Searching...</p>
        </div>
      )
    }

    if (searchResults.length === 0) {
      return (
        <div className="search-empty">
          <p>No results found for "{searchQuery}"</p>
          <small>Try different keywords or check spelling</small>
        </div>
      )
    }

    return (
      <div className="search-results">
        <div className="search-results-header">
          <span>Found {searchResults.length} results for "{searchQuery}"</span>
          <button 
            className="clear-search-btn"
            onClick={clearSearch}
            title="Clear search"
          >
            ✕
          </button>
        </div>
        {searchResults.map((result) => (
          <div
            key={`${result.file_id}-${result.id}`}
            className="search-result-item"
            onClick={() => {
              const fileName = result.file_name.replace(/\s+[a-f0-9]{32}\.md$/, '.md')
              onFileSelect(result.file_path, fileName)
            }}
            title={`Click to open ${result.file_name}`}
          >
            <div className="search-result-header">
              <span className="search-result-file">○ {result.file_name.replace(/\s+[a-f0-9]{32}\.md$/, '.md')}</span>
            </div>
            <div className="search-result-snippet">
              {result.content_snippet}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const findItemByPath = (items: FileItem[], path: string): FileItem | null => {
    for (const item of items) {
      if (item.path === path) return item
      if (item.children) {
        const found = findItemByPath(item.children, path)
        if (found) return found
      }
    }
    return null
  }

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setShowContextMenu(null)
    }

    if (showContextMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showContextMenu])

  // Drag and Drop Handlers
  const handleDragStart = (event: React.DragEvent, item: FileItem) => {
    const itemsToMove = selectedItems.has(item.path) 
      ? Array.from(selectedItems) 
      : [item.path]
    
    setDraggedItems(itemsToMove)
    event.dataTransfer.setData('text/plain', JSON.stringify(itemsToMove))
    event.dataTransfer.effectAllowed = 'move'
    
    // Add visual feedback
    event.currentTarget.classList.add('dragging')
  }

  const handleDragEnd = (event: React.DragEvent) => {
    setDraggedItems([])
    setDragOverItem(null)
    event.currentTarget.classList.remove('dragging')
  }

  const handleDragOver = (event: React.DragEvent, targetItem?: FileItem) => {
    event.preventDefault()
    
    if (targetItem && targetItem.type === 'directory') {
      event.dataTransfer.dropEffect = 'move'
      setDragOverItem(targetItem.path)
    } else {
      event.dataTransfer.dropEffect = 'none'
      setDragOverItem(null)
    }
  }

  const handleDragLeave = (event: React.DragEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX
    const y = event.clientY
    
    // Only clear drag over if mouse actually left the element
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverItem(null)
    }
  }

  const handleDrop = async (event: React.DragEvent, targetItem: FileItem) => {
    event.preventDefault()
    setDragOverItem(null)
    
    try {
      const draggedPaths = JSON.parse(event.dataTransfer.getData('text/plain')) as string[]
      
      if (targetItem.type === 'directory') {
        // Move each dragged item to the target directory
        for (const draggedPath of draggedPaths) {
          const draggedItem = findItemByPath(files, draggedPath)
          if (!draggedItem) continue
          
          try {
            const result = await window.electronAPI.moveFile?.(draggedPath, targetItem.path)
            if (result?.success) {
              console.log('🚚 [FileTree] Moved:', draggedItem.name, 'to', targetItem.name)
              
              // Update pinned items if the moved item was pinned
              setPinnedItems(prev => prev.map(pinned => 
                pinned.path === draggedPath 
                  ? { ...pinned, path: result?.newPath }
                  : pinned
              ))
              
              // Update selected items
              setSelectedItems(prev => {
                const newSelected = new Set(prev)
                if (newSelected.has(draggedPath)) {
                  newSelected.delete(draggedPath)
                  newSelected.add(result?.newPath || '')
                }
                return newSelected
              })
            } else if (result?.message) {
              console.log('ℹ️ [FileTree]', result.message)
            }
          } catch (error) {
            console.error('❌ [FileTree] Failed to move:', draggedItem.name, error)
            alert(`Failed to move "${draggedItem.name}": ${error.message}`)
          }
        }
        
        // Refresh the directory
        if (rootPath) {
          await loadDirectory(rootPath)
        }
      }
      // Don't allow dropping on files - only directories
      
    } catch (error) {
      console.error('❌ [FileTree] Drop operation failed:', error)
    }
  }

  return (
    <div className="file-tree">
      <div className="panel-header">
        {/* Top header: directory name only */}
        <div className="file-tree-header" style={{justifyContent:'flex-start', gap:8, width:'100%'}}>
          <button 
            className="open-directory-btn"
            onClick={onDirectorySelect}
            title={rootPath || 'Choose directory'}
            style={{flex:'1 1 auto', textAlign:'left'}}
          >
            {rootPath ? cleanDirectoryName(rootPath.split('/').pop() || rootPath) : '[Select Directory]'}
          </button>
          {isBuilding && (
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'2px 6px', border:'1px solid var(--border-light)', borderRadius:6 }} title="Indexing and building embeddings…">
              <span>⏳</span>
              <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
                {buildEmbedded.toLocaleString()} / {buildTotal.toLocaleString()}
              </span>
            </div>
          )}
        </div>
        
        {/* Search input - only show when search is active */}
        {showSearchResults && (
          <div className="search-container">
            <input
              type="text"
              placeholder="Search in files..."
              value={searchQuery}
              onChange={handleSearchInputChange}
              className="search-input"
              autoFocus
            />
            <button 
              className="clear-search-btn"
              onClick={clearSearch}
              title="Clear search"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="panel-content">
        {showSearchResults ? (
          renderSearchResults()
        ) : !rootPath ? (
          <div className="file-tree-empty">
            <p>No directory selected</p>
            <small>Use the header above to choose a directory</small>
          </div>
        ) : (
          <>
            {/* Pinned section - only show when not searching */}
            {renderPinnedItems()}
            
            {/* Root directory node and children */}
            <div className="file-tree-content">
              {rootPath && (
                <div className="tree-children">
                  {renderTreeItems(files, 0)}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="file-tree-actions">
        <button 
          className="action-btn"
          onClick={() => {
            setCreateType('file')
            setShowCreateModal(true)
          }}
          title="Create new markdown file"
          disabled={!rootPath}
        >
          [+] File
        </button>
        <button 
          className="action-btn"
          onClick={() => {
            setCreateType('directory')
            setShowCreateModal(true)
          }}
          title="Create new directory" 
          disabled={!rootPath}
        >
          [+] Folder
        </button>
        <button 
          className="action-btn"
          onClick={() => rootPath ? loadDirectory(rootPath) : loadSavedDirectory()}
          title={rootPath ? 'Refresh directory' : 'Load saved directory'}
        >
          [↻]
        </button>
        <button 
          className="action-btn"
          onClick={() => setShowSearchResults(!showSearchResults)}
          title="Search files"
        >
          [search]
        </button>
      </div>
      
      {/* Modals */}
      <CreateModal
        isOpen={showCreateModal}
        type={createType}
        onConfirm={createType === 'file' ? handleCreateFile : handleCreateFolder}
        onCancel={() => setShowCreateModal(false)}
      />

      <RenameModal
        isOpen={showRenameModal}
        item={renamingItem}
        onConfirm={handleRenameSubmit}
        onCancel={() => {
          setShowRenameModal(false)
          setRenamingItem(null)
        }}
      />

      {/* Context Menu */}
      {showContextMenu && (
        <>
          <div
            className="context-menu-overlay"
            onClick={() => setShowContextMenu(null)}
          />
          <div
            className="context-menu"
            style={{
              position: 'fixed',
              left: contextMenuPosition.x,
              top: contextMenuPosition.y,
              zIndex: 1001,
            }}
          >
            {(() => {
              const item = showContextMenu === rootPath 
                ? { path: rootPath, name: rootPath.split('/').pop() || rootPath, type: 'directory' as const }
                : findItemByPath(files, showContextMenu)
              if (!item) return null
              
              const isPinned = pinnedItems.some(p => p.path === item.path)
              
              return (
                <div className="context-menu-content">
                  {/* Only show pin options for files, not directories */}
                  {item.type === 'file' && (
                    <>
                      <button
                        className="context-menu-item"
                        onClick={() => handlePinItem(item as any)}
                        disabled={isPinned || pinnedItems.length >= 5}
                      >
                        {isPinned ? 'Already Favorited' : 'ADD TO FAVORITES'}
                      </button>
                      {isPinned && (
                        <button
                          className="context-menu-item"
                          onClick={() => {
                            handleUnpinItem(item.path)
                            setShowContextMenu(null)
                          }}
                        >
                          REMOVE FAVORITE
                        </button>
                      )}
                    </>
                  )}
                  <button
                    className="context-menu-item"
                    onClick={() => handleRenameItem(item as any)}
                    disabled={item.path === rootPath && item.type === 'directory'}
                  >
                    RENAME
                  </button>
                  <button
                    className="context-menu-item delete"
                    onClick={() => handleDeleteItem(item as any)}
                    disabled={item.path === rootPath && item.type === 'directory'}
                  >
                    DELETE
                  </button>
                </div>
              )
            })()}
          </div>
        </>
      )}
    </div>
  )
}

export default FileTree 