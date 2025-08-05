import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron'
import { join } from 'path'
import { isDev } from './utils/is-dev'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

const createWindow = (): void => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js'),
      webSecurity: !isDev
    }
  })

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    
    if (isDev) {
      mainWindow?.webContents.openDevTools()
    }
  })

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  // Initialize database
  try {
    database.initialize()
  } catch (error) {
    console.error('❌ [Main] Failed to initialize database:', error)
    // Continue without database for now - could show error dialog
  }

  createWindow()

  // Initialize License service (critical for app operation)
  const licenseService = LicenseService.getInstance()
  licenseService.setMainWindow(mainWindow!)
  
  try {
    await licenseService.initialize()
    
    // Perform startup license check
    const isLicensed = await licenseService.performStartupCheck()
    if (!isLicensed) {
      console.log('⚠️ [Main] App startup without valid license - functionality limited')
    }
  } catch (error) {
    console.error('❌ [Main] Failed to initialize license service:', error)
    // Continue but show license dialog
  }

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
      // File menu, Edit menu, etc. will be added here
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } else {
    // Windows/Linux - hide menu bar for VS Code-like experience
    Menu.setApplicationMenu(null)
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

// Clean up database and license service when app is about to quit
app.on('before-quit', () => {
  database.close()
  
  // Cleanup license service
  try {
    const licenseService = LicenseService.getInstance()
    licenseService.cleanup()
  } catch (error) {
    console.error('❌ [Main] License service cleanup error:', error)
  }
})

// Security: Prevent new window creation (handled by setWindowOpenHandler above)

  // File System Operations
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
import path from 'path'

// Database
import { database } from './database'

// LLM Services
import { LlamaService } from './services/llamaService'
import { DeviceDetectionService } from './services/deviceDetection'
import { contentService } from './services/contentService'

// License Service
import { LicenseService } from './services/licenseService'

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
      title: 'Select Journal Directory'
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

ipcMain.handle('file:readDirectory', async (_, dirPath: string) => {
  try {
    console.log('📁 Reading directory:', dirPath)
    
    // Check if this is a directory switch by getting current saved directory
    let shouldClearDatabase = false
    try {
      const currentSavedDirectory = await database.getSetting('selectedDirectory')
      if (currentSavedDirectory && currentSavedDirectory !== dirPath) {
        console.log('🔄 [Directory Switch] From:', currentSavedDirectory, 'To:', dirPath)
        shouldClearDatabase = true
      }
    } catch (error) {
      console.log('📁 [First Time] No previous directory found, proceeding with indexing')
    }
    
    // Clear database if switching directories
    if (shouldClearDatabase) {
      database.clearAllContent()
    }
    
    // Save the new directory
    database.setSetting('selectedDirectory', dirPath)
    
    const entries = await readdir(dirPath, { withFileTypes: true })
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
      
      const fullPath = join(dirPath, entry.name)
      const stats = await stat(fullPath)
      
      const fileItem = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        modified: stats.mtime.toISOString(), // FIX: Convert Date to ISO string
        size: stats.size
      }
      
      // Process markdown files for RAG (read content and chunk it)
      if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          console.log('📖 Reading content for RAG processing:', entry.name)
          const content = await readFile(fullPath, 'utf-8')
          
          // Save to database with RAG chunking and FTS indexing
          database.saveFile(fullPath, entry.name, content)
          console.log('🧠 RAG processed:', entry.name)
        } catch (contentError) {
          console.error('⚠️ Failed to process content for', entry.name, ':', contentError)
          // Continue with metadata-only entry
        }
      }
      
      // Recursively process directories to find markdown files
      if (entry.isDirectory()) {
        try {
          console.log('📂 Recursively processing directory:', entry.name)
          await processDirectoryRecursively(fullPath)
        } catch (dirError) {
          console.error('⚠️ Failed to process directory', entry.name, ':', dirError)
        }
      }
      
      console.log('✅ Added:', fileItem.name, fileItem.type)
      files.push(fileItem)
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
    const content = await readFile(filePath, 'utf-8')
    return content
  } catch (error) {
    console.error('Error reading file:', error)
    throw error
  }
})

ipcMain.handle('file:writeFile', async (_, filePath: string, content: string) => {
  try {
    await writeFile(filePath, content, 'utf-8')
    
    // If it's a markdown file, also update the database for RAG
    if (filePath.endsWith('.md')) {
      const fileName = path.basename(filePath)
      database.saveFile(filePath, fileName, content)
      console.log('🧠 Updated RAG index for:', fileName)
    }
    
    return true
  } catch (error) {
    console.error('Error writing file:', error)
    throw error
  }
})

ipcMain.handle('file:createFile', async (_, dirPath: string, fileName: string) => {
  try {
    // Ensure .md extension
    if (!fileName.endsWith('.md')) {
      fileName += '.md'
    }
    
    const filePath = join(dirPath, fileName)
    const initialContent = `# ${fileName.replace('.md', '')}\n\n*Created on ${new Date().toLocaleDateString()}*\n\n`
    
    await writeFile(filePath, initialContent, 'utf-8')
    return filePath
  } catch (error) {
    console.error('Error creating file:', error)
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
    database.saveFile(filePath, fileName, content)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error saving file to database:', error)
    throw error
  }
})

