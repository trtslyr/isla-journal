import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron'
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path, { join, normalize, resolve } from 'path'
import os from 'os'
import { isDev } from './utils/is-dev'
import { database } from './database'
import { LlamaService } from './services/llamaService'
import { DeviceDetectionService } from './services/deviceDetection'
import { contentService } from './services/contentService'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

const createWindow = (): void => {
  // Determine icon path
  const iconPath = process.platform === 'darwin' 
    ? join(process.cwd(), 'build/icon.icns')
    : process.platform === 'win32'
    ? join(process.cwd(), 'build/icon.ico')
    : join(process.cwd(), 'build/icon.png')
  
  console.log('🎨 [Icon] Platform:', process.platform)
  console.log('🎨 [Icon] Icon path:', iconPath)
  console.log('🎨 [Icon] Icon exists:', require('fs').existsSync(iconPath))
  console.log('🎨 [Icon] Current working directory:', process.cwd())
  console.log('🎨 [Icon] Absolute icon path:', require('path').resolve(iconPath))
  
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js'),
      // Suppress development security warnings (these are false positives from Electron Forge)
      ...(isDev && {
        webSecurity: true, // Explicitly enable web security
        allowRunningInsecureContent: false // Explicitly disable insecure content
      })
    }
  })

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools() // Commented out for cleaner dev experience
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    
    // if (isDev) {
    //   mainWindow?.webContents.openDevTools() // Commented out for cleaner dev experience
    // }
  })

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  // Log cross-platform information
  logPlatformInfo()
  
  // Initialize database (now async with proper error handling)
  try {
    await database.initialize()
    console.log('🚀 [Main] Database initialization completed')
  } catch (error) {
    console.error('❌ [Main] Failed to initialize database:', error)
    // Show error dialog to user
    const { dialog } = require('electron')
    dialog.showErrorBox(
      'Database Initialization Error',
      `Failed to initialize the database: ${error.message}\n\nThe application may not function properly.`
    )
  }

  createWindow()

  // Initialize LLM service (async, don't block app startup)
  const llamaService = LlamaService.getInstance()
  llamaService.setMainWindow(mainWindow!)
  llamaService.initialize().catch(error => {
    console.error('❌ [Main] Failed to initialize LLM service:', error)
    // LLM will be unavailable but app continues to work
  })

  // Set app menu
  if (process.platform === 'darwin') {
    // macOS menu
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' },
              { role: 'stopSpeaking' }
            ]
          }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' },
          { type: 'separator' },
          { role: 'front' }
        ]
      }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } else {
    // Windows/Linux - include Edit menu for clipboard operations
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'File',
        submenu: [
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'delete' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up database when app is about to quit
app.on('before-quit', () => {
  database.close()
})

// Security: Prevent new window creation (handled by setWindowOpenHandler above)



// Cross-platform path utility
const normalizePath = (filePath: string): string => {
  try {
    // Resolve to absolute path and normalize
    const resolved = resolve(filePath)
    // Convert Windows backslashes to forward slashes for logging consistency
    const normalized = normalize(resolved)
    return normalized
  } catch (error) {
    console.warn(`⚠️ [Path] Failed to normalize path: ${filePath} - ${error.message}`)
    return normalize(filePath) // Fallback to basic normalization
  }
}

// Cross-platform logging helper
const logPlatformInfo = () => {
  console.log(`🌍 [Platform] OS: ${os.platform()}, Arch: ${os.arch()}, Release: ${os.release()}`)
}

// Basic app info handlers
ipcMain.handle('app:getVersion', () => {
  return app.getVersion()
})

ipcMain.handle('app:getPlatform', () => {
  return process.platform
})

// File operations handlers
ipcMain.handle('file:openDirectory', async () => {
  if (!mainWindow) {
    throw new Error('Main window not available')
  }
  
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Journal Directory',
      // Windows-specific: Ensure proper default directory
      defaultPath: process.platform === 'win32' ? process.env.USERPROFILE : undefined
    })
    
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    
    return result.filePaths[0]
  } catch (error) {
    console.error('Error opening directory dialog:', error)
    throw error
  }
})

  // IPC handler to read directory contents with cross-platform path handling
  ipcMain.handle('file:readDirectory', async (_, dirPath: string) => {
    try {
      // Ensure database is ready before any operations
      await database.ensureReady()
      
      const normalizedDirPath = normalizePath(dirPath)
      console.log('📁 Reading directory:', normalizedDirPath)
      console.log('🔍 [Directory] Original path:', dirPath, '→ Normalized:', normalizedDirPath)
    
    // Check if this is a root directory switch (not just subdirectory expansion)
    let shouldClearDatabase = false
    let isRootDirectoryChange = false
    try {
      const currentSavedDirectory = await database.getSetting('selectedDirectory')
      
      if (!currentSavedDirectory) {
        // First time - this is a root directory selection
        console.log('📁 [First Time] No previous directory found, setting root directory')
        isRootDirectoryChange = true
      } else if (currentSavedDirectory !== dirPath && !path.relative(currentSavedDirectory, dirPath).startsWith('..')) {
        // This is a genuine root directory change (not a subdirectory)
        console.log('🔄 [Root Directory Switch] From:', currentSavedDirectory, 'To:', dirPath)
        shouldClearDatabase = true
        isRootDirectoryChange = true
      } else if (!path.relative(currentSavedDirectory, dirPath).startsWith('..')) {
        // This is just subdirectory expansion - don't change root directory or clear database
        console.log('📂 [Subdirectory Expansion]:', dirPath)
      } else if (currentSavedDirectory === dirPath) {
        // Same directory - might be a refresh
        console.log('🔄 [Directory Refresh]:', dirPath)
      }
    } catch (error) {
      console.log('📁 [First Time] No previous directory found, proceeding with indexing')
      isRootDirectoryChange = true
    }
    
    // Clear database and reinitialize chunking for new directories
    if (shouldClearDatabase) {
      console.log('🔄 [Directory Switch] Clearing and reinitializing database for new directory...')
      try {
        database.clearAllContent()
        console.log('✅ [Directory Switch] Database cleared successfully')
      } catch (error) {
        console.error('❌ [Directory Switch] Database clear failed:', error)
        // Database will be recreated automatically by the force recreate function
      }
    }
    
    // Save the directory as root directory only if it's a root directory change
    if (isRootDirectoryChange) {
      database.setSetting('selectedDirectory', normalizedDirPath)
      console.log('📂 [Directory Switch] Set new root directory:', normalizedDirPath)
    }
    
    const entries = await readdir(normalizedDirPath, { withFileTypes: true })
    console.log('📋 Found entries:', entries.length)
    
    const files = []
    
    for (const entry of entries) {
      
      console.log('🔍 Processing:', entry.name, 'Type:', entry.isDirectory() ? 'directory' : 'file')
      
      // Skip hidden files and non-markdown files (except directories)
      if (entry.name.startsWith('.')) {
        console.log('⏭️ Skipping hidden file:', entry.name)
        continue
      }
      if (entry.isFile() && !entry.name.endsWith('.md')) {
        console.log('⏭️ Skipping non-markdown file:', entry.name)
        continue
      }
      
      const fullPath = normalizePath(join(normalizedDirPath, entry.name))
      const stats = await stat(fullPath)
      
      const fileItem = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        modified: stats.mtime.toISOString(), // FIX: Convert Date to ISO string
        size: stats.size
      }
      
      // ✅ SMART INCREMENTAL RAG PROCESSING - Only process new/changed files
      if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const needsProcessing = database.needsProcessing(fullPath, stats.mtime)
          
          if (needsProcessing) {
            console.log('📖 [Incremental] Processing new/modified file:', entry.name)
            const content = await readFile(fullPath, 'utf-8')
            
            // Save to database with RAG chunking and FTS indexing
            database.saveFile(fullPath, entry.name, content)
            console.log('🧠 [Incremental] RAG processed:', entry.name)
          } else {
            console.log('⏭️ [Incremental] Skipping unchanged file:', entry.name)
          }
        } catch (contentError) {
          console.error('⚠️ Failed to process content for', entry.name, ':', contentError)
          // Continue with metadata-only entry
        }
      }
      
      // 🚫 RECURSIVE PROCESSING COMPLETELY DISABLED 
      // (This was causing the massive file processing on startup)
      
      files.push(fileItem)
      console.log('✅ Added:', entry.name, entry.isDirectory() ? 'directory' : 'file')
    }
    
    // Sort: directories first, then files, both alphabetically
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    
    // Log database stats after indexing
    const stats = database.getStats()
    console.log(`📊 [Database Stats] Files: ${stats.fileCount}, Chunks: ${stats.chunkCount}, FTS Index: ${stats.indexSize}`)
    
    console.log('📤 Returning files count:', files.length)
    return files
  } catch (error) {
    console.error('Error reading directory:', error)
    throw error
  }
})

