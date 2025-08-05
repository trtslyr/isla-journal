import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'

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

  constructor() {
    // Cross-platform database path
    this.dbPath = this.getDatabasePath()
  }

  /**
   * Get platform-specific database path
   * - macOS: ~/Library/Application Support/Isla Journal/
   * - Windows: %APPDATA%/Isla Journal/
   * - Linux: ~/.local/share/Isla Journal/
   */
  private getDatabasePath(): string {
    const userDataPath = app.getPath('userData')
    const dbDir = join(userDataPath, 'database')
    
    // Ensure directory exists
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }
    
    return join(dbDir, 'isla.db')
  }

  /**
   * Initialize database and create tables
   */
  public initialize(): void {
    try {
      // Ensure database directory exists
      const dbDir = path.dirname(this.dbPath)
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true })
      }

      this.db = new Database(this.dbPath)
      console.log('🗄️ [Database] Connected to SQLite database')

      // Enable WAL mode for better concurrency and safety
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('cache_size = 10000')
      this.db.pragma('foreign_keys = ON')

      // Create tables if they don't exist
      this.createTables()
      console.log('📋 [Database] Tables and indexes created')
      console.log('🔧 [Database] Schema validation completed (FTS removed)')

      console.log('✅ [Database] SQLite initialized successfully')
    } catch (error) {
      console.error('❌ [Database] Failed to initialize:', error)
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
    `)

    console.log('📋 [Database] Tables and indexes created')
  }

  /**
   * Save or update file content in database
   */
  public saveFile(filePath: string, fileName: string, content: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, name, content, modified_at, size)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
    `)
    
    const result = stmt.run(filePath, fileName, content, content.length)
    const fileId = result.lastInsertRowid as number

    // Update content chunks for FTS
    this.updateContentChunks(fileId, filePath, fileName, content)
    
    console.log(`✅ [Database] Saved file: ${fileName}`)
  }

  /**
   * Break content into chunks and update FTS index
   */
  private updateContentChunks(fileId: number, filePath: string, fileName: string, content: string): void {
    if (!this.db) throw new Error('Database not initialized')

    // Clear existing chunks for this file
    this.db.prepare('DELETE FROM content_chunks WHERE file_id = ?').run(fileId)

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
   * Get file content from database
   */
  public getFile(filePath: string): FileRecord | null {
    if (!this.db) throw new Error('Database not initialized')

    const select = this.db.prepare('SELECT * FROM files WHERE path = ?')
    return select.get(filePath) as FileRecord || null
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
        this.db.close()
        this.db = null
      }
      
      // Delete the corrupted database file
      const fs = require('fs')
      if (fs.existsSync(this.dbPath)) {
        fs.unlinkSync(this.dbPath)
      }
      
      // Reinitialize completely
      this.initialize()
      console.log('✅ [Database] Successfully recreated database')
    } catch (error) {
      console.error('❌ [Database] Failed to recreate database:', error)
      throw error
    }
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
   * Check if a file needs to be processed (new or modified)
   */
  public needsProcessing(filePath: string, currentMtime: Date): boolean {
    if (!this.db) throw new Error('Database not initialized')

    try {
      const existing = this.db.prepare('SELECT modified_at FROM files WHERE path = ?').get(filePath) as { modified_at: string } | undefined
      
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
   * Get file by path with error handling
   */
  public getFileByPath(filePath: string): FileRecord | null {
    if (!this.db) throw new Error('Database not initialized')

    try {
      return this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath) as FileRecord || null
    } catch (error) {
      console.error('❌ [Database] Error getting file by path:', error)
      return null
    }
  }

  // fixDatabaseSchema method removed - no longer needed without FTS

  /**
   * Close database connection
   */
  public close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      console.log('🔒 [Database] Connection closed')
    }
  }
}

// Export singleton instance
export const database = new IslaDatabase() 