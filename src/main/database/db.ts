import Database from 'better-sqlite3'
import { join, normalize, resolve } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
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

      // Apply schema migrations for added columns (idempotent)
      this.migrateSchema()

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

  private migrateSchema(): void {
    if (!this.db) throw new Error('Database not initialized')
    try {
      const columns: Array<{ name: string }> = this.db.prepare("PRAGMA table_info(files)").all() as any
      const names = new Set(columns.map(c => c.name))
      if (!names.has('file_mtime')) {
        this.db.exec("ALTER TABLE files ADD COLUMN file_mtime DATETIME")
      }
      if (!names.has('note_date')) {
        this.db.exec("ALTER TABLE files ADD COLUMN note_date DATE")
      }
      // Ensure new index exists
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_files_note_date ON files (note_date)")
    } catch (e) {
      console.warn('⚠️ [Database] Migration warning:', e)
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
        size INTEGER DEFAULT 0,
        file_mtime DATETIME,
        note_date DATE
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

    // Embeddings table for hybrid retrieval
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_id INTEGER PRIMARY KEY,
        vector TEXT NOT NULL,
        dim INTEGER NOT NULL,
        model TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chunk_id) REFERENCES content_chunks (id) ON DELETE CASCADE
      )
    `)

    // Create FTS5 virtual table for chunk text with external content table linkage
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          chunk_text,
          file_id UNINDEXED,
          content='content_chunks', content_rowid='id'
        );
      `)
      // Triggers to keep FTS in sync with content_chunks
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS content_chunks_ai AFTER INSERT ON content_chunks BEGIN
          INSERT INTO chunks_fts(rowid, chunk_text, file_id) VALUES (new.id, new.chunk_text, new.file_id);
        END;
      `)
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS content_chunks_ad AFTER DELETE ON content_chunks BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, chunk_text, file_id) VALUES('delete', old.id, old.chunk_text, old.file_id);
        END;
      `)
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS content_chunks_au AFTER UPDATE ON content_chunks BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, chunk_text, file_id) VALUES('delete', old.id, old.chunk_text, old.file_id);
          INSERT INTO chunks_fts(rowid, chunk_text, file_id) VALUES (new.id, new.chunk_text, new.file_id);
        END;
      `)
    } catch (e) {
      console.warn('⚠️ [Database] FTS5 unavailable or failed to initialize. Falling back to LIKE search.', e)
    }

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
      CREATE INDEX IF NOT EXISTS idx_embeddings_file_id ON embeddings (chunk_id);
      CREATE INDEX IF NOT EXISTS idx_files_note_date ON files (note_date);
      CREATE INDEX IF NOT EXISTS idx_search_word ON search_index (word);
      CREATE INDEX IF NOT EXISTS idx_search_file ON search_index (file_id);
      CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats (updated_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages (chat_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages (created_at);
      CREATE INDEX IF NOT EXISTS idx_settings_key ON app_settings (key);
    `)

    console.log('📋 [Database] Tables and indexes created')
  }

  /**
   * Save or update file content in database with cross-platform path normalization
   */
  public saveFile(filePath: string, fileName: string, content: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Normalize file path for consistent cross-platform storage
    const normalizedPath = this.normalizeFilePath(filePath)

    // Derive mtime from filesystem when available
    let fileMtime: string | null = null
    try {
      const { statSync } = require('fs')
      const st = statSync(filePath)
      fileMtime = new Date(st.mtime).toISOString()
    } catch {}

    // Derive note_date from filename or content
    const noteDate = this.deriveNoteDate(fileName, content)

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, name, content, modified_at, size, file_mtime, note_date)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, COALESCE(?, file_mtime), COALESCE(?, note_date))
    `)
    const result = stmt.run(normalizedPath, fileName, content, content.length, fileMtime, noteDate)
    const fileId = result.lastInsertRowid as number

    // Update content chunks for search
    this.updateContentChunks(fileId, normalizedPath, fileName, content)
    
    console.log(`✅ [Database] Saved file: ${fileName} (${normalizedPath})`)
  }

  private deriveNoteDate(fileName: string, content: string): string | null {
    try {
      // Try ISO date in filename: 2024-05-10 or 2024-05
      const m1 = fileName.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/)
      if (m1) {
        const y = +m1[1], m = +m1[2], d = m1[3] ? +m1[3] : 1
        return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
      }
      // Try first date-like heading in content
      const m2 = content.match(/^(?:#|##|###)\s*(\d{4}-\d{2}-\d{2})/m)
      if (m2) return m2[1]
    } catch {}
    return null
  }

  /**
   * Break content into chunks and update FTS index
   */
  private updateContentChunks(fileId: number, filePath: string, fileName: string, content: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Clear existing chunks for this file
    this.db.prepare('DELETE FROM content_chunks WHERE file_id = ?').run(fileId)
    // Also clear embeddings for chunks of this file (will be regenerated lazily)
    this.db.prepare('DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM content_chunks WHERE file_id = ?)').run(fileId)

    // Split content into chunks (500 chars with 100 char overlap)
    const chunks = this.chunkContent(content)
    
    const insertChunk = this.db.prepare(`
      INSERT INTO content_chunks (file_id, chunk_text, chunk_index)
      VALUES (?, ?, ?)
    `)

    chunks.forEach((chunk, index) => {
      insertChunk.run(fileId, chunk, index)
    })

    console.log(`📝 [Database] Indexed ${chunks.length} chunks for ${fileName}`)
  }

  /**
   * Split content into overlapping chunks
   */
  private chunkContent(content: string): string[] {
    const chunkSize = 500
    const overlap = 100
    const chunks: string[] = []
    
    // Clean content
    const cleanContent = content.replace(/\s+/g, ' ').trim()
    
    for (let i = 0; i < cleanContent.length; i += (chunkSize - overlap)) {
      const chunk = cleanContent.slice(i, i + chunkSize)
      if (chunk.trim().length > 50) { // Only add meaningful chunks
        chunks.push(chunk.trim())
      }
    }
    
    return chunks.length > 0 ? chunks : [cleanContent]
  }

  /**
   * Search content using FTS5 if available; falls back to LIKE
   */
  public searchContentFTS(query: string, limit: number = 20, dateRange?: { start: Date, end: Date }): SearchResult[] {
    if (!this.db) throw new Error('Database not initialized')

    try {
      // If chunks_fts doesn't exist, fallback to LIKE search
      const hasFts = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get() as any
      if (!hasFts) {
        return this.searchContent(query, limit)
      }

      // Sanitize query for FTS to avoid syntax errors (e.g., '?' or special chars)
      const sanitizedTokens = query
        .toLowerCase()
        .replace(/["'*?!@#$%^&()+={}[\\]|\\\:\";'<>,.]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 5)
      if (sanitizedTokens.length === 0) {
        console.log('⚠️ [Database] No valid tokens for FTS. Falling back to LIKE search')
        return this.searchContent(query, limit)
      }
      const ftsQuery = sanitizedTokens.join(' ')

      const params: any[] = []
      let dateFilterSql = ''
      if (dateRange) {
        dateFilterSql = ' AND ( (f.note_date IS NOT NULL AND f.note_date >= ? AND f.note_date < ?) OR (f.note_date IS NULL AND f.file_mtime IS NOT NULL AND f.file_mtime >= ? AND f.file_mtime < ?) )'
        const startIso = dateRange.start.toISOString().slice(0, 10)
        const endIso = dateRange.end.toISOString().slice(0, 10)
        params.push(startIso, endIso, dateRange.start.toISOString(), dateRange.end.toISOString())
      }

      const stmt = this.db.prepare(`
        SELECT 
          c.id as id,
          c.file_id as file_id,
          f.path as file_path,
          f.name as file_name,
          snippet(chunks_fts, 0, '<mark>', '</mark>', '…', 10) as content_snippet,
          bm25(chunks_fts) as rank
        FROM chunks_fts 
        JOIN content_chunks c ON chunks_fts.rowid = c.id
        JOIN files f ON c.file_id = f.id
        WHERE chunks_fts MATCH ? ${dateFilterSql}
        ORDER BY rank
        LIMIT ?
      `)

      const results = stmt.all(ftsQuery, ...params, limit) as SearchResult[]
      return results
    } catch (error) {
      console.error('❌ [Database] FTS search error, falling back:', error)
      return this.searchContent(query, limit)
    }
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
      
      // indexSize now represents content_chunks (our actual search index)
      const indexSize = chunkCount.count
      
      return {
        fileCount: fileCount.count,
        chunkCount: chunkCount.count,
        indexSize: indexSize
      }
    } catch (error) {
      console.error('❌ [Database] Error getting stats:', error)
      return { fileCount: 0, chunkCount: 0, indexSize: 0 }
    }
  }

  // ========================
  // EMBEDDINGS
  // ========================

  public listChunksNeedingEmbeddings(limit: number = 100): Array<{ id: number; file_id: number; chunk_text: string; file_name: string; file_path: string }> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(`
      SELECT c.id, c.file_id, c.chunk_text, f.name as file_name, f.path as file_path
      FROM content_chunks c
      JOIN files f ON c.file_id = f.id
      LEFT JOIN embeddings e ON e.chunk_id = c.id
      WHERE e.chunk_id IS NULL
      ORDER BY c.id ASC
      LIMIT ?
    `)
    return stmt.all(limit) as any
  }

  public upsertEmbedding(chunkId: number, vector: number[], dim: number, model: string): void {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(`
      INSERT INTO embeddings (chunk_id, vector, dim, model, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(chunk_id) DO UPDATE SET vector=excluded.vector, dim=excluded.dim, model=excluded.model, created_at=CURRENT_TIMESTAMP
    `)
    stmt.run(chunkId, JSON.stringify(vector), dim, model)
  }

  public getEmbeddingStats(): { total: number } {
    if (!this.db) throw new Error('Database not initialized')
    const row = this.db.prepare('SELECT COUNT(*) as total FROM embeddings').get() as { total: number }
    return { total: row.total }
  }

  // Compatibility: return embeddings joined with chunk and file info
  public getEmbeddingsForModel(model: string): Array<{ chunk_id: number; file_id: number; file_path: string; file_name: string; chunk_text: string; vector: number[] }>{
    if (!this.db) throw new Error('Database not initialized')
    const rows = this.db.prepare(`
      SELECT e.chunk_id, e.vector, c.file_id, c.chunk_text, f.name as file_name, f.path as file_path
      FROM embeddings e
      JOIN content_chunks c ON e.chunk_id = c.id
      JOIN files f ON c.file_id = f.id
      WHERE e.model = ?
    `).all(model) as Array<{ chunk_id:number; vector:string; file_id:number; chunk_text:string; file_name:string; file_path:string }>
    return rows.map(r => {
      let v: number[] = []
      try { v = JSON.parse(r.vector) } catch {}
      return { chunk_id: r.chunk_id, file_id: r.file_id, file_path: r.file_path, file_name: r.file_name, chunk_text: r.chunk_text, vector: v }
    })
  }

  // Compatibility wrapper expected by IPC: list chunks missing embeddings (model-agnostic)
  public getChunksNeedingEmbeddings(model: string, limit: number = 50): Array<{ id: number; file_id: number; chunk_text: string; file_name: string; file_path: string }>{
    // Current schema stores one embedding per chunk (overwrites by model). We treat any missing embedding as needing work.
    return this.listChunksNeedingEmbeddings(limit)
  }

  // Compatibility wrapper: upsert without dim parameter
  public upsertEmbeddingCompat(chunkId: number, vector: number[], model: string): void {
    this.upsertEmbedding(chunkId, vector, vector.length, model)
  }

  // Compatibility: stats per model (best-effort with current schema)
  public getEmbeddingsStats(model: string): { embeddedCount: number; chunkCount: number }{
    if (!this.db) throw new Error('Database not initialized')
    const embedded = this.db.prepare('SELECT COUNT(*) as c FROM embeddings WHERE model = ?').get(model) as { c: number }
    const chunks = this.db.prepare('SELECT COUNT(*) as c FROM content_chunks').get() as { c: number }
    return { embeddedCount: embedded.c, chunkCount: chunks.c }
  }
  public topByEmbeddingSimilarity(queryVector: number[], limit: number = 20): Array<{ file_id: number; file_path: string; file_name: string; content_snippet: string; sim: number }>{
    if (!this.db) throw new Error('Database not initialized')
    const rows = this.db.prepare(`
      SELECT e.chunk_id, e.vector, c.file_id, c.chunk_text, f.name as file_name, f.path as file_path
      FROM embeddings e
      JOIN content_chunks c ON e.chunk_id = c.id
      JOIN files f ON c.file_id = f.id
    `).all() as Array<{ chunk_id: number; vector: string; file_id: number; chunk_text: string; file_name: string; file_path: string }>

    const q = queryVector
    const qLen = Math.sqrt(q.reduce((s, v) => s + v*v, 0)) || 1
    const scored = rows.map(r => {
      let v: number[] = []
      try { v = JSON.parse(r.vector) } catch {}
      const vLen = Math.sqrt(v.reduce((s, x) => s + x*x, 0)) || 1
      const dot = Math.min(q.length, v.length) ? q.slice(0, Math.min(q.length, v.length)).reduce((s, x, i) => s + x * (v[i] || 0), 0) : 0
      const sim = dot / (qLen * vLen)
      return {
        file_id: r.file_id,
        file_path: r.file_path,
        file_name: r.file_name,
        content_snippet: r.chunk_text.slice(0, 200),
        sim
      }
    })

    scored.sort((a, b) => b.sim - a.sim)
    return scored.slice(0, limit)
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
   * Delete a file and its chunks by file path
   */
  public deleteFileByPath(filePath: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const normalizedPath = this.normalizeFilePath(filePath)
    const tx = this.db.transaction((p: string) => {
      const file = this.db!.prepare('SELECT id FROM files WHERE path = ?').get(p) as { id: number } | undefined
      if (!file) return
      this.db!.prepare('DELETE FROM content_chunks WHERE file_id = ?').run(file.id)
      this.db!.prepare('DELETE FROM search_index WHERE file_id = ?').run(file.id)
      this.db!.prepare('DELETE FROM files WHERE id = ?').run(file.id)
    })
    tx(normalizedPath)
  }

  /**
   * Update file path and name without re-saving content
   */
  public updateFilePath(oldPath: string, newPath: string, newName?: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const oldNorm = this.normalizeFilePath(oldPath)
    const newNorm = this.normalizeFilePath(newPath)

    const stmt = this.db.prepare('UPDATE files SET path = ?, name = COALESCE(?, name), modified_at = CURRENT_TIMESTAMP WHERE path = ?')
    stmt.run(newNorm, newName || null, oldNorm)
  }

  /**
   * Clear messages for a chat
   */
  public clearChatMessages(chatId: number): void {
    if (!this.db) throw new Error('Database not initialized')
    const del = this.db.prepare('DELETE FROM chat_messages WHERE chat_id = ?')
    del.run(chatId)
    const upd = this.db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    upd.run(chatId)
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
}

// Export singleton instance
export const database = new IslaDatabase() 