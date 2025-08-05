import * as si from 'systeminformation'
import * as os from 'os'

export interface DeviceSpecs {
  totalMemory: number // in GB
  availableMemory: number // in GB
  cpuCores: number
  cpuSpeed: number // in GHz
  platform: string
  arch: string
  osVersion: string
  isAppleSilicon: boolean
  supportsAVX: boolean
}

export interface ModelRecommendation {
  modelName: string
  displayName: string
  minMemory: number
  description: string
  downloadSize: string
  compatiblePlatforms: string[]
  compatibleArchitectures: string[]
  isOptimized: boolean
  fallbackModel?: string
}

export interface ModelCompatibility {
  [key: string]: {
    windows: boolean
    macos: boolean
    linux: boolean
    x64: boolean
    arm64: boolean
    requiresAVX?: boolean
  }
}

export class DeviceDetectionService {
  private static instance: DeviceDetectionService
  private deviceSpecs: DeviceSpecs | null = null
  private modelCompatibility: ModelCompatibility

  public static getInstance(): DeviceDetectionService {
    if (!DeviceDetectionService.instance) {
      DeviceDetectionService.instance = new DeviceDetectionService()
    }
    return DeviceDetectionService.instance
  }

  private constructor() {
    // Define model compatibility matrix
    this.modelCompatibility = {
      'llama3.2:latest': {
        windows: true,
        macos: true, 
        linux: true,
        x64: true,
        arm64: true,
        requiresAVX: false
      },
      'llama3.1:latest': {
        windows: true,
        macos: true,
        linux: true,
        x64: true,
        arm64: true,
        requiresAVX: false
      },
      'gemma2:2b': {
        windows: true,
        macos: true,
        linux: true,
        x64: true,
        arm64: true,
        requiresAVX: false
      },
      'phi3:mini': {
        windows: true,
        macos: true,
        linux: true,
        x64: true,
        arm64: true,
        requiresAVX: false
      }
    }
  }

  public async getDeviceSpecs(): Promise<DeviceSpecs> {
    if (this.deviceSpecs) {
      return this.deviceSpecs
    }

    try {
      // Use Promise.allSettled for better error handling across platforms
      const results = await Promise.allSettled([
        si.mem(),
        si.cpu(),
        si.osInfo()
      ])

      // Extract results with fallbacks
      const memory = results[0].status === 'fulfilled' ? results[0].value : { total: 8 * (1024 ** 3), available: 4 * (1024 ** 3) }
      const cpu = results[1].status === 'fulfilled' ? results[1].value : { cores: 4, speed: 2.0, manufacturer: '', brand: '', flags: [] }
      const osInfo = results[2].status === 'fulfilled' ? results[2].value : { platform: process.platform, arch: process.arch, release: os.release() }

      // Cross-platform Apple Silicon detection
      const isAppleSilicon = (process.platform === 'darwin' && process.arch === 'arm64') || 
        cpu.manufacturer?.toLowerCase().includes('apple') ||
        cpu.brand?.toLowerCase().includes('apple')

      // Enhanced AVX detection with cross-platform support
      const supportsAVX = this.detectAVXSupport(cpu, process.platform, process.arch)

      // Robust memory calculation with fallbacks
      const totalMemoryGB = memory.total ? Math.round(memory.total / (1024 ** 3)) : this.estimateMemoryByPlatform(process.platform)
      const availableMemoryGB = memory.available ? Math.round(memory.available / (1024 ** 3)) : Math.round(totalMemoryGB * 0.5)

      this.deviceSpecs = {
        totalMemory: totalMemoryGB,
        availableMemory: availableMemoryGB,
        cpuCores: cpu.cores || this.estimateCoresByPlatform(process.platform),
        cpuSpeed: cpu.speed || 2.0,
        platform: this.normalizePlatform(osInfo.platform || process.platform),
        arch: this.normalizeArchitecture(osInfo.arch || process.arch),
        osVersion: osInfo.release || os.release() || 'unknown',
        isAppleSilicon,
        supportsAVX
      }

      console.log('🔍 [DeviceDetection] Device specs detected:', {
        platform: this.deviceSpecs.platform,
        arch: this.deviceSpecs.arch,
        totalMemory: `${this.deviceSpecs.totalMemory}GB`,
        cpuCores: this.deviceSpecs.cpuCores,
        isAppleSilicon: this.deviceSpecs.isAppleSilicon,
        supportsAVX: this.deviceSpecs.supportsAVX,
        osVersion: this.deviceSpecs.osVersion
      })
      
      return this.deviceSpecs
    } catch (error) {
      console.error('❌ [DeviceDetection] Failed to get device specs:', error)
      // Fallback to conservative estimates with OS detection
      this.deviceSpecs = {
        totalMemory: 8,
        availableMemory: 4,
        cpuCores: 4,
        cpuSpeed: 2.0,
        platform: this.normalizePlatform(process.platform),
        arch: this.normalizeArchitecture(process.arch),
        osVersion: os.release(),
        isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
        supportsAVX: false // Conservative fallback
      }
      return this.deviceSpecs
    }
  }

