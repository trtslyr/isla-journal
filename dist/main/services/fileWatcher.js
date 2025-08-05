"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileWatcher = void 0;
const chokidar_1 = require("chokidar");
const embeddingService_1 = require("./embeddingService");
const path = __importStar(require("path"));
class FileWatcher {
    constructor() {
        this.watcher = null;
        this.watchedPath = null;
        this.debounceTimeout = new Map();
        this.embeddingService = embeddingService_1.EmbeddingService.getInstance();
        // vectorDatabase will be set when we start watching
        this.vectorDatabase = null;
    }
    static getInstance() {
        if (!FileWatcher.instance) {
            FileWatcher.instance = new FileWatcher();
        }
        return FileWatcher.instance;
    }
    /**
     * Start watching a directory for file changes
     */
    async startWatching(dirPath, vectorDatabase) {
        // Stop any existing watcher
        await this.stopWatching();
        try {
            console.log('👁️ [FileWatcher] Starting file watcher for:', dirPath);
            this.watchedPath = dirPath;
            this.vectorDatabase = vectorDatabase;
            // Initialize watcher with options
            this.watcher = (0, chokidar_1.watch)(dirPath, {
                ignored: [
                    /(^|[\/\\])\../, // ignore dotfiles
                    /node_modules/,
                    /\.git/,
                    /\.(jpg|jpeg|png|gif|bmp|svg|ico|pdf|zip|tar|gz)$/i // ignore binary files
                ],
                persistent: true,
                ignoreInitial: true, // Don't trigger events for existing files
                followSymlinks: false,
                depth: 10 // Limit recursion depth
            });
            // Handle file additions
            this.watcher.on('add', (filePath) => {
                if (filePath.endsWith('.md')) {
                    console.log('📄 [FileWatcher] New file detected:', path.basename(filePath));
                    this.debounceProcessFile(filePath, 'add');
                }
            });
            // Handle file changes
            this.watcher.on('change', (filePath) => {
                if (filePath.endsWith('.md')) {
                    console.log('✏️ [FileWatcher] File modified:', path.basename(filePath));
                    this.debounceProcessFile(filePath, 'change');
                }
            });
            // Handle file deletions
            this.watcher.on('unlink', (filePath) => {
                if (filePath.endsWith('.md')) {
                    console.log('🗑️ [FileWatcher] File deleted:', path.basename(filePath));
                    this.handleFileDelete(filePath);
                }
            });
            // Handle directory additions (auto-process markdown files in new dirs)
            this.watcher.on('addDir', (dirPath) => {
                console.log('📁 [FileWatcher] New directory detected:', path.basename(dirPath));
                // The individual files will trigger 'add' events
            });
            // Handle errors
            this.watcher.on('error', (error) => {
                console.error('❌ [FileWatcher] Error:', error);
            });
            console.log('✅ [FileWatcher] File watcher started successfully');
        }
        catch (error) {
            console.error('❌ [FileWatcher] Failed to start watching:', error);
            throw error;
        }
    }
    /**
     * Stop watching files
     */
    async stopWatching() {
        if (this.watcher) {
            console.log('🛑 [FileWatcher] Stopping file watcher');
            await this.watcher.close();
            this.watcher = null;
            this.watchedPath = null;
            // Clear any pending debounced operations
            for (const timeout of this.debounceTimeout.values()) {
                clearTimeout(timeout);
            }
            this.debounceTimeout.clear();
            console.log('✅ [FileWatcher] File watcher stopped');
        }
    }
    /**
     * Debounce file processing to avoid rapid-fire events
     */
    debounceProcessFile(filePath, action) {
        // Clear existing timeout for this file
        const existingTimeout = this.debounceTimeout.get(filePath);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }
        // Set new timeout
        const timeout = setTimeout(() => {
            this.processFile(filePath, action);
            this.debounceTimeout.delete(filePath);
        }, 1000); // Wait 1 second before processing
        this.debounceTimeout.set(filePath, timeout);
    }
    /**
     * Process a single file (add/update embeddings)
     */
    async processFile(filePath, action) {
        try {
            if (!this.embeddingService.isReady() || !this.vectorDatabase?.isReady()) {
                console.log('⏳ [FileWatcher] Embedding system not ready, skipping:', path.basename(filePath));
                return;
            }
            console.log(`🔮 [FileWatcher] Processing ${action}:`, path.basename(filePath));
            // For changes, remove old embeddings first
            if (action === 'change') {
                await this.vectorDatabase.removeFileEmbeddings(filePath);
            }
            // Generate new embeddings
            const embedding = await this.embeddingService.processFile(filePath);
            if (embedding) {
                await this.vectorDatabase.addEmbeddings([embedding]);
                console.log(`✅ [FileWatcher] Embedded ${action} file:`, path.basename(filePath));
            }
            else {
                console.log(`ℹ️ [FileWatcher] No embeddings generated for:`, path.basename(filePath));
            }
        }
        catch (error) {
            console.error(`❌ [FileWatcher] Failed to process ${action}:`, error);
        }
    }
    /**
     * Handle file deletion (remove embeddings)
     */
    async handleFileDelete(filePath) {
        try {
            if (!this.vectorDatabase?.isReady()) {
                return;
            }
            await this.vectorDatabase.removeFileEmbeddings(filePath);
            console.log('✅ [FileWatcher] Removed embeddings for deleted file:', path.basename(filePath));
        }
        catch (error) {
            console.error('❌ [FileWatcher] Failed to remove embeddings for deleted file:', error);
        }
    }
    /**
     * Get current watched path
     */
    getWatchedPath() {
        return this.watchedPath;
    }
    /**
     * Check if currently watching files
     */
    isWatching() {
        return this.watcher !== null;
    }
    /**
     * Get watcher statistics
     */
    getStats() {
        return {
            isWatching: this.isWatching(),
            watchedPath: this.watchedPath,
            pendingOperations: this.debounceTimeout.size
        };
    }
}
exports.FileWatcher = FileWatcher;
//# sourceMappingURL=fileWatcher.js.map