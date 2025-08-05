export interface RAGResponse {
    answer: string;
    sources: Array<{
        file_name: string;
        file_path: string;
        snippet: string;
    }>;
}
declare class ContentService {
    /**
     * Perform RAG search and generate response with conversation context
     */
    searchAndAnswer(query: string, conversationHistory?: Array<{
        role: string;
        content: string;
    }>): Promise<RAGResponse>;
    /**
     * Just search without LLM (for testing)
     */
    searchOnly(query: string, limit?: number): import("../database/db").SearchResult[];
    /**
     * Get full file content by ID
     */
    getFileContent(fileId: number): string | null;
}
export declare const contentService: ContentService;
export {};
//# sourceMappingURL=contentService.d.ts.map