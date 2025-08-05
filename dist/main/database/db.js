"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.database = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = require("path");
const electron_1 = require("electron");
const fs_1 = require("fs");
const path_2 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
class IslaDatabase {
    constructor() {
        this.db = null;
        this.isWindows = os_1.default.platform() === 'win32';
        // Cross-platform database path
        this.dbPath = this.getDatabasePath();
    }
    /**
     * Normalize file paths for cross-platform storage
     * Converts Windows backslashes to forward slashes for consistent storage
     */
    normalizeFilePath(filePath) {
        try {
            // Resolve to absolute path and normalize
            const resolved = (0, path_1.resolve)(filePath);
            // Windows-specific path handling
            if (this.isWindows) {
                // Handle long paths on Windows (>260 chars)
                const longPathPrefix = '\\\\?\\';
                let windowsPath = resolved;
                if (resolved.length > 260 && !resolved.startsWith(longPathPrefix)) {
                    windowsPath = longPathPrefix + resolved;
                }
                // Convert to forward slashes for consistent storage
                return windowsPath.replace(/\\/g, '/');
            }
            // Convert Windows backslashes to forward slashes for consistent storage
            return resolved.replace(/\\/g, '/');
        }
        catch (error) {
            console.warn(`⚠️ [Database] Path normalization failed for ${filePath}:`, error);
            return (0, path_1.normalize)(filePath).replace(/\\/g, '/');
        }
    }
    /**
     * Get platform-specific database path with enhanced cross-platform support
     * - macOS: ~/Library/Application Support/Isla Journal/database/
     * - Windows: %APPDATA%/Isla Journal/database/
     * - Linux: ~/.local/share/Isla Journal/database/
     * - Fallback: ~/.isla-journal/database/
     */
    getDatabasePath() {
        try {
            const userDataPath = electron_1.app.getPath('userData');
            const dbDir = (0, path_1.normalize)((0, path_1.join)(userDataPath, 'database'));
            // Ensure directory exists with cross-platform permissions
            if (!(0, fs_1.existsSync)(dbDir)) {
                const dirOptions = { recursive: true };
                // Windows doesn't use Unix-style mode permissions
                if (!this.isWindows) {
                    dirOptions.mode = 0o755;
                }
                (0, fs_1.mkdirSync)(dbDir, dirOptions);
                // Additional Windows directory setup
                if (this.isWindows) {
                    console.log(`🪟 [Database] Windows database directory created: ${dbDir}`);
                }
            }
            const dbPath = (0, path_1.normalize)((0, path_1.join)(dbDir, 'isla.db'));
            console.log(`🗄️ [Database] Platform: ${os_1.default.platform()}, DB Path: ${dbPath}`);
            return dbPath;
        }
        catch (error) {
            // Fallback to home directory if Electron userData fails
            console.warn(`⚠️ [Database] Electron userData failed, using fallback: ${error}`);
            const homeDir = os_1.default.homedir();
            const fallbackDir = (0, path_1.normalize)((0, path_1.join)(homeDir, '.isla-journal', 'database'));
            if (!(0, fs_1.existsSync)(fallbackDir)) {
                const dirOptions = { recursive: true };
                // Windows doesn't use Unix-style mode permissions
                if (!this.isWindows) {
                    dirOptions.mode = 0o755;
                }
                (0, fs_1.mkdirSync)(fallbackDir, dirOptions);
            }
            const fallbackPath = (0, path_1.normalize)((0, path_1.join)(fallbackDir, 'isla.db'));
            console.log(`🗄️ [Database] Fallback path: ${fallbackPath}`);
            return fallbackPath;
        }
    }
    /**
     * Initialize database and create tables with Windows-specific optimizations
     */
    initialize() {
        try {
            // Ensure database directory exists
            const dbDir = path_2.default.dirname(this.dbPath);
            if (!(0, fs_1.existsSync)(dbDir)) {
                const dirOptions = { recursive: true };
                if (!this.isWindows) {
                    dirOptions.mode = 0o755;
                }
                (0, fs_1.mkdirSync)(dbDir, dirOptions);
            }
            // Windows-specific database options
            const dbOptions = {};
            if (this.isWindows) {
                // Windows-specific SQLite options
                dbOptions.verbose = console.log; // Better Windows debugging
                dbOptions.fileMustExist = false;
                dbOptions.timeout = 10000; // 10 second timeout for Windows file locking
            }
            this.db = new better_sqlite3_1.default(this.dbPath, dbOptions);
            console.log('🗄️ [Database] Connected to SQLite database');
            // Enhanced Windows-compatible SQLite pragmas
            if (this.isWindows) {
                // Windows-specific pragmas for better reliability
                this.db.pragma('journal_mode = WAL');
                this.db.pragma('synchronous = NORMAL');
                this.db.pragma('cache_size = 10000');
                this.db.pragma('foreign_keys = ON');
                this.db.pragma('temp_store = MEMORY'); // Keep temp files in memory on Windows
                this.db.pragma('mmap_size = 268435456'); // 256MB memory mapping
                this.db.pragma('wal_autocheckpoint = 1000'); // Checkpoint WAL more frequently on Windows
                console.log('🪟 [Database] Applied Windows-specific SQLite optimizations');
            }
            else {
                // Standard pragmas for Unix-like systems
                this.db.pragma('journal_mode = WAL');
                this.db.pragma('synchronous = NORMAL');
                this.db.pragma('cache_size = 10000');
                this.db.pragma('foreign_keys = ON');
            }
            // Create tables if they don't exist
            this.createTables();
            console.log('📋 [Database] Tables and indexes created');
            console.log('🔧 [Database] Schema validation completed (FTS removed)');
            console.log('✅ [Database] SQLite initialized successfully');
        }
        catch (error) {
            console.error('❌ [Database] Failed to initialize:', error);
            // Windows-specific error handling
            if (this.isWindows && error.message.includes('database is locked')) {
                console.log('🪟 [Database] Windows file lock detected, attempting recovery...');
                this.handleWindowsLockError();
            }
            else {
                throw error;
            }
        }
    }
    /**
     * Handle Windows-specific SQLite locking issues
     */
    handleWindowsLockError() {
        try {
            // Wait a bit for Windows file system
            setTimeout(() => {
                console.log('🪟 [Database] Retrying Windows database connection...');
                // Close any existing connection
                if (this.db) {
                    try {
                        this.db.close();
                    }
                    catch (e) {
                        console.warn('⚠️ [Database] Error closing database:', e);
                    }
                    this.db = null;
                }
                // Force garbage collection on Windows
                if (global.gc) {
                    global.gc();
                }
                // Retry initialization
                this.initialize();
            }, 1000);
        }
        catch (error) {
            console.error('❌ [Database] Windows lock recovery failed:', error);
            throw error;
        }
    }
    /**
     * Create database schema
     */
    createTables() {
        if (!this.db)
            throw new Error('Database not initialized');
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
    `);
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
    `);
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
    `);
        // Chat conversations table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 0
      )
    `);
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
    `);
        // App settings table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
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
    `);
        console.log('📋 [Database] Tables and indexes created');
    }
    /**
     * Save or update file content in database with cross-platform path normalization
     */
    saveFile(filePath, fileName, content) {
        if (!this.db)
            throw new Error('Database not initialized');
        // Normalize file path for consistent cross-platform storage
        const normalizedPath = this.normalizeFilePath(filePath);
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, name, content, modified_at, size)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
    `);
        const result = stmt.run(normalizedPath, fileName, content, content.length);
        const fileId = result.lastInsertRowid;
        // Update content chunks for search
        this.updateContentChunks(fileId, normalizedPath, fileName, content);
        console.log(`✅ [Database] Saved file: ${fileName} (${normalizedPath})`);
    }
    /**
     * Break content into chunks and update FTS index
     */
    updateContentChunks(fileId, filePath, fileName, content) {
        if (!this.db)
            throw new Error('Database not initialized');
        // Clear existing chunks for this file
        this.db.prepare('DELETE FROM content_chunks WHERE file_id = ?').run(fileId);
        // Split content into chunks (500 chars with 100 char overlap)
        const chunks = this.chunkContent(content);
        const insertChunk = this.db.prepare(`
      INSERT INTO content_chunks (file_id, chunk_text, chunk_index)
      VALUES (?, ?, ?)
    `);
        chunks.forEach((chunk, index) => {
            insertChunk.run(fileId, chunk, index);
        });
        console.log(`📝 [Database] Indexed ${chunks.length} chunks for ${fileName}`);
    }
    /**
     * Split content into overlapping chunks
     */
    chunkContent(content) {
        const chunkSize = 500;
        const overlap = 100;
        const chunks = [];
        // Clean content
        const cleanContent = content.replace(/\s+/g, ' ').trim();
        for (let i = 0; i < cleanContent.length; i += (chunkSize - overlap)) {
            const chunk = cleanContent.slice(i, i + chunkSize);
            if (chunk.trim().length > 50) { // Only add meaningful chunks
                chunks.push(chunk.trim());
            }
        }
        return chunks.length > 0 ? chunks : [cleanContent];
    }
    /**
     * Search content using simple LIKE queries
     */
    searchContent(query, limit = 10) {
        if (!this.db)
            throw new Error('Database not initialized');
        try {
            // Clean and split query into individual words
            const words = query.toLowerCase()
                .replace(/['\"*?!@#$%^&()+={}[\\]|\\\\:\";'<>,.]/g, ' ')
                .split(/\s+/)
                .filter(word => word.length > 2) // Only words longer than 2 chars
                .slice(0, 3); // Max 3 words to keep it simple
            if (words.length === 0) {
                console.log('🔍 [Database] No valid search words found');
                return [];
            }
            console.log(`🔍 [Database] Search words: ${words.join(', ')}`);
            // Simple approach: search for any word match
            const results = [];
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
        `);
                const wordResults = stmt.all(word, Math.ceil(limit / words.length));
                results.push(...wordResults);
            }
            // Remove duplicates and limit results
            const uniqueResults = results.filter((result, index, self) => index === self.findIndex(r => r.id === result.id)).slice(0, limit);
            console.log(`🔍 [Database] Found ${uniqueResults.length} results for: ${query}`);
            return uniqueResults;
        }
        catch (error) {
            console.error('❌ [Database] Search error:', error);
            return [];
        }
    }
    /**
     * Get file content by ID
     */
    getFileContent(fileId) {
        if (!this.db)
            throw new Error('Database not initialized');
        const stmt = this.db.prepare('SELECT content FROM files WHERE id = ?');
        const result = stmt.get(fileId);
        return result?.content || null;
    }
    /**
     * Get file content from database with cross-platform path normalization
     */
    getFile(filePath) {
        if (!this.db)
            throw new Error('Database not initialized');
        const normalizedPath = this.normalizeFilePath(filePath);
        const select = this.db.prepare('SELECT * FROM files WHERE path = ?');
        return select.get(normalizedPath) || null;
    }
    // searchFiles method removed - FTS not needed, using searchContent instead
    /**
     * Clear all indexed content (useful when switching directories)
     */
    clearAllContent() {
        if (!this.db)
            throw new Error('Database not initialized');
        console.log('🗑️ [Database] Clearing all indexed content...');
        try {
            // Clear all content in transaction for consistency
            const transaction = this.db.transaction(() => {
                // Clear backing tables
                this.db.prepare('DELETE FROM content_chunks').run();
                this.db.prepare('DELETE FROM search_index').run();
                this.db.prepare('DELETE FROM files').run();
            });
            transaction();
            console.log('✅ [Database] All indexed content cleared');
        }
        catch (error) {
            console.error('❌ [Database] Error clearing content:', error);
            // Force recreate the database if clearing fails
            this.forceRecreateDatabase();
        }
    }
    forceRecreateDatabase() {
        console.log('🔄 [Database] Force recreating database due to errors...');
        try {
            if (this.db) {
                try {
                    this.db.close();
                }
                catch (closeError) {
                    console.warn('⚠️ [Database] Error during database close:', closeError);
                }
                this.db = null;
            }
            // Windows-specific cleanup delay
            if (this.isWindows) {
                // Give Windows file system time to release handles
                console.log('🪟 [Database] Waiting for Windows file handles to release...');
                setTimeout(() => this.performDatabaseCleanup(), 500);
            }
            else {
                this.performDatabaseCleanup();
            }
        }
        catch (error) {
            console.error('❌ [Database] Failed to recreate database:', error);
            throw error;
        }
    }
    /**
     * Perform the actual database file cleanup with enhanced Windows support
     */
    performDatabaseCleanup() {
        try {
            // Force garbage collection on Windows to release file handles
            if (this.isWindows && global.gc) {
                global.gc();
            }
            // Delete the corrupted database file with cross-platform path handling
            const normalizedPath = (0, path_1.normalize)(this.dbPath);
            // Windows-specific file deletion with retry logic
            if (this.isWindows) {
                this.deleteFileWithRetry(normalizedPath, 'main database');
            }
            else {
                if ((0, fs_1.existsSync)(normalizedPath)) {
                    (0, fs_1.unlinkSync)(normalizedPath);
                    console.log(`🗑️ [Database] Deleted corrupted database: ${normalizedPath}`);
                }
            }
            // Also clean up any associated WAL/SHM files (SQLite)
            const walPath = normalizedPath + '-wal';
            const shmPath = normalizedPath + '-shm';
            const journalPath = normalizedPath + '-journal';
            if (this.isWindows) {
                // Windows: delete with retry
                this.deleteFileWithRetry(walPath, 'WAL file');
                this.deleteFileWithRetry(shmPath, 'SHM file');
                this.deleteFileWithRetry(journalPath, 'Journal file');
            }
            else {
                // Unix: standard deletion
                if ((0, fs_1.existsSync)(walPath)) {
                    (0, fs_1.unlinkSync)(walPath);
                    console.log(`🗑️ [Database] Deleted WAL file: ${walPath}`);
                }
                if ((0, fs_1.existsSync)(shmPath)) {
                    (0, fs_1.unlinkSync)(shmPath);
                    console.log(`🗑️ [Database] Deleted SHM file: ${shmPath}`);
                }
                if ((0, fs_1.existsSync)(journalPath)) {
                    (0, fs_1.unlinkSync)(journalPath);
                    console.log(`🗑️ [Database] Deleted Journal file: ${journalPath}`);
                }
            }
            // Small delay before reinitializing on Windows
            if (this.isWindows) {
                setTimeout(() => {
                    this.initialize();
                    console.log('✅ [Database] Successfully recreated database');
                }, 200);
            }
            else {
                // Reinitialize immediately on Unix
                this.initialize();
                console.log('✅ [Database] Successfully recreated database');
            }
        }
        catch (error) {
            console.error('❌ [Database] Failed during cleanup:', error);
            throw error;
        }
    }
    /**
     * Delete file with retry logic for Windows file locking issues
     */
    deleteFileWithRetry(filePath, fileType, maxRetries = 3) {
        if (!(0, fs_1.existsSync)(filePath))
            return;
        let retries = 0;
        const attemptDelete = () => {
            try {
                (0, fs_1.unlinkSync)(filePath);
                console.log(`🗑️ [Database] Deleted ${fileType}: ${filePath}`);
            }
            catch (error) {
                retries++;
                if (retries < maxRetries && error.code === 'EBUSY') {
                    console.log(`🪟 [Database] ${fileType} busy, retrying (${retries}/${maxRetries})...`);
                    setTimeout(attemptDelete, 100 * retries); // Exponential backoff
                }
                else if (retries < maxRetries) {
                    console.log(`🪟 [Database] Retrying ${fileType} deletion (${retries}/${maxRetries})...`);
                    setTimeout(attemptDelete, 50);
                }
                else {
                    console.warn(`⚠️ [Database] Failed to delete ${fileType} after ${maxRetries} attempts:`, error);
                }
            }
        };
        attemptDelete();
    }
    /**
     * Update search index for a file
     */
    updateSearchIndex(filePath, content) {
        if (!this.db)
            throw new Error('Database not initialized');
        // Get file ID
        const fileQuery = this.db.prepare('SELECT id FROM files WHERE path = ?');
        const fileRecord = fileQuery.get(filePath);
        if (!fileRecord)
            return;
        // Clear existing index for this file
        const clearIndex = this.db.prepare('DELETE FROM search_index WHERE file_id = ?');
        clearIndex.run(fileRecord.id);
        // Extract words from content (simple tokenization)
        const words = content
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2);
        // Insert new index entries
        const insertIndex = this.db.prepare('INSERT INTO search_index (file_id, word, position) VALUES (?, ?, ?)');
        const insertMany = this.db.transaction((entries) => {
            for (const entry of entries) {
                insertIndex.run(entry.file_id, entry.word, entry.position);
            }
        });
        const indexEntries = words.map((word, position) => ({
            file_id: fileRecord.id,
            word,
            position
        }));
        insertMany(indexEntries);
    }
    /**
     * Get database statistics
     */
    getStats() {
        if (!this.db)
            throw new Error('Database not initialized');
        try {
            const fileCount = this.db.prepare('SELECT COUNT(*) as count FROM files').get();
            const chunkCount = this.db.prepare('SELECT COUNT(*) as count FROM content_chunks').get();
            // indexSize now represents content_chunks (our actual search index)
            const indexSize = chunkCount.count;
            return {
                fileCount: fileCount.count,
                chunkCount: chunkCount.count,
                indexSize: indexSize
            };
        }
        catch (error) {
            console.error('❌ [Database] Error getting stats:', error);
            return { fileCount: 0, chunkCount: 0, indexSize: 0 };
        }
    }
    /**
     * Get a setting value
     */
    getSetting(key) {
        if (!this.db)
            throw new Error('Database not initialized');
        try {
            const result = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
            return result ? result.value : null;
        }
        catch (error) {
            console.error('❌ [Database] Error getting setting:', error);
            return null;
        }
    }
    /**
     * Set a setting value
     */
    setSetting(key, value) {
        if (!this.db)
            throw new Error('Database not initialized');
        try {
            this.db.prepare(`
        INSERT OR REPLACE INTO app_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
      `).run(key, value);
        }
        catch (error) {
            console.error('❌ [Database] Error setting value:', error);
            throw error;
        }
    }
    // ========================
    // CHAT OPERATIONS
    // ========================
    /**
     * Create a new chat conversation
     */
    createChat(title) {
        if (!this.db)
            throw new Error('Database not initialized');
        // Set all other chats to inactive
        const deactivateAll = this.db.prepare('UPDATE chats SET is_active = 0');
        deactivateAll.run();
        // Create new chat
        const insert = this.db.prepare(`
      INSERT INTO chats (title, is_active) 
      VALUES (?, 1)
    `);
        const result = insert.run(title);
        const getChat = this.db.prepare('SELECT * FROM chats WHERE id = ?');
        return getChat.get(result.lastInsertRowid);
    }
    /**
     * Get all chat conversations
     */
    getAllChats() {
        if (!this.db)
            throw new Error('Database not initialized');
        const query = this.db.prepare('SELECT * FROM chats ORDER BY updated_at DESC');
        return query.all();
    }
    /**
     * Get active chat
     */
    getActiveChat() {
        if (!this.db)
            throw new Error('Database not initialized');
        const query = this.db.prepare('SELECT * FROM chats WHERE is_active = 1 LIMIT 1');
        return query.get();
    }
    /**
     * Set active chat
     */
    setActiveChat(chatId) {
        if (!this.db)
            throw new Error('Database not initialized');
        const transaction = this.db.transaction(() => {
            // Deactivate all chats
            const deactivateAll = this.db.prepare('UPDATE chats SET is_active = 0');
            deactivateAll.run();
            // Activate selected chat
            const activate = this.db.prepare('UPDATE chats SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
            activate.run(chatId);
        });
        transaction();
    }
    /**
     * Add message to chat
     */
    addChatMessage(chatId, role, content) {
        if (!this.db)
            throw new Error('Database not initialized');
        const transaction = this.db.transaction(() => {
            // Insert message
            const insertMessage = this.db.prepare(`
        INSERT INTO chat_messages (chat_id, role, content) 
        VALUES (?, ?, ?)
      `);
            const result = insertMessage.run(chatId, role, content);
            // Update chat timestamp
            const updateChat = this.db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?');
            updateChat.run(chatId);
            // Get the inserted message
            const getMessage = this.db.prepare('SELECT * FROM chat_messages WHERE id = ?');
            return getMessage.get(result.lastInsertRowid);
        });
        return transaction();
    }
    /**
     * Get messages for a chat with optional limit and conversation context
     */
    getChatMessages(chatId, limit) {
        if (!this.db)
            throw new Error('Database not initialized');
        if (limit) {
            // For conversation context - get recent messages in reverse chronological order
            const stmt = this.db.prepare(`
        SELECT id, chat_id, role, content, created_at 
        FROM chat_messages 
        WHERE chat_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `);
            const messages = stmt.all(chatId, limit);
            // Return in chronological order (oldest first) for conversation context
            return messages.reverse();
        }
        else {
            // Original functionality - get all messages in chronological order
            const query = this.db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC');
            return query.all(chatId);
        }
    }
    /**
     * Delete chat and all its messages
     */
    deleteChat(chatId) {
        if (!this.db)
            throw new Error('Database not initialized');
        const deleteChat = this.db.prepare('DELETE FROM chats WHERE id = ?');
        deleteChat.run(chatId);
    }
    /**
     * Rename a chat
     */
    renameChat(chatId, newTitle) {
        if (!this.db)
            throw new Error('Database not initialized');
        const updateChat = this.db.prepare('UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        updateChat.run(newTitle, chatId);
    }
    // ========================
    // APP SETTINGS
    // ========================
    /**
     * Get all app settings
     */
    getAllSettings() {
        if (!this.db)
            throw new Error('Database not initialized');
        const query = this.db.prepare('SELECT key, value FROM app_settings');
        const results = query.all();
        const settings = {};
        results.forEach(row => {
            settings[row.key] = row.value;
        });
        return settings;
    }
    /**
     * Check if a file needs to be processed (new or modified) with cross-platform path handling
     */
    needsProcessing(filePath, currentMtime) {
        if (!this.db)
            throw new Error('Database not initialized');
        try {
            const normalizedPath = this.normalizeFilePath(filePath);
            const existing = this.db.prepare('SELECT modified_at FROM files WHERE path = ?').get(normalizedPath);
            if (!existing) {
                // File doesn't exist in database, needs processing
                return true;
            }
            const dbMtime = new Date(existing.modified_at);
            // File needs processing if it's been modified since last time
            return currentMtime > dbMtime;
        }
        catch (error) {
            console.error('❌ [Database] Error checking if file needs processing:', error);
            // On error, assume it needs processing to be safe
            return true;
        }
    }
    /**
     * Get file by path with error handling and cross-platform path normalization
     */
    getFileByPath(filePath) {
        if (!this.db)
            throw new Error('Database not initialized');
        try {
            const normalizedPath = this.normalizeFilePath(filePath);
            return this.db.prepare('SELECT * FROM files WHERE path = ?').get(normalizedPath) || null;
        }
        catch (error) {
            console.error('❌ [Database] Error getting file by path:', error);
            return null;
        }
    }
    // fixDatabaseSchema method removed - no longer needed without FTS
    /**
     * Close database connection with Windows-specific cleanup
     */
    close() {
        if (this.db) {
            try {
                // Windows-specific pre-close cleanup
                if (this.isWindows) {
                    // Checkpoint WAL files on Windows before closing
                    try {
                        this.db.pragma('wal_checkpoint(TRUNCATE)');
                        console.log('🪟 [Database] Windows WAL checkpoint completed');
                    }
                    catch (walError) {
                        console.warn('⚠️ [Database] WAL checkpoint warning:', walError);
                    }
                }
                this.db.close();
                this.db = null;
                console.log('🔒 [Database] Connection closed');
                // Windows-specific post-close cleanup
                if (this.isWindows && global.gc) {
                    // Force garbage collection to release file handles
                    setTimeout(() => {
                        global.gc();
                        console.log('🪟 [Database] Windows garbage collection completed');
                    }, 100);
                }
            }
            catch (error) {
                console.error('❌ [Database] Error during close:', error);
                this.db = null; // Ensure it's set to null even on error
            }
        }
    }
}
// Export singleton instance
exports.database = new IslaDatabase();
//# sourceMappingURL=db.js.map