// Helper function to recursively process directories for markdown files
async function processDirectoryRecursively(dirPath: string): Promise<void> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    
    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) {
        continue
      }
      
      const fullPath = join(dirPath, entry.name)
      
      if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          console.log('📖 [Recursive] Reading content for RAG processing:', entry.name, 'in', dirPath)
          const content = await readFile(fullPath, 'utf-8')
          
          // Save to database with RAG chunking and FTS indexing
          database.saveFile(fullPath, entry.name, content)
          console.log('🧠 [Recursive] RAG processed:', entry.name)
        } catch (contentError) {
          console.error('⚠️ [Recursive] Failed to process content for', entry.name, ':', contentError)
        }
      } else if (entry.isDirectory()) {
        // Recursively process subdirectories (with depth limit to prevent infinite loops)
        const depth = dirPath.split('/').length
        if (depth < 10) { // Reasonable depth limit
          await processDirectoryRecursively(fullPath)
        }
      }
    }
  } catch (error) {
    console.error('Error in recursive directory processing:', error)
  }
}

ipcMain.handle('file:readFile', async (_, filePath: string) => {
  try {
    const normalizedPath = normalizePath(filePath)
    console.log('📖 [File] Reading:', normalizedPath)
    const content = await readFile(normalizedPath, 'utf-8')
    return content
  } catch (error) {
    console.error('❌ [File] Error reading file:', filePath, '→', error.message)
    throw error
  }
})

