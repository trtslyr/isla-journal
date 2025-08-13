import React, { useState, useEffect } from 'react'
import './Settings.css'
import { ValidationResult } from '../../services/licenseValidation'
import { getLicenseDisplayType } from '../../utils/licenseUtils'
import { useLicenseCheck } from '../../hooks/useLicenseCheck'

interface DeviceSpecs {
  totalMemory: number
  availableMemory: number
  cpuCores: number
  cpuSpeed: number
  platform: string
  arch: string
  osVersion: string
  isAppleSilicon: boolean
  supportsAVX: boolean
}

interface ModelRecommendation {
  modelName: string
  displayName: string
  minMemory: number
  description: string
  downloadSize: string
  compatiblePlatforms: string[]
  compatibleArchitectures: string[]
  isOptimized: boolean
  fallbackModel?: string
}

interface ModelStatus {
  currentModel: string | null
  isConnected: boolean
  availableModels: string[]
  recommendedModel: ModelRecommendation | null
  deviceSpecs: DeviceSpecs | null
  isDownloading: boolean
  downloadProgress: number
}

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
  onForceLicenseScreen: () => void
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose, onForceLicenseScreen }) => {
  const [licenseKey, setLicenseKey] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [databaseStats, setDatabaseStats] = useState({ fileCount: 0, chunkCount: 0, indexSize: 0 })
  const [isClearing, setIsClearing] = useState(false)
  const [isReindexing, setIsReindexing] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [embedProgress, setEmbedProgress] = useState<{ total?: number; embedded?: number; model?: string; status?: string; error?: string } | null>(null)
  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    currentModel: null,
    isConnected: false,
    availableModels: [],
    recommendedModel: null,
    deviceSpecs: null,
    isDownloading: false,
    downloadProgress: 0
  })
  const [selectedModel, setSelectedModel] = useState<string>('')
  const { licenseStatus, isLoading, validateNewLicense, clearLicense } = useLicenseCheck()
  const [licenseValidationMessage, setLicenseValidationMessage] = useState('')
  const [isValidatingLicense, setIsValidatingLicense] = useState(false)
  const [isLicenseLoading, setIsLicenseLoading] = useState(false)
  const [currentTheme, setCurrentTheme] = useState('dark')
  
  // Font settings state
  const [currentFontFamily, setCurrentFontFamily] = useState('jetbrains-mono')
  const [currentFontSize, setCurrentFontSize] = useState(14)
  // FTS settings
  const [ftsMaxResults, setFtsMaxResults] = useState<number>(20)
  const [ftsPerFileCap, setFtsPerFileCap] = useState<number>(2)
  const [ftsCharBudget, setFtsCharBudget] = useState<number>(2400)
  const [ftsOperator, setFtsOperator] = useState<'AND' | 'OR'>('AND')

  // Clear validation message and load database stats when modal opens
  useEffect(() => {
    if (isOpen) {
      setValidationMessage('')
      // Small delay to ensure electronAPI is loaded
      setTimeout(() => {
        loadDatabaseStats()
        loadModelStatus()
      }, 100)
    }
  }, [isOpen])

  // Initial embeddings stats load when opened
  useEffect(() => {
    const loadEmbStats = async () => {
      try {
        const stats = await window.electronAPI.embeddingsGetStats?.()
        if (stats && typeof stats.embeddedCount === 'number') {
          setEmbedProgress({ total: stats.chunkCount, embedded: stats.embeddedCount, model: stats.model, status: 'idle' })
        }
      } catch {}
    }
    if (isOpen) loadEmbStats()
  }, [isOpen])

  // Listen for model download progress
  useEffect(() => {
    if (!window.electronAPI?.onLLMDownloadProgress) return

    const unsubscribe = window.electronAPI.onLLMDownloadProgress((progress: any) => {
      setModelStatus(prev => ({
        ...prev,
        isDownloading: progress.progress < 100,
        downloadProgress: progress.progress
      }))
    })

    return unsubscribe
  }, [])

  // Listen for embeddings progress
  useEffect(() => {
    if (!window.electronAPI?.onEmbeddingsProgress) return
    const unsubscribe = window.electronAPI.onEmbeddingsProgress((payload) => {
      setEmbedProgress(payload || null)
      if (payload?.status === 'running' || payload?.status === 'starting') setIsEmbedding(true)
      if (payload?.status === 'done' || payload?.status === 'error') setIsEmbedding(false)
    })
    return unsubscribe
  }, [])

  // Load current theme on component mount
  useEffect(() => {
    if (isOpen) {
      loadCurrentTheme()
      loadCurrentFontSettings()
      loadFtsSettings()
    }
  }, [isOpen])

  const loadDatabaseStats = async () => {
    try {
      // Check if electronAPI is available
      if (!window.electronAPI?.dbGetStats) {
        console.log('⚠️ [Settings] electronAPI not available yet')
        return
      }
      
      const stats = await window.electronAPI.dbGetStats()
      setDatabaseStats(stats)
    } catch (error) {
      console.error('Failed to load database stats:', error)
      setDatabaseStats({ fileCount: 0, chunkCount: 0, indexSize: 0 })
    }
  }

  const loadModelStatus = async () => {
    try {
      if (!window.electronAPI?.llmGetStatus) {
        console.log('⚠️ [Settings] LLM API not available yet')
        return
      }

      // Get current model and device specs
      const [currentModel, deviceSpecs, recommendedModel, availableModels] = await Promise.all([
        window.electronAPI.llmGetCurrentModel?.() || null,
        window.electronAPI.llmGetDeviceSpecs?.() || null,
        window.electronAPI.llmGetRecommendedModel?.() || null,
        window.electronAPI.llmGetAvailableModels?.() || []
      ])

      const isConnected = currentModel !== null
      
      setModelStatus({
        currentModel,
        isConnected,
        availableModels,
        recommendedModel,
        deviceSpecs,
        isDownloading: false,
        downloadProgress: 0
      })

      // Set selected model to current model
      if (currentModel) {
        setSelectedModel(currentModel)
      } else if (recommendedModel) {
        setSelectedModel(recommendedModel.modelName)
      }

    } catch (error) {
      console.error('Failed to load model status:', error)
      setModelStatus(prev => ({
        ...prev,
        isConnected: false,
        currentModel: null
      }))
    }
  }

  const handleModelChange = async (newModel: string) => {
    if (!window.electronAPI?.llmSwitchModel) return

    try {
      console.log(`🔄 [Settings] Switching model to: ${newModel}`)
      setSelectedModel(newModel)
      setModelStatus(prev => ({ 
        ...prev, 
        isDownloading: true, 
        downloadProgress: 0,
        currentModel: null // Clear current model during switch
      }))
      setValidationMessage(`[INFO] Switching to ${newModel}...`)
      
      await window.electronAPI.llmSwitchModel(newModel)
      
      console.log(`✅ [Settings] Model switch completed: ${newModel}`)
      setValidationMessage(`[OK] Successfully switched to ${newModel}`)
      
      // Reload model status after switch
      setTimeout(() => {
        loadModelStatus()
        // Clear the message after status loads
        setTimeout(() => setValidationMessage(''), 3000)
      }, 1000)
      
    } catch (error) {
      console.error('❌ [Settings] Failed to switch model:', error)
      setValidationMessage(`[ERROR] Failed to switch model: ${error.message}`)
      // Reload status to restore previous state
      loadModelStatus()
    }
  }

  const handleClearDatabase = async () => {
    if (!window.electronAPI?.dbClearAll) {
      setValidationMessage('[ERROR] Database functions not available')
      return
    }

    if (!confirm('Are you sure you want to clear the entire database? This will remove all indexed content and cannot be undone.')) {
      return
    }

    setIsClearing(true)
    try {
      await window.electronAPI.dbClearAll()
      await loadDatabaseStats()
      setValidationMessage('[OK] Database cleared successfully!')
    } catch (error) {
      console.error('Failed to clear database:', error)
      setValidationMessage('[ERROR] Failed to clear database')
    } finally {
      setIsClearing(false)
    }
  }

  const handleReindexAll = async () => {
    if (!window.electronAPI?.dbReindexAll) {
      setValidationMessage('[ERROR] Database functions not available')
      return
    }

    if (!confirm('Are you sure you want to reindex all files? This will take some time and rebuild the entire search index.')) {
      return
    }

    setIsReindexing(true)
    try {
      const stats = await window.electronAPI.dbReindexAll()
      setDatabaseStats(stats)
      setValidationMessage('[OK] All files reindexed successfully!')
    } catch (error) {
      console.error('Failed to reindex files:', error)
      setValidationMessage('[ERROR] Failed to reindex files')
    } finally {
      setIsReindexing(false)
    }
  }

  const handleBuildEmbeddings = async () => {
    if (!window.electronAPI?.embeddingsRebuildAll) {
      setValidationMessage('[ERROR] Embeddings API not available')
      return
    }
    try {
      setIsEmbedding(true)
      await window.electronAPI.embeddingsRebuildAll()
    } catch (e) {
      setIsEmbedding(false)
      setValidationMessage('[ERROR] Failed to start embeddings build')
    }
  }

  if (!isOpen) return null

  const handleValidateLicense = async () => {
    if (!licenseKey.trim()) {
      setValidationMessage('Please enter a license key')
      return
    }

    setValidationMessage('')

    try {
      const result = await validateNewLicense(licenseKey)
      
              if (result.valid) {
          setValidationMessage('[OK] License validated successfully!')
          setLicenseKey('') // Clear input
        } else {
        setValidationMessage(`[ERROR] ${result.error || 'Invalid license key'}`)
      }
    } catch (error) {
      console.error('License validation error:', error)
              setValidationMessage('[ERROR] Network error - please check your connection')
    }
  }

  const handleClearLicense = async () => {
    if (confirm('Are you sure you want to clear your license? The app will be locked immediately.')) {
      try {
        clearLicense()
        // Force the license screen to show
        onForceLicenseScreen()
        // Close settings modal immediately to show license screen
        onClose()
      } catch (error) {
        console.error('Failed to clear license:', error)
        setValidationMessage('[ERROR] Failed to clear license')
      }
    }
  }

  const openUrl = (url: string) => {
    // Open URL in external browser
    try {
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(url)
      } else {
        window.open(url, '_blank')
      }
    } catch (error) {
      console.error('Failed to open URL:', error)
      window.open(url, '_blank')
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const loadCurrentTheme = async () => {
    try {
      const theme = await window.electronAPI.settingsGet('theme') || 'dark'
      setCurrentTheme(theme)
      applyTheme(theme)
    } catch (error) {
      console.error('Failed to load theme:', error)
    }
  }

  const handleThemeChange = async (newTheme: string) => {
    try {
      setCurrentTheme(newTheme)
      await window.electronAPI.settingsSet('theme', newTheme)
      applyTheme(newTheme)
      console.log('🎨 Theme changed to:', newTheme)
    } catch (error) {
      console.error('Failed to save theme:', error)
    }
  }

  const applyTheme = (theme: string) => {
    document.documentElement.setAttribute('data-theme', theme)
  }

  const loadCurrentFontSettings = async () => {
    try {
      const fontFamily = await window.electronAPI.settingsGet('fontFamily') || 'jetbrains-mono'
      const fontSize = await window.electronAPI.settingsGet('fontSize') || 14
      setCurrentFontFamily(fontFamily)
      setCurrentFontSize(fontSize)
      applyFontSettings(fontFamily, fontSize)
    } catch (error) {
      console.error('Failed to load font settings:', error)
    }
  }

  const applyFontSettings = (fontFamily: string, fontSize: number) => {
    // Map font family keys to actual font names
    const fontFamilyMap = {
      'jetbrains-mono': 'JetBrains Mono, Consolas, "Courier New", monospace',
      'fira-code': 'Fira Code, "JetBrains Mono", Consolas, monospace',
      'source-code-pro': 'Source Code Pro, "JetBrains Mono", Consolas, monospace',
      'monaco': 'Monaco, "JetBrains Mono", Consolas, "Segoe UI", monospace'
    }
    
    const fontStackValue = fontFamilyMap[fontFamily] || fontFamilyMap['jetbrains-mono']
    document.documentElement.style.setProperty('--app-font-family', fontStackValue)
    document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`)
  }

  const loadFtsSettings = async () => {
    try {
      const maxResults = parseInt((await window.electronAPI.settingsGet('ftsMaxResults')) || '20')
      const perFile = parseInt((await window.electronAPI.settingsGet('ftsPerFileCap')) || '2')
      const charBudget = parseInt((await window.electronAPI.settingsGet('ftsCharBudget')) || '2400')
      const op = ((await window.electronAPI.settingsGet('ftsOperator')) || 'AND').toUpperCase()
      setFtsMaxResults(Number.isFinite(maxResults) ? maxResults : 20)
      setFtsPerFileCap(Number.isFinite(perFile) ? perFile : 2)
      setFtsCharBudget(Number.isFinite(charBudget) ? charBudget : 2400)
      setFtsOperator(op === 'OR' ? 'OR' : 'AND')
    } catch (e) {
      console.error('Failed to load FTS settings:', e)
    }
  }

  const handleFontFamilyChange = async (newFontFamily: string) => {
    try {
      setCurrentFontFamily(newFontFamily)
      await window.electronAPI.settingsSet('fontFamily', newFontFamily)
      applyFontSettings(newFontFamily, currentFontSize)
      console.log('👀 Font family changed to:', newFontFamily)
    } catch (error) {
      console.error('Failed to save font family:', error)
    }
  }

  const handleFontSizeChange = async (newFontSize: number) => {
    try {
      setCurrentFontSize(newFontSize)
      await window.electronAPI.settingsSet('fontSize', newFontSize)
      applyFontSettings(currentFontFamily, newFontSize)
      console.log('👀 Font size changed to:', newFontSize)
    } catch (error) {
      console.error('Failed to save font size:', error)
    }
  }

  return (
    <div className="settings-overlay" onClick={handleBackdropClick}>
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="settings-content">
          {/* License Key Section */}
          <div className="settings-section">
            <h3>License Status</h3>
            
            {isLoading ? (
              <div className="settings-item">
                <div className="license-loading">
                  Checking license status...
                </div>
              </div>
            ) : licenseStatus && licenseStatus.valid ? (
              <div className="settings-item">
                <div className="license-status-display">
                  <div className="license-status-item">
                    <span className="license-label">Status:</span>
                    <span className="license-value valid">[ACTIVE]</span>
                  </div>
                  <div className="license-status-item">
                    <span className="license-label">Type:</span>
                    <span className="license-value">
                      {getLicenseDisplayType(licenseStatus.licenseKey || '')}
                    </span>
                  </div>
                  {licenseStatus.customerName && (
                    <div className="license-status-item">
                      <span className="license-label">Customer:</span>
                      <span className="license-value">{licenseStatus.customerName}</span>
                    </div>
                  )}
                  {licenseStatus.planType && (
                    <div className="license-status-item">
                      <span className="license-label">Plan:</span>
                      <span className="license-value">{licenseStatus.planType}</span>
                    </div>
                  )}
                  {/* Only show expires date for lifetime plans */}
                  {licenseStatus.licenseType === 'lifetime' && licenseStatus.expiresAt && !licenseStatus.neverExpires && (
                    <div className="license-status-item">
                      <span className="license-label">Expires:</span>
                      <span className="license-value">{new Date(licenseStatus.expiresAt).toLocaleDateString()}</span>
                    </div>
                  )}
                  {licenseStatus.licenseType === 'lifetime' && licenseStatus.neverExpires && (
                    <div className="license-status-item">
                      <span className="license-label">Expires:</span>
                      <span className="license-value-valid">Never</span>
                    </div>
                  )}
                  {licenseStatus.grantedAt && (
                    <div className="license-status-item">
                      <span className="license-label">Granted:</span>
                      <span className="license-value">{new Date(licenseStatus.grantedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
                
                {/* Display current license key */}
                {licenseStatus.licenseKey && (
                  <div className="license-key-display">
                    <div className="license-status-item">
                      <span className="license-label">License Key:</span>
                      <span className="license-value license-key-text">{licenseStatus.licenseKey}</span>
                    </div>
                  </div>
                )}
                
                <button className="settings-btn danger" onClick={handleClearLicense}>
                  Clear License
                </button>
              </div>
            ) : (
              <div className="settings-item">
                <label>Enter your license key:</label>
                <div className="license-input-group">
                  <input 
                    type="text" 
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value)}
                    placeholder="ij_life_... or ij_sub_..." 
                    className="settings-input"
                    disabled={isLoading}
                    onKeyPress={(e) => e.key === 'Enter' && handleValidateLicense()}
                  />
                  <button 
                    className="settings-btn"
                    onClick={handleValidateLicense}
                    disabled={isLoading || !licenseKey.trim()}
                  >
                    {isLoading ? 'Validating...' : 'Validate'}
                  </button>
                </div>
                {validationMessage && (
                  <div className="validation-message">
                    {validationMessage}
                  </div>
                )}
                
                {/* Purchase Links */}
                <div className="purchase-links">
                  <h4>Need a license?</h4>
                  <div className="purchase-buttons">
                    <button 
                      className="purchase-btn lifetime" 
                      onClick={() => openUrl('https://pay.islajournal.app/b/cNieVc50A7yGfkv4BQ73G00')}
                    >
                                              [LIFETIME] License
                      <span className="license-price">$99</span>
                    </button>
                    <button 
                      className="purchase-btn annual" 
                      onClick={() => openUrl('https://pay.islajournal.app/b/7sY28qakUg5cfkv2tI73G02')}
                    >
                      📅 Annual License
                      <span className="license-price">$49</span>
                    </button>
                    <button 
                      className="purchase-btn monthly" 
                      onClick={() => openUrl('https://pay.islajournal.app/b/dRmaEWct2cT03BN6JY73G01')}
                    >
                      [MONTHLY] License
                      <span className="license-price">$7</span>
                    </button>
                  </div>
                  <button 
                    className="customer-portal-btn" 
                    onClick={() => openUrl('https://pay.islajournal.app/p/login/cNieVc50A7yGfkv4BQ73G00')}
                  >
                    🏠 Customer Portal
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* AI Model Section */}
          <div className="settings-section">
            <h3>AI Model</h3>
            
            {/* Auto-Selected Model Display */}
            {modelStatus.recommendedModel && (
              <div className="settings-item">
                <div className="auto-selected-model">
                  <h4>🤖 Auto-Selected for Your Device</h4>
                  <div className="current-model-display">
                    <div className="model-info">
                      <strong>{modelStatus.recommendedModel.displayName}</strong>
                      <span className="model-size">({modelStatus.recommendedModel.downloadSize})</span>
                      {modelStatus.recommendedModel.isOptimized && <span className="optimization-badge">⚡ Optimized</span>}
                    </div>
                    <p className="model-description">{modelStatus.recommendedModel.description}</p>
                    <div className="auto-selection-reason">
                      <small>
                        ✅ Selected based on your {modelStatus.deviceSpecs?.totalMemory}GB RAM, {modelStatus.deviceSpecs?.platform} {modelStatus.deviceSpecs?.arch}
                        {modelStatus.deviceSpecs?.isAppleSilicon && ', Apple Silicon optimized'}
                      </small>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Model Status */}
            <div className="settings-item">
              <label>Status:</label>
              {modelStatus.isDownloading ? (
                <div className="model-status downloading">
                  <span>📥 Downloading optimal model... {modelStatus.downloadProgress}%</span>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${modelStatus.downloadProgress}%` }}
                    ></div>
                  </div>
                </div>
              ) : modelStatus.isConnected ? (
                <span className="model-status online">● Ready - Using {modelStatus.currentModel}</span>
              ) : (
                <span className="model-status offline">○ Setting up AI model...</span>
              )}
            </div>

            {/* Advanced Settings - Collapsible (only when a model is connected on startup) */}
            {modelStatus.isConnected && (
            <div className="settings-item">
              <details className="advanced-settings">
                <summary className="advanced-toggle">🔧 Advanced Model Settings</summary>
                <div className="advanced-content">
                  <p className="advanced-note">
                    <small>⚠️ The system automatically selects the best model for your device. Only change this if you have specific requirements.</small>
                  </p>

                  {/* Device Information */}
                  {modelStatus.deviceSpecs && (
                    <div className="device-info-advanced">
                      <h5>Device Specifications</h5>
                      <div className="device-stats">
                        <div className="device-stat">
                          <span className="device-label">Platform:</span>
                          <span className="device-value">
                            {modelStatus.deviceSpecs.platform} ({modelStatus.deviceSpecs.arch})
                            {modelStatus.deviceSpecs.isAppleSilicon && ' - Apple Silicon'}
                          </span>
                        </div>
                        <div className="device-stat">
                          <span className="device-label">Memory:</span>
                          <span className="device-value">
                            {modelStatus.deviceSpecs.availableMemory}GB available / {modelStatus.deviceSpecs.totalMemory}GB total
                          </span>
                        </div>
                        <div className="device-stat">
                          <span className="device-label">CPU:</span>
                          <span className="device-value">
                            {modelStatus.deviceSpecs.cpuCores} cores @ {modelStatus.deviceSpecs.cpuSpeed}GHz
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Manual Model Selection */}
                  <div className="manual-selection">
                    <label>Override Model Selection:</label>
                    <select 
                      className="settings-select"
                      value={selectedModel}
                      onChange={(e) => handleModelChange(e.target.value)}
                      disabled={modelStatus.isDownloading}
                    >
                      <option value="llama3.2:latest">
                        Llama 3.2 3B - Fast & Efficient {selectedModel === 'llama3.2:latest' ? '(Active)' : ''}
                      </option>
                      <option value="llama3.1:latest">
                        Llama 3.1 8B - High Quality {selectedModel === 'llama3.1:latest' ? '(Active)' : ''}
                      </option>
                      <option value="gemma2:2b">
                        Gemma 2 2B - Ultra Fast {selectedModel === 'gemma2:2b' ? '(Active)' : ''}
                      </option>
                      <option value="phi3:mini">
                        Phi-3 Mini - Code & Reasoning {selectedModel === 'phi3:mini' ? '(Active)' : ''}
                      </option>
                    </select>
                    <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                      Current: {modelStatus.currentModel || 'Loading...'}
                      {modelStatus.recommendedModel && modelStatus.currentModel === modelStatus.recommendedModel.modelName && ' (Auto-Selected)'}
                    </small>
                  </div>

                  {/* Available Models List */}
                  {modelStatus.availableModels.length > 0 && (
                    <div className="installed-models-section">
                      <label>Installed Models:</label>
                      <div className="installed-models">
                        {modelStatus.availableModels.map(model => (
                          <span key={model} className="installed-model">
                            {model}
                            {model === modelStatus.currentModel && <span className="current-indicator"> (active)</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </div>
            )}
          </div>

          {/* Storage Section */}
          <div className="settings-section">
            <h3>Storage</h3>
            <div className="settings-item">
              <div className="storage-stats">
                <div className="storage-item">
                  <span className="storage-label">Files Indexed:</span>
                  <span className="storage-value">{databaseStats.fileCount.toLocaleString()} files</span>
                </div>
                {/* Advanced chunk metrics intentionally hidden for simplicity */}
              </div>
              {/* Embeddings status */}
              <div className="storage-embeddings">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Embeddings</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {embedProgress?.model ? `Model: ${embedProgress.model}` : 'Model: —'}
                    </div>
                  </div>
                  <button 
                    className="settings-btn"
                    onClick={handleBuildEmbeddings}
                    disabled={isEmbedding}
                    title="Build embeddings for all indexed chunks"
                  >
                    {isEmbedding ? 'Building…' : 'Build Embeddings'}
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  {embedProgress?.status === 'error' ? (
                    <div className="validation-message">[ERROR] {embedProgress.error}</div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        <span>Status: {embedProgress?.status || 'idle'}</span>
                        <span>
                          {(embedProgress?.embedded ?? 0).toLocaleString()} / {(embedProgress?.total ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="progress-bar" style={{ marginTop: 4 }}>
                        <div 
                          className="progress-fill" 
                          style={{ width: `${Math.min(100, Math.round(((embedProgress?.embedded || 0) / Math.max(1, embedProgress?.total || 0)) * 100))}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="storage-actions" style={{ marginTop: 12 }}>
                <button 
                  className="settings-btn danger" 
                  onClick={handleClearDatabase}
                  disabled={isClearing}
                  title="Clear all indexed content"
                >
                  {isClearing ? 'Clearing...' : 'Clear Database'}
                </button>
                <button 
                  className="settings-btn"
                  onClick={handleReindexAll}
                  disabled={isReindexing}
                  title="Reindex all files from scratch"
                >
                  {isReindexing ? 'Reindexing...' : 'Reindex All'}
                </button>
              </div>
            </div>
          </div>

          {/* Search settings removed for simplicity; using smart defaults */}

          {/* Version Section */}
          <div className="settings-section">
            <h3>Version</h3>
            <div className="settings-item">
              <div className="version-info">
                <div className="version-item">
                  <span className="version-label">App Version:</span>
                  <span className="version-value">1.0.0</span>
                </div>
                <div className="version-item">
                  <span className="version-label">Electron Version:</span>
                  <span className="version-value">v31.0.0</span>
                </div>
                <div className="version-item">
                  <span className="version-label">Node Version:</span>
                  <span className="version-value">v20.11.1</span>
                </div>
              </div>
              <button className="settings-btn">Check for Updates</button>
            </div>
          </div>

          {/* Theme/Font Section */}
          <div className="settings-section">
            <h3>Theme & Font</h3>
            <div className="settings-item">
              <label>Theme:</label>
              <select className="settings-select" value={currentTheme} onChange={(e) => handleThemeChange(e.target.value)}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            <div className="settings-item">
              <label>Font Family:</label>
              <select className="settings-select" value={currentFontFamily} onChange={(e) => handleFontFamilyChange(e.target.value)}>
                <option value="jetbrains-mono">JetBrains Mono</option>
                <option value="fira-code">Fira Code</option>
                <option value="source-code-pro">Source Code Pro</option>
                <option value="monaco">Monaco</option>
              </select>
            </div>
            <div className="settings-item">
              <label>Font Size:</label>
              <input 
                type="range" 
                min="12" 
                max="20" 
                defaultValue={currentFontSize} 
                className="settings-slider"
                onChange={(e) => handleFontSizeChange(parseInt(e.target.value))}
              />
              <span className="slider-value">{currentFontSize}px</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="settings-actions">
            <button className="settings-btn danger">Reset to Defaults</button>
            <button className="settings-btn primary" onClick={onClose}>Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings 