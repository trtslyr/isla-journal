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
    constructor();
    /**
     * Get platform-specific database path
     * - macOS: ~/Library/Application Support/Isla Journal/
     * - Windows: %APPDATA%/Isla Journal/
     * - Linux: ~/.local/share/Isla Journal/
     */
    private getDatabasePath;
    /**
     * Initialize database and create tables
     */
    initialize(): void;
    /**
     * Create database schema
     */
    private createTables;
    /**
     * Save or update file content in database
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
     * Get file content from database
     */
    getFile(filePath: string): FileRecord | null;
    /**
     * Search for files using FTS
     */
    searchFiles(query: string, limit?: number): SearchResult[];
    /**
     * Clear all indexed content (useful when switching directories)
     */
    clearAllContent(): void;
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
     * Close database connection
     */
    close(): void;
}
export declare const database: IslaDatabase;
export {};
//# sourceMappingURL=db.d.ts.map