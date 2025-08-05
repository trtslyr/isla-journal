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
            // Check if Ollama is running with retry logic
            let ollamaAvailable = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await this.checkOllamaStatus();
                    ollamaAvailable = true;
                    break;
                }
                catch (error) {
                    this.safeLog(`❌ [LlamaService] Ollama check attempt ${attempt}/3 failed: ${error}`);
                    if (attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
                    }
                }
            }
            if (!ollamaAvailable) {
                this.safeLog('❌ [LlamaService] Ollama not available after 3 attempts. Service will be partially initialized.', 'error');
                // Don't throw - allow app to continue with limited functionality
                return;
            }
            // Get recommended model for this device with fallback
            let recommendation;
            try {
                recommendation = await this.deviceService.getRecommendedModel();
                this.safeLog(`🎯 [LlamaService] Recommended model: ${recommendation.displayName}`);
            }
            catch (error) {
                this.safeLog(`❌ [LlamaService] Failed to get device recommendation, using fallback`, 'error');
                // Use universal fallback model
                recommendation = {
                    modelName: 'gemma2:2b',
                    displayName: 'Gemma 2 2B (Fallback)',
                    minMemory: 2,
                    description: 'Universal compatibility, minimal resource usage',
                    downloadSize: '1.6GB',
                    compatiblePlatforms: ['windows', 'macos', 'linux'],
                    compatibleArchitectures: ['x64', 'arm64'],
                    isOptimized: false
                };
            }
            // Try to ensure model is available with multiple fallbacks
            const modelsToTry = [
                recommendation.modelName,
                recommendation.fallbackModel,
                'gemma2:2b',
                'llama3.2:latest'
            ].filter(Boolean); // Remove undefined values
            let modelLoaded = false;
            for (const modelName of modelsToTry) {
                try {
                    this.safeLog(`🔄 [LlamaService] Trying to load model: ${modelName}`);
                    await this.ensureModelAvailable(modelName, (progress, status) => {
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('llm:downloadProgress', {
                                modelName: modelName,
                                progress,
                                status
                            });
                        }
                    });
                    this.currentModel = modelName;
                    modelLoaded = true;
                    this.safeLog(`✅ [LlamaService] Successfully loaded model: ${modelName}`);
                    break;
                }
                catch (error) {
                    this.safeLog(`❌ [LlamaService] Failed to load model ${modelName}: ${error}`);
                    continue;
                }
            }
            if (!modelLoaded) {
                this.safeLog('❌ [LlamaService] No models could be loaded. Service will run without local model.', 'error');
                // Still mark as initialized to prevent retry loops
            }
            this.isInitialized = true;
            this.safeLog('✅ [LlamaService] Initialization completed');
        }
        catch (error) {
            this.safeLog(`❌ [LlamaService] Initialization failed: ${error}`, 'error');
            // Mark as initialized to prevent retry loops, but with no model
            this.isInitialized = true;
            this.currentModel = null;
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