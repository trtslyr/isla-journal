"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlamaService = void 0;
const ollama_1 = require("ollama");
const deviceDetection_1 = require("./deviceDetection");
class LlamaService {
    static getInstance() {
        if (!LlamaService.instance) {
            LlamaService.instance = new LlamaService();
        }
        return LlamaService.instance;
    }
    constructor() {
        this.currentModel = null;
        this.isInitialized = false;
        this.mainWindow = null;
        this.ollama = new ollama_1.Ollama({ host: 'http://127.0.0.1:11434' });
        this.deviceService = deviceDetection_1.DeviceDetectionService.getInstance();
    }
    setMainWindow(window) {
        this.mainWindow = window;
    }
    /**
     * Safe logging that handles EPIPE errors gracefully
     */
    safeLog(message, level = 'log') {
        try {
            if (level === 'error') {
                console.error(message);
            }
            else {
                console.log(message);
            }
        }
        catch (error) {
            // Handle EPIPE errors silently to prevent app crashes
            if (error?.code === 'EPIPE') {
                // Pipe is broken, ignore the log to prevent crash
                return;
            }
            // Re-throw other errors
            throw error;
        }
    }
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            this.safeLog('🚀 [LlamaService] Initializing...');
            // Check if Ollama is running
            await this.checkOllamaStatus();
            // Get recommended model for this device
            const recommendation = await this.deviceService.getRecommendedModel();
            this.safeLog(`🎯 [LlamaService] Recommended model: ${recommendation.displayName}`);
            // Check if model is installed, download if needed
            await this.ensureModelAvailable(recommendation.modelName, (progress, status) => {
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('llm:downloadProgress', {
                        modelName: recommendation.modelName,
                        progress,
                        status
                    });
                }
            });
            this.currentModel = recommendation.modelName;
            this.isInitialized = true;
            this.safeLog('✅ [LlamaService] Initialized successfully');
        }
        catch (error) {
            this.safeLog(`❌ [LlamaService] Initialization failed: ${error}`, 'error');
            throw error;
        }
    }
    async checkOllamaStatus() {
        try {
            const models = await this.ollama.list();
            this.safeLog('✅ [LlamaService] Ollama is running');
        }
        catch (error) {
            this.safeLog('❌ [LlamaService] Ollama not running. Please install and start Ollama first.', 'error');
            throw new Error('Ollama is not running. Please install Ollama from https://ollama.ai and start it.');
        }
    }
    async getModelStatus(modelName) {
        try {
            const models = await this.ollama.list();
            const isInstalled = models.models.some(model => model.name === modelName);
            return {
                isInstalled,
                isLoading: false
            };
        }
        catch (error) {
            return {
                isInstalled: false,
                isLoading: false,
                error: error.message
            };
        }
    }
    async ensureModelAvailable(modelName, onProgress) {
        const status = await this.getModelStatus(modelName);
        if (!status.isInstalled) {
            console.log(`📥 [LlamaService] Downloading model: ${modelName}`);
            try {
                // Pull the model - this will download it if not available
                const stream = await this.ollama.pull({ model: modelName, stream: true });
                for await (const chunk of stream) {
                    if (chunk.status) {
                        console.log(`📥 [LlamaService] ${chunk.status}`);
                        if (chunk.completed && chunk.total) {
                            const progress = Math.round((chunk.completed / chunk.total) * 100);
                            console.log(`📥 [LlamaService] Download progress: ${progress}%`);
                            if (onProgress) {
                                onProgress(progress, chunk.status);
                            }
                        }
                        else if (onProgress) {
                            onProgress(0, chunk.status);
                        }
                    }
                }
                console.log(`✅ [LlamaService] Model ${modelName} downloaded successfully`);
            }
            catch (error) {
                console.error(`❌ [LlamaService] Failed to download model ${modelName}:`, error);
                throw error;
            }
        }
        else {
            console.log(`✅ [LlamaService] Model ${modelName} already installed`);
        }
    }
    async sendMessage(messages, onProgress) {
        if (!this.isInitialized || !this.currentModel) {
            throw new Error('LlamaService not initialized');
        }
        try {
            console.log(`💬 [LlamaService] Sending message to ${this.currentModel}`);
            // Convert our message format to Ollama format
            const ollamaMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
            if (onProgress) {
                // Streaming response
                let fullResponse = '';
                const stream = await this.ollama.chat({
                    model: this.currentModel,
                    messages: ollamaMessages,
                    stream: true
                });
                for await (const chunk of stream) {
                    if (chunk.message?.content) {
                        fullResponse += chunk.message.content;
                        onProgress(chunk.message.content);
                    }
                }
                return fullResponse;
            }
            else {
                // Non-streaming response
                const response = await this.ollama.chat({
                    model: this.currentModel,
                    messages: ollamaMessages,
                    stream: false
                });
                return response.message.content;
            }
        }
        catch (error) {
            console.error('❌ [LlamaService] Error sending message:', error);
            throw error;
        }
    }
    async getAvailableModels() {
        try {
            const models = await this.ollama.list();
            return models.models.map(model => model.name);
        }
        catch (error) {
            console.error('❌ [LlamaService] Error getting available models:', error);
            return [];
        }
    }
    getCurrentModel() {
        return this.currentModel;
    }
    async switchModel(modelName) {
        console.log(`🔄 [LlamaService] Switching to model: ${modelName}`);
        await this.ensureModelAvailable(modelName, (progress, status) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('llm:downloadProgress', {
                    modelName,
                    progress,
                    status
                });
            }
        });
        this.currentModel = modelName;
        console.log(`✅ [LlamaService] Switched to model: ${modelName}`);
    }
    async getRecommendedModelInfo() {
        return await this.deviceService.getRecommendedModel();
    }
}
exports.LlamaService = LlamaService;
//# sourceMappingURL=llamaService.js.map