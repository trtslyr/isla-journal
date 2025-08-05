import React, { useState, useEffect } from 'react'

interface RenameModalProps {
  isOpen: boolean
  item: { path: string; name: string; type: 'file' | 'directory' } | null
  onConfirm: (newName: string) => void
  onCancel: () => void
}

const RenameModal: React.FC<RenameModalProps> = ({ isOpen, item, onConfirm, onCancel }) => {
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && item) {
      // Pre-fill with current name, but select the name part (without extension for files)
      if (item.type === 'file' && item.name.includes('.')) {
        const nameWithoutExt = item.name.substring(0, item.name.lastIndexOf('.'))
        setNewName(nameWithoutExt)
      } else {
        setNewName(item.name)
      }
      setError(null)
    }
  }, [isOpen, item])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!newName.trim()) {
      setError('Name cannot be empty')
      return
    }

    // Add file extension back for files
    const finalName = item?.type === 'file' && item.name.includes('.') 
      ? `${newName.trim()}.${item.name.split('.').pop()}`
      : newName.trim()

    // Basic validation
    if (finalName.includes('/') || finalName.includes('\\')) {
      setError('Name cannot contain / or \\ characters')
      return
    }

    if (finalName === item?.name) {
      setError('New name must be different from current name')
      return
    }

    onConfirm(finalName)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  if (!isOpen || !item) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Rename {item.type === 'file' ? 'File' : 'Directory'}</h3>
          <button 
            className="modal-close" 
            onClick={onCancel}
            type="button"
          >
            ×
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-body">
          <label htmlFor="newName">
            {item.type === 'file' ? 'File name:' : 'Directory name:'}
          </label>
          <input
            id="newName"
            type="text"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value)
              setError(null)
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Enter new ${item.type} name`}
            autoFocus
            autoSelect
          />
          
          {item.type === 'file' && item.name.includes('.') && (
            <small>
              Extension will be preserved: .{item.name.split('.').pop()}
            </small>
          )}
          
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">
              Rename
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default RenameModal 