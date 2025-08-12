import { Ollama } from 'ollama'
import { BrowserWindow } from 'electron'
import { DeviceDetectionService, ModelRecommendation } from './deviceDetection'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: Date
}

export interface ModelStatus {
  isInstalled: boolean
  isLoading: boolean
  downloadProgress?: number
  error?: string
}

export class LlamaService {
  private static instance: LlamaService
  private ollama: Ollama
  private deviceService: DeviceDetectionService
  private currentModel: string | null = null
  private isInitialized = false
  private mainWindow: BrowserWindow | null = null
  private embeddingModel: string = 'nomic-embed-text'

  public static getInstance(): LlamaService {
    if (!LlamaService.instance) {
      LlamaService.instance = new LlamaService()
    }
    return LlamaService.instance
  }

  private constructor() {
    this.ollama = new Ollama({ host: 'http://127.0.0.1:11434' })
    this.deviceService = DeviceDetectionService.getInstance()
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Safe logging that handles EPIPE errors gracefully
   */
  private safeLog(message: string, level: 'log' | 'error' = 'log'): void {
    try {
      if (level === 'error') {
        console.error(message)
      } else {
        console.log(message)
      }
    } catch (error: any) {
      // Handle EPIPE errors silently to prevent app crashes
      if (error?.code === 'EPIPE') {
        // Pipe is broken, ignore the log to prevent crash
        return
      }
      // Re-throw other errors
      throw error
    }
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return

    try {
      this.safeLog('🚀 [LlamaService] Initializing...')
      
      // Check if Ollama is running with retry logic and better error handling
      let ollamaAvailable = false
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.checkOllamaStatus() 
          ollamaAvailable = true
          break
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          this.safeLog(`❌ [LlamaService] Ollama check attempt ${attempt}/3 failed: ${errorMsg}`)
          
          // Handle specific Windows/Wine socket errors gracefully
          if (errorMsg.includes('EBADF') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND')) {
            this.safeLog(`🪟 [LlamaService] Network error detected (likely Wine/Windows environment without Ollama)`)
            break // Don't retry network errors
          }
          
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds before retry
          }
        }
      }

      if (!ollamaAvailable) {
        this.safeLog('❌ [LlamaService] Ollama not available after 3 attempts. Service will be partially initialized.', 'error')
        // Don't throw - allow app to continue with limited functionality
        return
      }
      
