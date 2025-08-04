import React, { useState, useEffect } from 'react'
import { MonacoEditor } from './components/Editor'
import './App.css'

const App: React.FC = () => {
  const [version, setVersion] = useState<string>('')
  const [platform, setPlatform] = useState<string>('')
  const [editorContent, setEditorContent] = useState<string>(`# 🏝️ Welcome to Isla Journal

Today I'm exploring this amazing new offline journaling app. The features I'm most excited about:

## ✨ Key Features
- **Completely offline** - All my thoughts stay private on my device
- **AI-powered insights** - Local AI that understands my writing patterns
- **VS Code interface** - Familiar and powerful editing experience
- **Cross-platform** - Works seamlessly on Mac, Windows, and Linux

## 📝 My Thoughts

This markdown editor feels incredibly smooth and responsive. The **JetBrains Mono** font makes everything so readable.

I can write:
- Lists like this
- With proper formatting
- And everything just works

> "The best journaling app is the one you actually use." - Me, just now

### Code Snippets Work Too!

\`\`\`javascript
const thoughts = {
  current: "This app is amazing!",
  future: "Can't wait to use the AI features"
}
\`\`\`

---

*Started writing at ${new Date().toLocaleString()}*`)
  const [currentFile, setCurrentFile] = useState<string>('Welcome.md')

  useEffect(() => {
    // Test the Electron API
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setVersion)
      window.electronAPI.getPlatform().then(setPlatform)
    }
  }, [])

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setEditorContent(value)
    }
  }

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
                <span>{currentFile}</span>
                <span className="tab-close">×</span>
              </div>
            </div>
          </div>
          <div className="panel-content">
            <MonacoEditor
              value={editorContent}
              onChange={handleEditorChange}
              language="markdown"
            />
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
          <span>{editorContent.split(/\s+/).filter(word => word.length > 0).length} words | {editorContent.split('\n').length} lines</span>
        </div>
        <div className="status-right">
          <span>Markdown</span>
        </div>
      </div>
    </div>
  )
}

export default App 