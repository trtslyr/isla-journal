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
import chokidar from 'chokidar'

// Global list of indexable text/code extensions for FTS-only indexing
const INDEXABLE_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.yml', '.yaml',
  '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h', '.rb', '.php', '.sh', '.toml'
])
const hasIndexableExt = (p: string): boolean => {
  const lower = p.toLowerCase()
  const i = lower.lastIndexOf('.')
  if (i < 0) return false
  const ext = lower.slice(i)
  return INDEXABLE_EXTENSIONS.has(ext)
}

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

// Simple file logger setup for production
async function setupFileLogging(): Promise<void> {
  if (isDev) return

  const debugEnabled = !!process.env.DEBUG
  try {
    const { mkdir, appendFile, stat: fsStat, rename } = await import('fs/promises')
    const { join } = await import('path')

    const logsDir = join(app.getPath('userData'), 'logs')
    await mkdir(logsDir, { recursive: true })
    const logFilePath = join(logsDir, 'isla.log')

    const writeLine = async (level: 'log' | 'warn' | 'error', msg: any[]) => {
      try {
        const timestamp = new Date().toISOString()
        const text = msg.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(' ')
        const line = `${timestamp} [${level.toUpperCase()}] ${text}\n`

        // Rotate if > 5MB
        try {
          const st = await fsStat(logFilePath).catch(() => null)
          if (st && st.size > 5 * 1024 * 1024) {
            const rotated = join(logsDir, 'isla.log.1')
            await rename(logFilePath, rotated).catch(() => {})
          }
        } catch {}

        await appendFile(logFilePath, line)
      } catch {}
    }

    const originalLog = console.log
    const originalWarn = console.warn
    const originalError = console.error

    console.log = (...args: any[]) => {
      if (debugEnabled) writeLine('log', args)
      try { originalLog.apply(console, args) } catch {}
    }
    console.warn = (...args: any[]) => {
      writeLine('warn', args)
      try { originalWarn.apply(console, args) } catch {}
    }
    console.error = (...args: any[]) => {
      writeLine('error', args)
      try { originalError.apply(console, args) } catch {}
    }
  } catch {
    // Best-effort only
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

// Embeddings (re)build
ipcMain.handle('embeddings:rebuildAll', async (_, modelOverride?: string) => {
  try {
    await database.ensureReady()
    const llama = require('./services/llamaService').LlamaService.getInstance()
    await llama.initialize()
    const model = modelOverride || llama.getCurrentModel() || 'llama3.1:latest'
    const batchSize = 64
    let batch: Array<{ id: number; file_id: number; chunk_text: string }>
    let total = 0
    let embedded = 0
    const stats = database.getEmbeddingsStats(model)
    total = stats.chunkCount
    mainWindow?.webContents.send('embeddings:progress', { total, embedded: stats.embeddedCount, model, status: 'starting' })
    while ((batch = database.getChunksNeedingEmbeddings(model, batchSize)).length > 0) {
      const texts = batch.map(b => b.chunk_text)
      const vectors = await llama.embedTexts(texts, model)
      for (let i = 0; i < batch.length; i++) {
        database.upsertEmbedding(batch[i].id, vectors[i] || [], model)
      }
      embedded += batch.length
      const nowStats = database.getEmbeddingsStats(model)
      mainWindow?.webContents.send('embeddings:progress', { total: nowStats.chunkCount, embedded: nowStats.embeddedCount, model, status: 'running' })
    }
    const finalStats = database.getEmbeddingsStats(model)
    mainWindow?.webContents.send('embeddings:progress', { total: finalStats.chunkCount, embedded: finalStats.embeddedCount, model, status: 'done' })
    return { ok: true, model, ...finalStats }
  } catch (error) {
    console.error('❌ [IPC] Error rebuilding embeddings:', error)
    mainWindow?.webContents.send('embeddings:progress', { error: String(error?.message || error), status: 'error' })
    throw error
  }
})

let mainWindow: BrowserWindow | null = null
let embeddingsBuilding = false
let vaultWatcher: import('chokidar').FSWatcher | null = null

function startVaultWatcher(rootDir: string) {
  try {
    // Close previous watcher
    if (vaultWatcher) {
      vaultWatcher.close().catch(() => {})
      vaultWatcher = null
    }
    const ignored = (p: string) => {
      const lower = p.toLowerCase()
      if (lower.includes('/.git/') || lower.endsWith('/.git')) return true
      if (lower.includes('/node_modules/') || lower.endsWith('/node_modules')) return true
      if (lower.includes('/dist/') || lower.includes('/build/')) return true
      if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.pdf')) return true
      // Index only known text/code extensions
      if (!hasIndexableExt(lower)) return true
      return false
    }

    // Simple concurrency limiter
    const createLimiter = (max: number) => {
      let active = 0
      const queue: Array<() => Promise<void>> = []
      const runNext = () => {
        if (active >= max) return
        const task = queue.shift()
        if (!task) return
        active++
        task().finally(() => {
          active--
          runNext()
        })
      }
      return (fn: () => Promise<void>) => {
        queue.push(fn)
        runNext()
      }
    }
    const schedule = createLimiter(3)

    // Index existing files as they are discovered
    vaultWatcher = chokidar.watch(rootDir, { ignoreInitial: false, ignored, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } })
    const onAddOrChange = (filePath: string) => {
      schedule(async () => {
        try {
          if (!hasIndexableExt(filePath)) return
          await database.ensureReady()
          const content = await readFile(filePath, 'utf-8')
          const name = path.basename(filePath)
          database.saveFile(filePath, name, content)
        } catch (e) {
          console.error('Watcher add/change failed:', e)
        }
      })
    }
    const onUnlink = (filePath: string) => {
      schedule(async () => {
        try {
          if (!hasIndexableExt(filePath)) return
          await database.ensureReady()
          database.deleteFileByPath(filePath)
        } catch (e) {
          console.error('Watcher unlink failed:', e)
        }
      })
    }
    vaultWatcher.on('add', onAddOrChange)
    vaultWatcher.on('change', onAddOrChange)
    vaultWatcher.on('unlink', onUnlink)
    console.log('👀 [Watcher] Started for:', rootDir)
  } catch (e) {
    console.error('❌ [Watcher] Failed to start:', e)
  }
}

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
      ...(isDev && {
        webSecurity: true, // Enable web security in dev
        allowRunningInsecureContent: false
      }),
      ...(!isDev && {
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
      // Auto-trigger embeddings build if missing
      ;(async () => {
        try {
          if (embeddingsBuilding) return
          await database.ensureReady()
          const llama = LlamaService.getInstance()
          await llama.initialize()
          const model = llama.getCurrentModel() || 'llama3.1:latest'
          const { embeddedCount, chunkCount } = database.getEmbeddingsStats(model)
          if (embeddedCount < chunkCount) {
            embeddingsBuilding = true
            mainWindow?.webContents.send('embeddings:progress', { total: chunkCount, embedded: embeddedCount, model, status: 'starting' })
            const batchSize = 64
            let stagnation = 0
            let prevEmbedded = embeddedCount
            while (true) {
              const batch = database.getChunksNeedingEmbeddings(model, batchSize)
              if (!batch.length) break
              const texts = batch.map(b => b.chunk_text)
              const vectors = await llama.embedTexts(texts, model)
              for (let i = 0; i < batch.length; i++) {
                database.upsertEmbedding(batch[i].id, vectors[i] || [], model)
              }
              const now = database.getEmbeddingsStats(model)
              mainWindow?.webContents.send('embeddings:progress', { total: now.chunkCount, embedded: now.embeddedCount, model, status: 'running' })
              // Break if progress stalls to avoid busy loops under concurrent reindex
              if (now.embeddedCount <= prevEmbedded) {
                if (++stagnation >= 3) break
              } else {
                stagnation = 0
                prevEmbedded = now.embeddedCount
              }
            }
            const fin = database.getEmbeddingsStats(model)
            mainWindow?.webContents.send('embeddings:progress', { total: fin.chunkCount, embedded: fin.embeddedCount, model, status: 'done' })
          }
        } catch (e) {
          console.error('⚠️ [Main] Auto embeddings build failed:', e)
          try { mainWindow?.webContents.send('embeddings:progress', { status: 'error', error: String(e?.message || e) }) } catch {}
        } finally {
          embeddingsBuilding = false
        }
      })()
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
    
    // Do not auto-open DevTools in production
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
  try {
    // Set up file logging in production and gate verbose logs
    await setupFileLogging()
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
          ...(isDev ? [{ role: 'toggleDevTools' } as const] : []),
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
    // LLM status removed
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

    // helper to determine subpath
    const isSubpath = (root: string, candidate: string) => {
      const rel = path.relative(root, candidate)
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
    }

    try {
      const currentSavedDirectory = await database.getSetting('selectedDirectory')
      
      if (!currentSavedDirectory) {
        // First time - this is a root directory selection
        console.log('📁 [First Time] No previous directory found, setting root directory')
        isRootDirectoryChange = true
      } else if (normalizedDirPath === currentSavedDirectory || isSubpath(currentSavedDirectory, normalizedDirPath)) {
        // Same root or a subdirectory inside current root - do nothing special
        console.log(isSubpath(currentSavedDirectory, normalizedDirPath) ? '📂 [Subdirectory Expansion]:' : '🔄 [Directory Refresh]:', normalizedDirPath)
      } else {
        // This is a genuine root directory change
        console.log('🔄 [Root Directory Switch] From:', currentSavedDirectory, 'To:', normalizedDirPath)
        shouldClearDatabase = true
        isRootDirectoryChange = true
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
      // Start watcher
      startVaultWatcher(normalizedDirPath)
      // Notify renderer of settings change
      try { mainWindow?.webContents.send('settings:changed', { key: 'selectedDirectory', value: normalizedDirPath }) } catch {}
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
      if (entry.isFile()) {
        const full = join(normalizedDirPath, entry.name)
        if (!hasIndexableExt(full)) {
          console.log('⏭️ Skipping non-indexable file:', entry.name)
          continue
        }
      } else if (!entry.isDirectory()) {
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
      
      if (entry.isFile()) {
        const full = join(dirPath, entry.name)
        if (!hasIndexableExt(full)) continue
        try {
          console.log('📖 [Recursive] Reading content for indexing:', entry.name, 'in', dirPath)
          const content = await readFile(fullPath, 'utf-8')
          
          // Save to database with chunking and FTS indexing
          database.saveFile(fullPath, entry.name, content)
          console.log('🧠 [Recursive] Indexed:', entry.name)
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

ipcMain.handle('db:updateNoteDates', async () => {
  try {
    await database.ensureReady()
    console.log('📅 [IPC] Updating note dates from file content...')
    return (database as any).updateAllNoteDates()
  } catch (error) {
    console.error('❌ [IPC] Error updating note dates:', error)
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
// Removed: llm:sendMessage

// Embeddings IPC handlers (background-ish but simple)
// Removed: embeddings:rebuild

// Removed: embeddings:stats

ipcMain.handle('llm:getStatus', async () => {
  try {
    const llamaService = LlamaService.getInstance()
    const currentModel = llamaService.getCurrentModel()
    return {
      isInitialized: !!currentModel,
      currentModel
    }
  } catch (error) {
    return { isInitialized: false, currentModel: null }
  }
})

ipcMain.handle('llm:getDeviceSpecs', async () => {
  try {
    const deviceModule = require('./services/deviceDetection')
    const deviceService = deviceModule?.DeviceDetectionService?.getInstance?.()
    return deviceService ? await deviceService.getDeviceSpecs() : null
  } catch {
    return null
  }
})

ipcMain.handle('llm:switchModel', async (_, modelName: string) => {
  try {
    const llamaService = LlamaService.getInstance()
    await llamaService.switchModel(modelName)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('llm:getCurrentModel', async () => {
  try {
    const llamaService = LlamaService.getInstance()
    return llamaService.getCurrentModel()
  } catch {
    return null
  }
})

ipcMain.handle('llm:getRecommendedModel', async () => {
  try {
    const deviceModule = require('./services/deviceDetection')
    const deviceService = deviceModule?.DeviceDetectionService?.getInstance?.()
    return deviceService ? await deviceService.getRecommendedModel() : null
  } catch {
    return null
  }
})

ipcMain.handle('llm:getAvailableModels', async () => {
  try {
    const llamaService = LlamaService.getInstance()
    return await llamaService.getAvailableModels()
  } catch {
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
    console.log(`🧠 [IPC] FTS-backed searchAndAnswer: ${query}`)
    // Optional: collect brief conversation history for future use (not injected now)
    let conversationHistory: Array<{ role: string, content: string }> = []
    if (chatId) {
      const recentMessages = database.getChatMessages(chatId, 6)
      conversationHistory = recentMessages.map(msg => ({ role: msg.role, content: msg.content }))
    }
    return await contentService.searchAndAnswer(query, conversationHistory)
  } catch (error) {
    console.error('❌ [IPC] Error in searchAndAnswer:', error)
    throw error
  }
})

// Streaming RAG
ipcMain.handle('content:streamSearchAndAnswer', async (_, query: string, chatId?: number) => {
  try {
    await database.ensureReady()
    console.log(`🧠 [IPC] FTS-backed streaming: ${query}`)

    // Minimal streaming: build prompt from FTS, then stream from LLM
    let conversationHistory: Array<{ role: string, content: string }> = []
    if (chatId) {
      const recent = database.getChatMessages(chatId, 6)
      conversationHistory = recent.map(m => ({ role: m.role, content: m.content }))
    }
    const { prompt, sources } = await contentService["preparePromptWithHybrid"](query)
    const llama = require('./services/llamaService').LlamaService.getInstance()
    try { await llama.initialize() } catch {}

    let full = ''
    await llama.sendMessage([{ role: 'user', content: prompt }], (chunk: string) => {
      full += chunk
      try { mainWindow?.webContents.send('content:streamChunk', { chunk }) } catch {}
    })
    try { mainWindow?.webContents.send('content:streamDone', { answer: full, sources }) } catch {}
    return { started: true }
  } catch (error) {
    console.error('❌ [IPC] Error in FTS-backed streaming:', error)
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
    // Emit change event to renderer
    try { mainWindow?.webContents.send('settings:changed', { key, value }) } catch {}
    // If root directory changed via settings, (re)start watcher
    if (key === 'selectedDirectory' && typeof value === 'string' && value) {
      startVaultWatcher(value)
    }
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
    await database.ensureReady()
    return database.getAllSettings()
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
          database.deleteFileByPath(filePath)
          console.log('🗑️ [Database] Removed from index:', filePath)
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
        database.updateFilePath(oldPath, newPath, fileName)
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
        const fileName = path.basename(newPath)
        database.updateFilePath(sourcePath, newPath, fileName)
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

// Image save helper
ipcMain.handle('file:saveImage', async (_, dirPath: string, baseName: string, dataBase64: string, ext: string) => {
  try {
    const safeExt = (ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    const fileName = `${baseName.replace(/[^a-zA-Z0-9-_]/g, '_')}_${Date.now()}.${safeExt}`
    const fullDir = dirPath
    const fullPath = join(fullDir, fileName)

    // Ensure directory exists
    try { await mkdir(fullDir, { recursive: true }) } catch {}

    // Strip data URL prefix if provided
    const commaIdx = dataBase64.indexOf(',')
    const payload = commaIdx >= 0 ? dataBase64.slice(commaIdx + 1) : dataBase64
    const buf = Buffer.from(payload, 'base64')

    await writeFile(fullPath, buf)
    console.log('🖼️ [IPC] Image saved:', fullPath)
    return fullPath
  } catch (error) {
    console.error('❌ [IPC] Error saving image:', error)
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

ipcMain.handle('db:healthCheck', async () => {
  try {
    await database.ensureReady()
    const token = `ISLA_HEALTH_TOKEN_${Date.now()}`
    const fakePath = path.join(app.getPath('userData'), `${token}.md`)
    const fakeName = `${token}.md`
    database.saveFile(fakePath, fakeName, `health ${token}`)
    const hits = (database as any).searchContentFTS?.(token, 1) || database.searchContent(token, 1)
    database.deleteFileByPath(fakePath)
    const ok = Array.isArray(hits) && hits.length > 0
    return { ok }
  } catch (error) {
    console.error('❌ [IPC] DB health check failed:', error)
    return { ok: false, error: String(error?.message || error) }
  }
}) 