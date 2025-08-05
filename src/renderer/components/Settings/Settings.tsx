import React, { useState, useEffect } from 'react'
import './Settings.css'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
}

interface LicenseState {
  status: 'unlicensed' | 'active' | 'expired' | 'invalid'
  license_type?: 'lifetime' | 'subscription'
  license_key?: string
  last_validated?: string
  next_validation?: string
  customer_name?: string
  expires_at?: string
}

interface PaymentLinks {
  monthly: string
  annual: string
  lifetime: string
  portal: string
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseState, setLicenseState] = useState<LicenseState | null>(null)
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinks | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')

  if (!isOpen) return null

  // Load license state and payment links when modal opens
  useEffect(() => {
    if (isOpen) {
      loadLicenseData()
    }
  }, [isOpen])

  const loadLicenseData = async () => {
    try {
      const [state, links] = await Promise.all([
        window.electronAPI.licenseGetState(),
        window.electronAPI.licenseGetPaymentLinks()
      ])
      
      setLicenseState(state)
      setPaymentLinks(links)
      
      // Pre-fill license key if available
      if (state.license_key) {
        setLicenseKey(state.license_key)
      }
    } catch (error) {
      console.error('Failed to load license data:', error)
    }
  }

  const handleValidateLicense = async () => {
    if (!licenseKey.trim()) {
      setValidationMessage('Please enter a license key')
      return
    }

    setIsValidating(true)
    setValidationMessage('')

    try {
      const result = await window.electronAPI.licenseValidate(licenseKey.trim())
      
      if (result.valid) {
        setValidationMessage(`✅ Valid ${result.license_type} license for ${result.customer_name}`)
        // Reload license state
        await loadLicenseData()
      } else {
        switch (result.reason) {
          case 'missing_key':
            setValidationMessage('❌ Please enter a license key')
            break
          case 'invalid_key':
            setValidationMessage('❌ Invalid license key')
            break
          case 'expired':
            setValidationMessage('❌ License has expired')
            break
          case 'database_error':
            setValidationMessage('❌ Database error occurred')
            break
          default:
            setValidationMessage('❌ License validation failed')
        }
      }
    } catch (error) {
      console.error('License validation error:', error)
      setValidationMessage('❌ Validation error occurred')
    } finally {
      setIsValidating(false)
    }
  }

  const handleOpenPaymentLink = async (linkType: 'monthly' | 'annual' | 'lifetime' | 'portal') => {
    try {
      await window.electronAPI.licenseOpenPaymentLink(linkType)
    } catch (error) {
      console.error(`Failed to open ${linkType} payment link:`, error)
      alert(`Failed to open payment link. Please check your payment links configuration.`)
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
            <h3>License Key</h3>
            <div className="settings-item">
              <label>Enter your license key:</label>
              <div className="license-input-group">
                <input 
                  type="text" 
                  placeholder="Enter license key..." 
                  className="settings-input"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
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
            </div>
            
            {licenseState && licenseState.status === 'active' && (
              <div className="settings-item">
                <div className="license-status active">
                  <div className="license-info">
                    <span className="license-label">Status:</span>
                    <span className="license-value">✅ Active ({licenseState.license_type})</span>
                  </div>
                  {licenseState.customer_name && (
                    <div className="license-info">
                      <span className="license-label">Licensed to:</span>
                      <span className="license-value">{licenseState.customer_name}</span>
                    </div>
                  )}
                  {licenseState.expires_at && (
                    <div className="license-info">
                      <span className="license-label">Expires:</span>
                      <span className="license-value">
                        {new Date(licenseState.expires_at).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {licenseState.license_type === 'lifetime' && (
                    <div className="license-info">
                      <span className="license-label">Validity:</span>
                      <span className="license-value">🎉 Lifetime Access</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Purchase License Section */}
          <div className="settings-section">
            <h3>Purchase License</h3>
            <div className="settings-item">
              <label>Choose a license plan:</label>
              <div className="payment-links">
                <button 
                  className="payment-btn monthly"
                  onClick={() => handleOpenPaymentLink('monthly')}
                >
                  💳 Monthly Subscription
                  <span className="payment-description">Billed monthly</span>
                </button>
                <button 
                  className="payment-btn annual"
                  onClick={() => handleOpenPaymentLink('annual')}
                >
                  💳 Annual Subscription
                  <span className="payment-description">Billed yearly (save 20%)</span>
                </button>
                <button 
                  className="payment-btn lifetime"
                  onClick={() => handleOpenPaymentLink('lifetime')}
                >
                  💳 Lifetime License
                  <span className="payment-description">One-time payment</span>
                </button>
              </div>
            </div>
            
            {licenseState && licenseState.status === 'active' && licenseState.license_type === 'subscription' && (
              <div className="settings-item">
                <button 
                  className="settings-btn portal"
                  onClick={() => handleOpenPaymentLink('portal')}
                >
                  🔗 Manage Subscription
                </button>
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