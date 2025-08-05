export interface EmbeddingChunk {
    text: string;
    embedding: number[];
}
export declare class EmbeddingService {
    private static instance;
    private ollama;
    private isInitialized;
    private embeddingModel;
    static getInstance(): EmbeddingService;
    private constructor();
    /**
     * Initialize the embedding service
     */
    initialize(): Promise<void>;
    private ensureEmbeddingModel;
    /**
     * Generate embeddings for text chunks
     */
    generateEmbeddings(chunks: string[]): Promise<EmbeddingChunk[]>;
    /**
     * Generate single embedding for search queries
     */
    generateEmbedding(text: string): Promise<number[]>;
    /**
     * Calculate cosine similarity between two vectors
     */
    static cosineSimilarity(a: number[], b: number[]): number;
    /**
     * Simple text chunking - breaks text into smaller pieces for embedding
     */
    static chunkText(text: string, chunkSize?: number, overlap?: number): string[];
    isReady(): boolean;
}
//# sourceMappingURL=embeddingService.d.ts.map