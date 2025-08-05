import { EmbeddingResult } from './embeddingService';
export interface VectorSearchResult {
    filePath: string;
    content: string;
    similarity: number;
    startIndex: number;
    endIndex: number;
}
export interface StoredVector {
    id: number;
    filePath: string;
    content: string;
    startIndex: number;
    endIndex: number;
    embedding: number[];
}
export declare class VectorDatabase {
    private static instance;
    private vectors;
    private isInitialized;
    private nextId;
    private metadataPath;
    private dimension;
    private constructor();
    static getInstance(dataDir: string): VectorDatabase;
    /**
     * Initialize the vector database
     */
    initialize(): Promise<void>;
    /**
     * Load existing vectors from disk
     */
    private loadVectors;
    /**
     * Add embeddings to the vector database
     */
    addEmbeddings(embeddings: EmbeddingResult[]): Promise<void>;
    /**
     * Remove embeddings for a specific file
     */
    removeFileEmbeddings(filePath: string): Promise<void>;
    /**
     * Search for similar vectors using linear search and cosine similarity
     */
    search(queryEmbedding: number[], topK?: number): Promise<VectorSearchResult[]>;
    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity;
    /**
     * Save vectors to disk
     */
    private saveVectors;
    /**
     * Get statistics about the vector database
     */
    getStats(): {
        vectorCount: number;
        dimension: number;
        metadataSize: string;
    };
    /**
     * Clear all vectors
     */
    clear(): Promise<void>;
    /**
     * Check if database is ready
     */
    isReady(): boolean;
}
//# sourceMappingURL=vectorDatabase.d.ts.map