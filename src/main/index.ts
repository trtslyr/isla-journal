// Suppress Electron error dialogs for Wine/Windows compatibility issues
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

// Override console methods to prevent Wine stdio crashes
const originalConsole = { ...console }
try {
  // Test if console works in Wine
  console.log('')
} catch (e) {
  // Console is broken in Wine - create safe wrappers
  console.log = (...args) => { try { originalConsole.log(...args) } catch {} }
  console.error = (...args) => { try { originalConsole.error(...args) } catch {} }
  console.warn = (...args) => { try { originalConsole.warn(...args) } catch {} }
}

import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron'
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path, { join, normalize, resolve } from 'path'
import os from 'os'
// Fixed isDev detection for packaged apps
const isDev = process.env.NODE_ENV === 'development' && !app.isPackaged
import { database } from './database'
import { LlamaService } from './services/llamaService'
import { contentService } from './services/contentService'
import { EmbeddingsService } from './services/embeddingsService'
import { WatcherService } from './services/watcherService'

// Conditionally import DeviceDetectionService to prevent Wine crashes
let DeviceDetectionService: any
try {
  const deviceModule = require('./services/deviceDetection')
  DeviceDetectionService = deviceModule.DeviceDetectionService
} catch (error) {
  console.log('🍷 [Main] DeviceDetectionService unavailable in Wine environment - using fallback')
  // Create a mock DeviceDetectionService for Wine compatibility
  DeviceDetectionService = class {
    static getInstance() {
      return {
        getRecommendedModel: async () => ({
          modelName: 'llama3.2:1b',
          displayName: 'Llama 3.2 1B (Fallback)',
          minMemory: 2,
          description: 'Lightweight model for Wine/Windows compatibility',
          downloadSize: '1.3GB',
          compatiblePlatforms: ['windows', 'macos', 'linux'],
          compatibleArchitectures: ['x64', 'arm64'],
          isOptimized: false
        })
      }
    }
  }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit()
}

// Dialog override will be set up after app is ready

// Disable Electron's default error dialogs for known Wine/Windows issues
process.on('uncaughtException', (error) => {
  console.error('🚨 [Main] Uncaught Exception:', error)
  const errorMsg = error.message || String(error)
  
  // Don't crash for known Wine/Windows compatibility issues
  if (errorMsg.includes('EBADF') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('open EBADF') || errorMsg.includes('Socket')) {
    console.log('🍷 [Main] Wine/Network error caught - continuing without crashing')
    return // Don't crash the app
  }
  
  // For other critical errors, still crash
  console.error('💥 [Main] Critical error - app will exit')
  process.exit(1)
})