ipcMain.handle('file:writeFile', async (_, filePath: string, content: string) => {
  try {
    const normalizedPath = normalizePath(filePath)
    console.log('💾 [File] Writing:', normalizedPath)
    
    // Windows-specific: Ensure parent directory exists
    const dirPath = path.dirname(normalizedPath)
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true })
    }
    
    await writeFile(normalizedPath, content, 'utf-8')
    
    // If it's a markdown file, also update the database for RAG
    if (normalizedPath.endsWith('.md')) {
      const fileName = path.basename(normalizedPath)
      database.saveFile(normalizedPath, fileName, content)
      console.log('🧠 [File] Updated RAG index for:', fileName)
    }
    
    return true
  } catch (error) {
    console.error('❌ [File] Error writing file:', filePath, '→', error.message)
    throw error
  }
})

ipcMain.handle('file:createFile', async (_, dirPath: string, fileName: string) => {
  try {
    // Ensure .md extension
    if (!fileName.endsWith('.md')) {
      fileName += '.md'
    }
    
    const normalizedDirPath = normalizePath(dirPath)
    const filePath = normalizePath(join(normalizedDirPath, fileName))
    const initialContent = `# ${fileName.replace('.md', '')}\n\n*Created on ${new Date().toLocaleDateString()}*\n\n`
    
    console.log('📝 [File] Creating new file:', filePath)
    await writeFile(filePath, initialContent, 'utf-8')
    
    // Also add to database for RAG indexing
    database.saveFile(filePath, fileName, initialContent)
    console.log('🧠 [File] Added new file to RAG index:', fileName)
    
    return filePath
  } catch (error) {
    console.error('❌ [File] Error creating file:', fileName, '→', error.message)
    throw error
  }
})

ipcMain.handle('file:createDirectory', async (_, parentPath: string, dirName: string) => {
  try {
    const dirPath = join(parentPath, dirName)
    await mkdir(dirPath, { recursive: true })
    return dirPath
  } catch (error) {
    console.error('Error creating directory:', error)
    throw error
  }
})

