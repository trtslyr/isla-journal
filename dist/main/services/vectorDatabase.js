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
exports.VectorDatabase = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class VectorDatabase {
    constructor(dataDir) {
        this.vectors = new Map();
        this.isInitialized = false;
        this.nextId = 0;
        this.dimension = 384; // Embedding dimension
        this.metadataPath = path.join(dataDir, 'vector_metadata.json');
    }
    static getInstance(dataDir) {
        if (!VectorDatabase.instance) {
            VectorDatabase.instance = new VectorDatabase(dataDir);
        }
        return VectorDatabase.instance;
    }
    /**
     * Initialize the vector database
     */
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            console.log('🗄️ [VectorDB] Initializing simple vector database...');
            // Load existing vectors if they exist
            await this.loadVectors();
            this.isInitialized = true;
            console.log(`✅ [VectorDB] Initialized with ${this.vectors.size} vectors`);
        }
        catch (error) {
            console.error('❌ [VectorDB] Failed to initialize:', error);
            throw error;
        }
    }
    /**
     * Load existing vectors from disk
     */
    async loadVectors() {
        try {
            if (fs.existsSync(this.metadataPath)) {
                console.log('📥 [VectorDB] Loading existing vectors...');
                const metadataJson = fs.readFileSync(this.metadataPath, 'utf-8');
                const metadata = JSON.parse(metadataJson);
                this.nextId = metadata.nextId || 0;
                // Rebuild vectors map
                this.vectors.clear();
                for (const vectorData of metadata.vectors || []) {
                    this.vectors.set(vectorData.id, vectorData);
                }
                console.log(`📥 [VectorDB] Loaded ${this.vectors.size} vectors from disk`);
            }
            else {
                console.log('🆕 [VectorDB] No existing vectors found, starting fresh');
            }
        }
        catch (error) {
            console.error('❌ [VectorDB] Failed to load vectors:', error);
            // Continue with empty database
            this.vectors.clear();
            this.nextId = 0;
        }
    }
    /**
     * Add embeddings to the vector database
     */
    async addEmbeddings(embeddings) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        let addedCount = 0;
        for (const result of embeddings) {
            for (const chunk of result.chunks) {
                try {
                    const id = this.nextId++;
                    // Store vector metadata
                    const storedVector = {
                        id,
                        filePath: result.filePath,
                        content: chunk.content,
                        startIndex: chunk.startIndex,
                        endIndex: chunk.endIndex,
                        embedding: chunk.embedding
                    };
                    this.vectors.set(id, storedVector);
                    addedCount++;
                }
                catch (error) {
                    console.error(`❌ [VectorDB] Failed to add chunk from ${result.filePath}:`, error);
                }
            }
        }
        console.log(`✅ [VectorDB] Added ${addedCount} vectors to database`);
        // Auto-save after adding
        await this.saveVectors();
    }
    /**
     * Remove embeddings for a specific file
     */
    async removeFileEmbeddings(filePath) {
        if (!this.isInitialized)
            return;
        const toRemove = [];
        for (const [id, vector] of this.vectors) {
            if (vector.filePath === filePath) {
                toRemove.push(id);
            }
        }
        for (const id of toRemove) {
            this.vectors.delete(id);
        }
        if (toRemove.length > 0) {
            console.log(`🗑️ [VectorDB] Removed ${toRemove.length} vectors for ${filePath}`);
            await this.saveVectors();
        }
    }
    /**
     * Search for similar vectors using linear search and cosine similarity
     */
    async search(queryEmbedding, topK = 10) {
        if (!this.isInitialized || this.vectors.size === 0) {
            return [];
        }
        try {
            const searchResults = [];
            // Linear search through all vectors
            let maxSimilarity = 0;
            for (const vector of this.vectors.values()) {
                try {
                    const similarity = this.cosineSimilarity(queryEmbedding, vector.embedding);
                    if (similarity > maxSimilarity) {
                        maxSimilarity = similarity;
                    }
                    // Include all results for now, filter later
                    searchResults.push({
                        filePath: vector.filePath,
                        content: vector.content,
                        similarity,
                        startIndex: vector.startIndex,
                        endIndex: vector.endIndex
                    });
                }
                catch (error) {
                    // Skip this vector if similarity calculation fails
                    continue;
                }
            }
            console.log(`🔍 [VectorDB] Max similarity found: ${maxSimilarity.toFixed(4)}`);
            // Sort by similarity and return top K
            return searchResults
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK);
        }
        catch (error) {
            console.error('❌ [VectorDB] Search failed:', error);
            return [];
        }
    }
    /**
     * Calculate cosine similarity between two vectors
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length)
            return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
    /**
     * Save vectors to disk
     */
    async saveVectors() {
        try {
            const metadata = {
                nextId: this.nextId,
                vectors: Array.from(this.vectors.values())
            };
            fs.writeFileSync(this.metadataPath, JSON.stringify(metadata, null, 2));
            console.log('✅ [VectorDB] Vectors saved successfully');
        }
        catch (error) {
            console.error('❌ [VectorDB] Failed to save vectors:', error);
        }
    }
    /**
     * Get statistics about the vector database
     */
    getStats() {
        const vectorCount = this.vectors.size;
        const metadataSize = fs.existsSync(this.metadataPath)
            ? `${(fs.statSync(this.metadataPath).size / 1024 / 1024).toFixed(2)} MB`
            : '0 MB';
        return {
            vectorCount,
            dimension: this.dimension,
            metadataSize
        };
    }
    /**
     * Clear all vectors
     */
    async clear() {
        this.vectors.clear();
        this.nextId = 0;
        // Remove metadata file
        if (fs.existsSync(this.metadataPath)) {
            fs.unlinkSync(this.metadataPath);
        }
        console.log('🧹 [VectorDB] Cleared all vectors');
    }
    /**
     * Check if database is ready
     */
    isReady() {
        return this.isInitialized;
    }
}
exports.VectorDatabase = VectorDatabase;
//# sourceMappingURL=vectorDatabase.js.map