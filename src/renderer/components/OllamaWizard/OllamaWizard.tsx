import React, { useState, useEffect } from 'react'
import './OllamaWizard.css'

interface OllamaWizardProps {
  isOpen: boolean
  onClose: () => void
  autoLaunched?: boolean // true if opened due to no Ollama detected
}

interface ModelInfo {
  name: string
  size: string
  description: string
  isRecommended?: boolean
  isRequired?: boolean
  isInstalled?: boolean
  downloadProgress?: number
}

interface OllamaStatus {
  connected: boolean
  host: string | null
  models: string[]
  error?: string
}

const RECOMMENDED_MODELS: ModelInfo[] = [
  {
    name: 'nomic-embed-text:latest',
    size: '274MB',
    description: 'Required for semantic search and AI features (768-dim embeddings)',
    isRequired: true
  },
  {
    name: 'llama3.2:1b',
    size: '1.3GB',
    description: 'Fast, efficient chat model - great for quick responses',
    isRecommended: true
  },
  {
    name: 'llama3.2:3b',
    size: '2.0GB',
    description: 'Balanced performance and quality',
    isRecommended: true
  },
  {
    name: 'llama3.1:8b',
    size: '4.7GB',
    description: 'High-quality responses, best for detailed analysis'
  },
  {
    name: 'gemma2:2b',
    size: '1.6GB',
    description: 'Ultra-fast responses, minimal resource usage'
  }
]