// Database operations handlers
ipcMain.handle('db:saveFile', async (_, filePath: string, fileName: string, content: string) => {
  try {
    await database.ensureReady()
    database.saveFile(filePath, fileName, content)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error saving file to database:', error)
    throw error
  }
})

ipcMain.handle('db:getFile', async (_, filePath: string) => {
  try {
    await database.ensureReady()
    return database.getFile(filePath)
  } catch (error) {
    console.error('❌ [IPC] Error getting file from database:', error)
    throw error
  }
})

// db:searchFiles removed - FTS not needed

ipcMain.handle('db:clearAll', async () => {
  try {
    await database.ensureReady()
    database.clearAllContent()
    console.log('🗑️ [IPC] Database cleared successfully')
    return true
  } catch (error) {
    console.error('❌ [IPC] Error clearing database:', error)
    throw error
  }
})

ipcMain.handle('db:getStats', async () => {
  try {
    await database.ensureReady()
    return database.getStats()
  } catch (error) {
    console.error('❌ [IPC] Error getting database stats:', error)
    throw error
  }
})

ipcMain.handle('db:reindexAll', async () => {
  try {
    await database.ensureReady()
    console.log('🔄 [IPC] Starting reindex of all files...')
    
    // Get the current selected directory
    const selectedDirectory = database.getSetting('selectedDirectory')
    if (!selectedDirectory) {
      throw new Error('No directory selected for reindexing')
    }
    
    // Clear existing content first
    database.clearAllContent()
    console.log('🗑️ [IPC] Cleared existing content')
    
    // Recursively reindex all markdown files in the directory
    await processDirectoryRecursively(selectedDirectory)
    
    const stats = database.getStats()
    console.log('✅ [IPC] Reindexing completed:', stats)
    return stats
  } catch (error) {
    console.error('❌ [IPC] Error reindexing all files:', error)
    throw error
  }
})

// LLM IPC handlers
ipcMain.handle('llm:sendMessage', async (_, messages: Array<{role: string, content: string}>) => {
  try {
    const llamaService = LlamaService.getInstance()
    // Convert messages to proper ChatMessage format
    const chatMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
      timestamp: new Date()
    }))
    return await llamaService.sendMessage(chatMessages)
  } catch (error) {
    console.error('❌ [IPC] Error sending message to LLM:', error)
    throw error
  }
})

ipcMain.handle('llm:getStatus', async () => {
  try {
    const llamaService = LlamaService.getInstance()
    const currentModel = llamaService.getCurrentModel()
    const deviceService = DeviceDetectionService.getInstance()
    const recommendation = await deviceService.getRecommendedModel()
    
    console.log('🔧 [IPC] LLM Status Check:')
    console.log('🔧 [IPC] currentModel:', currentModel)
    console.log('🔧 [IPC] isInitialized:', currentModel !== null)
    
    return {
      isInitialized: currentModel !== null,
      currentModel,
      recommendedModel: recommendation
    }
  } catch (error) {
    console.error('❌ [IPC] Error getting LLM status:', error)
    throw error
  }
})

ipcMain.handle('llm:getDeviceSpecs', async () => {
  try {
    const deviceService = DeviceDetectionService.getInstance()
    return await deviceService.getDeviceSpecs()
  } catch (error) {
    console.error('❌ [IPC] Error getting device specs:', error)
    throw error
  }
})

ipcMain.handle('llm:switchModel', async (_, modelName: string) => {
  try {
    const llamaService = LlamaService.getInstance()
    await llamaService.switchModel(modelName)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error switching LLM model:', error)
    throw error
  }
})

ipcMain.handle('llm:getCurrentModel', async () => {
  try {
    const llamaService = LlamaService.getInstance()
    return llamaService.getCurrentModel()
  } catch (error) {
    console.error('❌ [IPC] Error getting current model:', error)
    return null
  }
})

ipcMain.handle('llm:getRecommendedModel', async () => {
  try {
    const deviceService = DeviceDetectionService.getInstance()
    return await deviceService.getRecommendedModel()
  } catch (error) {
    console.error('❌ [IPC] Error getting recommended model:', error)
    return null
  }
})