  private normalizePlatform(platform: string): string {
    const normalized = platform.toLowerCase()
    switch (normalized) {
      case 'win32':
      case 'windows':
      case 'cygwin':
      case 'msys':
        return 'windows'
      case 'darwin':
      case 'macos':
      case 'osx':
        return 'macos'
      case 'linux':
      case 'freebsd':
      case 'openbsd':
      case 'netbsd':
      case 'sunos':
      case 'aix':
        return 'linux'
      case 'android':
        return 'android'
      default:
        console.log(`🔍 [DeviceDetection] Unknown platform: ${platform}, treating as linux`)
        return 'linux' // Conservative fallback to linux
    }
  }

  private normalizeArchitecture(arch: string): string {
    switch (arch.toLowerCase()) {
      case 'x64':
      case 'x86_64':
      case 'amd64':
        return 'x64'
      case 'arm64':
      case 'aarch64':
        return 'arm64'
      case 'x86':
      case 'ia32':
        return 'x86'
      default:
        return arch.toLowerCase()
    }
  }

  private detectAVXSupport(cpu: any, platform: string, arch: string): boolean {
    // Check CPU flags first (most reliable)
    if (cpu.flags && Array.isArray(cpu.flags)) {
      if (cpu.flags.includes('avx') || cpu.flags.includes('avx2')) {
        return true
      }
    }

    // Check brand/manufacturer
    const brand = (cpu.brand || '').toLowerCase()
    const manufacturer = (cpu.manufacturer || '').toLowerCase()
    
    // Most modern Intel/AMD CPUs support AVX
    if (brand.includes('intel') || brand.includes('amd') || 
        manufacturer.includes('intel') || manufacturer.includes('amd')) {
      return true
    }

    // Apple Silicon has its own optimizations
    if (platform === 'darwin' && arch === 'arm64') {
      return false // Apple Silicon uses different optimizations
    }

    // Conservative fallback
    return false
  }

  private estimateMemoryByPlatform(platform: string): number {
    // Conservative estimates based on typical configurations
    switch (platform.toLowerCase()) {
      case 'win32':
      case 'windows':
        return 16 // Windows machines often have 16GB+
      case 'darwin':
      case 'macos':
        return 16 // Macs typically 16GB+
      case 'linux':
        return 8  // Linux can run on lower-end hardware
      default:
        return 8  // Conservative fallback
    }
  }

  private estimateCoresByPlatform(platform: string): number {
    // Conservative estimates based on typical configurations
    switch (platform.toLowerCase()) {
      case 'win32':
      case 'windows':
        return 8  // Modern Windows machines
      case 'darwin':
      case 'macos':
        return 8  // Modern Macs
      case 'linux':
        return 4  // Linux can run on varied hardware
      default:
        return 4  // Conservative fallback
    }
  }

