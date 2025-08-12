import Database from 'better-sqlite3'
import { join, normalize, resolve } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync, unlinkSync, statSync } from 'fs'
import path from 'path'
import os from 'os'

// Safe console wrapper for Windows compatibility
const safeConsole = {
  log: (message: string) => {
    try {
      console.log(message)
    } catch (e) {
      // Console failed - continue silently on Windows
    }
  },
  warn: (message: string) => {
    try {
      console.warn(message)
    } catch (e) {
      // Console failed - continue silently on Windows
    }
  },
  error: (message: string, error?: any) => {
    try {
      console.error(message, error)
    } catch (e) {
      // Console failed - continue silently on Windows
    }
  }
}

export interface FileRecord {
  id: number
  path: string
  name: string
  content: string
  created_at: string
  modified_at: string
  size: number
}

export interface SearchIndex {
  id: number
  file_id: number
  word: string
  position: number
}

export interface ChatRecord {
  id: number
  title: string
  created_at: string
  updated_at: string
  is_active: boolean
}

export interface ChatMessageRecord {
  id: number
  chat_id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  metadata?: string | null
}

export interface AppSettings {
  id: number
  key: string
  value: string
  updated_at: string
}

export interface SearchResult {
  id: number
  file_id: number
  file_path: string
  file_name: string
  content_snippet: string
  rank: number
  chunk_index?: number
}

export interface ContentChunk {
  id: number
  file_id: number
  chunk_text: string
  chunk_index: number
  created_at: string
}

class IslaDatabase {
  private db: Database.Database | null = null
  private dbPath: string
  private isWindows: boolean
  private isInitialized: boolean = false
  private initializationPromise: Promise<void> | null = null
  private ftsReady: boolean = false

  constructor() {
    this.isWindows = os.platform() === 'win32'
    // Cross-platform database path
    this.dbPath = this.getDatabasePath()
  }

  /**
   * Normalize file paths for cross-platform storage
   * Converts Windows backslashes to forward slashes for consistent storage
   */
  private normalizeFilePath(filePath: string): string {
    try {
      // Resolve to absolute path and normalize
      const resolved = resolve(filePath)
      
      // Windows-specific path handling
      if (this.isWindows) {
        // Handle long paths on Windows (>260 chars)
        const longPathPrefix = '\\\\?\\'
        let windowsPath = resolved
        
        if (resolved.length > 260 && !resolved.startsWith(longPathPrefix)) {
          windowsPath = longPathPrefix + resolved
        }
        
        // Convert to forward slashes for consistent storage
        return windowsPath.replace(/\\/g, '/')
      }
      
      // Convert Windows backslashes to forward slashes for consistent storage
      return resolved.replace(/\\/g, '/')
    } catch (error) {
      console.warn(`⚠️ [Database] Path normalization failed for ${filePath}:`, error)
      return normalize(filePath).replace(/\\/g, '/')
    }
  }

  /**
   * Get platform-specific database path with enhanced cross-platform support
   * - macOS: ~/Library/Application Support/Isla Journal/database/
   * - Windows: %APPDATA%/Isla Journal/database/
   * - Linux: ~/.local/share/Isla Journal/database/
   * - Fallback: ~/.isla-journal/database/
   */
  private getDatabasePath(): string {
    try {
      // Handle testing environment where app might not be ready
      let userDataPath: string
      try {
        userDataPath = app.getPath('userData')
      } catch (error) {
        // Fallback for testing/CI environments
        userDataPath = process.env.NODE_ENV === 'test' 
          ? join(os.tmpdir(), 'isla-journal-test')
          : join(os.homedir(), '.isla-journal')
      }
      const dbDir = normalize(join(userDataPath, 'database'))
      
      // Ensure directory exists with cross-platform permissions
      if (!existsSync(dbDir)) {
        const dirOptions: any = { recursive: true }
        
        // Windows doesn't use Unix-style mode permissions
        if (!this.isWindows) {
          dirOptions.mode = 0o755
        }
        
        mkdirSync(dbDir, dirOptions)
        
        // Additional Windows directory setup
        if (this.isWindows) {
          console.log(`🪟 [Database] Windows database directory created: ${dbDir}`)
        }
      }
      
      const dbPath = normalize(join(dbDir, 'isla.db'))
      safeConsole.log(`🗄️ [Database] Platform: ${os.platform()}, DB Path: ${dbPath}`)
      
      return dbPath
    } catch (error) {
      // Fallback to home directory if Electron userData fails
      safeConsole.warn(`⚠️ [Database] Electron userData failed, using fallback: ${error}`)
      
      const homeDir = os.homedir()
      const fallbackDir = normalize(join(homeDir, '.isla-journal', 'database'))
      
      if (!existsSync(fallbackDir)) {
        const dirOptions: any = { recursive: true }
        
        // Windows doesn't use Unix-style mode permissions
        if (!this.isWindows) {
          dirOptions.mode = 0o755
        }
        
        mkdirSync(fallbackDir, dirOptions)
      }
      
      const fallbackPath = normalize(join(fallbackDir, 'isla.db'))
      console.log(`🗄️ [Database] Fallback path: ${fallbackPath}`)
      
      return fallbackPath
    }
  }

  /**
   * Initialize database and create tables with Windows-specific optimizations
   */
  public async initialize(): Promise<void> {
    // Return existing promise if initialization is already in progress
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    // If already initialized, return immediately
    if (this.isInitialized && this.db) {
      return Promise.resolve()
    }

    // Create and store the initialization promise
    this.initializationPromise = this.performInitialization()
    
    try {
      await this.initializationPromise
      this.isInitialized = true
      console.log('✅ [Database] SQLite initialized successfully')
    } catch (error) {
      // Reset state on failure
      this.isInitialized = false
      this.initializationPromise = null
      throw error
    }
  }