ipcMain.handle('llm:getAvailableModels', async () => {
  try {
    const llamaService = LlamaService.getInstance()
    return await llamaService.getAvailableModels()
  } catch (error) {
    console.error('❌ [IPC] Error getting available models:', error)
    return []
  }
})

// Chat IPC handlers
ipcMain.handle('chat:create', async (_, title: string) => {
  try {
    await database.ensureReady()
    return database.createChat(title)
  } catch (error) {
    console.error('❌ [IPC] Error creating chat:', error)
    throw error
  }
})

ipcMain.handle('chat:getAll', async () => {
  try {
    await database.ensureReady()
    return database.getAllChats()
  } catch (error) {
    console.error('❌ [IPC] Error getting all chats:', error)
    throw error
  }
})

ipcMain.handle('chat:getActive', async () => {
  try {
    await database.ensureReady()
    return database.getActiveChat()
  } catch (error) {
    console.error('❌ [IPC] Error getting active chat:', error)
    throw error
  }
})

ipcMain.handle('chat:setActive', async (_, chatId: number) => {
  try {
    await database.ensureReady()
    database.setActiveChat(chatId)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error setting active chat:', error)
    throw error
  }
})

ipcMain.handle('chat:addMessage', async (_, chatId: number, role: string, content: string) => {
  try {
    await database.ensureReady()
    return database.addChatMessage(chatId, role as 'user' | 'assistant' | 'system', content)
  } catch (error) {
    console.error('❌ [IPC] Error adding chat message:', error)
    throw error
  }
})

ipcMain.handle('chat:getMessages', async (_, chatId: number) => {
  try {
    await database.ensureReady()
    return database.getChatMessages(chatId)
  } catch (error) {
    console.error('❌ [IPC] Error getting chat messages:', error)
    throw error
  }
})

ipcMain.handle('chat:delete', async (_, chatId: number) => {
  try {
    await database.ensureReady()
    database.deleteChat(chatId)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error deleting chat:', error)
    throw error
  }
})

ipcMain.handle('chat:rename', async (_, chatId: number, newTitle: string) => {
  try {
    await database.ensureReady()
    database.renameChat(chatId, newTitle)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error renaming chat:', error)
    throw error
  }
})

// RAG/Content Search IPC handlers
ipcMain.handle('content:search', async (_, query: string, limit?: number) => {
  try {
    await database.ensureReady()
    console.log(`🔍 [IPC] Content search: ${query}`)
    return contentService.searchOnly(query, limit)
  } catch (error) {
    console.error('❌ [IPC] Error searching content:', error)
    throw error
  }
})

ipcMain.handle('content:searchAndAnswer', async (_, query: string, chatId?: number) => {
  try {
    await database.ensureReady()
    console.log(`🧠 [IPC] RAG search and answer: ${query}`)
    
    // Get recent conversation history if chatId provided
    let conversationHistory: Array<{role: string, content: string}> = []
    if (chatId) {
      const recentMessages = database.getChatMessages(chatId, 8) // Get last 8 messages
      conversationHistory = recentMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    }
    
    return await contentService.searchAndAnswer(query, conversationHistory)
  } catch (error) {
    console.error('❌ [IPC] Error in RAG search:', error)
    throw error
  }
})

ipcMain.handle('content:getFile', async (_, fileId: number) => {
  try {
    await database.ensureReady()
    return contentService.getFileContent(fileId)
  } catch (error) {
    console.error('❌ [IPC] Error getting file content:', error)
    throw error
  }
})

// Settings IPC handlers
ipcMain.handle('settings:get', async (_, key: string) => {
  try {
    await database.ensureReady()
    return database.getSetting(key)
  } catch (error) {
    console.error('❌ [IPC] Error getting setting:', error)
    throw error
  }
})

ipcMain.handle('settings:set', async (_, key: string, value: string) => {
  try {
    await database.ensureReady()
    database.setSetting(key, value)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error setting value:', error)
    throw error
  }
})

ipcMain.handle('settings:getAll', async () => {
  try {
    // For now, return empty object since getAllSettings doesn't exist
    return {}
  } catch (error) {
    console.error('❌ [IPC] Error getting all settings:', error)
    throw error
  }
})

