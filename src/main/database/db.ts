import Database from 'better-sqlite3'
import { join, normalize, resolve } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync, unlinkSync, statSync } from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

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
      CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats (updated_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages (chat_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages (created_at);
      CREATE INDEX IF NOT EXISTS idx_settings_key ON app_settings (key);
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON content_chunks (file_id, chunk_index);
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

    // Add chunk_hash to content_chunks if missing
    try {
      const chunkCols: Array<{name: string}> = this.db.prepare("PRAGMA table_info(content_chunks)").all() as any
      const hasChunkHash = chunkCols.some(c => c.name === 'chunk_hash')
      if (!hasChunkHash) {
        this.db.exec("ALTER TABLE content_chunks ADD COLUMN chunk_hash TEXT")
        // Index to speed up matching
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_file_hash ON content_chunks (file_id, chunk_hash)")
      }
    } catch (e) {
      console.warn('⚠️ [Database] Failed to ensure chunk_hash on content_chunks:', e)
    }

    // Add heading_path, section_title, token_count to content_chunks if missing
    try {
      const chunkCols2: Array<{name: string}> = this.db.prepare("PRAGMA table_info(content_chunks)").all() as any
      const hasHeadingPath = chunkCols2.some(c => c.name === 'heading_path')
      const hasSectionTitle = chunkCols2.some(c => c.name === 'section_title')
      const hasTokenCount = chunkCols2.some(c => c.name === 'token_count')
      if (!hasHeadingPath) this.db.exec("ALTER TABLE content_chunks ADD COLUMN heading_path TEXT")
      if (!hasSectionTitle) this.db.exec("ALTER TABLE content_chunks ADD COLUMN section_title TEXT")
      if (!hasTokenCount) this.db.exec("ALTER TABLE content_chunks ADD COLUMN token_count INTEGER")
    } catch (e) {
      console.warn('⚠️ [Database] Failed to add heading metadata on content_chunks:', e)
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
          PRIMARY KEY (chunk_id, model),
          FOREIGN KEY (chunk_id) REFERENCES content_chunks (id) ON DELETE CASCADE
        );
      `)
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings (model)`)
      console.log('✅ [Database] Embeddings table ready')
    } catch (e) {
      console.warn('⚠️ [Database] Failed to ensure embeddings table:', e)
    }

    // Ensure embeddings table has composite primary key; migrate if needed
    try {
      this.migrateEmbeddingsSchemaIfNeeded()
    } catch (e) {
      console.warn('⚠️ [Database] Embeddings schema migration skipped/failed:', e)
    }
  }

  private deriveNoteDate(fileName: string, content?: string): string | null {
    // Try filename ISO date
    const m = fileName.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3]
      const dt = new Date(Date.UTC(y, mo - 1, d))
      return dt.toISOString().slice(0, 10)
    }
    // Optionally inspect content (frontmatter) - minimal pass
    if (content) {
      const fm = content.match(/date:\s*(\d{4}-\d{2}-\d{2})/i)
      if (fm) return fm[1]
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

  /** Compute a stable hash for a chunk */
  private computeChunkHash(text: string): string {
    return crypto.createHash('sha1').update(text).digest('hex')
  }

  /**
   * Break content into chunks and update FTS index (diff by chunk hash)
   */
  private updateContentChunks(fileId: number, filePath: string, fileName: string, content: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const chunks = this.chunkContent(content)

    // Load existing chunks for file
    const existingRows = this.db.prepare('SELECT id, chunk_hash, chunk_index FROM content_chunks WHERE file_id = ?').all(fileId) as Array<{ id:number, chunk_hash:string|null, chunk_index:number }>

    const hashToIds = new Map<string, number[]>()
    for (const row of existingRows) {
      if (!row.chunk_hash) continue
      const arr = hashToIds.get(row.chunk_hash) || []
      arr.push(row.id)
      hashToIds.set(row.chunk_hash, arr)
    }

    const toInsert: typeof chunks = []
    const keep: Array<{ id:number; index:number; hash:string }> = []

    for (const nc of chunks) {
      const pool = hashToIds.get(nc.hash)
      if (pool && pool.length) {
        const id = pool.shift()!
        keep.push({ id, index: nc.index, hash: nc.hash })
      } else {
        toInsert.push(nc)
      }
    }

    // Any remaining ids in hashToIds are removals
    const toDeleteIds: number[] = []
    for (const arr of hashToIds.values()) {
      for (const id of arr) toDeleteIds.push(id)
    }

    const updateIndexStmt = this.db.prepare('UPDATE content_chunks SET chunk_index = ? WHERE id = ?')
    const insertChunkStmt = this.db.prepare('INSERT INTO content_chunks (file_id, chunk_text, chunk_index, chunk_hash, heading_path, section_title, token_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const deleteChunkStmt = this.db.prepare('DELETE FROM content_chunks WHERE id = ?')

    const insertFts = this.ftsReady ? this.db.prepare('INSERT INTO chunks_fts(rowid, chunk_text, file_id) VALUES(?, ?, ?)') : null
    const deleteFts = this.ftsReady ? this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?') : null

    const tx = this.db.transaction(() => {
      // Delete removed
      for (const id of toDeleteIds) {
        deleteChunkStmt.run(id)
        if (deleteFts) deleteFts.run(id)
      }
      // Insert new
      for (const ins of toInsert) {
        const res = insertChunkStmt.run(fileId, ins.text, ins.index, ins.hash, ins.headingPath, ins.sectionTitle, ins.tokenCount)
        const newId = Number(res.lastInsertRowid)
        if (insertFts) insertFts.run(newId, ins.text, fileId)
      }
      // Update index for kept (no text change)
      for (const k of keep) {
        updateIndexStmt.run(k.index, k.id)
      }
    })

    tx()

    console.log(`📝 [Database] Indexed ${chunks.length} chunks for ${fileName} (inserted ${toInsert.length}, removed ${toDeleteIds.length}, kept ${keep.length})`)
  }

  /**
   * Estimate tokens ~4 chars per token
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.trim().length / 4)
  }

  /**
   * Split markdown into structural units (paragraphs, code blocks) with heading breadcrumbs
   */
  private splitMarkdown(content: string): Array<{ text: string; headingPath: string; sectionTitle: string }> {
    const lines = content.replace(/\r\n?/g, '\n').split('\n')
    const headingLevels: string[] = []
    const units: Array<{ text: string; headingPath: string; sectionTitle: string }> = []
    let i = 0
    let inCode = false
    let codeFence = ''
    let buffer: string[] = []
    let sectionTitle = ''

    const flushBuffer = () => {
      if (buffer.length === 0) return
      const text = buffer.join('\n').trim()
      if (text) {
        const headingPath = headingLevels.filter(Boolean).join(' > ')
        units.push({ text, headingPath, sectionTitle })
      }
      buffer = []
    }

    while (i < lines.length) {
      const line = lines[i]
      const hMatch = !inCode && line.match(/^(#{1,6})\s+(.+?)\s*$/)
      const fenceMatch = line.match(/^```(.*)$/)

      if (fenceMatch) {
        if (!inCode) {
          // start code block
          inCode = true
          codeFence = fenceMatch[1] || ''
          buffer.push(line)
        } else {
          // end code block
          buffer.push(line)
          inCode = false
          flushBuffer()
        }
        i++
        continue
      }

      if (hMatch && !inCode) {
        // heading found
        flushBuffer()
        const level = hMatch[1].length
        const title = hMatch[2].trim()
        headingLevels.length = level
        headingLevels[level - 1] = title
        sectionTitle = title
        i++
        continue
      }

      if (!inCode && line.trim() === '') {
        // paragraph break
        flushBuffer()
        i++
        continue
      }

      buffer.push(line)
      i++
    }
    flushBuffer()
    return units
  }

  /**
   * Break content into markdown-aware, token-based chunks (~450 tokens, 50 overlap)
   */
  private chunkContent(content: string): Array<{ text: string; index: number; hash: string; headingPath: string; sectionTitle: string; tokenCount: number }> {
    const targetTokens = 450
    const overlapTokens = 60
    const units = this.splitMarkdown(content)
    const chunks: Array<{ text: string; index: number; hash: string; headingPath: string; sectionTitle: string; tokenCount: number }> = []

    let current: string[] = []
    let currentTokens = 0
    let currentHeading = ''
    let currentSection = ''

    const pushChunk = () => {
      const text = current.join('\n').trim()
      if (!text) return
      const tokenCount = this.estimateTokens(text)
      const headingPath = currentHeading
      const sectionTitle = currentSection
      chunks.push({ text, index: chunks.length, hash: this.computeChunkHash(text), headingPath, sectionTitle, tokenCount })
    }

    for (let uIndex = 0; uIndex < units.length; uIndex++) {
      const u = units[uIndex]
      const tTokens = this.estimateTokens(u.text)
      if (currentTokens === 0) { currentHeading = u.headingPath; currentSection = u.sectionTitle }

      if (currentTokens + tTokens > targetTokens && current.length > 0) {
        pushChunk()
        // overlap: keep last unit
        const last = current.length ? current[current.length - 1] : ''
        current = last ? [last] : []
        currentTokens = last ? this.estimateTokens(last) : 0
        currentHeading = u.headingPath
        currentSection = u.sectionTitle
      }
      current.push(u.text)
      currentTokens += tTokens

      // proactively split very long single units
      if (tTokens > targetTokens * 1.2) {
        // split by sentences
        const sentences = u.text.split(/(?<=[.!?])\s+/)
        let buf: string[] = []
        let bufT = 0
        for (const s of sentences) {
          const sT = this.estimateTokens(s)
          if (bufT + sT > targetTokens) {
            const part = buf.join(' ').trim()
            if (part) {
              chunks.push({ text: part, index: chunks.length, hash: this.computeChunkHash(part), headingPath: u.headingPath, sectionTitle: u.sectionTitle, tokenCount: this.estimateTokens(part) })
            }
            buf = [s]
            bufT = sT
          } else {
            buf.push(s)
            bufT += sT
          }
        }
        const remain = buf.join(' ').trim()
        if (remain) {
          chunks.push({ text: remain, index: chunks.length, hash: this.computeChunkHash(remain), headingPath: u.headingPath, sectionTitle: u.sectionTitle, tokenCount: this.estimateTokens(remain) })
        }
        current = []
        currentTokens = 0
      }
    }

    if (currentTokens > 0) pushChunk()

    // enforce overlap by trimming if necessary
    // (already handled when pushing)

    return chunks
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
        .filter(word => word.length > 2) // Only words longer than 2 chars
        .slice(0, 3) // Max 3 words to keep it simple

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
            1 as rank
          FROM content_chunks c
          JOIN files f ON c.file_id = f.id
          WHERE LOWER(c.chunk_text) LIKE '%' || ? || '%'
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
  public addChatMessage(chatId: number, role: 'user' | 'assistant' | 'system', content: string): ChatMessageRecord {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(() => {
      // Insert message
      const insertMessage = this.db!.prepare(`
        INSERT INTO chat_messages (chat_id, role, content) 
        VALUES (?, ?, ?)
      `)
      const result = insertMessage.run(chatId, role, content)

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
        SELECT id, chat_id, role, content, created_at 
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
      const query = this.db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC')
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
      const existing = this.db.prepare('SELECT file_mtime FROM files WHERE path = ?').get(normalizedPath) as { file_mtime: string } | undefined
      
      if (!existing || !existing.file_mtime) {
        // File doesn't exist in database (or missing mtime), needs processing
        return true
      }
      
      const dbFileMtime = new Date(existing.file_mtime)
      // File needs processing if filesystem mtime is newer than stored file mtime
      return currentMtime > dbFileMtime
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
      // Basic FTS5 match string: quote the whole query for now
      const match = query.replace(/['\"]+/g, ' ').trim()

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
        rank: r.rank
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
      INSERT INTO embeddings (chunk_id, vector, dim, model)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chunk_id, model) DO UPDATE SET
        vector = excluded.vector,
        dim = excluded.dim,
        created_at = CURRENT_TIMESTAMP
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

  private migrateEmbeddingsSchemaIfNeeded(): void {
    if (!this.db) throw new Error('Database not initialized')
    try {
      // Check current schema
      const pragma = this.db.prepare("PRAGMA table_info(embeddings)").all() as Array<{ name: string, pk: number }>
      const hasChunkId = pragma.some(c => c.name === 'chunk_id')
      const hasModel = pragma.some(c => c.name === 'model')
      const pkCols = pragma.filter(c => c.pk === 1).map(c => c.name)
      const isOldSchema = hasChunkId && hasModel && pkCols.length === 1 && pkCols[0] === 'chunk_id'

      if (!isOldSchema) return

      console.log('🔧 [Database] Migrating embeddings schema to composite primary key (chunk_id, model)...')

      // Create new table with desired schema
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings_new (
          chunk_id INTEGER NOT NULL,
          vector TEXT NOT NULL,
          dim INTEGER NOT NULL,
          model TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (chunk_id, model),
          FOREIGN KEY (chunk_id) REFERENCES content_chunks (id) ON DELETE CASCADE
        );
      `)

      // Copy data from old table (deduplicate by last write per chunk)
      // If multiple rows somehow exist, prefer the most recent
      this.db.exec(`
        INSERT OR IGNORE INTO embeddings_new (chunk_id, vector, dim, model, created_at)
        SELECT chunk_id, vector, dim, model, created_at
        FROM embeddings;
      `)

      // Replace old table
      this.db.exec('DROP TABLE IF EXISTS embeddings;')
      this.db.exec('ALTER TABLE embeddings_new RENAME TO embeddings;')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings (model);')

      console.log('✅ [Database] Embeddings schema migration complete')
    } catch (e) {
      console.warn('⚠️ [Database] Embeddings schema migration skipped/failed:', e)
    }
  }

  /** Return most recent files by file_mtime or modified_at */
  public getRecentFiles(limit: number = 10): Array<{ id: number; path: string; name: string; content: string; file_mtime: string | null }>{
    if (!this.db) throw new Error('Database not initialized')
    const sql = `
      SELECT id, path, name, content, COALESCE(file_mtime, modified_at) as file_mtime
      FROM files
      ORDER BY datetime(COALESCE(file_mtime, modified_at)) DESC
      LIMIT ?
    `
    return this.db.prepare(sql).all(limit) as any
  }

  /** Return recent chunks joined with file metadata (for general query fallback) */
  public getRecentChunks(limit: number = 20): Array<{ id:number; file_id:number; file_path:string; file_name:string; content_snippet:string }>{
    if (!this.db) throw new Error('Database not initialized')
    const sql = `
      SELECT c.id, c.file_id, f.path as file_path, f.name as file_name,
             substr(c.chunk_text, 1, 200) as content_snippet
      FROM content_chunks c
      JOIN files f ON f.id = c.file_id
      ORDER BY datetime(COALESCE(f.file_mtime, f.modified_at)) DESC, c.chunk_index ASC
      LIMIT ?
    `
    return this.db.prepare(sql).all(limit) as any
  }

  /** Build a context window around a chunk (previous..next) and return combined snippet with file metadata */
  public getChunkWindow(chunkId: number, window: number = 1): { id:number; file_id:number; file_path:string; file_name:string; content_snippet:string } | null {
    if (!this.db) throw new Error('Database not initialized')
    const row = this.db.prepare('SELECT id, file_id, chunk_index FROM content_chunks WHERE id = ?').get(chunkId) as { id:number; file_id:number; chunk_index:number } | undefined
    if (!row) return null
    const start = row.chunk_index - window
    const end = row.chunk_index + window
    const sql = `
      SELECT c.chunk_text, c.chunk_index, f.path as file_path, f.name as file_name, c.file_id
      FROM content_chunks c
      JOIN files f ON f.id = c.file_id
      WHERE c.file_id = ? AND c.chunk_index BETWEEN ? AND ?
      ORDER BY c.chunk_index ASC
    `
    const parts = this.db.prepare(sql).all(row.file_id, start, end) as Array<{ chunk_text:string; chunk_index:number; file_path:string; file_name:string; file_id:number }>
    if (!parts.length) return null
    const snippet = parts.map(p => p.chunk_text).join(' ')
    return { id: row.id, file_id: parts[0].file_id, file_path: parts[0].file_path, file_name: parts[0].file_name, content_snippet: snippet.slice(0, 600) }
  }
}

// Export singleton instance
export const database = new IslaDatabase() 