import * as si from 'systeminformation'

export interface DeviceSpecs {
  totalMemory: number // in GB
  availableMemory: number // in GB
  cpuCores: number
  cpuSpeed: number // in GHz
  platform: string
  arch: string
}

export interface ModelRecommendation {
  modelName: string
  displayName: string
  minMemory: number
  description: string
  downloadSize: string
}

export class DeviceDetectionService {
  private static instance: DeviceDetectionService
  private deviceSpecs: DeviceSpecs | null = null

  public static getInstance(): DeviceDetectionService {
    if (!DeviceDetectionService.instance) {
      DeviceDetectionService.instance = new DeviceDetectionService()
    }
    return DeviceDetectionService.instance
  }

  private constructor() {}

  public async getDeviceSpecs(): Promise<DeviceSpecs> {
    if (this.deviceSpecs) {
      return this.deviceSpecs
    }

    try {
      const [memory, cpu, osInfo] = await Promise.all([
        si.mem(),
        si.cpu(),
        si.osInfo()
      ])

      this.deviceSpecs = {
        totalMemory: Math.round(memory.total / (1024 ** 3)), // Convert to GB
        availableMemory: Math.round(memory.available / (1024 ** 3)),
        cpuCores: cpu.cores,
        cpuSpeed: cpu.speed,
        platform: osInfo.platform,
        arch: osInfo.arch
      }

      console.log('🔍 [DeviceDetection] Device specs:', this.deviceSpecs)
      return this.deviceSpecs
    } catch (error) {
      console.error('❌ [DeviceDetection] Failed to get device specs:', error)
      // Fallback to conservative estimates
      this.deviceSpecs = {
        totalMemory: 8,
        availableMemory: 4,
        cpuCores: 4,
        cpuSpeed: 2.0,
        platform: process.platform,
        arch: process.arch
      }
      return this.deviceSpecs
    }
  }

  public getModelRecommendation(specs: DeviceSpecs): ModelRecommendation {
    // Conservative memory allocation (leave room for OS and app)
    const usableMemory = specs.totalMemory * 0.7

    if (usableMemory >= 12) {
      // High-end: 16GB+ total RAM
      return {
        modelName: 'llama3.1:latest',
        displayName: 'Llama 3.1 8B',
        minMemory: 12,
        description: 'High-quality responses, best for detailed analysis',
        downloadSize: '4.7GB'
      }
    } else if (usableMemory >= 6) {
      // Mid-range: 8-16GB total RAM  
      return {
        modelName: 'llama3.1:latest',
        displayName: 'Llama 3.1 8B',
        minMemory: 6,
        description: 'High-quality responses, best for detailed analysis',
        downloadSize: '4.7GB'
      }
    } else {
      // Low-end: 4-8GB total RAM
      return {
        modelName: 'llama3.2:latest',
        displayName: 'Llama 3.2 3B',
        minMemory: 3,
        description: 'Fast and efficient, perfect for quick insights',
        downloadSize: '2.0GB'
      }
    }
  }

  public async getRecommendedModel(): Promise<ModelRecommendation> {
    const specs = await this.getDeviceSpecs()
    const recommendation = this.getModelRecommendation(specs)
    
    console.log(`🎯 [DeviceDetection] Recommended model: ${recommendation.displayName} for device with ${specs.totalMemory}GB RAM`)
    return recommendation
  }

  public getAllSupportedModels(): ModelRecommendation[] {
    return [
      {
        modelName: 'llama3.2:latest',
        displayName: 'Llama 3.2 3B',
        minMemory: 3,
        description: 'Fast and efficient, perfect for quick insights',
        downloadSize: '2.0GB'
      },
      {
        modelName: 'llama3.1:latest', 
        displayName: 'Llama 3.1 8B',
        minMemory: 6,
        description: 'High-quality responses, best for detailed analysis',
        downloadSize: '4.7GB'
      },
      {
        modelName: 'gemma2:2b',
        displayName: 'Gemma 2 2B',
        minMemory: 2,
        description: 'Ultra-fast responses, minimal resource usage',
        downloadSize: '1.6GB'
      }
    ]
  }
} 