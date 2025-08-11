import React, { useState, useEffect } from 'react'

interface CreateModalProps {
  isOpen: boolean
  type: 'file' | 'directory'
  onConfirm: (name: string) => void
  onCancel: () => void
}

const CreateModal: React.FC<CreateModalProps> = ({ isOpen, type, onConfirm, onCancel }) => {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setName('')
      setError(null)
    }
  }, [isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    const trimmedName = name.trim()
    
    // Validation
    if (!trimmedName) {
      setError('Name cannot be empty')
      return
    }
    
    // Check for actually invalid characters (Windows: < > : " | ? * )
    const invalidChars = /[<>:"|?*]/g
    if (invalidChars.test(trimmedName)) {
      setError('Name cannot contain < > : " | ? * characters')
      return
    }
    
    if (trimmedName.startsWith('.')) {
      setError('Name cannot start with .')
      return
    }
    
    // Add .md extension for files if not present
    const finalName = type === 'file' && !trimmedName.endsWith('.md') 
      ? `${trimmedName}.md` 
      : trimmedName
    
    onConfirm(finalName)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create New {type === 'file' ? 'File' : 'Folder'}</h3>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <label>
              {type === 'file' ? 'File' : 'Folder'} Name:
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                }}
                onKeyDown={handleKeyDown}
                placeholder={type === 'file' ? 'my-journal-entry' : 'folder-name'}
                autoFocus
              />
            </label>
            {type === 'file' && (
              <small>Note: .md extension will be added automatically</small>
            )}
            {error && <div className="error-message">{error}</div>}
          </div>
          
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="submit">Create</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateModal 