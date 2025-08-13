import React, { useState, useEffect, useRef, useCallback } from 'react'
import { MonacoEditor, MarkdownPreview } from './components/Editor'
import EditorPane from './components/Layout/EditorPane'
import Sidebar from './components/Layout/Sidebar'
import { FileTree } from './components/FileTree'

import Settings from './components/Settings'
import { useLicenseCheck } from './hooks/useLicenseCheck'
import './App.css'


interface ChatMessage {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
  sources?: Array<{ file_name: string; file_path: string; snippet: string }>
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
  const { licenseStatus, isLoading: licenseLoading, isLicensed, validateNewLicense } = useLicenseCheck()
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseValidationMessage, setLicenseValidationMessage] = useState('')
  const [isValidatingLicense, setIsValidatingLicense] = useState(false)
  const [forceLicenseScreen, setForceLicenseScreen] = useState(false)
  
  // Tab management
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  
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
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [currentModelName, setCurrentModelName] = useState<string | null>(null)
  // Context injection for AI
  const [contextSelections, setContextSelections] = useState<Array<{path:string,name:string}>>([])
  const [fileSuggestions, setFileSuggestions] = useState<Array<{path:string,name:string}>>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  
  // Rename modal state
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renamingChat, setRenamingChat] = useState<{id: number, title: string} | null>(null)
  
  // Settings modal state
  const [showSettings, setShowSettings] = useState(false)
  
  // Theme state
  const [currentTheme, setCurrentTheme] = useState('dark')
  const editorApiRef = useRef<{
    wrapSelection: (p: string, s?: string) => void
    toggleBold: () => void
    toggleItalic: () => void
    insertLink: () => void
    insertList: (t: 'bullet'|'number'|'check') => void
    insertCodeBlock: () => void
  } | null>(null)

  // Initialize theme on app load
  useEffect(() => {
    const initializeTheme = async () => {
      try {
        const savedTheme = await window.electronAPI.settingsGet('theme') || 'dark'
        setCurrentTheme(savedTheme)
        document.documentElement.setAttribute('data-theme', savedTheme)
        console.log('🎨 Theme initialized:', savedTheme)
      } catch (error) {
        console.error('Failed to initialize theme:', error)
        // Default to dark theme if database is unavailable
        setCurrentTheme('dark')
        document.documentElement.setAttribute('data-theme', 'dark')
        console.log('🎨 Using default dark theme (database unavailable)')
      }
    }
    
    const initializeFontSettings = async () => {
      try {
        const fontFamily = await window.electronAPI.settingsGet('fontFamily') || 'jetbrains-mono'
        const fontSize = await window.electronAPI.settingsGet('fontSize') || 14
        
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
        console.log('👀 Font settings initialized:', fontFamily, fontSize + 'px')
      } catch (error) {
        console.error('Failed to initialize font settings:', error)
        // Default font settings if database is unavailable
        document.documentElement.style.setProperty('--app-font-family', 'JetBrains Mono, Consolas, "Courier New", monospace')
        document.documentElement.style.setProperty('--app-font-size', '14px')
        console.log('👀 Using default font settings (database unavailable)')
      }
    }
    
    initializeTheme()
    initializeFontSettings()
  }, [])

  // Event-driven settings updates (theme and others)
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSettingsChanged?.(({ key, value }) => {
      if (key === 'theme') {
        setCurrentTheme(value || 'dark')
        document.documentElement.setAttribute('data-theme', value || 'dark')
      }
    })
    return () => { if (unsubscribe) unsubscribe() }
  }, [])

  // Keyboard shortcut: toggle preview Ctrl/Cmd+Shift+V
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmd = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey
      // reserved for future shortcuts
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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
    
    // Streaming listeners
    const offChunk = window.electronAPI.onContentStreamChunk?.(({ chunk }) => {
      console.log('⚡️ [App] Stream chunk received:', chunk?.substring(0, 50) + '...')
      setChatMessages(prev => {
        const last = prev[prev.length-1]
        if (!last || last.role !== 'assistant') {
          const m = { id: String(Date.now()), content: chunk, role:'assistant' as const, timestamp: new Date() }
          return [...prev, m]
        } else {
          const updated = { ...last, content: (last.content || '') + chunk }
          return [...prev.slice(0, -1), updated as any]
        }
      })
    })
    const offDone = window.electronAPI.onContentStreamDone?.(async ({ answer, sources }) => {
      console.log('✅ [App] Stream done. Persisting assistant message...')
      setChatMessages(prev => {
        const last = prev[prev.length-1]
        if (last && last.role === 'assistant') {
          const updated = { ...last, content: answer, sources }
          return [...prev.slice(0,-1), updated as any]
        }
        return prev
      })
      setIsAiThinking(false)
      
      // CRITICAL: Persist assistant message to localStorage
      try {
        if (activeChat?.id && answer) {
          console.log('💾 [App] Saving assistant message to chat:', activeChat.id)
          await window.electronAPI.chatAddMessage(activeChat.id, 'assistant', answer, JSON.stringify({ sources }))
          console.log('✅ [App] Assistant message saved successfully')
          
          // Force refresh messages from storage to ensure UI reflects persistence
          const refreshedMessages = await window.electronAPI.chatGetMessages(activeChat.id)
          console.log('📚 [App] Refreshed', refreshedMessages.length, 'messages from storage')
          setChatMessages(refreshedMessages.map(msg => ({
            id: msg.id.toString(),
            content: msg.content,
            role: msg.role as 'user' | 'assistant',
            timestamp: new Date(msg.created_at),
            sources: (()=>{ try { const m = msg.metadata && JSON.parse(msg.metadata); return m?.sources || [] } catch { return [] } })()
          })))
        }
      } catch (e) { 
        console.error('❌ [App] CRITICAL: Failed to persist assistant message:', e)
      }
    })

    return () => {
      document.removeEventListener('mousemove', handleLeftResize)
      document.removeEventListener('mousemove', handleRightResize)
      document.removeEventListener('mouseup', handleMouseUp)
      if (offChunk) offChunk()
      if (offDone) offDone()
    }
  }, [handleLeftResize, handleRightResize, handleMouseUp])


  // Tab management functions
  const createNewTab = () => {
    const newTab: EditorTab = {
      id: `untitled-${Date.now()}`,
      name: 'Untitled',
      path: null,
      content: '',
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
          name: 'Welcome',
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
        const versionInfo = await window.electronAPI.getVersion?.()
        setVersion(versionInfo)
        try {
          const plat = await window.electronAPI.getPlatform?.()
          setPlatform(plat)
        } catch {}

        // Load saved directory from settings - restore persistent directory
        try {
          const savedDirectory = await window.electronAPI.settingsGet?.('selectedDirectory')
          const savedName = await window.electronAPI.settingsGet?.('selectedDirectoryName')
          console.log('🔍 [App] Saved directory:', savedDirectory, 'name:', savedName)
          
          if (savedDirectory === 'fsroot://' && savedName) {
            // Check if we already have a directory handle in memory
            const existingHandle = (window as any).__isla_rootHandle
            const existingName = (window as any).__isla_rootName
            
            if (existingHandle && existingName) {
              console.log('✅ [App] Directory handle already available:', existingName)
              setRootDirectory(savedDirectory)
            } else {
              // Set the saved name so UI shows it, but directory needs re-selection
              console.log('🔄 [App] Restoring directory session, but need user to re-grant access')
              ;(window as any).__isla_rootName = savedName
              // Don't set rootDirectory yet - this will cause FileTree to try loading without a handle
              // Instead, the user needs to click the directory button to re-grant access
              console.log('⚠️ [App] Directory handle missing - user must re-select directory to access files')
            }
          } else {
            console.log('📁 [App] No saved directory - user needs to select directory')
            setTimeout(() => handleOpenDirectory(), 100)
          }        
        } catch (error) {
          console.error('❌ [App] Failed to load saved directory:', error)
          setTimeout(() => handleOpenDirectory(), 100)
        }

        // Restore previous editor session (tabs + active)
        try {
          const savedTabsJson = await window.electronAPI.settingsGet?.('sessionTabs')
          const savedActive = await window.electronAPI.settingsGet?.('sessionActiveTabId')
          if (savedTabsJson) {
            const list: Array<{id:string; name:string; path:string|null}> = JSON.parse(savedTabsJson)
            const restored: EditorTab[] = []
            for (const t of list) {
              try {
                const content = t.path ? await window.electronAPI.readFile?.(t.path) : ''
                restored.push({ id: t.id, name: t.name, path: t.path, content, hasUnsavedChanges: false })
              } catch (e) {
                console.warn('⚠️ [App] Failed to restore tab content for', t.path, e)
                restored.push({ id: t.id, name: t.name, path: t.path, content: '', hasUnsavedChanges: false })
              }
            }
            if (restored.length > 0) {
              setTabs(restored)
              if (savedActive && restored.some(r => r.id === savedActive)) {
                setActiveTabId(savedActive)
              } else {
                setActiveTabId(restored[restored.length - 1].id)
              }
            }
          }
        } catch (e) {
          console.error('❌ [App] Failed to restore editor session:', e)
        }

        // Load chats
        const chats = await window.electronAPI.chatGetAll?.()
        setAllChats(chats)

        // Load LLM models and current model
        try {
          const models = await window.electronAPI.llmGetAvailableModels?.()
          if (Array.isArray(models)) setAvailableModels(models)
          const cm = await window.electronAPI.llmGetCurrentModel?.()
          setCurrentModelName(cm || null)
        } catch (e) {
          console.warn('LLM model info load failed:', e)
        }

        // Load active chat and its messages (if any exist)
        const activeChat = await window.electronAPI.chatGetActive?.()
        if (activeChat) {
          setActiveChat(activeChat)
          const messages = await window.electronAPI.chatGetMessages(activeChat.id)
          setChatMessages(messages.map(msg => ({
            id: msg.id.toString(),
            content: msg.content,
            role: msg.role as 'user' | 'assistant',
            timestamp: new Date(msg.created_at),
            sources: (()=>{ try { const m = msg.metadata && JSON.parse(msg.metadata); return m?.sources || [] } catch { return [] } })()
          })))
        }
        // No automatic chat creation - user can create chats when needed
      } catch (error) {
        console.error('❌ [App] Failed to initialize app:', error)
      }
    }

    initializeApp()
  }, [])

  // Persist editor session whenever tabs or active tab changes
  useEffect(() => {
    const minimal = tabs.map(t => ({ id: t.id, name: t.name, path: t.path }))
    try {
      window.electronAPI.settingsSet?.('sessionTabs', JSON.stringify(minimal))
      if (activeTabId) window.electronAPI.settingsSet?.('sessionActiveTabId', activeTabId)
    } catch (e) {
      console.warn('⚠️ [App] Failed to persist session', e)
    }
  }, [tabs, activeTabId])

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
      const content = await window.electronAPI.readFile?.(filePath)
      
      // Clean up the file name by removing ID suffix
          const cleanFileName = fileName.replace(/\s+[a-f0-9]{32}\.md$/, '.md').replace(/\.md$/i,'')
      
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
      // Update date meta in title area (read-only)
      try {
        const meta = await window.electronAPI.getFileMetaByPath?.(filePath)
        const el = document.getElementById('editor-file-date')
        if (el && meta) {
          const created = meta.note_date || meta.created_at || ''
          const modified = meta.file_mtime || meta.modified_at || ''
          const createdStr = created ? new Date(created).toLocaleDateString() : ''
          const modifiedStr = modified ? new Date(modified).toLocaleDateString() : ''
          el.textContent = [createdStr && `Created: ${createdStr}`, modifiedStr && `Last edit: ${modifiedStr}`].filter(Boolean).join(' • ')
        }
      } catch {}
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
      
      // Save user message to database FIRST
      console.log('💾 [App] Saving user message to chat:', activeChat.id)
      await window.electronAPI.chatAddMessage?.(activeChat.id, 'user', userContent)
      console.log('✅ [App] User message saved')
      
      // Add user message to UI immediately
      const userMessage = {
        id: Date.now().toString(),
        content: userContent,
        role: 'user' as const,
        timestamp: new Date()
      }
      setChatMessages(prev => [...prev, userMessage])

      // Use RAG for intelligent notes-aware responses
      console.log(`🧠 [App] Using RAG for intelligent response with chat context`)
      let ragResponse: any = null
      let gotStream = false
      const offChunk = window.electronAPI.onContentStreamChunk?.(() => { gotStream = true })
      const offDone = window.electronAPI.onContentStreamDone?.(() => { gotStream = true })
      if (contextSelections.length > 0 && window.electronAPI.contentStreamSearchAndAnswerWithContext) {
        ragResponse = await window.electronAPI.contentStreamSearchAndAnswerWithContext(userContent, activeChat.id, contextSelections.map(c=>c.path))
      } else {
        ragResponse = await window.electronAPI.contentStreamSearchAndAnswer?.(userContent, activeChat.id)
      }
      
      // If streaming did not start within 1s, fallback to non-streaming
      await new Promise(r => setTimeout(r, 1000))
      if (!gotStream || !ragResponse) {
        console.log(`⚠️ [App] No RAG response, falling back to basic LLM`)
        // Fallback to basic LLM response
        const basicResponse = await window.electronAPI.llmSendMessage?.(
          [
            { role: 'user', content: userContent }
          ]
        )
        
        console.log('💾 [App] Saving fallback assistant response')
        await window.electronAPI.chatAddMessage?.(activeChat.id, 'assistant', basicResponse)
        console.log('✅ [App] Fallback response saved')
        
        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          content: basicResponse,
          role: 'assistant' as const,
          timestamp: new Date()
        }
        setChatMessages(prev => [...prev, assistantMessage])
        
        // Force refresh to ensure persistence reflected
        try {
          const messages = await window.electronAPI.chatGetMessages(activeChat.id)
          console.log('📚 [App] Fallback refresh: loaded', messages.length, 'messages')
          setChatMessages(messages.map(msg => ({
            id: msg.id.toString(),
            content: msg.content,
            role: msg.role as 'user' | 'assistant',
            timestamp: new Date(msg.created_at),
            sources: (()=>{ try { const m = msg.metadata && JSON.parse(msg.metadata); return m?.sources || [] } catch { return [] } })()
          })))
        } catch (e) {
          console.error('❌ [App] Failed to refresh after fallback:', e)
        }
      }
      if (offChunk) offChunk()
      if (offDone) offDone()

    } catch (error) {
      console.error('❌ [App] Failed to send message:', error)
      
      // Fallback to basic LLM if RAG fails
      try {
        console.log('🔄 [App] RAG failed, falling back to basic LLM...')
        const basicResponse = await window.electronAPI.llmSendMessage?.(
          [
            { role: 'user', content: userContent }
          ]
        )
        
        console.log('💾 [App] Saving secondary fallback assistant response')
        await window.electronAPI.chatAddMessage?.(activeChat.id, 'assistant', basicResponse)
        console.log('✅ [App] Secondary fallback response saved')
        
        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          content: basicResponse,
          role: 'assistant' as const,
          timestamp: new Date()
        }
        setChatMessages(prev => [...prev, assistantMessage])
        
        try {
          const messages = await window.electronAPI.chatGetMessages(activeChat.id)
          console.log('📚 [App] Secondary fallback refresh: loaded', messages.length, 'messages')
          setChatMessages(messages.map(msg => ({
            id: msg.id.toString(),
            content: msg.content,
            role: msg.role as 'user' | 'assistant',
            timestamp: new Date(msg.created_at),
            sources: (()=>{ try { const m = msg.metadata && JSON.parse(msg.metadata); return m?.sources || [] } catch { return [] } })()
          })))
        } catch (e) {
          console.error('❌ [App] Failed to refresh after secondary fallback:', e)
        }
      } catch (fallbackError) {
        console.error('❌ [App] Even fallback LLM failed:', fallbackError)
        alert('Failed to get AI response. Please check your connection and try again.')
      }
    } finally {
      setIsAiThinking(false)
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
      const newChat = await window.electronAPI.chatCreate?.(newTitle)
      console.log('✅ [App] Chat created with ID:', newChat.id)
      
      // No automatic welcome messages - user starts with clean chat
      
      // Refresh chats and set as active
      const chats = await window.electronAPI.chatGetAll?.()
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
      await window.electronAPI.chatSetActive?.(chatId)
      
      // Update local state
      const updatedChats = await window.electronAPI.chatGetAll?.()
      setAllChats(updatedChats)
      
      const chat = updatedChats.find(c => c.id === chatId)
      if (chat) {
        setActiveChat(chat)
        console.log('✅ [App] Active chat set:', chat.title)
        
        // Load messages for this chat
        const messages = await window.electronAPI.chatGetMessages?.(chatId)
        setChatMessages(messages.map(msg => ({
          id: msg.id.toString(),
          content: msg.content,
          role: msg.role as 'user' | 'assistant',
          timestamp: new Date(msg.created_at),
          sources: (()=>{ try { const m = msg.metadata && JSON.parse(msg.metadata); return m?.sources || [] } catch { return [] } })()
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
      await window.electronAPI.chatDelete?.(chatId)
      const chats = await window.electronAPI.chatGetAll?.()
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
      await window.electronAPI.chatRename?.(renamingChat.id, newTitle)
      console.log('🔧 [App] chatRename API completed')
      
      // Refresh chats list
      const chats = await window.electronAPI.chatGetAll?.()
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
      const result = await window.electronAPI.openDirectory?.()
      if (result) {
        console.log('📁 [App] Directory selected:', result)
        setRootDirectory(result)
        
        // Save both directory path and name to settings for persistence
        try {
          await window.electronAPI.settingsSet?.('selectedDirectory', result)
          const directoryName = (window as any).__isla_rootName
          if (directoryName) {
            await window.electronAPI.settingsSet?.('selectedDirectoryName', directoryName)
            console.log('💾 [App] Directory and name saved to settings:', result, directoryName)
          }
        } catch (settingsError) {
          console.error('❌ [App] Failed to save directory to settings:', settingsError)
        }
      }
    } catch (error) {
      console.error('❌ [App] Failed to open directory:', error)
    }
  }

  // License key validation function
  const handleLicenseValidation = async () => {
    const trimmedKey = licenseKey.trim()
    if (!trimmedKey) {
      setLicenseValidationMessage('Please enter a license key')
      return
    }

    setIsValidatingLicense(true)
    setLicenseValidationMessage('')

    try {
      const result = await validateNewLicense(trimmedKey)
      
      if (result.valid) {
        setLicenseValidationMessage('[OK] License validated successfully! Welcome to Isla Journal!')
        setLicenseKey('') // Clear input
        setForceLicenseScreen(false) // Reset force state when valid license is entered
        // The license check hook will automatically update the UI
      } else {
        setLicenseValidationMessage(`[ERROR] ${result.error || 'Invalid license key'}`)
      }
    } catch (error) {
      console.error('License validation error:', error)
              setLicenseValidationMessage('[ERROR] Network error - please check your connection and try again')
    } finally {
      setIsValidatingLicense(false)
    }
  }

  // Function to force license screen to show
  const forceLicenseScreenToShow = () => {
    setForceLicenseScreen(true)
  }

  // Function to open external URLs
  const openUrl = (url: string) => {
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

  // Suggestion search when typing '@'
  useEffect(() => {
    const atIndex = chatInput.lastIndexOf('@')
    if (atIndex >= 0) {
      const query = chatInput.slice(atIndex + 1).trim()
      if (query.length === 0) {
        setShowSuggestions(true)
        // show nothing until user types
        setFileSuggestions([])
        return
      }
      // Debounced content search; dedupe by file_path
      const t = setTimeout(async () => {
        try {
          const res = await window.electronAPI.searchContent?.(query, 12)
          const seen: Record<string, boolean> = {}
          const uniq = res.filter((r:any)=>{
            if (seen[r.file_path]) return false
            seen[r.file_path]=true
            return true
          }).map((r:any)=>({ path: r.file_path, name: r.file_name.replace(/\s+[a-f0-9]{32}\.md$/,'').replace(/\.md$/i,'') }))
          setFileSuggestions(uniq)
          setShowSuggestions(true)
        } catch (e) {
          setFileSuggestions([])
          setShowSuggestions(false)
        }
      }, 200)
      return () => clearTimeout(t)
    } else {
      setShowSuggestions(false)
    }
  }, [chatInput])

  return (
    <div className="app">
      {/* Only show main app if licensed */}
      {!licenseLoading && isLicensed && (
        <>
          {/* Title Bar */}
          <div className="title-bar">
            <div className="title-bar-left">
              {/* Removed app title */}
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
                [⚙]
              </button>
            </div>
          </div>

          {/* Main Content Area */}
      <div className="main-content">
        <Sidebar
          rootDirectory={rootDirectory}
          width={leftPanelWidth}
          collapsed={leftPanelCollapsed}
          onResizeStart={() => { isDraggingLeft.current = true }}
          onOpenDirectory={handleOpenDirectory}
          onFileSelect={handleFileSelect}
          selectedFilePath={activeTab?.path || null}
        />
 
        {/* Center Panel - Editor */}
        <div style={{ display:'flex', flex:1, flexDirection:'column', minWidth:0 }}>
          <EditorPane
            activeTab={activeTab || null}
            theme={currentTheme}
            onChange={handleEditorChange}
            onNewEditor={() => {
              const newTab = { id: `untitled-${Date.now()}`, name: 'Untitled', path: null, content: '', hasUnsavedChanges: false }
              setTabs(prev => [...prev, newTab as any]); setActiveTabId((newTab as any).id)
            }}
            onRenameFile={(newName) => {
              if (!activeTab) return
              // Only update title; saving path rename is managed elsewhere
              // Hide extension in UI
              const clean = newName.replace(/\.?md$/i, '')
              setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, name: clean, hasUnsavedChanges: true } : t))
            }}
            onCommitRename={async (newName) => {
              try {
                if (!activeTab?.path) return
                const clean = newName.replace(/\.?md$/i, '')
                await window.electronAPI.renameFile?.(activeTab.path, clean + '.md')
                // Refresh active tab path and name
                const parent = activeTab
                setTabs(prev => prev.map(t => t.id === parent.id ? { ...t, name: clean + '.md' } as any : t))
              } catch (e) {
                console.error('Rename failed:', e)
              }
            }}
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={(id)=> setActiveTabId(id)}
            onCloseTab={(id)=> closeTab(id)}
          />

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
                              <span className="chat-item-title">{String(chat.title || '').replace(/\.?md$/i,'')}</span>
                              <span className="chat-item-date">
                                {new Date(chat.updated_at).toLocaleDateString()}
                              </span>
                            </div>
                            <button 
                              className="chat-item-kebab"
                              onClick={(e)=>{
                                e.stopPropagation()
                                const container = e.currentTarget.parentElement as HTMLElement
                                const menu = container.querySelector('.chat-item-menu') as HTMLElement
                                if (menu) {
                                  const willOpen = !menu.classList.contains('open')
                                  menu.classList.toggle('open', willOpen)
                                  menu.style.display = willOpen ? 'flex' : 'none'
                                }
                              }}
                              title="More"
                            >
                              ⋯
                            </button>
                            <div className="chat-item-menu" style={{display:'none'}}>
                              <button onClick={() => renameChat(chat.id, chat.title)}>Rename</button>
                              <button className="danger" onClick={() => { if (confirm(`Delete "${chat.title}"?`)) { deleteChat(chat.id); setShowChatDropdown(false) } }}>Delete</button>
                            </div>
                          </div>
                        ))}
                        {allChats.length === 0 && (
                          <div className="chat-dropdown-empty">
                            No chats yet. Create your first chat!
                          </div>
                        )}
                        {allChats.length > 0 && (
                          <div className="chat-dropdown-item" style={{justifyContent:'center'}}>
                            <button
                              className="chat-action-btn delete-btn"
                              onClick={async () => {
                                if (confirm('Delete ALL chats and messages? This cannot be undone.')) {
                                  try { await window.electronAPI.chatDeleteAll() } catch {}
                                  const chats = await window.electronAPI.chatGetAll?.()
                                  setAllChats(chats)
                                  setActiveChat(null as any)
                                  setChatMessages([])
                                  setShowChatDropdown(false)
                                }
                              }}
                              title="Delete all chats"
                            >
                              Trash
                            </button>
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
              [+] New
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
                          <span className="message-text">
                            {message.role === 'assistant' ? (
                              <MarkdownPreview markdown={message.content} />
                            ) : (
                              message.content
                            )}
                          </span>
                        </div>
                        {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                          <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8, padding:'8px 0', borderTop:'1px solid var(--border-light)' }}>
                            <div style={{ fontSize:'12px', color:'var(--text-secondary)', fontWeight:500 }}>Sources:</div>
                            {message.sources.filter(s=> (s?.file_name && s?.file_path && (s?.snippet||'').length > 40)).slice(0,6).map((src, idx) => {
                              // Clean filename by removing hash IDs
                               const cleanFileName = src.file_name
                                .replace(/\s+[a-f0-9]{32,}\.md$/i, '')
                                .replace(/\.md$/i, '')
                                .replace(/^\d+\s+/, '')
                                .trim()
                              
                              return (
                                <button
                                  key={idx}
                                  className="source-citation"
                                  title={src.snippet}
                                  onClick={async ()=>{
                                    try {
                                      const content = await window.electronAPI.readFile?.(src.file_path)
                                      if (activeTab) {
                                        setTabs(prev => prev.map(tab => 
                                          tab.id === activeTab.id 
                                            ? { ...tab, name: cleanFileName, path: src.file_path, content, hasUnsavedChanges: false }
                                            : tab
                                        ))
                                      } else {
                                        const newTab = { id: `file-${Date.now()}`, name: cleanFileName, path: src.file_path, content, hasUnsavedChanges:false }
                                        setTabs(prev => [...prev, newTab as any])
                                        setActiveTabId((newTab as any).id)
                                      }
                                    } catch (e) {
                                      console.error('Failed to open source file:', e)
                                    }
                                  }}
                                >
                                  📄 {cleanFileName}
                                </button>
                              )
                            })}
                          </div>
                        )}
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
                      <textarea 
                        ref={(el) => {
                          if (el) {
                            // Auto-resize functionality
                            el.style.height = 'auto'
                            el.style.height = Math.min(el.scrollHeight, 120) + 'px'
                          }
                        }}
                        value={chatInput}
                        onChange={(e) => {
                          setChatInput(e.target.value)
                          // Auto-resize on change
                          e.target.style.height = 'auto'
                          e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleSendMessage()
                          }
                        }}
                        placeholder="Ask or reflect..."
                        className="chat-input"
                        disabled={isAiThinking || !activeChat}
                        rows={1}
                      />
                      <button 
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || isAiThinking || !activeChat}
                        className="send-button"
                        title="Send message (Enter)"
                      >
                        {isAiThinking ? '•••' : '▶'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
          {/* Chat Rename Modal */}
          {showRenameModal && renamingChat && (
            <div className="modal-overlay" onClick={handleRenameCancel}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h3>Rename Chat</h3>
                <form onSubmit={(e) => {
                  e.preventDefault()
                  const formData = new FormData(e.target as HTMLFormElement)
                  const newTitle = formData.get('chatTitle') as string
                  if (newTitle && newTitle.trim()) {
                    handleRenameSubmit(newTitle.trim())
                  }
                }}>
                  <input
                    type="text"
                    name="chatTitle"
                    defaultValue={renamingChat.title}
                    placeholder="Enter chat title"
                    autoFocus
                    required
                  />
                  <div className="modal-actions">
                    <button type="button" onClick={handleRenameCancel}>Cancel</button>
                    <button type="submit">Rename</button>
                  </div>
                </form>
              </div>
            </div>
          )}
          
          {/* Settings Modal */}
          <Settings
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            onForceLicenseScreen={forceLicenseScreenToShow}
          />
        </>
      )}
      
      {/* License Check Overlay */}
      {!licenseLoading && (!isLicensed || forceLicenseScreen) && (
        <div className="license-overlay">
          <div className="license-prompt">
            <div className="license-prompt-header">
              <h2>🔒 License Required</h2>
            </div>
            <div className="license-prompt-content">
              <p>Isla Journal requires a valid license to access all features.</p>
              
              {/* License Key Input */}
              <div className="license-input-section">
                <label htmlFor="license-key-input" className="license-input-label">
                  Enter your license key:
                </label>
                <div className="license-input-group">
                  <input
                    id="license-key-input"
                    type="text"
                    className="license-input"
                    placeholder="ij_life_... or ij_sub_... (paste your license key here)"
                    value={licenseKey}
                    onChange={(e) => {
                      setLicenseKey(e.target.value)
                      // Clear previous validation message on input change
                      if (licenseValidationMessage) {
                        setLicenseValidationMessage('')
                      }
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleLicenseValidation()
                      }
                    }}
                    disabled={isValidatingLicense}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    className="license-validate-btn"
                    onClick={handleLicenseValidation}
                    disabled={isValidatingLicense || !licenseKey.trim()}
                  >
                    {isValidatingLicense ? '⏳' : '✓'}
                  </button>
                </div>
                
                {licenseValidationMessage && (
                  <div className={`license-validation-message ${licenseValidationMessage.startsWith('[OK]') ? 'success' : 'error'}`}>
                    {licenseValidationMessage}
                  </div>
                )}
              </div>

              {/* Links Section */}
              <div className="license-links-section">
                <div className="license-links-row">
                  <button 
                    className="license-link-btn"
                    onClick={() => openUrl('https://pay.islajournal.app/p/login/cNieVc50A7yGfkv4BQ73G00')}
                  >
                    🏠 Customer Portal
                  </button>
                </div>
                
                <div className="license-payment-section">
                  <p className="license-payment-text">Need a license?</p>
                  <div className="license-payment-buttons">
                    <button 
                      className="license-payment-btn lifetime"
                      onClick={() => openUrl('https://pay.islajournal.app/b/cNieVc50A7yGfkv4BQ73G00')}
                    >
                                              [LIFETIME] License
                      <span className="license-price">$99</span>
                    </button>
                    <button 
                      className="license-payment-btn annual"
                      onClick={() => openUrl('https://pay.islajournal.app/b/7sY28qakUg5cfkv2tI73G02')}
                    >
                      📅 Annual License
                      <span className="license-price">$49</span>
                    </button>
                    <button 
                      className="license-payment-btn monthly"
                      onClick={() => openUrl('https://pay.islajournal.app/b/dRmaEWct2cT03BN6JY73G01')}
                    >
                      [MONTHLY] License
                      <span className="license-price">$7</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App 