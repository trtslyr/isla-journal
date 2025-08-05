import { VectorDatabase } from './vectorDatabase';
export declare class FileWatcher {
    private static instance;
    private watcher;
    private embeddingService;
    private vectorDatabase;
    private watchedPath;
    private debounceTimeout;
    private constructor();
    static getInstance(): FileWatcher;
    /**
     * Start watching a directory for file changes
     */
    startWatching(dirPath: string, vectorDatabase: VectorDatabase): Promise<void>;
    /**
     * Stop watching files
     */
    stopWatching(): Promise<void>;
    /**
     * Debounce file processing to avoid rapid-fire events
     */
    private debounceProcessFile;
    /**
     * Process a single file (add/update embeddings)
     */
    private processFile;
    /**
     * Handle file deletion (remove embeddings)
     */
    private handleFileDelete;
    /**
     * Get current watched path
     */
    getWatchedPath(): string | null;
    /**
     * Check if currently watching files
     */
    isWatching(): boolean;
    /**
     * Get watcher statistics
     */
    getStats(): {
        isWatching: boolean;
        watchedPath: string | null;
        pendingOperations: number;
    };
}
//# sourceMappingURL=fileWatcher.d.ts.map