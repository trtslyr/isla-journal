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
      
      // Check if Ollama is running
      await this.checkOllamaStatus()
      
      // Get recommended model for this device
      const recommendation = await this.deviceService.getRecommendedModel()
      this.safeLog(`🎯 [LlamaService] Recommended model: ${recommendation.displayName}`)
      
      // Check if model is installed, download if needed
      await this.ensureModelAvailable(recommendation.modelName, (progress, status) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('llm:downloadProgress', {
            modelName: recommendation.modelName,
            progress,
            status
          })
        }
      })
      
      this.currentModel = recommendation.modelName
      this.isInitialized = true
      
      this.safeLog('✅ [LlamaService] Initialized successfully')
    } catch (error) {
      this.safeLog(`❌ [LlamaService] Initialization failed: ${error}`, 'error')
      throw error
    }
  }

  private async checkOllamaStatus(): Promise<void> {
    try {
      const models = await this.ollama.list()
      this.safeLog('✅ [LlamaService] Ollama is running')
    } catch (error) {
      this.safeLog('❌ [LlamaService] Ollama not running. Please install and start Ollama first.', 'error')
      throw new Error('Ollama is not running. Please install Ollama from https://ollama.ai and start it.')
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
} 