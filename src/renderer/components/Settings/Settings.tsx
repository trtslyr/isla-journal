import React, { useState, useEffect } from 'react'
import './Settings.css'
import { ValidationResult } from '../../services/licenseValidation'
import { getLicenseDisplayType } from '../../utils/licenseUtils'
import { useLicenseCheck } from '../../hooks/useLicenseCheck'

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
  const { licenseStatus, isLoading, validateNewLicense, clearLicense } = useLicenseCheck()

  // Clear validation message and load database stats when modal opens
  useEffect(() => {
    if (isOpen) {
      setValidationMessage('')
      // Small delay to ensure electronAPI is loaded
      setTimeout(() => {
        loadDatabaseStats()
      }, 100)
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
            <div className="settings-item">
              <label>Select AI Model:</label>
              <select className="settings-select">
                <option value="llama3.1:latest">Llama 3.1 (Latest)</option>
                <option value="llama3:8b">Llama 3 8B</option>
                <option value="llama3:70b">Llama 3 70B</option>
                <option value="mistral:latest">Mistral (Latest)</option>
              </select>
            </div>
            <div className="settings-item">
              <label>Model Status:</label>
              <span className="model-status online">● Connected</span>
            </div>
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
                <div className="storage-item">
                  <span className="storage-label">Chunks Indexed:</span>
                  <span className="storage-value">{databaseStats.chunkCount.toLocaleString()} chunks</span>
                </div>
                <div className="storage-item">
                  <span className="storage-label">Search Index Size:</span>
                  <span className="storage-value">{databaseStats.indexSize.toLocaleString()} entries</span>
                </div>
              </div>
              <div className="storage-actions">
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
              <select className="settings-select">
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            <div className="settings-item">
              <label>Font Family:</label>
              <select className="settings-select">
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
                defaultValue="14" 
                className="settings-slider"
              />
              <span className="slider-value">14px</span>
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