// Prevent Electron from showing error dialogs for network issues
app.on('web-contents-created', (event, contents) => {
  contents.on('crashed', (event, killed) => {
    console.log('🚨 [Main] Renderer crashed, killed:', killed)
  })
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 [Main] Unhandled Rejection at:', promise, 'reason:', reason)
  const reasonMsg = reason instanceof Error ? reason.message : String(reason)
  
  // Don't crash for known Wine/Windows compatibility issues
  if (reasonMsg.includes('EBADF') || reasonMsg.includes('ECONNREFUSED') || reasonMsg.includes('ENOTFOUND')) {
    console.log('🍷 [Main] Wine/Network rejection caught - continuing without crashing')
    return // Don't crash the app
  }
})

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
      // Fixed platform and environment-specific settings
      ...(isDev ? {
        webSecurity: true,
        allowRunningInsecureContent: false
      } : {
        webSecurity: true,
        allowRunningInsecureContent: false,
        enableRemoteModule: false,
        nodeIntegrationInWorker: false
      })
    }
  })

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools() // Commented out for cleaner dev experience
  } else {
    // Fixed cross-platform path handling for packaged apps
    let rendererPath: string
    
    // BULLETPROOF cross-platform path resolution
    const possiblePaths = [
      // Primary: Standard ASAR path
      join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
      // Fallback 1: Alternative ASAR structure
      join(app.getAppPath(), 'renderer', 'index.html'),
      // Fallback 2: Development path
      join(__dirname, '../renderer/index.html'),
      // Fallback 3: Process resources path (Windows specific)
      join(process.resourcesPath || '', 'app', 'dist', 'renderer', 'index.html'),
      // Fallback 4: App directory relative
      join(path.dirname(app.getPath('exe')), 'resources', 'app', 'dist', 'renderer', 'index.html'),
      // Fallback 5: Direct resources path
      join(path.dirname(app.getPath('exe')), 'resources', 'app.asar', 'dist', 'renderer', 'index.html')
    ]
    
    // Find the first existing path
    rendererPath = possiblePaths.find(p => {
      const exists = require('fs').existsSync(p)
      console.log(`🔍 [Main] Checking path: ${p} - ${exists ? '✅ EXISTS' : '❌ NOT FOUND'}`)
      return exists
    }) || possiblePaths[0] // Fallback to first path if none found
    
    console.log(`🎯 [Main] Selected renderer path: ${rendererPath}`)
    
    console.log('🌐 [Main] Platform:', process.platform)
    console.log('🌐 [Main] __dirname:', __dirname)
    console.log('🌐 [Main] App packaged:', app.isPackaged)
    console.log('🌐 [Main] Loading renderer from:', rendererPath)
    console.log('🌐 [Main] Renderer exists:', require('fs').existsSync(rendererPath))
    console.log('🌐 [Main] App path:', app.getAppPath())
    
    // Add error handling for renderer loading
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('❌ [Main] Failed to load:', validatedURL, 'Error:', errorDescription)
      console.error('❌ [Main] Error code:', errorCode)
      
      // Windows-specific file protocol handling
      if (process.platform === 'win32') {
        console.log('🪟 [Main] Windows detected - trying file:// protocol')
        const windowsPath = rendererPath.replace(/\\/g, '/')
        const fileUrl = `file:///${windowsPath}`
        console.log('🪟 [Main] Trying Windows file URL:', fileUrl)
        mainWindow.loadURL(fileUrl).catch(urlError => {
          console.error('❌ [Main] Windows file URL also failed:', urlError)
          tryAlternativePaths()
        })
        return
      }
      
      tryAlternativePaths()
      
      function tryAlternativePaths() {
        // Try alternative paths if first attempt fails
        const alternativePaths = [
          join(__dirname, '../renderer/index.html'),
          join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
          join(process.resourcesPath, 'app', 'dist', 'renderer', 'index.html')
        ]
        
        for (const altPath of alternativePaths) {
          console.log('🔄 [Main] Trying alternative path:', altPath)
          console.log('🔄 [Main] Alternative exists:', require('fs').existsSync(altPath))
          if (require('fs').existsSync(altPath)) {
            console.log('✅ [Main] Found renderer at:', altPath)
            mainWindow.loadFile(altPath)
            return
          }
        }
        
        console.error('❌ [Main] No valid renderer path found')
      }
    })
    
    mainWindow.webContents.on('did-start-loading', () => {
      console.log('🔄 [Main] Renderer started loading...')
    })
    
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('✅ [Main] Renderer loaded successfully')
    })
    
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('❌ [Main] Renderer failed to load:', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      })
    })
    
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`🔍 [Renderer] Console ${level}:`, message, `(${sourceId}:${line})`)
    })
    
    mainWindow.webContents.on('dom-ready', () => {
      console.log('🎯 [Main] DOM is ready')
    })
    
    // BULLETPROOF Windows loading with multiple strategies
    console.log('🚀 [Main] Attempting to load renderer...')
    
    async function loadRendererWithFallbacks() {
      const strategies = [
        // Strategy 1: Standard loadFile
        () => {
          console.log('🔄 [Main] Strategy 1: Standard loadFile')
          return mainWindow.loadFile(rendererPath)
        },
        // Strategy 2: File URL protocol
        () => {
          const fileUrl = `file://${rendererPath.replace(/\\/g, '/')}`
          console.log('🔄 [Main] Strategy 2: File URL protocol:', fileUrl)
          return mainWindow.loadURL(fileUrl)
        },
        // Strategy 3: Windows file URL with triple slash
        () => {
          const winUrl = `file:///${rendererPath.replace(/\\/g, '/').replace(/^\//, '')}`
          console.log('🔄 [Main] Strategy 3: Windows file URL:', winUrl)
          return mainWindow.loadURL(winUrl)
        },
        // Strategy 4: Data URL fallback (emergency)
        () => {
          console.log('🔄 [Main] Strategy 4: Emergency HTML fallback')
          const emergencyHtml = `
            <!DOCTYPE html>
            <html>
            <head><title>Isla Journal - Loading...</title></head>
            <body>
              <div style="padding: 20px; font-family: Arial;">
                <h2>🔄 Loading Isla Journal...</h2>
                <p>Please wait while the application loads.</p>
                <p><em>If this persists, please restart the application.</em></p>
              </div>
            </body>
            </html>
          `
          return mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(emergencyHtml)}`)
        }
      ]
      
      for (let i = 0; i < strategies.length; i++) {
        try {
          await strategies[i]()
          console.log(`✅ [Main] Strategy ${i + 1} succeeded!`)
          return
        } catch (error) {
          console.error(`❌ [Main] Strategy ${i + 1} failed:`, error)
          if (i === strategies.length - 1) {
            console.error('💥 [Main] All loading strategies failed!')
          }
        }
      }
    }
    
    // Execute bulletproof loading
    loadRendererWithFallbacks().catch(error => {
      console.error('💥 [Main] Critical renderer loading failure:', error)
    })
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    
    if (isDev || process.env.DEBUG === 'true') {
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
  try {
    // BULLETPROOF Windows diagnostics and error handling
    console.log('🚀 [Main] ========== ISLA JOURNAL WINDOWS INITIALIZATION ==========')
    console.log(`🪟 [Main] Platform: ${process.platform}`)
    console.log(`🪟 [Main] Architecture: ${process.arch}`)
    console.log(`🪟 [Main] Node version: ${process.version}`)
    console.log(`🪟 [Main] Electron version: ${process.versions.electron}`)
    console.log(`🪟 [Main] App packaged: ${app.isPackaged}`)
    console.log(`🪟 [Main] App path: ${app.getAppPath()}`)
    console.log(`🪟 [Main] Exe path: ${app.getPath('exe')}`)
    console.log(`🪟 [Main] Resources path: ${process.resourcesPath || 'N/A'}`)
    console.log(`🪟 [Main] Working directory: ${process.cwd()}`)
    console.log(`🪟 [Main] __dirname: ${__dirname}`)
    console.log('🚀 [Main] ================================================================')
    
    // Disable error dialogs but keep comprehensive logging
    const originalShowErrorBox = dialog?.showErrorBox
    if (originalShowErrorBox) {
      dialog.showErrorBox = (title: string, content: string) => {
        console.error(`🚫 [Main] ERROR DIALOG SUPPRESSED:`)
        console.error(`🚫 [Main] Title: ${title}`)
        console.error(`🚫 [Main] Content: ${content}`)
        console.error(`🚫 [Main] Stack trace:`, new Error().stack)
        // Don't show the dialog - just log comprehensively
      }
    }
    
    // Log cross-platform information
    logPlatformInfo()
    
    // Setup production file logging with rotation and DEBUG gating
    try {
      if (!isDev) {
        const DEBUG_LOG = process.env.DEBUG === 'true'
        const logsDir = require('path').join(app.getPath('userData'), 'logs')
        const fs = require('fs')
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true })
        }
        const logFile = require('path').join(logsDir, 'main.log')
        if (fs.existsSync(logFile)) {
          const stats = fs.statSync(logFile)
          if (stats.size > 5 * 1024 * 1024) {
            const rotated = logFile + '.1'
            if (fs.existsSync(rotated)) fs.unlinkSync(rotated)
            fs.renameSync(logFile, rotated)
          }
        }
        const stream = fs.createWriteStream(logFile, { flags: 'a' })
        const original = { ...console }
        const write = (level: string, args: any[]) => {
          const msg = args.map((a: any) => {
            try { return typeof a === 'string' ? a : JSON.stringify(a) } catch { return String(a) }
          }).join(' ')
          stream.write(`[${new Date().toISOString()}] [${level}] ${msg}\n`)
        }
        console.log = (...args: any[]) => { if (DEBUG_LOG) original.log(...args); write('INFO', args) }
        console.warn = (...args: any[]) => { if (DEBUG_LOG) original.warn(...args); write('WARN', args) }
        console.error = (...args: any[]) => { original.error(...args); write('ERROR', args) }
      }
    } catch (e) {
      console.warn('⚠️ Failed to setup file logging:', e)
    }
    
    // BULLETPROOF database initialization with comprehensive error handling
    console.log('🗄️ [Main] ========== DATABASE INITIALIZATION ==========')
    let databaseReady = false
    try {
      console.log('🗄️ [Main] Attempting database initialization...')
      await database.initialize()
      databaseReady = true
      console.log('✅ [Main] Database initialization completed successfully')
      console.log('🗄️ [Main] Database is READY and FUNCTIONAL')
    } catch (error) {
      console.error('❌ [Main] Database initialization failed:', error)
      
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error('🔍 [Main] Error details:', {
        message: errorMsg,
        stack: error instanceof Error ? error.stack : 'No stack trace',
        name: error instanceof Error ? error.name : 'Unknown error'
      })
      
      if (errorMsg.includes('Bad EXE format') || errorMsg.includes('better_sqlite3.node')) {
        console.error('🪟 [Main] CRITICAL: Windows native module issue detected!')
        console.error('🪟 [Main] This indicates better-sqlite3 was not compiled for Windows')
        console.error('🪟 [Main] App will continue but database features will be unavailable')
      } else if (errorMsg.includes('EBADF') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('open EBADF')) {
        console.error('🍷 [Main] Network/Socket error during database init')
        console.error('🍷 [Main] This is likely a Wine/compatibility layer issue')
        console.error('🍷 [Main] App will continue with limited database functionality')
      } else {
        console.error('⚠️ [Main] Unexpected database error - investigating...')
        console.error('⚠️ [Main] App will continue with limited functionality')
      }
    }
    console.log(`🗄️ [Main] Database status: ${databaseReady ? '✅ READY' : '❌ UNAVAILABLE'}`)
    console.log('🗄️ [Main] ===============================================')

  createWindow()
  // Start watcher if a directory is already saved
  try {
    const saved = database.getSetting('selectedDirectory')
    if (saved) {
      await WatcherService.getInstance().start(saved)
      console.log('👀 [Watcher] Started on saved directory', saved)
    }
  } catch {}

  // BULLETPROOF LLM service initialization
  console.log('🤖 [Main] ========== LLM SERVICE INITIALIZATION ==========')
  let llamaReady = false
  try {
    const llamaService = LlamaService.getInstance()
    llamaService.setMainWindow(mainWindow!)
    console.log('🤖 [Main] Attempting LLM service initialization...')
    
    await llamaService.initialize()
    llamaReady = true
    console.log('✅ [Main] LLM service initialization completed successfully')
    console.log('🤖 [Main] AI features are READY and FUNCTIONAL')
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('❌ [Main] LLM service initialization failed:', errorMsg)
    console.error('🔍 [Main] LLM Error details:', {
      message: errorMsg,
      stack: error instanceof Error ? error.stack : 'No stack trace',
      name: error instanceof Error ? error.name : 'Unknown error'
    })
    
    if (errorMsg.includes('EBADF') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND')) {
      console.error('🌐 [Main] Network connectivity issue - Ollama service unavailable')
      console.error('🌐 [Main] This is expected if Ollama is not installed or running')
      console.error('🌐 [Main] App will function normally without AI features')
    } else if (errorMsg.includes('timeout')) {
      console.error('⏱️ [Main] LLM service timeout - Ollama may be starting up')
      console.error('⏱️ [Main] App will function normally without AI features')
    } else {
      console.error('⚠️ [Main] Unexpected LLM service error')
      console.error('⚠️ [Main] App will function normally without AI features')
    }
  }
  console.log(`🤖 [Main] LLM service status: ${llamaReady ? '✅ READY' : '❌ UNAVAILABLE'}`)
  console.log('🤖 [Main] ===============================================')

  // Start embeddings service (Phase 3 groundwork)
  try {
    const emb = EmbeddingsService.getInstance()
    if (mainWindow) emb.setMainWindow(mainWindow)
    await emb.start(1)
    console.log('✅ [Main] Embeddings service started')
  } catch (e) {
    console.warn('⚠️ [Main] Embeddings service failed to start:', e)
  }

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
  
    // BULLETPROOF initialization summary
    console.log('🎯 [Main] ========== INITIALIZATION COMPLETE ==========')
    console.log(`✅ [Main] Platform: ${process.platform}`)
    console.log(`✅ [Main] Database: ${databaseReady ? 'READY' : 'UNAVAILABLE'}`)
    console.log(`✅ [Main] LLM Service: ${llamaReady ? 'READY' : 'UNAVAILABLE'}`)
    console.log(`✅ [Main] Main Window: CREATED`)
    console.log('🎯 [Main] Isla Journal is READY FOR USE!')
    console.log('🎯 [Main] ================================================')
    
  } catch (error) {
    // BULLETPROOF error handling for critical initialization failures
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('🚨 [Main] ========== CRITICAL INITIALIZATION ERROR ==========')
    console.error('🚨 [Main] App initialization failed:', errorMsg)
    console.error('🚨 [Main] Error details:', {
      message: errorMsg,
      stack: error instanceof Error ? error.stack : 'No stack trace',
      name: error instanceof Error ? error.name : 'Unknown error',
      platform: process.platform,
      arch: process.arch
    })
    
    if (errorMsg.includes('EBADF') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('open EBADF')) {
      console.error('🍷 [Main] Wine/Network error during initialization')
      console.error('🍷 [Main] This is likely a compatibility layer issue')
      console.error('🍷 [Main] Attempting to continue with basic functionality...')
    } else {
      console.error('💥 [Main] Critical system error during initialization')
      console.error('💥 [Main] App may not function properly')
    }
    
    // Emergency window creation
    console.log('🆘 [Main] Attempting emergency window creation...')
    try {
      createWindow()
      console.log('✅ [Main] Emergency window created successfully')
    } catch (windowError) {
      console.error('❌ [Main] Emergency window creation failed:', windowError)
      console.error('💥 [Main] Application cannot continue - exiting...')
      app.quit()
    }
  }
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
      // Start watcher on the selected directory
      try {
        await WatcherService.getInstance().start(normalizedDirPath)
        console.log('👀 [Watcher] Started on', normalizedDirPath)
      } catch (e) {
        console.warn('⚠️ [Watcher] Failed to start:', e)
      }
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

ipcMain.handle('file:createFile', async (_, dirPath: string, fileName: string, content?: string) => {
  try {
    // Ensure .md extension
    if (!fileName.endsWith('.md')) {
      fileName += '.md'
    }
    
    const normalizedDirPath = normalizePath(dirPath)
    const filePath = normalizePath(join(normalizedDirPath, fileName))
    const initialContent = typeof content === 'string' ? content : `# ${fileName.replace('.md', '')}\n\n*Created on ${new Date().toLocaleDateString()}*\n\n`
    
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

// Embeddings IPC (Phase 3 groundwork)
ipcMain.handle('embeddings:listPending', async (_, limit: number = 100) => {
  try {
    await database.ensureReady()
    return (database as any).listChunksNeedingEmbeddings ? (database as any).listChunksNeedingEmbeddings(limit) : []
  } catch (error) {
    console.error('❌ [IPC] Error listing pending embeddings:', error)
    return []
  }
})

ipcMain.handle('embeddings:upsert', async (_, chunkId: number, vector: number[], dim: number, model: string) => {
  try {
    await database.ensureReady()
    if ((database as any).upsertEmbedding) (database as any).upsertEmbedding(chunkId, vector, dim, model)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error upserting embedding:', error)
    return false
  }
})

ipcMain.handle('embeddings:getStats', async () => {
  try {
    await database.ensureReady()
    return (database as any).getEmbeddingStats ? (database as any).getEmbeddingStats() : { total: 0 }
  } catch (error) {
    console.error('❌ [IPC] Error getting embedding stats:', error)
    return { total: 0 }
  }
})

ipcMain.handle('embeddings:setModel', async (_, model: string) => {
  try {
    const emb = EmbeddingsService.getInstance()
    emb.setModel(model)
    return true
  } catch (e) {
    return false
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
  if (databaseDisabled) {
    console.log('🔄 [IPC] Database disabled - returning empty chat list')
    return []
  }
  
  try {
    await database.ensureReady()
    return database.getAllChats()
  } catch (error) {
    console.error('❌ [IPC] Error getting all chats:', error)
    // Disable database for all future calls
    databaseDisabled = true
    console.log('🔄 [IPC] Disabling database and returning empty chat list (database unavailable)')
    return []
  }
})

ipcMain.handle('chat:getActive', async () => {
  if (databaseDisabled) {
    console.log('🔄 [IPC] Database disabled - returning null for active chat')
    return null
  }
  
  try {
    await database.ensureReady()
    return database.getActiveChat()
  } catch (error) {
    console.error('❌ [IPC] Error getting active chat:', error)
    // Disable database for all future calls
    databaseDisabled = true
    console.log('🔄 [IPC] Disabling database and returning null for active chat (database unavailable)')
    return null
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

// Implement chat:clearMessages to align with preload API
ipcMain.handle('chat:clearMessages', async (_, chatId: number) => {
  try {
    await database.ensureReady()
    database.clearChatMessages(chatId)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error clearing chat messages:', error)
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

// Global flag to disable database when we know it will fail
let databaseDisabled = false

// Settings IPC handlers
ipcMain.handle('settings:get', async (_, key: string) => {
  if (databaseDisabled) {
    console.log('🔄 [IPC] Database disabled - returning null for setting:', key)
    return null
  }
  
  try {
    await database.ensureReady()
    return database.getSetting(key)
  } catch (error) {
    console.error('❌ [IPC] Error getting setting:', error)
    // Disable database for all future calls to prevent infinite loop
    databaseDisabled = true
    console.log('🔄 [IPC] Disabling database and returning null for setting:', key, '(database unavailable)')
    return null
  }
})

ipcMain.handle('settings:set', async (_, key: string, value: string) => {
  if (databaseDisabled) {
    console.log('🔄 [IPC] Database disabled - cannot set setting:', key)
    return false
  }
  
  try {
    await database.ensureReady()
    database.setSetting(key, value)
    return true
  } catch (error) {
    console.error('❌ [IPC] Error setting value:', error)
    // Disable database for all future calls
    databaseDisabled = true
    console.log('🔄 [IPC] Disabling database and failing to set setting:', key, '(database unavailable)')
    return false
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
        try {
          await database.ensureReady()
          database.deleteFileByPath(filePath)
          console.log('🗑️ [Database] Removed from index:', filePath)
        } catch (dbErr) {
          console.error('⚠️ [Database] Failed to remove from index:', dbErr)
        }
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
        const fileName = path.basename(newPath)
        await database.ensureReady()
        database.updateFilePath(oldPath, newPath, fileName)
        console.log('📝 [Database] Updated file path in index for renamed file:', fileName)
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
        const fileName = path.basename(newPath)
        await database.ensureReady()
        database.updateFilePath(sourcePath, newPath, fileName)
        console.log('📝 [Database] Updated file path in index for moved file:', fileName)
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

// Explicit watcher start IPC
ipcMain.handle('watcher:start', async (_, rootDir: string) => {
  try {
    await WatcherService.getInstance().start(rootDir)
    return true
  } catch (e) {
    return false
  }
}) 