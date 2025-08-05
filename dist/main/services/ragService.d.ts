export interface SearchResult {
    text: string;
    similarity: number;
    fileName: string;
    filePath: string;
}
export declare class RAGService {
    private static instance;
    private embeddingService;
    private isEnabled;
    static getInstance(): RAGService;
    private constructor();
    /**
     * Initialize RAG service (graceful failure)
     */
    initialize(): Promise<void>;
    /**
     * Process directory and create embeddings for markdown files
     */
    processDirectory(directoryPath: string, files: Array<{
        name: string;
        path: string;
        type: string;
    }>): Promise<void>;
    /**
     * Process a single file and create embeddings
     */
    private processFile;
    /**
     * Search for similar content using RAG
     */
    search(query: string, maxResults?: number): Promise<SearchResult[]>;
    /**
     * Get RAG context for LLM
     */
    getContext(query: string): Promise<string>;
    isReady(): boolean;
}
//# sourceMappingURL=ragService.d.ts.map