  public getModelRecommendation(specs: DeviceSpecs): ModelRecommendation {
    // Conservative memory allocation (leave room for OS and app)
    const usableMemory = specs.totalMemory * 0.7
    
    // Get candidate models based on memory
    let candidateModels: ModelRecommendation[]

    if (usableMemory >= 12) {
      // High-end: 16GB+ total RAM
      candidateModels = [
        {
          modelName: 'llama3.1:latest',
          displayName: 'Llama 3.1 8B',
          minMemory: 6,
          description: 'High-quality responses, best for detailed analysis',
          downloadSize: '4.7GB',
          compatiblePlatforms: ['windows', 'macos', 'linux'],
          compatibleArchitectures: ['x64', 'arm64'],
          isOptimized: specs.isAppleSilicon,
          fallbackModel: 'llama3.2:latest'
        }
      ]
    } else if (usableMemory >= 6) {
      // Mid-range: 8-16GB total RAM
      candidateModels = [
        {
          modelName: 'llama3.1:latest',
          displayName: 'Llama 3.1 8B',
          minMemory: 6,
          description: 'High-quality responses, best for detailed analysis',
          downloadSize: '4.7GB',
          compatiblePlatforms: ['windows', 'macos', 'linux'],
          compatibleArchitectures: ['x64', 'arm64'],
          isOptimized: specs.isAppleSilicon,
          fallbackModel: 'llama3.2:latest'
        },
        {
          modelName: 'llama3.2:latest',
          displayName: 'Llama 3.2 3B',
          minMemory: 3,
          description: 'Fast and efficient, perfect for quick insights',
          downloadSize: '2.0GB',
          compatiblePlatforms: ['windows', 'macos', 'linux'],
          compatibleArchitectures: ['x64', 'arm64'],
          isOptimized: true,
          fallbackModel: 'gemma2:2b'
        }
      ]
    } else {
      // Low-end: 4-8GB total RAM
      candidateModels = [
        {
          modelName: 'llama3.2:latest',
          displayName: 'Llama 3.2 3B',
          minMemory: 3,
          description: 'Fast and efficient, perfect for quick insights',
          downloadSize: '2.0GB',
          compatiblePlatforms: ['windows', 'macos', 'linux'],
          compatibleArchitectures: ['x64', 'arm64'],
          isOptimized: true,
          fallbackModel: 'gemma2:2b'
        },
        {
          modelName: 'gemma2:2b',
          displayName: 'Gemma 2 2B',
          minMemory: 2,
          description: 'Ultra-fast responses, minimal resource usage',
          downloadSize: '1.6GB',
          compatiblePlatforms: ['windows', 'macos', 'linux'],
          compatibleArchitectures: ['x64', 'arm64'],
          isOptimized: true
        }
      ]
    }

    // Enhanced cross-platform compatibility filtering
    const compatibleModels = candidateModels.filter(model => {
      // Check platform compatibility with fallbacks
      let platformCompatible = model.compatiblePlatforms.includes(specs.platform)
      
      // If platform not directly supported, check for linux fallback (most universal)
      if (!platformCompatible && specs.platform === 'android') {
        platformCompatible = model.compatiblePlatforms.includes('linux')
      }
      
      // Check architecture compatibility with fallbacks
      let archCompatible = model.compatibleArchitectures.includes(specs.arch)
      
      // x86 systems can often run x64 models
      if (!archCompatible && specs.arch === 'x86') {
        archCompatible = model.compatibleArchitectures.includes('x64')
      }
      
      const isCompatible = platformCompatible && archCompatible
      
      if (!isCompatible) {
        console.log(`🚫 [DeviceDetection] Model ${model.modelName} incompatible: platform=${specs.platform}(${platformCompatible}), arch=${specs.arch}(${archCompatible})`)
      } else {
        console.log(`✅ [DeviceDetection] Model ${model.modelName} compatible with ${specs.platform}/${specs.arch}`)
      }
      
      return isCompatible
    })

    // Return the first compatible model, or fallback if none found
    if (compatibleModels.length > 0) {
      const selectedModel = compatibleModels[0]
      console.log(`🎯 [DeviceDetection] Selected ${selectedModel.displayName} for ${specs.platform}/${specs.arch} with ${specs.totalMemory}GB RAM`)
      return selectedModel
    }

    // Ultimate universal fallback - guaranteed to work on all platforms
    console.log(`⚠️ [DeviceDetection] No compatible models found, using universal fallback for ${specs.platform}/${specs.arch}`)
    return {
      modelName: 'gemma2:2b',
      displayName: 'Gemma 2 2B (Universal Fallback)',
      minMemory: 2,
      description: 'Cross-platform compatibility guaranteed, minimal resource usage',
      downloadSize: '1.6GB',
      compatiblePlatforms: ['windows', 'macos', 'linux', 'android'],
      compatibleArchitectures: ['x64', 'arm64', 'x86'],
      isOptimized: false
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
        downloadSize: '2.0GB',
        compatiblePlatforms: ['windows', 'macos', 'linux'],
        compatibleArchitectures: ['x64', 'arm64'],
        isOptimized: true,
        fallbackModel: 'gemma2:2b'
      },
      {
        modelName: 'llama3.1:latest', 
        displayName: 'Llama 3.1 8B',
        minMemory: 6,
        description: 'High-quality responses, best for detailed analysis',
        downloadSize: '4.7GB',
        compatiblePlatforms: ['windows', 'macos', 'linux'],
        compatibleArchitectures: ['x64', 'arm64'],
        isOptimized: true,
        fallbackModel: 'llama3.2:latest'
      },
      {
        modelName: 'gemma2:2b',
        displayName: 'Gemma 2 2B',
        minMemory: 2,
        description: 'Ultra-fast responses, minimal resource usage',
        downloadSize: '1.6GB',
        compatiblePlatforms: ['windows', 'macos', 'linux'],
        compatibleArchitectures: ['x64', 'arm64'],
        isOptimized: true
      },
      {
        modelName: 'phi3:mini',
        displayName: 'Phi-3 Mini',
        minMemory: 2,
        description: 'Microsoft\'s efficient model, great for code and reasoning',
        downloadSize: '2.3GB',
        compatiblePlatforms: ['windows', 'macos', 'linux'],
        compatibleArchitectures: ['x64', 'arm64'],
        isOptimized: true
      }
    ]
  }

  public isModelCompatible(modelName: string, specs: DeviceSpecs): boolean {
    const compatibility = this.modelCompatibility[modelName]
    if (!compatibility) return false

    const platformCompatible = compatibility[specs.platform as keyof typeof compatibility]
    const archCompatible = compatibility[specs.arch as keyof typeof compatibility]
    const avxCompatible = !compatibility.requiresAVX || specs.supportsAVX

    return platformCompatible && archCompatible && avxCompatible
  }

  public getCompatibleModels(specs: DeviceSpecs): ModelRecommendation[] {
    return this.getAllSupportedModels().filter(model => 
      this.isModelCompatible(model.modelName, specs) &&
      specs.availableMemory >= model.minMemory
    )
  }
} 