const OllamaWizard: React.FC<OllamaWizardProps> = ({ isOpen, onClose, autoLaunched = false }) => {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({ connected: false, host: null, models: [] })
  const [models, setModels] = useState<ModelInfo[]>([])
  const [downloading, setDownloading] = useState<Record<string, number>>({}) // modelName -> progress
  const [isChecking, setIsChecking] = useState(false)
  const [activeModel, setActiveModel] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      checkOllamaStatus()
    }
  }, [isOpen])

  const checkOllamaStatus = async () => {
    setIsChecking(true)
    try {
      // Check if Ollama is reachable
      const host = await window.electronAPI?.getResolvedOllamaHost?.() || 'http://127.0.0.1:11434'
      
      try {
        const availableModels = await window.electronAPI?.llmGetAvailableModels?.() || []
        const currentActiveModel = await window.electronAPI?.llmGetCurrentModel?.() || null
        
        // Merge recommended models with installed status
        const enhancedModels = RECOMMENDED_MODELS.map(model => ({
          ...model,
          isInstalled: availableModels.includes(model.name)
        }))
        
        // Add any installed models not in our recommended list
        const extraModels = availableModels
          .filter(modelName => !RECOMMENDED_MODELS.some(rec => rec.name === modelName))
          .map(modelName => ({
            name: modelName,
            size: 'Unknown',
            description: 'User-installed model',
            isInstalled: true
          }))
        
        setModels([...enhancedModels, ...extraModels])
        setActiveModel(currentActiveModel)
        setOllamaStatus({
          connected: true,
          host,
          models: availableModels,
          error: undefined
        })
      } catch (modelError) {
        setOllamaStatus({
          connected: false,
          host,
          models: [],
          error: 'Ollama server not responding'
        })
      }
    } catch (error) {
      setOllamaStatus({
        connected: false,
        host: null,
        models: [],
        error: 'Ollama not found'
      })
    } finally {
      setIsChecking(false)
    }
  }

  const downloadModel = async (modelName: string) => {
    if (downloading[modelName]) return // Already downloading
    
    setDownloading(prev => ({ ...prev, [modelName]: 0 }))
    
    try {
      const host = ollamaStatus.host || 'http://127.0.0.1:11434'
      
      // Start download with progress tracking
      const response = await fetch(`${host}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true })
      })

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(Boolean)

        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            if (data.total && data.completed) {
              const progress = Math.round((data.completed / data.total) * 100)
              setDownloading(prev => ({ ...prev, [modelName]: progress }))
            }
            if (data.error) throw new Error(data.error)
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }

      // Download complete
      setDownloading(prev => {
        const newState = { ...prev }
        delete newState[modelName]
        return newState
      })
      
      // Refresh status
      await checkOllamaStatus()
      
    } catch (error) {
      console.error('Failed to download model:', error)
      setDownloading(prev => {
        const newState = { ...prev }
        delete newState[modelName]
        return newState
      })
    }
  }

  const deleteModel = async (modelName: string) => {
    if (!confirm(`Delete model "${modelName}"? This will free up disk space but you'll need to download it again to use it.`)) {
      return
    }

    try {
      const host = ollamaStatus.host || 'http://127.0.0.1:11434'
      
      const response = await fetch(`${host}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      })

      if (!response.ok) {
        throw new Error(`Failed to delete model: ${response.status}`)
      }

      // Refresh status
      await checkOllamaStatus()
      
    } catch (error) {
      console.error('Failed to delete model:', error)
      alert(`Failed to delete model: ${error.message}`)
    }
  }

  const activateModel = async (modelName: string) => {
    try {
      // Set as active model in localStorage
      await window.electronAPI?.llmSwitchModel?.(modelName)
      console.log('Activated model:', modelName)
      
      // Refresh status to show updated active model
      await checkOllamaStatus()
      
    } catch (error) {
      console.error('Failed to activate model:', error)
    }
  }

  const openUrl = (url: string) => {
    try {
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(url)
      } else {
        window.open(url, '_blank')
      }
    } catch (error) {
      window.open(url, '_blank')
    }
  }

  if (!isOpen) return null

  return (
    <div className="ollama-wizard-overlay">
      <div className="ollama-wizard">
        <div className="wizard-header">
          <h2>Ollama Management</h2>
          {!autoLaunched && (
            <button className="close-btn" onClick={onClose}>×</button>
          )}
        </div>

        <div className="wizard-content">
          {/* Connection Status */}
          <div className="connection-status">
            <div className="status-row">
              <span className="status-label">Ollama Status:</span>
              <span className={`status-indicator ${ollamaStatus.connected ? 'connected' : 'disconnected'}`}>
                {isChecking ? '⏳ Checking...' : ollamaStatus.connected ? '✅ Connected' : '❌ Not Connected'}
              </span>
              {ollamaStatus.host && (
                <span className="host-info">({ollamaStatus.host})</span>
              )}
            </div>
            {ollamaStatus.error && (
              <div className="error-message">{ollamaStatus.error}</div>
            )}
          </div>

          {/* Ollama Not Found */}
          {!ollamaStatus.connected && (
            <div className="installation-guide">
              <h3>📦 Install Ollama First</h3>
              <p>Isla Journal requires Ollama to run AI features locally on your computer.</p>
              
              <div className="install-steps">
                <div className="step">
                  <strong>1. Download Ollama:</strong>
                  <button 
                    className="download-btn"
                    onClick={() => openUrl('https://ollama.ai/download')}
                  >
                    Download Ollama
                  </button>
                </div>
                <div className="step">
                  <strong>2. Install and run:</strong> <code>ollama serve</code>
                </div>
                <div className="step">
                  <strong>3. Refresh this wizard:</strong>
                  <button className="refresh-btn" onClick={checkOllamaStatus}>
                    🔄 Check Again
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Model Management */}
          {ollamaStatus.connected && (
            <div className="models-section">
              <h3>🤖 AI Models</h3>
              <p>Install the models you need for different AI features:</p>
              
              <div className="models-list">
                {models.map(model => (
                  <div key={model.name} className={`model-item ${model.isRequired ? 'required' : model.isRecommended ? 'recommended' : ''}`}>
                    <div className="model-info">
                      <div className="model-header">
                        <span className="model-name">{model.name}</span>
                        <span className="model-size">{model.size}</span>
                        {model.isRequired && <span className="badge required">Required</span>}
                        {model.isRecommended && <span className="badge recommended">Recommended</span>}
                      </div>
                      <div className="model-description">{model.description}</div>
                    </div>
                    
                    <div className="model-actions">
                      {model.isInstalled ? (
                        <div className="installed-actions">
                          {activeModel === model.name ? (
                            <span className="active-badge">🟢 Active</span>
                          ) : (
                            <button 
                              className="activate-btn"
                              onClick={() => activateModel(model.name)}
                            >
                              Activate
                            </button>
                          )}
                          {!model.isRequired && (
                            <button 
                              className="delete-btn"
                              onClick={() => deleteModel(model.name)}
                              title="Delete model"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      ) : downloading[model.name] !== undefined ? (
                        <div className="download-progress">
                          <div className="progress-bar">
                            <div 
                              className="progress-fill" 
                              style={{ width: `${downloading[model.name]}%` }}
                            />
                          </div>
                          <span className="progress-text">{downloading[model.name]}%</span>
                        </div>
                      ) : (
                        <button 
                          className="download-model-btn"
                          onClick={() => downloadModel(model.name)}
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Browse More Models */}
              <div className="browse-models">
                <p>Need more models?</p>
                <button 
                  className="browse-btn"
                  onClick={() => openUrl('https://ollama.ai/library')}
                >
                  🔍 Browse Ollama Library
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="wizard-actions">
            {autoLaunched && !ollamaStatus.connected ? (
              <p className="auto-launch-note">
                ⚠️ Ollama is required to use AI features. Please install it to continue.
              </p>
            ) : (
              <button className="continue-btn" onClick={onClose}>
                {ollamaStatus.connected ? 'Continue' : 'Close'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default OllamaWizard