ipcMain.handle('db:getFile', async (_, filePath: string) => {
  try {
    return database.getFile(filePath)
  } catch (error) {
    console.error('❌ [IPC] Error getting file from database:', error)
    throw error
  }
})

ipcMain.handle('db:searchFiles', async (_, query: string) => {
  try {
    return database.searchFiles(query)
  } catch (error) {
    console.error('❌ [IPC] Error searching files in database:', error)
    throw error
  }
})

ipcMain.handle('db:clearAll', async () => {
  try {
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
    return database.getStats()
  } catch (error) {
    console.error('❌ [IPC] Error getting database stats:', error)
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

// Chat IPC handlers
ipcMain.handle('chat:create', async (_, title: string) => {
  try {
    return database.createChat(title)
  } catch (error) {
    console.error('❌ [IPC] Error creating chat:', error)
    throw error
  }
})

ipcMain.handle('chat:getAll', async () => {
  try {
    return database.getAllChats()
  } catch (error) {
    console.error('❌ [IPC] Error getting all chats:', error)
    throw error
  }
})

ipcMain.handle('chat:getActive', async () => {
  try {
    return database.getActiveChat()
  } catch (error) {
    console.error('❌ [IPC] Error getting active chat:', error)
    throw error
  }
})

ipcMain.handle('chat:setActive', async (_, chatId: number) => {
  try {
    database.setActiveChat(chatId)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error setting active chat:', error)
    throw error
  }
})

ipcMain.handle('chat:addMessage', async (_, chatId: number, role: string, content: string) => {
  try {
    return database.addChatMessage(chatId, role as 'user' | 'assistant' | 'system', content)
  } catch (error) {
    console.error('❌ [IPC] Error adding chat message:', error)
    throw error
  }
})

ipcMain.handle('chat:getMessages', async (_, chatId: number) => {
  try {
    return database.getChatMessages(chatId)
  } catch (error) {
    console.error('❌ [IPC] Error getting chat messages:', error)
    throw error
  }
})

ipcMain.handle('chat:delete', async (_, chatId: number) => {
  try {
    database.deleteChat(chatId)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error deleting chat:', error)
    throw error
  }
})

ipcMain.handle('chat:rename', async (_, chatId: number, newTitle: string) => {
  try {
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
    console.log(`🔍 [IPC] Content search: ${query}`)
    return contentService.searchOnly(query, limit)
  } catch (error) {
    console.error('❌ [IPC] Error searching content:', error)
    throw error
  }
})

ipcMain.handle('content:searchAndAnswer', async (_, query: string, chatId?: number) => {
  try {
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
    return contentService.getFileContent(fileId)
  } catch (error) {
    console.error('❌ [IPC] Error getting file content:', error)
    throw error
  }
})

// Settings IPC handlers
ipcMain.handle('settings:get', async (_, key: string) => {
  try {
    return database.getSetting(key)
  } catch (error) {
    console.error('❌ [IPC] Error getting setting:', error)
    throw error
  }
})

ipcMain.handle('settings:set', async (_, key: string, value: string) => {
  try {
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

// ========================
// LICENSE IPC HANDLERS
// ========================

// Validate license key
ipcMain.handle('license:validate', async (_, licenseKey: string) => {
  try {
    const licenseService = LicenseService.getInstance()
    return await licenseService.validateLicense(licenseKey)
  } catch (error) {
    console.error('❌ [IPC] Error validating license:', error)
    throw error
  }
})

// Get current license state
ipcMain.handle('license:getState', async () => {
  try {
    const licenseService = LicenseService.getInstance()
    return await licenseService.getCurrentLicenseState()
  } catch (error) {
    console.error('❌ [IPC] Error getting license state:', error)
    throw error
  }
})

// Check if app is licensed
ipcMain.handle('license:isLicensed', async () => {
  try {
    const licenseService = LicenseService.getInstance()
    return await licenseService.isAppLicensed()
  } catch (error) {
    console.error('❌ [IPC] Error checking license status:', error)
    return false
  }
})

// Get payment links
ipcMain.handle('license:getPaymentLinks', async () => {
  try {
    const licenseService = LicenseService.getInstance()
    return licenseService.getPaymentLinks()
  } catch (error) {
    console.error('❌ [IPC] Error getting payment links:', error)
    throw error
  }
})

// Open payment link
ipcMain.handle('license:openPaymentLink', async (_, linkType: 'monthly' | 'annual' | 'lifetime' | 'portal') => {
  try {
    const licenseService = LicenseService.getInstance()
    await licenseService.openPaymentLink(linkType)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error opening payment link:', error)
    throw error
  }
})

// Clear license (for testing)
ipcMain.handle('license:clear', async () => {
  try {
    const licenseService = LicenseService.getInstance()
    await licenseService.clearLicense()
    return true
  } catch (error) {
    console.error('❌ [IPC] Error clearing license:', error)
    throw error
  }
})

// Get license statistics
ipcMain.handle('license:getStats', async () => {
  try {
    const licenseService = LicenseService.getInstance()
    return await licenseService.getLicenseStats()
  } catch (error) {
    console.error('❌ [IPC] Error getting license stats:', error)
    throw error
  }
}) 