  /**
   * Perform the actual database initialization
   */
  private async performInitialization(): Promise<void> {
    try {
      // Ensure database directory exists
      const dbDir = path.dirname(this.dbPath)
      if (!existsSync(dbDir)) {
        const dirOptions: any = { recursive: true }
        if (!this.isWindows) {
          dirOptions.mode = 0o755
        }
        mkdirSync(dbDir, dirOptions)
      }

      // Windows-specific database options with retry logic
      const dbOptions: Database.Options = {}
      
      if (this.isWindows) {
        // Windows-specific SQLite options
        dbOptions.verbose = console.log // Better Windows debugging
        dbOptions.fileMustExist = false
        dbOptions.timeout = 10000 // 10 second timeout for Windows file locking
      }

      // Retry logic for Windows file locking issues
      let retryCount = 0
      const maxRetries = this.isWindows ? 3 : 1
      
      while (retryCount < maxRetries) {
        try {
          this.db = new Database(this.dbPath, dbOptions)
          console.log('🗄️ [Database] Connected to SQLite database')
          break // Success, exit retry loop
        } catch (dbError) {
          retryCount++
          if (this.isWindows && dbError.message.includes('database is locked') && retryCount < maxRetries) {
            console.log(`🪟 [Database] Windows lock detected, retry ${retryCount}/${maxRetries}...`)
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)) // Exponential backoff
            continue
          }
          throw dbError // Re-throw if not a retryable Windows lock error
        }
      }

      if (!this.db) {
        throw new Error('Failed to create database connection after retries')
      }

      // Enhanced Windows-compatible SQLite pragmas
      if (this.isWindows) {
        // Windows-specific pragmas for better reliability
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('synchronous = NORMAL') 
        this.db.pragma('cache_size = 10000')
        this.db.pragma('foreign_keys = ON')
        this.db.pragma('temp_store = MEMORY') // Keep temp files in memory on Windows
        this.db.pragma('mmap_size = 268435456') // 256MB memory mapping
        this.db.pragma('wal_autocheckpoint = 1000') // Checkpoint WAL more frequently on Windows
        console.log('🪟 [Database] Applied Windows-specific SQLite optimizations')
      } else {
        // Standard pragmas for Unix-like systems
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('synchronous = NORMAL')
        this.db.pragma('cache_size = 10000')
        this.db.pragma('foreign_keys = ON')
      }

