import React, { useState, useEffect, useRef, useCallback } from 'react'
import { MonacoEditor } from './components/Editor'
import { FileTree } from './components/FileTree'
import RenameModal from './components/FileTree/RenameModal'
import Settings from './components/Settings'
import { useLicenseCheck } from './hooks/useLicenseCheck'
import './App.css'

interface ChatMessage {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
}

interface EditorTab {
  id: string
  name: string
  path: string | null
  content: string
  hasUnsavedChanges: boolean
}

const App: React.FC = () => {
  const [version, setVersion] = useState<string>('')
  const [platform, setPlatform] = useState<string>('')
  
  // License management
  const { licenseStatus, isLoading: licenseLoading, isLicensed } = useLicenseCheck()
  
  // Tab management
  const [tabs, setTabs] = useState<EditorTab[]>([
    {
      id: 'welcome',
      name: 'Welcome.md',
      path: null,
      content: `# 🏝️ Welcome to Isla Journal

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

*Started writing at ${new Date().toLocaleString()}*

## 🔥 Now with File Operations!

Click **"📁 Open Directory"** in the file tree to:
1. Select your journal directory
2. See all your .md files
3. Click any file to open it
4. Create new files and folders
5. Everything saves automatically!`,
      hasUnsavedChanges: false
    }
  ])
  const [activeTabId, setActiveTabId] = useState<string>('welcome')
  
  const [rootDirectory, setRootDirectory] = useState<string | null>(null)
  
  // Panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(280)
  const [rightPanelWidth, setRightPanelWidth] = useState(320)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  
  // Resize refs
  const leftResizeRef = useRef<HTMLDivElement>(null)
  const rightResizeRef = useRef<HTMLDivElement>(null)
  const isDraggingLeft = useRef(false)
  const isDraggingRight = useRef(false)
  
  // Chat state
  const [allChats, setAllChats] = useState<any[]>([])
  const [activeChat, setActiveChat] = useState<any>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isAiThinking, setIsAiThinking] = useState(false)
  const [showChatDropdown, setShowChatDropdown] = useState(false)
  
  // Rename modal state
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renamingChat, setRenamingChat] = useState<{id: number, title: string} | null>(null)
  
  // Settings modal state
  const [showSettings, setShowSettings] = useState(false)

  // Get current active tab
  const activeTab = tabs.find(tab => tab.id === activeTabId)

  // Resize handlers
  const handleLeftResize = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft.current) return
    
    const newWidth = e.clientX
    const minWidth = 40
    const maxWidth = window.innerWidth * 0.5
    
    if (newWidth < minWidth) {
      setLeftPanelWidth(minWidth)
      setLeftPanelCollapsed(true)
    } else if (newWidth > maxWidth) {
      setLeftPanelWidth(maxWidth)
      setLeftPanelCollapsed(false)
    } else {
      setLeftPanelWidth(newWidth)
      setLeftPanelCollapsed(newWidth < 120)
    }
  }, [])

  const handleRightResize = useCallback((e: MouseEvent) => {
    if (!isDraggingRight.current) return
    
    const newWidth = window.innerWidth - e.clientX
    const minWidth = 40
    const maxWidth = window.innerWidth * 0.5
    
    if (newWidth < minWidth) {
      setRightPanelWidth(minWidth)
      setRightPanelCollapsed(true)
    } else if (newWidth > maxWidth) {
      setRightPanelWidth(maxWidth)
      setRightPanelCollapsed(false)
    } else {
      setRightPanelWidth(newWidth)
      setRightPanelCollapsed(newWidth < 120)
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    isDraggingLeft.current = false
    isDraggingRight.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    document.addEventListener('mousemove', handleLeftResize)
    document.addEventListener('mousemove', handleRightResize)
    document.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleLeftResize)
      document.removeEventListener('mousemove', handleRightResize)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleLeftResize, handleRightResize, handleMouseUp])

  // Tab management functions
  const createNewTab = () => {
    const newTab: EditorTab = {
      id: `untitled-${Date.now()}`,
      name: 'Untitled.md',
      path: null,
      content: '# New Document\n\n',
      hasUnsavedChanges: false
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const closeTab = (tabId: string) => {
    const tabToClose = tabs.find(tab => tab.id === tabId)
    if (tabToClose?.hasUnsavedChanges) {
      if (!confirm(`Close "${tabToClose.name}" without saving changes?`)) {
        return
      }
    }
    
    setTabs(prev => prev.filter(tab => tab.id !== tabId))
    
    // If closing active tab, switch to another tab
    if (tabId === activeTabId) {
      const remainingTabs = tabs.filter(tab => tab.id !== tabId)
      if (remainingTabs.length > 0) {
        setActiveTabId(remainingTabs[remainingTabs.length - 1].id)
      } else {
        // Create a new welcome tab if no tabs left
        const welcomeTab: EditorTab = {
          id: 'welcome-new',
          name: 'Welcome.md',
          path: null,
          content: '# Welcome\n\nStart writing...',
          hasUnsavedChanges: false
        }
        setTabs([welcomeTab])
        setActiveTabId(welcomeTab.id)
      }
    }
  }

  const updateTabContent = (tabId: string, content: string) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId 
        ? { ...tab, content, hasUnsavedChanges: true }
        : tab
    ))
  }

  const saveTab = async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab || !tab.path) return

    try {
      await window.electronAPI.writeFile(tab.path, tab.content)
      setTabs(prev => prev.map(t => 
        t.id === tabId 
          ? { ...t, hasUnsavedChanges: false }
          : t
      ))
    } catch (error) {
      console.error('Failed to save file:', error)
    }
  }

  // Initialize app data on component mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        console.log('🚀 [App] Initializing app...')
        
        // Check if electronAPI is available
        if (!window.electronAPI) {
          console.error('❌ [App] electronAPI not available, retrying in 1 second...')
          setTimeout(initializeApp, 1000)
          return
        }
        
        // Get app info
        const versionInfo = await window.electronAPI.getVersion()
        setVersion(versionInfo)

        // Load saved directory from settings
        try {
          const savedDirectory = await window.electronAPI.settingsGet('selectedDirectory')
          if (savedDirectory) {
            console.log('📁 [App] Restoring saved directory:', savedDirectory)
            setRootDirectory(savedDirectory)
          } else {
            console.log('📁 [App] No saved directory found')
          }        
        } catch (error) {
          console.error('❌ [App] Failed to load saved directory:', error)
        }

        // Load chats
        const chats = await window.electronAPI.chatGetAll()
        setAllChats(chats)

        // Load active chat and its messages
        const activeChat = await window.electronAPI.chatGetActive()
        if (activeChat) {
          setActiveChat(activeChat)
          const messages = await window.electronAPI.chatGetMessages(activeChat.id)
          setChatMessages(messages.map(msg => ({
            id: msg.id.toString(),
            content: msg.content,
            role: msg.role as 'user' | 'assistant',
            timestamp: new Date(msg.created_at)
          })))
        } else {
          // Create default chat if none exists
          console.log('🆕 [App] Creating Welcome Chat...')
          const welcomeChat = await createNewChat('Welcome Chat')
          if (welcomeChat) {
            console.log('✅ [App] Welcome Chat created and activated')
          } else {
            console.error('❌ [App] Failed to create Welcome Chat')
            // Fallback: try to activate any existing chat
            if (chats.length > 0) {
              await switchToChat(chats[0].id)
              console.log('🔄 [App] Activated first available chat as fallback')
            }
          }
        }

        // Ensure we have an active chat - final fallback
        if (!activeChat && allChats.length === 0) {
          console.log('🚨 [App] No chats available, creating emergency fallback chat')
          try {
            const fallbackChat = await window.electronAPI.chatCreate('AI Assistant')
            await window.electronAPI.chatSetActive(fallbackChat.id)
            setActiveChat(fallbackChat)
            const updatedChats = await window.electronAPI.chatGetAll()
            setAllChats(updatedChats)
            console.log('✅ [App] Emergency fallback chat created')
          } catch (error) {
            console.error('❌ [App] Even fallback chat creation failed:', error)
          }
        }
      } catch (error) {
        console.error('❌ [App] Failed to initialize app:', error)
      }
    }

    initializeApp()
  }, [])

  // Auto-save active tab
  useEffect(() => {
    if (!activeTab?.hasUnsavedChanges || !activeTab?.path) return

    const timeoutId = setTimeout(async () => {
      await saveTab(activeTab.id)
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [activeTab?.content, activeTab?.hasUnsavedChanges])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (showChatDropdown && !target.closest('.chat-selector-wrapper')) {
        setShowChatDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showChatDropdown])

  // Debug: Track rootDirectory state changes
  useEffect(() => {
    console.log('🎯 [App] rootDirectory state changed to:', rootDirectory)
  }, [rootDirectory])

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && activeTab) {
      updateTabContent(activeTab.id, value)
    }
  }

  const handleFileSelect = async (filePath: string, fileName: string) => {
    try {
      // Load the selected file content
      const content = await window.electronAPI.readFile(filePath)
      
      // Clean up the file name by removing ID suffix
      const cleanFileName = fileName.replace(/\s+[a-f0-9]{32}\.md$/, '.md')
      
      if (activeTab) {
        // Update the current active tab with the new file
        setTabs(prev => prev.map(tab => 
          tab.id === activeTab.id 
            ? { 
                ...tab, 
                name: cleanFileName, 
                path: filePath, 
                content: content, 
                hasUnsavedChanges: false 
              }
            : tab
        ))
      } else {
        // If no active tab, create a new one (fallback case)
        const newTab: EditorTab = {
          id: `file-${Date.now()}`,
          name: cleanFileName,
          path: filePath,
          content: content,
          hasUnsavedChanges: false
        }
        
        setTabs(prev => [...prev, newTab])
        setActiveTabId(newTab.id)
      }
    } catch (error) {
      console.error('Failed to open file:', error)
      alert('Failed to open file: ' + fileName)
    }
  }

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isAiThinking || !activeChat) return

    // Check if electronAPI is available
    if (!window.electronAPI) {
      console.error('❌ [App] electronAPI not available for sending messages')
      alert('Unable to send message - app is still initializing. Please wait and try again.')
      return
    }

    // Validate required AI methods exist (prevent regressions)
    if (!window.electronAPI.contentSearchAndAnswer) {
      console.error('❌ [App] contentSearchAndAnswer API method is missing!')
      alert('AI chat functionality is unavailable. Please restart the application.')
      return
    }
    if (!window.electronAPI.llmSendMessage) {
      console.error('❌ [App] llmSendMessage API method is missing!')
      alert('Basic AI functionality is unavailable. Please restart the application.')
      return
    }

    const userContent = chatInput.trim()
    setChatInput('')
    setIsAiThinking(true)

    try {
      console.log('💬 [App] Sending message:', userContent)
      
      // Save user message to database
      await window.electronAPI.chatAddMessage(activeChat.id, 'user', userContent)
      
      // Add user message to UI immediately
      const userMessage = {
        id: Date.now().toString(),
        content: userContent,
        role: 'user' as const,
        timestamp: new Date()
      }
      setChatMessages(prev => [...prev, userMessage])

      // Use RAG for intelligent journal-aware responses
      console.log(`🧠 [App] Using RAG for intelligent response with chat context`)
      const ragResponse = await window.electronAPI.contentSearchAndAnswer(userContent, activeChat.id)
      
      if (ragResponse && ragResponse.answer) {
        // Save RAG response to database
        await window.electronAPI.chatAddMessage(activeChat.id, 'assistant', ragResponse.answer)
        
        // Add RAG response to UI
        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          content: ragResponse.answer,
          role: 'assistant' as const,
          timestamp: new Date()
        }
        setChatMessages(prev => [...prev, assistantMessage])
        
        console.log(`✅ [App] RAG response generated with ${ragResponse.sources?.length || 0} sources`)
      } else {
        console.log(`⚠️ [App] No RAG response, falling back to basic LLM`)
        // Fallback to basic LLM response
        const basicResponse = await window.electronAPI.llmSendMessage([
          { role: 'user', content: userContent }
        ])
        
        await window.electronAPI.chatAddMessage(activeChat.id, 'assistant', basicResponse)
        
        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          content: basicResponse,
          role: 'assistant' as const,
          timestamp: new Date()
        }
        setChatMessages(prev => [...prev, assistantMessage])
      }

    } catch (error) {
      console.error('❌ [App] Failed to send message:', error)
      
      // Fallback to basic LLM if RAG fails
      try {
        console.log('🔄 [App] RAG failed, falling back to basic LLM...')
        const basicResponse = await window.electronAPI.llmSendMessage([
          { role: 'user', content: userContent }
        ])
        
        await window.electronAPI.chatAddMessage(activeChat.id, 'assistant', basicResponse)
        
        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          content: basicResponse,
          role: 'assistant' as const,
          timestamp: new Date()
        }
        setChatMessages(prev => [...prev, assistantMessage])
        
      } catch (fallbackError) {
        console.error('❌ [App] Even fallback LLM failed:', fallbackError)
        alert('Failed to get AI response. Please check your connection and try again.')
      }
    } finally {
      setIsAiThinking(false)
    }
  }

  const handleChatKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Chat management functions
  const createNewChat = async (title?: string) => {
    try {
      // Check if electronAPI is available
      if (!window.electronAPI) {
        console.error('❌ [App] electronAPI not available for chat creation')
        return null
      }
      
      console.log('🆕 [App] Creating new chat:', title || 'Untitled')
      const newTitle = title || `Chat ${allChats.length + 1}`
      const newChat = await window.electronAPI.chatCreate(newTitle)
      console.log('✅ [App] Chat created with ID:', newChat.id)
      
      // Add welcome message for new chats (only if no title specified)
      if (!title) {
        await window.electronAPI.chatAddMessage(
          newChat.id, 
          'assistant', 
          'Hello! I\'m your local AI assistant. I can help you analyze your journal entries, find patterns, and provide insights - all while keeping your data completely private and offline.'
        )
        console.log('📝 [App] Added welcome message to chat')
      }
      
      // Refresh chats and set as active
      const chats = await window.electronAPI.chatGetAll()
      setAllChats(chats)
      console.log('🔄 [App] Refreshed chat list, switching to new chat')
      
      await switchToChat(newChat.id)
      console.log('✅ [App] Successfully switched to new chat')
      
      return newChat
    } catch (error) {
      console.error('❌ [App] Failed to create new chat:', error)
      return null
    }
  }

  const switchToChat = async (chatId: number) => {
    try {
      // Check if electronAPI is available
      if (!window.electronAPI) {
        console.error('❌ [App] electronAPI not available for chat switching')
        return
      }
      
      console.log('🔄 [App] Switching to chat ID:', chatId)
      await window.electronAPI.chatSetActive(chatId)
      
      // Update local state
      const updatedChats = await window.electronAPI.chatGetAll()
      setAllChats(updatedChats)
      
      const chat = updatedChats.find(c => c.id === chatId)
      if (chat) {
        setActiveChat(chat)
        console.log('✅ [App] Active chat set:', chat.title)
        
        // Load messages for this chat
        const messages = await window.electronAPI.chatGetMessages(chatId)
        setChatMessages(messages.map(msg => ({
          id: msg.id.toString(),
          content: msg.content,
          role: msg.role as 'user' | 'assistant',
          timestamp: new Date(msg.created_at)
        })))
        console.log('📚 [App] Loaded', messages.length, 'messages for chat')
      } else {
        console.error('❌ [App] Chat not found after switch:', chatId)
      }
    } catch (error) {
      console.error('❌ [App] Failed to switch to chat:', chatId, error)
    }
  }

  const deleteChat = async (chatId: number) => {
    try {
      await window.electronAPI.chatDelete(chatId)
      const chats = await window.electronAPI.chatGetAll()
      setAllChats(chats)
      
      // If deleted chat was active, switch to first available or create new
      if (activeChat?.id === chatId) {
        if (chats.length > 0) {
          await switchToChat(chats[0].id)
        } else {
          await createNewChat('New Chat')
        }
      }
    } catch (error) {
      console.error('❌ [App] Failed to delete chat:', error)
    }
  }

  const renameChat = async (chatId: number, currentTitle: string) => {
    console.log('🔧 [App] Rename clicked for chat:', chatId, currentTitle)
    setRenamingChat({ id: chatId, title: currentTitle })
    setShowRenameModal(true)
    setShowChatDropdown(false)
  }

  const handleRenameSubmit = async (newTitle: string) => {
    if (!renamingChat) return
    
    try {
      console.log('🔧 [App] Calling chatRename API...')
      console.log('🔧 [App] electronAPI.chatRename exists?', typeof window.electronAPI.chatRename)
      await window.electronAPI.chatRename(renamingChat.id, newTitle)
      console.log('🔧 [App] chatRename API completed')
      
      // Refresh chats list
      const chats = await window.electronAPI.chatGetAll()
      setAllChats(chats)
      
      // Update active chat if it was renamed
      if (activeChat?.id === renamingChat.id) {
        const updatedChat = chats.find(c => c.id === renamingChat.id)
        setActiveChat(updatedChat)
      }
      
      console.log(`📝 [App] Renamed chat ${renamingChat.id} to: ${newTitle}`)
      
      // Close modal
      setShowRenameModal(false)
      setRenamingChat(null)
    } catch (error) {
      console.error('❌ [App] Failed to rename chat:', error)
    }
  }

  const handleRenameCancel = () => {
    setShowRenameModal(false)
    setRenamingChat(null)
  }

  // Directory persistence
  const handleOpenDirectory = async () => {
    try {
      const result = await window.electronAPI.openDirectory()
      if (result) {
        console.log('📁 [App] Directory selected:', result)
        setRootDirectory(result)
        
        // Save the selected directory to settings
        try {
          await window.electronAPI.settingsSet('selectedDirectory', result)
          console.log('💾 [App] Directory saved to settings:', result)
        } catch (settingsError) {
          console.error('❌ [App] Failed to save directory to settings:', settingsError)
        }
      }
    } catch (error) {
      console.error('❌ [App] Failed to open directory:', error)
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
          <span className="file-path">
            {activeTab ? activeTab.name : 'No file open'}
          </span>
        </div>
        <div className="title-bar-right">
          <span className="app-info">v{version} ({platform})</span>
          <button 
            className="settings-gear-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        {/* Left Panel - File Tree */}
        <div 
          className={`panel file-tree-panel ${leftPanelCollapsed ? 'collapsed' : ''}`} 
          style={{ width: leftPanelWidth }}
        >
          <div className="panel-header">
            <h3>Explorer</h3>
            <div className="panel-header-actions">
              <button 
                className="open-directory-btn"
                onClick={handleOpenDirectory}
                title="Open Journal Directory"
              >
                📁
              </button>
              <button 
                className="collapse-btn"
                onClick={() => {
                  if (leftPanelCollapsed) {
                    setLeftPanelWidth(280)
                    setLeftPanelCollapsed(false)
                  } else {
                    setLeftPanelCollapsed(true)
                  }
                }}
                title={leftPanelCollapsed ? "Expand Explorer" : "Collapse Explorer"}
              >
                {leftPanelCollapsed ? '▶' : '◀'}
              </button>
            </div>
          </div>
          {!leftPanelCollapsed && (
            <div className="panel-content">
              <FileTree
                rootPath={rootDirectory}
                onFileSelect={handleFileSelect}
                selectedFile={activeTab?.path || null}
                onDirectorySelect={handleOpenDirectory}
              />
            </div>
          )}
          {/* Left Resize Handle */}
          <div 
            className="resize-handle resize-handle-right"
            onMouseDown={(e) => {
              e.preventDefault()
              isDraggingLeft.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
          />
        </div>

        {/* Center Panel - Editor */}
        <div className="panel editor-panel">
          <div className="panel-header">
            <div className="tab-bar">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <span>{tab.name}{tab.hasUnsavedChanges ? ' •' : ''}</span>
                  <span 
                    className="tab-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.id)
                    }}
                  >
                    ×
                  </span>
                </div>
              ))}
              <button 
                className="new-tab-btn"
                onClick={createNewTab}
                title="New Tab"
              >
                +
              </button>
            </div>
          </div>
          <div className="panel-content">
            {activeTab && (
              <MonacoEditor
                value={activeTab.content}
                onChange={handleEditorChange}
                language="markdown"
              />
            )}
          </div>
        </div>

        {/* Right Panel - AI Chat */}
        <div 
          className={`panel ai-chat-panel ${rightPanelCollapsed ? 'collapsed' : ''}`} 
          style={{ width: rightPanelWidth }}
        >
          {/* Right Resize Handle */}
          <div 
            className="resize-handle resize-handle-left"
            onMouseDown={(e) => {
              e.preventDefault()
              isDraggingRight.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
          />
          <div className="panel-header">
            <div className="chat-title">
              <span className="chat-icon">🤖</span>
              <span>AI Journal Assistant</span>
            </div>
            <button 
              className="collapse-btn"
              onClick={() => {
                if (rightPanelCollapsed) {
                  setRightPanelWidth(320)
                  setRightPanelCollapsed(false)
                } else {
                  setRightPanelCollapsed(true)
                }
              }}
              title={rightPanelCollapsed ? "Expand AI Chat" : "Collapse AI Chat"}
            >
              {rightPanelCollapsed ? '◀' : '▶'}
            </button>
          </div>
          
          {!rightPanelCollapsed && (
            <div className="panel-content">
              <div className="chat-area">
                <div className="chat-area-header">
                  <div className="chat-selector-wrapper">
                    <button 
                      className="chat-selector"
                      onClick={() => setShowChatDropdown(!showChatDropdown)}
                    >
                      <span className="selected-chat">
                        {activeChat?.title || 'Select a chat...'}
                      </span>
                      <span className="dropdown-arrow">
                        {showChatDropdown ? '▲' : '▼'}
                      </span>
                    </button>
                    
                    {showChatDropdown && (
                      <div className="chat-dropdown">
                        {allChats.map((chat) => (
                          <div 
                            key={chat.id}
                            className={`chat-dropdown-item ${activeChat?.id === chat.id ? 'active' : ''}`}
                          >
                            <div 
                              className="chat-item-main"
                              onClick={() => {
                                switchToChat(chat.id)
                                setShowChatDropdown(false)
                              }}
                            >
                              <span className="chat-item-title">{chat.title}</span>
                              <span className="chat-item-date">
                                {new Date(chat.updated_at).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="chat-item-actions">
                              <button 
                                className="chat-action-btn rename-btn"
                                onClick={() => renameChat(chat.id, chat.title)}
                                title="Rename Chat"
                              >
                                ✏️
                              </button>
                              <button 
                                className="chat-action-btn delete-btn"
                                onClick={() => {
                                  if (confirm(`Delete "${chat.title}"?`)) {
                                    deleteChat(chat.id)
                                    setShowChatDropdown(false)
                                  }
                                }}
                                title="Delete Chat"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                        {allChats.length === 0 && (
                          <div className="chat-dropdown-empty">
                            No chats yet. Create your first chat!
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <button 
                    className="new-chat-btn"
                    onClick={() => {
                      if (window.electronAPI) {
                        createNewChat()
                      } else {
                        console.error('❌ [App] Cannot create chat - electronAPI not available')
                      }
                    }}
                    title="New Chat"
                  >
                    ➕ New
                  </button>
                </div>
                
                <div className="chat-container">
                  <div className="chat-messages">
                    {chatMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`}
                      >
                        <div className="message-timestamp">{formatTime(message.timestamp)}</div>
                        <div className="message-line">
                          <span className="message-icon">
                            {message.role === 'user' ? '>' : '<'}
                          </span>
                          <span className="message-text">{message.content}</span>
                        </div>
                      </div>
                    ))}
                    
                    {isAiThinking && (
                      <div className="message message-assistant">
                        <div className="message-line">
                          <span className="message-icon">&lt;</span>
                          <span className="message-text">
                            <div className="typing-indicator">
                              <span></span>
                              <span></span>
                              <span></span>
                            </div>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="chat-input-area">
                    <div className="chat-input-wrapper">
                      <input 
                        type="text" 
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyPress={handleChatKeyPress}
                        placeholder="Ask about your journal entries, request insights, or start a reflection..."
                        className="chat-input"
                        disabled={isAiThinking || !activeChat}
                      />
                      <button 
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || isAiThinking || !activeChat}
                        className="send-button"
                        title="Send message (Enter)"
                      >
                        {isAiThinking ? '⏳' : '📤'}
                      </button>
                    </div>
                    <div className="chat-input-hint">
                      Press Enter to send, Shift+Enter for new line
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Rename Modal */}
      <RenameModal
        isOpen={showRenameModal}
        currentName={renamingChat?.title || ''}
        onSubmit={handleRenameSubmit}
        onCancel={handleRenameCancel}
      />
      
      {/* Settings Modal */}
      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
      
      {/* License Check Overlay */}
      {!licenseLoading && !isLicensed && (
        <div className="license-overlay">
          <div className="license-prompt">
            <div className="license-prompt-header">
              <h2>🔒 License Required</h2>
            </div>
            <div className="license-prompt-content">
              <p>Isla Journal requires a valid license to access all features.</p>
              <p>Open Settings to enter your license key or purchase a license.</p>
              <div className="license-prompt-actions">
                <button 
                  className="license-prompt-btn primary"
                  onClick={() => setShowSettings(true)}
                >
                  Open Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App 