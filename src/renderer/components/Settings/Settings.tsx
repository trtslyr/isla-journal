import React, { useState, useEffect } from 'react'
import './Settings.css'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
}

interface LicenseStatus {
  isValid: boolean
  licenseType: 'lifetime' | 'monthly' | 'annual' | null
  expiresAt?: string
  lastValidated: string
  error?: string
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')

  // Load license status when component opens
  useEffect(() => {
    if (isOpen) {
      loadLicenseStatus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const loadLicenseStatus = async () => {
    try {
      if (!window.electronAPI?.licenseGetStatus) {
        console.warn('License API not available')
        return
      }
      const status = await window.electronAPI.licenseGetStatus()
      setLicenseStatus(status)
    } catch (error) {
      console.error('Failed to load license status:', error)
    }
  }

  const handleValidateLicense = async () => {
    if (!licenseKey.trim()) {
      setValidationMessage('Please enter a license key')
      return
    }

    if (!window.electronAPI?.licenseValidate) {
      setValidationMessage('❌ License API not available')
      return
    }

    setIsValidating(true)
    setValidationMessage('')

    try {
      const result = await window.electronAPI.licenseValidate(licenseKey)
      
      if (result.success) {
        setValidationMessage('✅ License validated successfully!')
        await loadLicenseStatus() // Refresh status
        setLicenseKey('') // Clear input
      } else {
        setValidationMessage(`❌ ${result.error || 'Invalid license key'}`)
      }
    } catch (error) {
      console.error('License validation error:', error)
      setValidationMessage('❌ Network error - please check your connection')
    } finally {
      setIsValidating(false)
    }
  }

  const handleClearLicense = async () => {
    if (confirm('Are you sure you want to clear your license? The app will have limited functionality.')) {
      try {
        if (!window.electronAPI?.licenseClear) {
          setValidationMessage('❌ License API not available')
          return
        }
        await window.electronAPI.licenseClear()
        await loadLicenseStatus()
        setValidationMessage('License cleared')
      } catch (error) {
        console.error('Failed to clear license:', error)
        setValidationMessage('❌ Failed to clear license')
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
            
            {licenseStatus && licenseStatus.isValid ? (
              <div className="settings-item">
                <div className="license-status-display">
                  <div className="license-status-item">
                    <span className="license-label">Status:</span>
                    <span className="license-value valid">✅ Active</span>
                  </div>
                  <div className="license-status-item">
                    <span className="license-label">Type:</span>
                    <span className="license-value">
                      {licenseStatus.licenseType === 'lifetime' ? '💎 Lifetime' : 
                       licenseStatus.licenseType === 'annual' ? '📅 Annual' : 
                       licenseStatus.licenseType === 'monthly' ? '📆 Monthly' : 'Unknown'}
                    </span>
                  </div>
                  {licenseStatus.expiresAt && (
                    <div className="license-status-item">
                      <span className="license-label">Expires:</span>
                      <span className="license-value">{new Date(licenseStatus.expiresAt).toLocaleDateString()}</span>
                    </div>
                  )}
                  <div className="license-status-item">
                    <span className="license-label">Last Validated:</span>
                    <span className="license-value">{new Date(licenseStatus.lastValidated).toLocaleDateString()}</span>
                  </div>
                </div>
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
                    placeholder="Enter license key..." 
                    className="settings-input"
                    disabled={isValidating}
                  />
                  <button 
                    className="settings-btn"
                    onClick={handleValidateLicense}
                    disabled={isValidating || !licenseKey.trim()}
                  >
                    {isValidating ? 'Validating...' : 'Validate'}
                  </button>
                </div>
                {validationMessage && (
                  <div className="validation-message">
                    {validationMessage}
                  </div>
                )}
                
                {/* Purchase Links */}
                <div className="purchase-links">
                  <h4>Don't have a license? Purchase one:</h4>
                  <div className="purchase-buttons">
                    <button className="purchase-btn monthly" onClick={() => openUrl('https://your-payment-link-monthly.com')}>
                      📆 Monthly - $9.99/mo
                    </button>
                    <button className="purchase-btn annual" onClick={() => openUrl('https://your-payment-link-annual.com')}>
                      📅 Annual - $99.99/yr
                    </button>
                    <button className="purchase-btn lifetime" onClick={() => openUrl('https://your-payment-link-lifetime.com')}>
                      💎 Lifetime - $299
                    </button>
                  </div>
                  <button className="customer-portal-btn" onClick={() => openUrl('https://your-customer-portal.com')}>
                    🏪 Customer Portal
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Token Usage Section */}
          <div className="settings-section">
            <h3>Token Usage</h3>
            <div className="settings-item">
              <div className="usage-stats">
                <div className="usage-item">
                  <span className="usage-label">Tokens Used Today:</span>
                  <span className="usage-value">0 / 10,000</span>
                </div>
                <div className="usage-item">
                  <span className="usage-label">Tokens Used This Month:</span>
                  <span className="usage-value">0 / 100,000</span>
                </div>
                <div className="usage-progress">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: '0%' }}></div>
                  </div>
                </div>
              </div>
            </div>
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
                  <span className="storage-label">Database Size:</span>
                  <span className="storage-value">45.2 MB</span>
                </div>
                <div className="storage-item">
                  <span className="storage-label">Files Indexed:</span>
                  <span className="storage-value">1,247 files</span>
                </div>
                <div className="storage-item">
                  <span className="storage-label">Chunks Indexed:</span>
                  <span className="storage-value">8,934 chunks</span>
                </div>
              </div>
              <div className="storage-actions">
                <button className="settings-btn danger">Clear Database</button>
                <button className="settings-btn">Reindex All</button>
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

          {/* Additional Settings */}
          <div className="settings-section">
            <h3>Advanced</h3>
            <div className="settings-item">
              <label className="settings-checkbox">
                <input type="checkbox" defaultChecked />
                <span className="checkmark"></span>
                Enable auto-save
              </label>
            </div>
            <div className="settings-item">
              <label className="settings-checkbox">
                <input type="checkbox" defaultChecked />
                <span className="checkmark"></span>
                Enable file watching
              </label>
            </div>
            <div className="settings-item">
              <label className="settings-checkbox">
                <input type="checkbox" />
                <span className="checkmark"></span>
                Enable debug logging
              </label>
            </div>
            <div className="settings-item">
              <label>Auto-save interval (seconds):</label>
              <input 
                type="number" 
                min="5" 
                max="300" 
                defaultValue="30" 
                className="settings-input number"
              />
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