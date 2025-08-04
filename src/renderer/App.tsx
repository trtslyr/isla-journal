import React, { useState, useEffect } from 'react'
import './App.css'

const App: React.FC = () => {
  const [version, setVersion] = useState<string>('')
  const [platform, setPlatform] = useState<string>('')

  useEffect(() => {
    // Test the Electron API
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setVersion)
      window.electronAPI.getPlatform().then(setPlatform)
    }
  }, [])

  return (
    <div className="app">
      {/* Title Bar */}
      <div className="title-bar">
        <div className="title-bar-left">
          <span className="app-title">Isla Journal</span>
        </div>
        <div className="title-bar-center">
          <span className="file-path">Welcome to your offline journal</span>
        </div>
        <div className="title-bar-right">
          <span className="app-info">v{version} ({platform})</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        {/* Left Panel - File Tree */}
        <div className="panel file-tree-panel">
          <div className="panel-header">
            <h3>Explorer</h3>
          </div>
          <div className="panel-content">
            <div className="file-tree">
              <div className="tree-item folder">
                <span className="tree-icon">📁</span>
                <span>My Journal</span>
              </div>
              <div className="tree-item file indent-1">
                <span className="tree-icon">📄</span>
                <span>2024-01-15.md</span>
              </div>
              <div className="tree-item file indent-1">
                <span className="tree-icon">📄</span>
                <span>ideas.md</span>
              </div>
              <div className="tree-item folder">
                <span className="tree-icon">📁</span>
                <span>Archive</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center Panel - Editor */}
        <div className="panel editor-panel">
          <div className="panel-header">
            <div className="tab-bar">
              <div className="tab active">
                <span>Welcome.md</span>
                <span className="tab-close">×</span>
              </div>
            </div>
          </div>
          <div className="panel-content">
            <div className="editor-placeholder">
              <h1>🏝️ Welcome to Isla Journal</h1>
              <p>Your fully offline, AI-powered journaling companion.</p>
              <br />
              <h2>✨ Features</h2>
              <ul>
                <li>📝 VS Code-style interface</li>
                <li>🤖 Local AI assistance</li>
                <li>🔒 Completely offline</li>
                <li>🌍 Cross-platform</li>
              </ul>
              <br />
              <p><em>Monaco Editor will be integrated here soon...</em></p>
            </div>
          </div>
        </div>

        {/* Right Panel - AI Chat */}
        <div className="panel ai-chat-panel">
          <div className="panel-header">
            <h3>AI Assistant</h3>
          </div>
          <div className="panel-content">
            <div className="chat-container">
              <div className="chat-messages">
                <div className="message ai-message">
                  <div className="message-header">
                    <span className="message-author">🤖 AI Assistant</span>
                  </div>
                  <div className="message-content">
                    Hello! I'm your local AI assistant. I'll help you analyze your journal entries, find patterns, and provide insights - all while keeping your data completely private and offline.
                  </div>
                </div>
              </div>
              <div className="chat-input-area">
                <input 
                  type="text" 
                  placeholder="Ask me about your journal entries..."
                  className="chat-input"
                />
                <button className="send-button">Send</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-left">
          <span>Ready</span>
        </div>
        <div className="status-center">
          <span>0 words | Line 1, Column 1</span>
        </div>
        <div className="status-right">
          <span>Markdown</span>
        </div>
      </div>
    </div>
  )
}

export default App 