      // Create tables if they don't exist
      this.createTables()
      console.log('📋 [Database] Tables and indexes created')
      console.log('🔧 [Database] Schema validation completed (FTS removed)')

    } catch (error) {
      console.error('❌ [Database] Failed to initialize:', error)
      
      // Windows-specific error handling
      if (this.isWindows && error.message.includes('database is locked')) {
        console.log('🪟 [Database] Windows file lock detected, attempting recovery...')
        this.handleWindowsLockError()
      } else {
        throw error
      }
    }
  }

  /**
   * Ensure database is initialized and ready for operations
   */
  public async ensureReady(): Promise<void> {
    if (!this.isInitialized || !this.db) {
      if (this.initializationPromise) {
        // Wait for ongoing initialization
        await this.initializationPromise
      } else {
        // Start initialization
        await this.initialize()
      }
    }
    
    if (!this.db) {
      throw new Error('Database not initialized')
    }
  }

  /**
   * Check if database is ready (synchronous check)
   */
  public isReady(): boolean {
    return this.isInitialized && this.db !== null
  }

  /**
   * Handle Windows-specific SQLite locking issues
   */
  private handleWindowsLockError(): void {
    try {
      // Wait a bit for Windows file system
      setTimeout(() => {
        console.log('🪟 [Database] Retrying Windows database connection...')
        
        // Close any existing connection
        if (this.db) {
          try {
            this.db.close()
          } catch (e) {
            console.warn('⚠️ [Database] Error closing database:', e)
          }
          this.db = null
        }
        
        // Force garbage collection on Windows
        if (global.gc) {
          global.gc()
        }
        
        // Retry initialization
        this.initialize()
      }, 1000)
    } catch (error) {
      console.error('❌ [Database] Windows lock recovery failed:', error)
      throw error
    }
  }

  /**
   * Create database schema
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized')

    // Files table - stores file metadata and content
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        size INTEGER DEFAULT 0
      )
    `)

    // Content chunks table - for better search granularity
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
      )
    `)

    // Per-chunk metadata (heading context)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_meta (
        chunk_id INTEGER PRIMARY KEY,
        heading_path TEXT,
        heading TEXT,
        level INTEGER,
        FOREIGN KEY (chunk_id) REFERENCES content_chunks (id) ON DELETE CASCADE
      )
    `)

    // Headings table per file (for outline/backlinks later)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS headings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        text TEXT NOT NULL,
        char_index INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
      )
    `)

    // FTS removed - using direct content_chunks search instead

    // Search index table - for full-text search
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        word TEXT NOT NULL,
        position INTEGER NOT NULL,
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
      )
    `)

    // Chat conversations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 0
      )
    `)

    // Chat messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT,
        FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
      )
    `)

    // App settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_files_path ON files (path);
      CREATE INDEX IF NOT EXISTS idx_files_modified ON files (modified_at);
      CREATE INDEX IF NOT EXISTS idx_search_word ON search_index (word);
      CREATE INDEX IF NOT EXISTS idx_search_file ON search_index (file_id);
      CREATE INDEX IF NOT EXISTS idx_headings_file ON headings (file_id);
      CREATE INDEX IF NOT EXISTS idx_headings_level ON headings (level);
      CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats (updated_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages (chat_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages (created_at);
      CREATE INDEX IF NOT EXISTS idx_settings_key ON app_settings (key);
    `)

    console.log('📋 [Database] Tables and indexes created')

    // Run lightweight migrations and FTS setup
    this.runMigrations()
    this.setupFTS()
  }

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialized')

    // Add file_mtime and note_date columns if missing
    const columns: Array<{name: string}> = this.db.prepare("PRAGMA table_info(files)").all() as any
    const hasMtime = columns.some(c => c.name === 'file_mtime')
    const hasNoteDate = columns.some(c => c.name === 'note_date')

    if (!hasMtime) {
      try {
        this.db.exec("ALTER TABLE files ADD COLUMN file_mtime DATETIME")
      } catch (e) {
        console.warn('⚠️ [Database] Failed to add file_mtime:', e)
      }
    }
    if (!hasNoteDate) {
      try {
        this.db.exec("ALTER TABLE files ADD COLUMN note_date DATE")
      } catch (e) {
        console.warn('⚠️ [Database] Failed to add note_date:', e)
      }
    }

    // Add metadata to chat_messages if missing
    try {
      const chatCols: Array<{name: string}> = this.db.prepare("PRAGMA table_info(chat_messages)").all() as any
      const hasMetadata = chatCols.some(c => c.name === 'metadata')
      if (!hasMetadata) {
        this.db.exec("ALTER TABLE chat_messages ADD COLUMN metadata TEXT")
      }
    } catch (e) {
      console.warn('⚠️ [Database] Failed to ensure chat_messages.metadata:', e)
    }

    // Indexes for new columns
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_file_mtime ON files (file_mtime);
        CREATE INDEX IF NOT EXISTS idx_files_note_date ON files (note_date);
      `)
    } catch (e) {
      console.warn('⚠️ [Database] Failed to create indexes for new columns:', e)
    }
  }

  private setupFTS(): void {
    if (!this.db) throw new Error('Database not initialized')
    this.ftsReady = false
    try {
      // Create FTS5 table linked to content_chunks
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          chunk_text,
          file_id UNINDEXED,
          content='content_chunks', content_rowid='id'
        );
      `)
      // Auxiliary index-like trigger not strictly necessary with manual sync
      this.ftsReady = true
      console.log('✅ [Database] FTS5 ready')
    } catch (e) {
      console.warn('⚠️ [Database] FTS5 unavailable, falling back to LIKE search:', e)
      this.ftsReady = false
    }

    // Embeddings table
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings (
          chunk_id INTEGER NOT NULL,
          vector TEXT NOT NULL,
          dim INTEGER NOT NULL,
          model TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (chunk_id) REFERENCES content_chunks (id) ON DELETE CASCADE
        );
      `)
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings (model)`)
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_chunk_model ON embeddings (chunk_id, model)`)
      console.log('✅ [Database] Embeddings table ready')
    } catch (e) {
      console.warn('⚠️ [Database] Failed to ensure embeddings table:', e)
    }
  }

  private deriveNoteDate(fileName: string, content?: string): string | null {
    // Priority 1: Content-based dates (more reliable)
    if (content) {
      // Frontmatter date: date: 2025-08-12
      const frontmatter = content.match(/^---[\s\S]*?date:\s*['"]?(\d{4}-\d{2}-\d{2})['"]?[\s\S]*?---/i)
      if (frontmatter) return frontmatter[1]
      
      // First line date formats
      const firstLines = content.split('\n').slice(0, 3).join('\n')
      
      // ISO date anywhere in first few lines: 2025-08-12
      const isoDate = firstLines.match(/(\d{4}-\d{2}-\d{2})/i)
      if (isoDate) return isoDate[1]
      
      // US format: 8/12/2025 or 08/12/2025
      const usDate = firstLines.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
      if (usDate) {
        const month = parseInt(usDate[1]).toString().padStart(2, '0')
        const day = parseInt(usDate[2]).toString().padStart(2, '0')
        return `${usDate[3]}-${month}-${day}`
      }
      
      // Written date: August 12, 2025 or Aug 12, 2025
      const monthMap: Record<string, string> = {
        january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
        april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
        august: '08', aug: '08', september: '09', sep: '09', october: '10', oct: '10',
        november: '11', nov: '11', december: '12', dec: '12'
      }
      
      const writtenDate = firstLines.match(/(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+(\d{1,2}),?\s+(\d{4})/i)
      if (writtenDate) {
        const month = monthMap[writtenDate[1].toLowerCase()]
        const day = parseInt(writtenDate[2]).toString().padStart(2, '0')
        return `${writtenDate[3]}-${month}-${day}`
      }
      
      // Reverse format: 12 August 2025
      const reverseDate = firstLines.match(/(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec),?\s+(\d{4})/i)
      if (reverseDate) {
        const month = monthMap[reverseDate[2].toLowerCase()]
        const day = parseInt(reverseDate[1]).toString().padStart(2, '0')
        return `${reverseDate[3]}-${month}-${day}`
      }
    }
    
    // Priority 2: Filename-based dates (fallback)
    // ISO format in filename: 2025-08-12
    const isoFilename = fileName.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (isoFilename) {
      const y = +isoFilename[1], mo = +isoFilename[2], d = +isoFilename[3]
      const dt = new Date(Date.UTC(y, mo - 1, d))
      return dt.toISOString().slice(0, 10)
    }
    
    // Month name in filename: "4 aug.md"
    const monthMap: Record<string, string> = {
      january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
      april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
      august: '08', aug: '08', september: '09', sep: '09', october: '10', oct: '10',
      november: '11', nov: '11', december: '12', dec: '12'
    }
    
    // "4 aug" or "12 august" format (day + month)
    let monthFilename = fileName.toLowerCase().match(/(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)/i)
    if (monthFilename) {
      const day = parseInt(monthFilename[1]).toString().padStart(2, '0')
      const month = monthMap[monthFilename[2].toLowerCase()]
      const currentYear = new Date().getFullYear()
      return `${currentYear}-${month}-${day}`
    }
    
    // "Jan 17" format (month + day)
    monthFilename = fileName.toLowerCase().match(/(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})/i)
    if (monthFilename) {
      const month = monthMap[monthFilename[1].toLowerCase()]
      const day = parseInt(monthFilename[2]).toString().padStart(2, '0')
      const currentYear = new Date().getFullYear()
      return `${currentYear}-${month}-${day}`
    }
    
    return null
  }

  /**
   * Save or update file content in database with cross-platform path normalization
   */
  public saveFile(filePath: string, fileName: string, content: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Normalize file path for consistent cross-platform storage
    const normalizedPath = this.normalizeFilePath(filePath)

    // Compute mtime from FS; fallback to now
    let fileMtimeIso: string | null = null
    try {
      const st = statSync(filePath)
      fileMtimeIso = new Date(st.mtimeMs).toISOString()
    } catch {
      fileMtimeIso = new Date().toISOString()
    }

    const noteDate = this.deriveNoteDate(fileName, content)

    const stmt = this.db.prepare(`
      INSERT INTO files (path, name, content, modified_at, size, file_mtime, note_date)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name=excluded.name,
        content=excluded.content,
        modified_at=CURRENT_TIMESTAMP,
        size=excluded.size,
        file_mtime=excluded.file_mtime,
        note_date=COALESCE(excluded.note_date, files.note_date)
    `)
    const result = stmt.run(normalizedPath, fileName, content, content.length, fileMtimeIso, noteDate)

    // Get file id (insert or existing)
    const fileRecord = this.db.prepare('SELECT id FROM files WHERE path = ?').get(normalizedPath) as { id: number }
    const fileId = fileRecord.id

    // Update content chunks and FTS
    this.updateContentChunks(fileId, normalizedPath, fileName, content)

    console.log(`✅ [Database] Saved file: ${fileName} (${normalizedPath})`)
  }

  /**
   * Break content into chunks and update FTS index
   */
  private updateContentChunks(fileId: number, filePath: string, fileName: string, content: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Clear existing chunks and FTS rows for this file
    this.db.prepare('DELETE FROM content_chunks WHERE file_id = ?').run(fileId)
    if (this.ftsReady) {
      this.db.prepare('DELETE FROM chunks_fts WHERE file_id = ?').run(fileId)
    }
    this.db.prepare('DELETE FROM headings WHERE file_id = ?').run(fileId)

    const { chunks, headings } = this.chunkContentStructured(content)

    const insertChunk = this.db.prepare(`
      INSERT INTO content_chunks (file_id, chunk_text, chunk_index)
      VALUES (?, ?, ?)
    `)

    const insertFts = this.ftsReady
      ? this.db.prepare(`INSERT INTO chunks_fts(rowid, chunk_text, file_id) VALUES(?, ?, ?)`)
      : null

    const insertChunkMeta = this.db.prepare(`
      INSERT OR REPLACE INTO chunk_meta (chunk_id, heading_path, heading, level)
      VALUES (?, ?, ?, ?)
    `)

    const insertHeading = this.db.prepare(`
      INSERT INTO headings (file_id, level, text, char_index)
      VALUES (?, ?, ?, ?)
    `)

    const tx = this.db.transaction(() => {
      // Insert headings for outline
      headings.forEach(h => insertHeading.run(fileId, h.level, h.text, h.charIndex))

      chunks.forEach((chunk, index) => {
        const res = insertChunk.run(fileId, chunk.text, index)
        const chunkId = Number(res.lastInsertRowid)
        if (insertFts) insertFts.run(chunkId, chunk.text, fileId)
        insertChunkMeta.run(chunkId, chunk.headingPath, chunk.heading, chunk.level)
      })
    })

    tx()

    console.log(`📝 [Database] Indexed ${chunks.length} chunks (${headings.length} headings) for ${fileName}`)
  }

  /**
   * Split content into heading-aware overlapping chunks and extract headings
   */
  private chunkContentStructured(content: string): { chunks: Array<{ text: string; headingPath: string; heading: string; level: number }>; headings: Array<{ level: number; text: string; charIndex: number }> } {
    const lines = content.split(/\r?\n/)
    const headings: Array<{ level: number; text: string; charIndex: number }> = []
    const chunks: Array<{ text: string; headingPath: string; heading: string; level: number }> = []

    // Track heading path
    const pathStack: Array<{ level: number; text: string }> = []
    const textBlocks: Array<{ start: number; end: number; text: string; level: number; heading: string; headingPath: string }> = []
    let currentStart = 0
    let currentLevel = 0
    let currentHeading = ''
    let currentPath = ''
    let charOffset = 0

    const flushBlock = (endLine: number) => {
      const blockLines = lines.slice(currentStart, endLine)
      const blockText = blockLines.join('\n').trim()
      if (blockText) {
        textBlocks.push({ start: currentStart, end: endLine, text: blockText, level: currentLevel, heading: currentHeading, headingPath: currentPath })
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const m = line.match(/^(#{1,6})\s+(.*)$/)
      if (m) {
        // flush previous block before heading
        flushBlock(i)
        const level = m[1].length
        const text = (m[2] || '').trim()
        headings.push({ level, text, charIndex: charOffset })
        // maintain path stack
        while (pathStack.length && pathStack[pathStack.length - 1].level >= level) {
          pathStack.pop()
        }
        pathStack.push({ level, text })
        currentPath = pathStack.map(h => h.text).join(' > ')
        currentHeading = text
        currentLevel = level
        currentStart = i + 1
      }
      charOffset += line.length + 1
    }
    // flush last block
    flushBlock(lines.length)

    // Now turn blocks into overlapping chunks by token-like length
    const maxLen = 800
    const overlap = 150
    for (const block of textBlocks) {
      const text = block.text.replace(/\s+/g, ' ').trim()
      if (!text) continue
      if (text.length <= maxLen) {
        chunks.push({ text, headingPath: block.headingPath, heading: block.heading, level: block.level || 0 })
      } else {
        for (let i = 0; i < text.length; i += (maxLen - overlap)) {
          const slice = text.slice(i, i + maxLen)
          if (slice.trim().length > 50) {
            chunks.push({ text: slice.trim(), headingPath: block.headingPath, heading: block.heading, level: block.level || 0 })
          }
        }
      }
    }
    if (chunks.length === 0 && content.trim()) {
      chunks.push({ text: content.trim(), headingPath: '', heading: '', level: 0 })
    }
    return { chunks, headings }
  }

  /**
   * Search content using simple LIKE queries
   */
  public searchContent(query: string, limit: number = 10): SearchResult[] {
    if (!this.db) throw new Error('Database not initialized')

    try {
      // Clean and split query into individual words
      const words = query.toLowerCase()
        .replace(/['\"*?!@#$%^&()+={}[\\]|\\\\:\";'<>,.]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 1) // Allow 2+ character words
        .slice(0, 8) // Allow more words for better search

      if (words.length === 0) {
        console.log('🔍 [Database] No valid search words found')
        return []
      }

      console.log(`🔍 [Database] Search words: ${words.join(', ')}`)

      // Simple approach: search for any word match
      const results: SearchResult[] = []
      
      for (const word of words) {
        const stmt = this.db.prepare(`
          SELECT 
            c.id,
            c.file_id,
            f.path as file_path,
            f.name as file_name,
            substr(c.chunk_text, 1, 200) as content_snippet,
            c.chunk_index as chunk_index,
            f.file_mtime,
            f.note_date,
            1 as rank
          FROM content_chunks c
          JOIN files f ON c.file_id = f.id
          WHERE LOWER(c.chunk_text) LIKE '%' || ? || '%'
          ORDER BY f.file_mtime DESC, f.note_date DESC
          LIMIT ?
        `)
        
        const wordResults = stmt.all(word, Math.ceil(limit / words.length)) as SearchResult[]
        results.push(...wordResults)
      }

      // Remove duplicates and limit results
      const uniqueResults = results.filter((result, index, self) => 
        index === self.findIndex(r => r.id === result.id)
      ).slice(0, limit)

      console.log(`🔍 [Database] Found ${uniqueResults.length} results for: ${query}`)
      return uniqueResults
      
    } catch (error) {
      console.error('❌ [Database] Search error:', error)
      return []
    }
  }

  /**
   * Get file content by ID
   */
  public getFileContent(fileId: number): string | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT content FROM files WHERE id = ?')
    const result = stmt.get(fileId) as { content: string } | undefined
    
    return result?.content || null
  }

  /**
   * Get file content from database with cross-platform path normalization
   */
  public getFile(filePath: string): FileRecord | null {
    if (!this.db) throw new Error('Database not initialized')

    const normalizedPath = this.normalizeFilePath(filePath)
    const select = this.db.prepare('SELECT * FROM files WHERE path = ?')
    return select.get(normalizedPath) as FileRecord || null
  }

  // searchFiles method removed - FTS not needed, using searchContent instead

  /**
   * Clear all indexed content (useful when switching directories)
   */
  public clearAllContent(): void {
    if (!this.db) throw new Error('Database not initialized')

    console.log('🗑️ [Database] Clearing all indexed content...')
    
    try {
      // Clear all content in transaction for consistency
      const transaction = this.db.transaction(() => {
        // Clear backing tables
        this.db!.prepare('DELETE FROM content_chunks').run()
        this.db!.prepare('DELETE FROM search_index').run()
        this.db!.prepare('DELETE FROM files').run()
      })
      
      transaction()
      console.log('✅ [Database] All indexed content cleared')
    } catch (error) {
      console.error('❌ [Database] Error clearing content:', error)
      // Force recreate the database if clearing fails
      this.forceRecreateDatabase()
    }
  }

  private forceRecreateDatabase(): void {
    console.log('🔄 [Database] Force recreating database due to errors...')
    try {
      if (this.db) {
        try {
          this.db.close()
        } catch (closeError) {
          console.warn('⚠️ [Database] Error during database close:', closeError)
        }
        this.db = null
      }
      
      // Windows-specific cleanup delay
      if (this.isWindows) {
        // Give Windows file system time to release handles
        console.log('🪟 [Database] Waiting for Windows file handles to release...')
        setTimeout(() => this.performDatabaseCleanup(), 500)
      } else {
        this.performDatabaseCleanup()
      }
      
    } catch (error) {
      console.error('❌ [Database] Failed to recreate database:', error)
      throw error
    }
  }

  /**
   * Perform the actual database file cleanup with enhanced Windows support
   */
  private performDatabaseCleanup(): void {
    try {
      // Force garbage collection on Windows to release file handles
      if (this.isWindows && global.gc) {
        global.gc()
      }
      
      // Delete the corrupted database file with cross-platform path handling
      const normalizedPath = normalize(this.dbPath)
      
      // Windows-specific file deletion with retry logic
      if (this.isWindows) {
        this.deleteFileWithRetry(normalizedPath, 'main database')
      } else {
        if (existsSync(normalizedPath)) {
          unlinkSync(normalizedPath)
          console.log(`🗑️ [Database] Deleted corrupted database: ${normalizedPath}`)
        }
      }
      
      // Also clean up any associated WAL/SHM files (SQLite)
      const walPath = normalizedPath + '-wal'
      const shmPath = normalizedPath + '-shm'
      const journalPath = normalizedPath + '-journal'
      
      if (this.isWindows) {
        // Windows: delete with retry
        this.deleteFileWithRetry(walPath, 'WAL file')
        this.deleteFileWithRetry(shmPath, 'SHM file')
        this.deleteFileWithRetry(journalPath, 'Journal file')
      } else {
        // Unix: standard deletion
        if (existsSync(walPath)) {
          unlinkSync(walPath)
          console.log(`🗑️ [Database] Deleted WAL file: ${walPath}`)
        }
        
        if (existsSync(shmPath)) {
          unlinkSync(shmPath)
          console.log(`🗑️ [Database] Deleted SHM file: ${shmPath}`)
        }
        
        if (existsSync(journalPath)) {
          unlinkSync(journalPath)
          console.log(`🗑️ [Database] Deleted Journal file: ${journalPath}`)
        }
      }
      
      // Small delay before reinitializing on Windows
      if (this.isWindows) {
        setTimeout(() => {
          this.initialize()
          console.log('✅ [Database] Successfully recreated database')
        }, 200)
      } else {
        // Reinitialize immediately on Unix
        this.initialize()
        console.log('✅ [Database] Successfully recreated database')
      }
      
    } catch (error) {
      console.error('❌ [Database] Failed during cleanup:', error)
      throw error
    }
  }

  /**
   * Delete file with retry logic for Windows file locking issues
   */
  private deleteFileWithRetry(filePath: string, fileType: string, maxRetries: number = 3): void {
    if (!existsSync(filePath)) return
    
    let retries = 0
    const attemptDelete = () => {
      try {
        unlinkSync(filePath)
        console.log(`🗑️ [Database] Deleted ${fileType}: ${filePath}`)
      } catch (error) {
        retries++
        // Windows-specific error handling
        const isWindowsError = error.code === 'EBUSY' || error.code === 'EACCES' || error.code === 'EPERM'
        const isRetryable = retries < maxRetries && (isWindowsError || error.code === 'ENOENT')
        
        if (isRetryable) {
          console.log(`🪟 [Database] ${fileType} busy/locked, retrying (${retries}/${maxRetries})...`)
          setTimeout(attemptDelete, 100 * retries) // Exponential backoff
        } else if (retries < maxRetries) {
          console.log(`🪟 [Database] Retrying ${fileType} deletion (${retries}/${maxRetries})...`)
          setTimeout(attemptDelete, 50)
        } else {
          console.warn(`⚠️ [Database] Failed to delete ${fileType} after ${maxRetries} attempts:`, error)
        }
      }
    }
    
    attemptDelete()
  }

  /**
   * Update search index for a file
   */
  private updateSearchIndex(filePath: string, content: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Get file ID
    const fileQuery = this.db.prepare('SELECT id FROM files WHERE path = ?')
    const fileRecord = fileQuery.get(filePath) as { id: number } | undefined
    
    if (!fileRecord) return

    // Clear existing index for this file
    const clearIndex = this.db.prepare('DELETE FROM search_index WHERE file_id = ?')
    clearIndex.run(fileRecord.id)

    // Extract words from content (simple tokenization)
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)

    // Insert new index entries
    const insertIndex = this.db.prepare(
      'INSERT INTO search_index (file_id, word, position) VALUES (?, ?, ?)'
    )

    const insertMany = this.db.transaction((entries) => {
      for (const entry of entries) {
        insertIndex.run(entry.file_id, entry.word, entry.position)
      }
    })

    const indexEntries = words.map((word, position) => ({
      file_id: fileRecord.id,
      word,
      position
    }))

    insertMany(indexEntries)
  }

  /**
   * Get database statistics
   */
  public getStats(): { fileCount: number, chunkCount: number, indexSize: number } {
    if (!this.db) throw new Error('Database not initialized')

    try {
      const fileCount = this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }
      const chunkCount = this.db.prepare('SELECT COUNT(*) as count FROM content_chunks').get() as { count: number }

      let ftsCount = 0
      if (this.ftsReady) {
        try {
          const r = this.db.prepare('SELECT COUNT(*) as count FROM chunks_fts').get() as { count: number }
          ftsCount = r.count
        } catch {}
      }

      const indexSize = this.ftsReady ? ftsCount : chunkCount.count
      return { fileCount: fileCount.count, chunkCount: chunkCount.count, indexSize }
    } catch (error) {
      console.error('❌ [Database] Error getting stats:', error)
      return { fileCount: 0, chunkCount: 0, indexSize: 0 }
    }
  }

  /**
   * Get a setting value
   */
  public getSetting(key: string): string | null {
    if (!this.db) throw new Error('Database not initialized')

    try {
      const result = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
      return result ? result.value : null
    } catch (error) {
      console.error('❌ [Database] Error getting setting:', error)
      return null
    }
  }

  /**
   * Set a setting value
   */
  public setSetting(key: string, value: string): void {
    if (!this.db) throw new Error('Database not initialized')

    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO app_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
      `).run(key, value)
    } catch (error) {
      console.error('❌ [Database] Error setting value:', error)
      throw error
    }
  }

  // ========================
  // CHAT OPERATIONS
  // ========================

  /**
   * Create a new chat conversation
   */
  public createChat(title: string): ChatRecord {
    if (!this.db) throw new Error('Database not initialized')

    // Set all other chats to inactive
    const deactivateAll = this.db.prepare('UPDATE chats SET is_active = 0')
    deactivateAll.run()

    // Create new chat
    const insert = this.db.prepare(`
      INSERT INTO chats (title, is_active) 
      VALUES (?, 1)
    `)
    const result = insert.run(title)

    const getChat = this.db.prepare('SELECT * FROM chats WHERE id = ?')
    return getChat.get(result.lastInsertRowid) as ChatRecord
  }

  /**
   * Get all chat conversations
   */
  public getAllChats(): ChatRecord[] {
    if (!this.db) throw new Error('Database not initialized')

    const query = this.db.prepare('SELECT * FROM chats ORDER BY updated_at DESC')
    return query.all() as ChatRecord[]
  }

  /**
   * Get active chat
   */
  public getActiveChat(): ChatRecord | null {
    if (!this.db) throw new Error('Database not initialized')

    const query = this.db.prepare('SELECT * FROM chats WHERE is_active = 1 LIMIT 1')
    return query.get() as ChatRecord | null
  }

  /**
   * Set active chat
   */
  public setActiveChat(chatId: number): void {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(() => {
      // Deactivate all chats
      const deactivateAll = this.db!.prepare('UPDATE chats SET is_active = 0')
      deactivateAll.run()

      // Activate selected chat
      const activate = this.db!.prepare('UPDATE chats SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      activate.run(chatId)
    })

    transaction()
  }

  /**
   * Add message to chat
   */
  public addChatMessage(chatId: number, role: 'user' | 'assistant' | 'system', content: string, metadata?: any): ChatMessageRecord {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(() => {
      // Insert message
      const insertMessage = this.db!.prepare(`
        INSERT INTO chat_messages (chat_id, role, content, metadata) 
        VALUES (?, ?, ?, ?)
      `)
      const metadataString = metadata == null ? null : JSON.stringify(metadata)
      const result = insertMessage.run(chatId, role, content, metadataString)

      // Update chat timestamp
      const updateChat = this.db!.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      updateChat.run(chatId)

      // Get the inserted message
      const getMessage = this.db!.prepare('SELECT * FROM chat_messages WHERE id = ?')
      return getMessage.get(result.lastInsertRowid) as ChatMessageRecord
    })

    return transaction()
  }

  /**
   * Get messages for a chat with optional limit and conversation context
   */
  public getChatMessages(chatId: number, limit?: number): ChatMessageRecord[] {
    if (!this.db) throw new Error('Database not initialized')

    if (limit) {
      // For conversation context - get recent messages in reverse chronological order
      const stmt = this.db.prepare(`
        SELECT id, chat_id, role, content, created_at, metadata 
        FROM chat_messages 
        WHERE chat_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `)
      
      const messages = stmt.all(chatId, limit) as ChatMessageRecord[]
      
      // Return in chronological order (oldest first) for conversation context
      return messages.reverse()
    } else {
      // Original functionality - get all messages in chronological order
      const query = this.db.prepare('SELECT id, chat_id, role, content, created_at, metadata FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC')
      return query.all(chatId) as ChatMessageRecord[]
    }
  }

  /**
   * Delete chat and all its messages
   */
  public deleteChat(chatId: number): void {
    if (!this.db) throw new Error('Database not initialized')

    const deleteChat = this.db.prepare('DELETE FROM chats WHERE id = ?')
    deleteChat.run(chatId)
  }

  /**
   * Rename a chat
   */
  public renameChat(chatId: number, newTitle: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const updateChat = this.db.prepare('UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    updateChat.run(newTitle, chatId)
  }

  // ========================
  // APP SETTINGS
  // ========================

  /**
   * Get all app settings
   */
  public getAllSettings(): Record<string, string> {
    if (!this.db) throw new Error('Database not initialized')

    const query = this.db.prepare('SELECT key, value FROM app_settings')
    const results = query.all() as { key: string; value: string }[]
    
    const settings: Record<string, string> = {}
    results.forEach(row => {
      settings[row.key] = row.value
    })
    return settings
  }

  /**
   * Check if a file needs to be processed (new or modified) with cross-platform path handling
   */
  public needsProcessing(filePath: string, currentMtime: Date): boolean {
    if (!this.db) throw new Error('Database not initialized')

    try {
      const normalizedPath = this.normalizeFilePath(filePath)
      const existing = this.db.prepare('SELECT modified_at FROM files WHERE path = ?').get(normalizedPath) as { modified_at: string } | undefined
      
      if (!existing) {
        // File doesn't exist in database, needs processing
        return true
      }
      
      const dbMtime = new Date(existing.modified_at)
      // File needs processing if it's been modified since last time
      return currentMtime > dbMtime
    } catch (error) {
      console.error('❌ [Database] Error checking if file needs processing:', error)
      // On error, assume it needs processing to be safe
      return true
    }
  }

  /**
   * Get file by path with error handling and cross-platform path normalization
   */
  public getFileByPath(filePath: string): FileRecord | null {
    if (!this.db) throw new Error('Database not initialized')

    try {
      const normalizedPath = this.normalizeFilePath(filePath)
      return this.db.prepare('SELECT * FROM files WHERE path = ?').get(normalizedPath) as FileRecord || null
    } catch (error) {
      console.error('❌ [Database] Error getting file by path:', error)
      return null
    }
  }

  // fixDatabaseSchema method removed - no longer needed without FTS

  /**
   * Delete a file (and its chunks/index) by absolute path
   */
  public deleteFileByPath(filePath: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const normalizedPath = this.normalizeFilePath(filePath)

    const transaction = this.db.transaction(() => {
      // Find file id first (optional but useful for logging)
      const file = this.db!.prepare('SELECT id FROM files WHERE path = ?').get(normalizedPath) as { id: number } | undefined

      // Delete from files (CASCADE will remove content_chunks)
      this.db!.prepare('DELETE FROM files WHERE path = ?').run(normalizedPath)

      // Clean up legacy search_index rows if any
      if (file?.id) {
        this.db!.prepare('DELETE FROM search_index WHERE file_id = ?').run(file.id)
      }
    })

    transaction()
  }

  /**
   * Update file path and optionally name without touching content/chunks
   */
  public updateFilePath(oldPath: string, newPath: string, newName?: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const normalizedOld = this.normalizeFilePath(oldPath)
    const normalizedNew = this.normalizeFilePath(newPath)

    const stmt = this.db.prepare(`
      UPDATE files
      SET path = ?,
          name = COALESCE(?, name),
          modified_at = CURRENT_TIMESTAMP
      WHERE path = ?
    `)

    stmt.run(normalizedNew, newName ?? null, normalizedOld)
  }

  /**
   * Close database connection with Windows-specific cleanup
   */
  public close(): void {
    if (this.db) {
      try {
        // Windows-specific pre-close cleanup
        if (this.isWindows) {
          // Checkpoint WAL files on Windows before closing
          try {
            this.db.pragma('wal_checkpoint(TRUNCATE)')
            console.log('🪟 [Database] Windows WAL checkpoint completed')
          } catch (walError) {
            console.warn('⚠️ [Database] WAL checkpoint warning:', walError)
          }
        }
        
        this.db.close()
        this.db = null
        console.log('🔒 [Database] Connection closed')
        
        // Windows-specific post-close cleanup
        if (this.isWindows && global.gc) {
          // Force garbage collection to release file handles
          setTimeout(() => {
            global.gc()
            console.log('🪟 [Database] Windows garbage collection completed')
          }, 100)
        }
        
      } catch (error) {
        console.error('❌ [Database] Error during close:', error)
        this.db = null // Ensure it's set to null even on error
      }
    }
  }

  // Date-aware FTS search with fallback
  public searchContentFTS(query: string, limit: number = 20, dateRange: { start: Date; end: Date } | null = null): SearchResult[] {
    if (!this.db) throw new Error('Database not initialized')
    if (!this.ftsReady) {
      return this.searchContent(query, limit)
    }

    try {
      // Build FTS5 query: tokenize and join with OR for better matching
      const words = query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(word => word.length > 1) // Allow 2+ character words
        .slice(0, 8) // Allow more words
        .map(word => `"${word.replace(/"/g, '')}"`) // Quote each word for exact matching
      
      if (words.length === 0) {
        return []
      }
      
      // Use OR to match any of the words, or AND for all words (you can experiment)
      const match = words.join(' OR ') // This finds documents with ANY of the words
      // Alternative: const match = words.join(' AND ') // This finds documents with ALL words

      const clauses: string[] = []
      const params: any[] = []

      clauses.push("chunks_fts MATCH ?")
      params.push(match)

      if (dateRange) {
        clauses.push("(f.note_date BETWEEN ? AND ? OR f.file_mtime BETWEEN ? AND ?)")
        const startIso = dateRange.start.toISOString()
        const endIso = dateRange.end.toISOString()
        params.push(startIso, endIso, startIso, endIso)
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

      const sql = `
        SELECT 
          c.id,
          c.file_id,
          f.path as file_path,
          f.name as file_name,
          c.chunk_index as chunk_index,
          f.note_date,
          f.file_mtime,
          snippet(chunks_fts, 0, '<mark>', '</mark>', '...', 12) as content_snippet,
          bm25(chunks_fts, 1.0, 1.0) as rank
        FROM chunks_fts
        JOIN content_chunks c ON chunks_fts.rowid = c.id
        JOIN files f ON c.file_id = f.id
        ${where}
        ORDER BY rank ASC, f.file_mtime DESC
        LIMIT ?
      `

      const rows = this.db.prepare(sql).all(...params, limit) as any[]
      return rows.map(r => ({
        id: r.id,
        file_id: r.file_id,
        file_path: r.file_path,
        file_name: r.file_name,
        content_snippet: String(r.content_snippet || '').replace(/\u0000/g, ''),
        rank: r.rank,
        chunk_index: r.chunk_index,
        note_date: r.note_date,
        file_mtime: r.file_mtime
      }))
    } catch (error) {
      console.error('⚠️ [Database] FTS search failed, falling back:', error)
      return this.searchContent(query, limit)
    }
  }

  // ========================
  // EMBEDDINGS HELPERS
  // ========================

  /** Return up to limit chunk rows missing embeddings for the specified model */
  public getChunksNeedingEmbeddings(model: string, limit: number = 100): Array<{ id: number; file_id: number; chunk_text: string }> {
    if (!this.db) throw new Error('Database not initialized')
    const sql = `
      SELECT c.id, c.file_id, c.chunk_text
      FROM content_chunks c
      LEFT JOIN embeddings e ON e.chunk_id = c.id AND e.model = ?
      WHERE e.chunk_id IS NULL
      LIMIT ?
    `
    return this.db.prepare(sql).all(model, limit) as any
  }

  public upsertEmbedding(chunkId: number, vector: number[], model: string): void {
    if (!this.db) throw new Error('Database not initialized')
    const dim = vector.length
    const vectorJson = JSON.stringify(vector)
    const sql = `
      INSERT OR REPLACE INTO embeddings (chunk_id, vector, dim, model)
      VALUES (?, ?, ?, ?)
    `
    this.db.prepare(sql).run(chunkId, vectorJson, dim, model)
  }

  /** Count of embeddings for model and total chunk count */
  public getEmbeddingsStats(model: string): { embeddedCount: number; chunkCount: number } {
    if (!this.db) throw new Error('Database not initialized')
    const embedded = this.db.prepare('SELECT COUNT(*) as c FROM embeddings WHERE model = ?').get(model) as { c: number }
    const chunks = this.db.prepare('SELECT COUNT(*) as c FROM content_chunks').get() as { c: number }
    return { embeddedCount: embedded.c, chunkCount: chunks.c }
  }

  /** Load embeddings for a model with associated chunk and file metadata */
  public getEmbeddingsForModel(model: string): Array<{ chunk_id: number; file_id: number; file_path: string; file_name: string; chunk_text: string; vector: number[] }> {
    if (!this.db) throw new Error('Database not initialized')
    const sql = `
      SELECT e.chunk_id, c.file_id, f.path as file_path, f.name as file_name, c.chunk_text, e.vector
      FROM embeddings e
      JOIN content_chunks c ON c.id = e.chunk_id
      JOIN files f ON f.id = c.file_id
      WHERE e.model = ?
    `
    const rows = this.db.prepare(sql).all(model) as any[]
    return rows.map(r => ({
      chunk_id: r.chunk_id,
      file_id: r.file_id,
      file_path: r.file_path,
      file_name: r.file_name,
      chunk_text: r.chunk_text,
      vector: (() => { try { return JSON.parse(r.vector) } catch { return [] } })()
    }))
  }

  /** Clear all embeddings (for rebuild) */
  public clearEmbeddings(model?: string): void {
    if (!this.db) throw new Error('Database not initialized')
    if (model) {
      this.db.prepare('DELETE FROM embeddings WHERE model = ?').run(model)
    } else {
      this.db.prepare('DELETE FROM embeddings').run()
    }
  }

  /** Load file by chunk id (for recency boost and metadata) */
  public getFileMetaByChunkId(chunkId: number): { id: number; path: string; name: string; file_mtime?: string } | null {
    if (!this.db) throw new Error('Database not initialized')
    const sql = `
      SELECT f.id, f.path, f.name, f.file_mtime
      FROM content_chunks c
      JOIN files f ON f.id = c.file_id
      WHERE c.id = ?
      LIMIT 1
    `
    const row = this.db.prepare(sql).get(chunkId) as any
    return row || null
  }

  /** Fetch neighboring chunks around a given chunk index for a file */
  public getNeighborChunks(fileId: number, centerChunkIndex: number, window: number = 1): Array<{ chunk_index: number; chunk_text: string }> {
    if (!this.db) throw new Error('Database not initialized')
    const start = Math.max(0, centerChunkIndex - window)
    const end = centerChunkIndex + window
    const sql = `
      SELECT chunk_index, chunk_text
      FROM content_chunks
      WHERE file_id = ? AND chunk_index BETWEEN ? AND ?
      ORDER BY chunk_index ASC
    `
    return this.db.prepare(sql).all(fileId, start, end) as Array<{ chunk_index: number; chunk_text: string }>
  }

  public getDatabaseFilePath(): string {
    return this.dbPath
  }

  /** Force update note_date for all files by re-parsing content */
  public updateAllNoteDates(): { updated: number } {
    if (!this.db) throw new Error('Database not initialized')
    
    let updated = 0
    const files = this.db.prepare('SELECT id, path, name, content FROM files').all() as Array<{id: number, path: string, name: string, content: string}>
    
    const updateStmt = this.db.prepare('UPDATE files SET note_date = ? WHERE id = ?')
    
    for (const file of files) {
      const noteDate = this.deriveNoteDate(file.name, file.content)
      if (noteDate) {
        updateStmt.run(noteDate, file.id)
        updated++
        console.log(`📅 [Database] Updated note_date for "${file.name}": ${noteDate}`)
      }
    }
    
    console.log(`✅ [Database] Updated note_date for ${updated}/${files.length} files`)
    return { updated }
  }
}

// Export singleton instance
export const database = new IslaDatabase() 