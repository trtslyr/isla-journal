export interface FileRecord {
    id: number;
    path: string;
    name: string;
    content: string;
    created_at: string;
    modified_at: string;
    size: number;
}
export interface SearchIndex {
    id: number;
    file_id: number;
    word: string;
    position: number;
}
export interface ChatRecord {
    id: number;
    title: string;
    created_at: string;
    updated_at: string;
    is_active: boolean;
}
export interface ChatMessageRecord {
    id: number;
    chat_id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    created_at: string;
}
export interface AppSettings {
    id: number;
    key: string;
    value: string;
    updated_at: string;
}
export interface SearchResult {
    id: number;
    file_id: number;
    file_path: string;
    file_name: string;
    content_snippet: string;
    rank: number;
}
export interface ContentChunk {
    id: number;
    file_id: number;
    chunk_text: string;
    chunk_index: number;
    created_at: string;
}
declare class IslaDatabase {
    private db;
    private dbPath;
    private isWindows;
    constructor();
    /**
     * Normalize file paths for cross-platform storage
     * Converts Windows backslashes to forward slashes for consistent storage
     */
    private normalizeFilePath;
    /**
     * Get platform-specific database path with enhanced cross-platform support
     * - macOS: ~/Library/Application Support/Isla Journal/database/
     * - Windows: %APPDATA%/Isla Journal/database/
     * - Linux: ~/.local/share/Isla Journal/database/
     * - Fallback: ~/.isla-journal/database/
     */
    private getDatabasePath;
    /**
     * Initialize database and create tables with Windows-specific optimizations
     */
    initialize(): void;
    /**
     * Handle Windows-specific SQLite locking issues
     */
    private handleWindowsLockError;
    /**
     * Create database schema
     */
    private createTables;
    /**
     * Save or update file content in database with cross-platform path normalization
     */
    saveFile(filePath: string, fileName: string, content: string): void;
    /**
     * Break content into chunks and update FTS index
     */
    private updateContentChunks;
    /**
     * Split content into overlapping chunks
     */
    private chunkContent;
    /**
     * Search content using simple LIKE queries
     */
    searchContent(query: string, limit?: number): SearchResult[];
    /**
     * Get file content by ID
     */
    getFileContent(fileId: number): string | null;
    /**
     * Get file content from database with cross-platform path normalization
     */
    getFile(filePath: string): FileRecord | null;
    /**
     * Clear all indexed content (useful when switching directories)
     */
    clearAllContent(): void;
    private forceRecreateDatabase;
    /**
     * Perform the actual database file cleanup with enhanced Windows support
     */
    private performDatabaseCleanup;
    /**
     * Delete file with retry logic for Windows file locking issues
     */
    private deleteFileWithRetry;
    /**
     * Update search index for a file
     */
    private updateSearchIndex;
    /**
     * Get database statistics
     */
    getStats(): {
        fileCount: number;
        chunkCount: number;
        indexSize: number;
    };
    /**
     * Get a setting value
     */
    getSetting(key: string): string | null;
    /**
     * Set a setting value
     */
    setSetting(key: string, value: string): void;
    /**
     * Create a new chat conversation
     */
    createChat(title: string): ChatRecord;
    /**
     * Get all chat conversations
     */
    getAllChats(): ChatRecord[];
    /**
     * Get active chat
     */
    getActiveChat(): ChatRecord | null;
    /**
     * Set active chat
     */
    setActiveChat(chatId: number): void;
    /**
     * Add message to chat
     */
    addChatMessage(chatId: number, role: 'user' | 'assistant' | 'system', content: string): ChatMessageRecord;
    /**
     * Get messages for a chat with optional limit and conversation context
     */
    getChatMessages(chatId: number, limit?: number): ChatMessageRecord[];
    /**
     * Delete chat and all its messages
     */
    deleteChat(chatId: number): void;
    /**
     * Rename a chat
     */
    renameChat(chatId: number, newTitle: string): void;
    /**
     * Get all app settings
     */
    getAllSettings(): Record<string, string>;
    /**
     * Check if a file needs to be processed (new or modified) with cross-platform path handling
     */
    needsProcessing(filePath: string, currentMtime: Date): boolean;
    /**
     * Get file by path with error handling and cross-platform path normalization
     */
    getFileByPath(filePath: string): FileRecord | null;
    /**
     * Close database connection with Windows-specific cleanup
     */
    close(): void;
}
export declare const database: IslaDatabase;
export {};
//# sourceMappingURL=db.d.ts.map