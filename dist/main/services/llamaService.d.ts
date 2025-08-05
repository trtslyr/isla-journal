import { BrowserWindow } from 'electron';
import { ModelRecommendation } from './deviceDetection';
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
}
export interface ModelStatus {
    isInstalled: boolean;
    isLoading: boolean;
    downloadProgress?: number;
    error?: string;
}
export declare class LlamaService {
    private static instance;
    private ollama;
    private deviceService;
    private currentModel;
    private isInitialized;
    private mainWindow;
    static getInstance(): LlamaService;
    private constructor();
    setMainWindow(window: BrowserWindow): void;
    /**
     * Safe logging that handles EPIPE errors gracefully
     */
    private safeLog;
    initialize(): Promise<void>;
    private checkOllamaStatus;
    getModelStatus(modelName: string): Promise<ModelStatus>;
    private ensureModelAvailable;
    sendMessage(messages: ChatMessage[], onProgress?: (chunk: string) => void): Promise<string>;
    getAvailableModels(): Promise<string[]>;
    getCurrentModel(): string | null;
    switchModel(modelName: string): Promise<void>;
    getRecommendedModelInfo(): Promise<ModelRecommendation>;
}
//# sourceMappingURL=llamaService.d.ts.map