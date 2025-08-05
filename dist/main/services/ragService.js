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
exports.RAGService = void 0;
const embeddingService_1 = require("./embeddingService");
const database_1 = require("../database");
const promises_1 = require("fs/promises");
class RAGService {
    static getInstance() {
        if (!RAGService.instance) {
            RAGService.instance = new RAGService();
        }
        return RAGService.instance;
    }
    constructor() {
        this.isEnabled = false;
        this.embeddingService = embeddingService_1.EmbeddingService.getInstance();
    }
    /**
     * Initialize RAG service (graceful failure)
     */
    async initialize() {
        try {
            console.log('🚀 [RAGService] Initializing...');
            await this.embeddingService.initialize();
            this.isEnabled = true;
            console.log('✅ [RAGService] Initialized successfully');
        }
        catch (error) {
            console.error('❌ [RAGService] Initialization failed:', error);
            this.isEnabled = false;
            // Don't throw - RAG is optional
        }
    }
    /**
     * Process directory and create embeddings for markdown files
     */
    async processDirectory(directoryPath, files) {
        if (!this.isEnabled) {
            console.log('⚠️ [RAGService] Service not enabled, skipping processing');
            return;
        }
        try {
            console.log(`📁 [RAGService] Processing directory: ${directoryPath}`);
            // Filter for markdown files
            const markdownFiles = files.filter(file => file.type === 'file' && file.name.endsWith('.md'));
            console.log(`📄 [RAGService] Found ${markdownFiles.length} markdown files`);
            for (const file of markdownFiles) {
                try {
                    await this.processFile(file.path, file.name);
                }
                catch (error) {
                    console.error(`❌ [RAGService] Error processing ${file.name}:`, error);
                    // Continue with other files
                }
            }
            console.log('✅ [RAGService] Directory processing complete');
        }
        catch (error) {
            console.error('❌ [RAGService] Error processing directory:', error);
        }
    }
    /**
     * Process a single file and create embeddings
     */
    async processFile(filePath, fileName) {
        try {
            console.log(`📄 [RAGService] Processing file: ${fileName}`);
            // Read file content
            const content = await (0, promises_1.readFile)(filePath, 'utf-8');
            if (!content || content.trim().length === 0) {
                console.log(`⚠️ [RAGService] File ${fileName} is empty, skipping`);
                return;
            }
            // Check if file already exists in database
            const existingFile = database_1.database.getFile(filePath);
            const { stat } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            const fileStat = await stat(filePath);
            if (existingFile && existingFile.modified_at === fileStat.mtime.toISOString()) {
                console.log(`⏭️ [RAGService] File ${fileName} unchanged, skipping`);
                return;
            }
            // Save file to database first
            database_1.database.saveFile(filePath, fileName, content);
            const fileId = database_1.database.getFileIdByPath(filePath);
            if (!fileId) {
                throw new Error('Failed to save file to database');
            }
            // Chunk the content
            const chunks = embeddingService_1.EmbeddingService.chunkText(content);
            console.log(`🔗 [RAGService] Created ${chunks.length} chunks for ${fileName}`);
            // Generate embeddings for chunks
            const embeddingChunks = await this.embeddingService.generateEmbeddings(chunks);
            // Save embeddings to database
            database_1.database.saveEmbeddings(fileId, embeddingChunks);
            console.log(`✅ [RAGService] Processed ${fileName}: ${chunks.length} chunks embedded`);
        }
        catch (error) {
            console.error(`❌ [RAGService] Error processing file ${fileName}:`, error);
            throw error;
        }
    }
    /**
     * Search for similar content using RAG
     */
    async search(query, maxResults = 5) {
        if (!this.isEnabled) {
            console.log('⚠️ [RAGService] Service not enabled, returning empty results');
            return [];
        }
        try {
            console.log(`🔍 [RAGService] Searching for: "${query}"`);
            // Generate embedding for query
            const queryEmbedding = await this.embeddingService.generateEmbedding(query);
            // Get all embeddings from database
            const allEmbeddings = database_1.database.getAllEmbeddings();
            if (allEmbeddings.length === 0) {
                console.log('📭 [RAGService] No embeddings found in database');
                return [];
            }
            // Calculate similarities
            const results = allEmbeddings.map(item => ({
                text: item.chunk_text,
                similarity: embeddingService_1.EmbeddingService.cosineSimilarity(queryEmbedding, item.embedding),
                fileName: item.file_name || 'Unknown',
                filePath: item.file_path || ''
            }));
            // Sort by similarity and take top results
            const topResults = results
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, maxResults)
                .filter(result => result.similarity > 0.3); // Minimum similarity threshold
            console.log(`📊 [RAGService] Found ${topResults.length} relevant results`);
            return topResults;
        }
        catch (error) {
            console.error('❌ [RAGService] Search error:', error);
            return [];
        }
    }
    /**
     * Get RAG context for LLM
     */
    async getContext(query) {
        const results = await this.search(query, 3);
        if (results.length === 0) {
            return '';
        }
        const context = results
            .map(result => `[From ${result.fileName}]\n${result.text}`)
            .join('\n\n---\n\n');
        return `Based on your journal entries:\n\n${context}\n\n---\n\n`;
    }
    isReady() {
        return this.isEnabled && this.embeddingService.isReady();
    }
}
exports.RAGService = RAGService;
//# sourceMappingURL=ragService.js.map