// File system operations - Delete
ipcMain.handle('file:delete', async (_, filePath: string) => {
  try {
    const { unlink, rmdir } = await import('fs/promises')
    const stats = await stat(filePath)
    
    if (stats.isDirectory()) {
      // For directories, use recursive removal
      await rmdir(filePath, { recursive: true })
      console.log('🗑️ [IPC] Directory deleted:', filePath)
    } else {
      // For files
      await unlink(filePath)
      console.log('🗑️ [IPC] File deleted:', filePath)
      
      // Remove from database if it was a markdown file
      if (filePath.endsWith('.md')) {
        // TODO: Add method to remove file from database
        console.log('🗑️ [Database] Should remove from index:', filePath)
      }
    }
    
    return true
  } catch (error) {
    console.error('❌ [IPC] Error deleting file/directory:', error)
    throw error
  }
})

// File system operations - Rename/Move
ipcMain.handle('file:rename', async (_, oldPath: string, newName: string) => {
  try {
    const { rename } = await import('fs/promises')
    const parentDir = path.dirname(oldPath)
    const newPath = path.join(parentDir, newName)
    
    // Check if new path already exists
    try {
      await stat(newPath)
      throw new Error(`A file or directory with the name "${newName}" already exists`)
    } catch (checkError: any) {
      // File doesn't exist, which is what we want
      if (checkError.code !== 'ENOENT') {
        throw checkError
      }
    }
    
    // Rename the file/directory
    await rename(oldPath, newPath)
    console.log('✏️ [IPC] Renamed:', oldPath, '->', newPath)
    
    // Update database if it was a markdown file
    if (oldPath.endsWith('.md') && newPath.endsWith('.md')) {
      try {
        const content = await readFile(newPath, 'utf-8')
        const fileName = path.basename(newPath)
        
        // Remove old entry and add new one
        // TODO: Add method to update file path in database
        database.saveFile(newPath, fileName, content)
        console.log('📝 [Database] Updated index for renamed file:', fileName)
      } catch (dbError) {
        console.error('⚠️ [Database] Failed to update index after rename:', dbError)
      }
    }
    
    return { success: true, newPath }
  } catch (error) {
    console.error('❌ [IPC] Error renaming file/directory:', error)
    throw error
  }
})

// File system operations - Move to different directory
ipcMain.handle('file:move', async (_, sourcePath: string, targetDirectoryPath: string) => {
  try {
    const { rename } = await import('fs/promises')
    const fileName = path.basename(sourcePath)
    const newPath = path.join(targetDirectoryPath, fileName)
    
    // Check if source and target are the same
    if (sourcePath === newPath) {
      return { success: true, newPath: sourcePath, message: 'File is already in target location' }
    }
    
    // Check if new path already exists
    try {
      await stat(newPath)
      throw new Error(`A file or directory with the name "${fileName}" already exists in the target directory`)
    } catch (checkError: any) {
      // File doesn't exist, which is what we want
      if (checkError.code !== 'ENOENT') {
        throw checkError
      }
    }
    
    // Move the file/directory
    await rename(sourcePath, newPath)
    console.log('🚚 [IPC] Moved:', sourcePath, '->', newPath)
    
    // Update database if it was a markdown file
    if (sourcePath.endsWith('.md') && newPath.endsWith('.md')) {
      try {
        const content = await readFile(newPath, 'utf-8')
        const fileName = path.basename(newPath)
        
        // Remove old entry and add new one
        // TODO: Add method to update file path in database
        database.saveFile(newPath, fileName, content)
        console.log('📝 [Database] Updated index for moved file:', fileName)
      } catch (dbError) {
        console.error('⚠️ [Database] Failed to update index after move:', dbError)
      }
    }
    
    return { success: true, newPath }
  } catch (error) {
    console.error('❌ [IPC] Error moving file/directory:', error)
    throw error
  }
})

// System operations
ipcMain.handle('system:openExternal', async (_, url: string) => {
  try {
    // Windows-specific: Handle different URL schemes
    let processedUrl = url
    if (process.platform === 'win32' && url.startsWith('file://')) {
      // Windows file URLs need special handling
      processedUrl = url.replace(/^file:\/\//, '')
    }
    
    await shell.openExternal(processedUrl)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error opening external URL:', error)
    throw error
  }
}) 