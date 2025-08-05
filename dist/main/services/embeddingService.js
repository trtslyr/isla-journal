"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingService = void 0;
const ollama_1 = require("ollama");
class EmbeddingService {
    static getInstance() {
        if (!EmbeddingService.instance) {
            EmbeddingService.instance = new EmbeddingService();
        }
        return EmbeddingService.instance;
    }
    constructor() {
        this.isInitialized = false;
        this.embeddingModel = 'nomic-embed-text';
        this.ollama = new ollama_1.Ollama({ host: 'http://127.0.0.1:11434' });
    }
    /**
     * Initialize the embedding service
     */
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            console.log('🧠 [EmbeddingService] Initializing with Ollama...');
            // Check if embedding model is available, pull if needed
            await this.ensureEmbeddingModel();
            this.isInitialized = true;
            console.log('✅ [EmbeddingService] Initialized successfully');
        }
        catch (error) {
            console.error('❌ [EmbeddingService] Initialization failed:', error);
            throw error;
        }
    }
    async ensureEmbeddingModel() {
        try {
            // Check if model exists
            const models = await this.ollama.list();
            const hasModel = models.models.some(model => model.name.includes(this.embeddingModel));
            if (!hasModel) {
                console.log(`📥 [EmbeddingService] Downloading ${this.embeddingModel}...`);
                await this.ollama.pull({ model: this.embeddingModel });
                console.log(`✅ [EmbeddingService] Downloaded ${this.embeddingModel}`);
            }
            else {
                console.log(`✅ [EmbeddingService] Model ${this.embeddingModel} already available`);
            }
        }
        catch (error) {
            console.error(`❌ [EmbeddingService] Error with model ${this.embeddingModel}:`, error);
            throw error;
        }
    }
    /**
     * Generate embeddings for text chunks
     */
    async generateEmbeddings(chunks) {
        if (!this.isInitialized) {
            throw new Error('EmbeddingService not initialized');
        }
        try {
            console.log(`🧠 [EmbeddingService] Generating embeddings for ${chunks.length} chunks`);
            const results = [];
            for (const chunk of chunks) {
                const response = await this.ollama.embeddings({
                    model: this.embeddingModel,
                    prompt: chunk
                });
                results.push({
                    text: chunk,
                    embedding: response.embedding
                });
            }
            console.log(`✅ [EmbeddingService] Generated ${results.length} embeddings`);
            return results;
        }
        catch (error) {
            console.error('❌ [EmbeddingService] Error generating embeddings:', error);
            throw error;
        }
    }
    /**
     * Generate single embedding for search queries
     */
    async generateEmbedding(text) {
        if (!this.isInitialized) {
            throw new Error('EmbeddingService not initialized');
        }
        try {
            const response = await this.ollama.embeddings({
                model: this.embeddingModel,
                prompt: text
            });
            return response.embedding;
        }
        catch (error) {
            console.error('❌ [EmbeddingService] Error generating single embedding:', error);
            throw error;
        }
    }
    /**
     * Calculate cosine similarity between two vectors
     */
    static cosineSimilarity(a, b) {
        if (a.length !== b.length) {
            throw new Error('Vectors must have the same length');
        }
        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            magnitudeA += a[i] * a[i];
            magnitudeB += b[i] * b[i];
        }
        magnitudeA = Math.sqrt(magnitudeA);
        magnitudeB = Math.sqrt(magnitudeB);
        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }
        return dotProduct / (magnitudeA * magnitudeB);
    }
    /**
     * Simple text chunking - breaks text into smaller pieces for embedding
     */
    static chunkText(text, chunkSize = 500, overlap = 50) {
        if (text.length <= chunkSize) {
            return [text];
        }
        const chunks = [];
        let start = 0;
        while (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            const chunk = text.slice(start, end);
            // Try to break at word boundaries
            if (end < text.length) {
                const lastSpaceIndex = chunk.lastIndexOf(' ');
                if (lastSpaceIndex > 0) {
                    chunks.push(chunk.slice(0, lastSpaceIndex));
                    start += lastSpaceIndex + 1 - overlap;
                }
                else {
                    chunks.push(chunk);
                    start += chunkSize - overlap;
                }
            }
            else {
                chunks.push(chunk);
                break;
            }
        }
        return chunks.filter(chunk => chunk.trim().length > 0);
    }
    isReady() {
        return this.isInitialized;
    }
}
exports.EmbeddingService = EmbeddingService;
//# sourceMappingURL=embeddingService.js.map