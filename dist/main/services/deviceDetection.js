"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceDetectionService = void 0;
const si = __importStar(require("systeminformation"));
const os = __importStar(require("os"));
class DeviceDetectionService {
    static getInstance() {
        if (!DeviceDetectionService.instance) {
            DeviceDetectionService.instance = new DeviceDetectionService();
        }
        return DeviceDetectionService.instance;
    }
    constructor() {
        this.deviceSpecs = null;
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
        };
    }
    async getDeviceSpecs() {
        if (this.deviceSpecs) {
            return this.deviceSpecs;
        }
        try {
            const [memory, cpu, osInfo] = await Promise.all([
                si.mem(),
                si.cpu(),
                si.osInfo()
            ]);
            // Detect Apple Silicon
            const isAppleSilicon = process.platform === 'darwin' &&
                (process.arch === 'arm64' || cpu.manufacturer?.toLowerCase().includes('apple'));
            // Detect AVX support (simplified - in production you'd use a more robust check)
            const supportsAVX = cpu.flags?.includes('avx') || cpu.flags?.includes('avx2') ||
                cpu.brand?.toLowerCase().includes('intel') || cpu.brand?.toLowerCase().includes('amd');
            this.deviceSpecs = {
                totalMemory: Math.round(memory.total / (1024 ** 3)), // Convert to GB
                availableMemory: Math.round(memory.available / (1024 ** 3)),
                cpuCores: cpu.cores,
                cpuSpeed: cpu.speed,
                platform: this.normalizePlatform(osInfo.platform),
                arch: this.normalizeArchitecture(osInfo.arch),
                osVersion: osInfo.release || 'unknown',
                isAppleSilicon,
                supportsAVX: supportsAVX || false
            };
            console.log('🔍 [DeviceDetection] Device specs:', this.deviceSpecs);
            return this.deviceSpecs;
        }
        catch (error) {
            console.error('❌ [DeviceDetection] Failed to get device specs:', error);
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
            };
            return this.deviceSpecs;
        }
    }
    normalizePlatform(platform) {
        switch (platform.toLowerCase()) {
            case 'win32':
            case 'windows':
                return 'windows';
            case 'darwin':
            case 'macos':
                return 'macos';
            case 'linux':
            case 'freebsd':
            case 'openbsd':
                return 'linux';
            default:
                return platform.toLowerCase();
        }
    }
    normalizeArchitecture(arch) {
        switch (arch.toLowerCase()) {
            case 'x64':
            case 'x86_64':
            case 'amd64':
                return 'x64';
            case 'arm64':
            case 'aarch64':
                return 'arm64';
            case 'x86':
            case 'ia32':
                return 'x86';
            default:
                return arch.toLowerCase();
        }
    }
    getModelRecommendation(specs) {
        // Conservative memory allocation (leave room for OS and app)
        const usableMemory = specs.totalMemory * 0.7;
        // Get candidate models based on memory
        let candidateModels;
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
            ];
        }
        else if (usableMemory >= 6) {
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
            ];
        }
        else {
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
            ];
        }
        // Filter models based on platform and architecture compatibility
        const compatibleModels = candidateModels.filter(model => model.compatiblePlatforms.includes(specs.platform) &&
            model.compatibleArchitectures.includes(specs.arch));
        // Return the first compatible model, or fallback if none found
        if (compatibleModels.length > 0) {
            return compatibleModels[0];
        }
        // Ultimate fallback - should work on all platforms
        return {
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
    async getRecommendedModel() {
        const specs = await this.getDeviceSpecs();
        const recommendation = this.getModelRecommendation(specs);
        console.log(`🎯 [DeviceDetection] Recommended model: ${recommendation.displayName} for device with ${specs.totalMemory}GB RAM`);
        return recommendation;
    }
    getAllSupportedModels() {
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
        ];
    }
    isModelCompatible(modelName, specs) {
        const compatibility = this.modelCompatibility[modelName];
        if (!compatibility)
            return false;
        const platformCompatible = compatibility[specs.platform];
        const archCompatible = compatibility[specs.arch];
        const avxCompatible = !compatibility.requiresAVX || specs.supportsAVX;
        return platformCompatible && archCompatible && avxCompatible;
    }
    getCompatibleModels(specs) {
        return this.getAllSupportedModels().filter(model => this.isModelCompatible(model.modelName, specs) &&
            specs.availableMemory >= model.minMemory);
    }
}
exports.DeviceDetectionService = DeviceDetectionService;
//# sourceMappingURL=deviceDetection.js.map