      // Get recommended model for this device with fallback
      let recommendation
      try {
        recommendation = await this.deviceService.getRecommendedModel()
        this.safeLog(`🎯 [LlamaService] Recommended model: ${recommendation.displayName}`)
      } catch (error) {
        this.safeLog(`❌ [LlamaService] Failed to get device recommendation, using fallback`, 'error')
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
        }
      }
      
      // Try to ensure model is available with multiple fallbacks
      const modelsToTry = [
        recommendation.modelName,
        recommendation.fallbackModel,
        'gemma2:2b',
        'llama3.2:latest'
      ].filter(Boolean) // Remove undefined values
      
      let modelLoaded = false
      for (const modelName of modelsToTry) {
        try {
          this.safeLog(`🔄 [LlamaService] Trying to load model: ${modelName}`)
          await this.ensureModelAvailable(modelName!, (progress, status) => {
            if (this.mainWindow) {
              this.mainWindow.webContents.send('llm:downloadProgress', {
                modelName: modelName!,
                progress,
                status
              })
            }
          })
          
          this.currentModel = modelName!
          modelLoaded = true
          this.safeLog(`✅ [LlamaService] Successfully loaded model: ${modelName}`)
          break
        } catch (error) {
          this.safeLog(`❌ [LlamaService] Failed to load model ${modelName}: ${error}`)
          continue
        }
      }
      
      if (!modelLoaded) {
        this.safeLog('❌ [LlamaService] No models could be loaded. Service will run without local model.', 'error')
        // Still mark as initialized to prevent retry loops
      }
      
      this.isInitialized = true
      this.safeLog('✅ [LlamaService] Initialization completed')
      
      // Best effort: ensure embedding model is available in background
      try {
        await this.ensureModelAvailable(this.embeddingModel)
      } catch {}
      
    } catch (error) {
      this.safeLog(`❌ [LlamaService] Initialization failed: ${error}`, 'error')
      // Mark as initialized to prevent retry loops, but with no model
      this.isInitialized = true
      this.currentModel = null
    }
  }

  private async checkOllamaStatus(): Promise<void> {
    try {
      const models = await this.ollama.list()
      this.safeLog('✅ [LlamaService] Ollama is running')
    } catch (error) {
      const platform = process.platform
      let installInstructions = ''
      
      switch (platform) {
        case 'darwin':
          installInstructions = 'Install Ollama for macOS from https://ollama.ai/download/mac'
          break
        case 'win32':
          installInstructions = 'Install Ollama for Windows from https://ollama.ai/download/windows'
          break
        case 'linux':
          installInstructions = 'Install Ollama for Linux: curl -fsSL https://ollama.ai/install.sh | sh'
          break
        default:
          installInstructions = 'Install Ollama from https://ollama.ai for your platform'
          break
      }
      
      this.safeLog(`❌ [LlamaService] Ollama not running on ${platform}. ${installInstructions}`, 'error')
      throw new Error(`Ollama is not running. ${installInstructions}`)
    }
  }

  public async getModelStatus(modelName: string): Promise<ModelStatus> {
    try {
      const models = await this.ollama.list()
      const isInstalled = models.models.some(model => model.name === modelName)
      
      return {
        isInstalled,
        isLoading: false
      }
    } catch (error) {
      return {
        isInstalled: false,
        isLoading: false,
        error: error.message
      }
    }
  }

  private async ensureModelAvailable(modelName: string, onProgress?: (progress: number, status: string) => void): Promise<void> {
    const status = await this.getModelStatus(modelName)
    
    if (!status.isInstalled) {
      console.log(`📥 [LlamaService] Downloading model: ${modelName}`)
      
      try {
        // Pull the model - this will download it if not available
        const stream = await this.ollama.pull({ model: modelName, stream: true })
        
        for await (const chunk of stream) {
          if (chunk.status) {
            console.log(`📥 [LlamaService] ${chunk.status}`)
            if (chunk.completed && chunk.total) {
              const progress = Math.round((chunk.completed / chunk.total) * 100)
              console.log(`📥 [LlamaService] Download progress: ${progress}%`)
              if (onProgress) {
                onProgress(progress, chunk.status)
              }
            } else if (onProgress) {
              onProgress(0, chunk.status)
            }
          }
        }
        
        console.log(`✅ [LlamaService] Model ${modelName} downloaded successfully`)
      } catch (error) {
        console.error(`❌ [LlamaService] Failed to download model ${modelName}:`, error)
        throw error
      }
    } else {
      console.log(`✅ [LlamaService] Model ${modelName} already installed`)
    }
  }

  public async sendMessage(
    messages: ChatMessage[],
    onProgress?: (chunk: string) => void
  ): Promise<string> {
    if (!this.isInitialized || !this.currentModel) {
      throw new Error('LlamaService not initialized')
    }

    try {
      console.log(`💬 [LlamaService] Sending message to ${this.currentModel}`)
      
      // Convert our message format to Ollama format
      const ollamaMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))

      if (onProgress) {
        // Streaming response
        let fullResponse = ''
        const stream = await this.ollama.chat({
          model: this.currentModel,
          messages: ollamaMessages,
          stream: true
        })

        for await (const chunk of stream) {
          if (chunk.message?.content) {
            fullResponse += chunk.message.content
            onProgress(chunk.message.content)
          }
        }

        return fullResponse
      } else {
        // Non-streaming response
        const response = await this.ollama.chat({
          model: this.currentModel,
          messages: ollamaMessages,
          stream: false
        })

        return response.message.content
      }
    } catch (error) {
      console.error('❌ [LlamaService] Error sending message:', error)
      throw error
    }
  }

  public async getAvailableModels(): Promise<string[]> {
    try {
      const models = await this.ollama.list()
      return models.models.map(model => model.name)
    } catch (error) {
      console.error('❌ [LlamaService] Error getting available models:', error)
      return []
    }
  }

  public getCurrentModel(): string | null {
    return this.currentModel
  }

  public getEmbeddingModel(): string {
    return this.embeddingModel
  }

  public async switchModel(modelName: string): Promise<void> {
    console.log(`🔄 [LlamaService] Switching to model: ${modelName}`)
    
    await this.ensureModelAvailable(modelName, (progress, status) => {
      if (this.mainWindow) {
        this.mainWindow.webContents.send('llm:downloadProgress', {
          modelName,
          progress,
          status
        })
      }
    })
    this.currentModel = modelName
    
    console.log(`✅ [LlamaService] Switched to model: ${modelName}`)
  }

  public async getRecommendedModelInfo(): Promise<ModelRecommendation> {
    return await this.deviceService.getRecommendedModel()
  }

  public async embedTexts(texts: string[], modelOverride?: string): Promise<number[][]> {
    if (!this.isInitialized) {
      throw new Error('LlamaService not initialized')
    }
    const model = modelOverride || this.embeddingModel
    if (!model) throw new Error('No model available for embeddings')

    try {
      // Ensure embedding model is available
      await this.ensureModelAvailable(model)
      // Ollama embeddings endpoint supports single text per call; do sequential to avoid overload
      const vectors: number[][] = []
      for (const t of texts) {
        const res: any = await (this.ollama as any).embeddings({ model, prompt: t })
        const v: number[] = res?.embedding || res?.data?.[0]?.embedding || []
        vectors.push(v)
      }
      return vectors
    } catch (error) {
      console.error('❌ [LlamaService] Error generating embeddings:', error)
      throw error
    }
  }
} 