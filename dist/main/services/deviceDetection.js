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
class DeviceDetectionService {
    static getInstance() {
        if (!DeviceDetectionService.instance) {
            DeviceDetectionService.instance = new DeviceDetectionService();
        }
        return DeviceDetectionService.instance;
    }
    constructor() {
        this.deviceSpecs = null;
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
            this.deviceSpecs = {
                totalMemory: Math.round(memory.total / (1024 ** 3)), // Convert to GB
                availableMemory: Math.round(memory.available / (1024 ** 3)),
                cpuCores: cpu.cores,
                cpuSpeed: cpu.speed,
                platform: osInfo.platform,
                arch: osInfo.arch
            };
            console.log('🔍 [DeviceDetection] Device specs:', this.deviceSpecs);
            return this.deviceSpecs;
        }
        catch (error) {
            console.error('❌ [DeviceDetection] Failed to get device specs:', error);
            // Fallback to conservative estimates
            this.deviceSpecs = {
                totalMemory: 8,
                availableMemory: 4,
                cpuCores: 4,
                cpuSpeed: 2.0,
                platform: process.platform,
                arch: process.arch
            };
            return this.deviceSpecs;
        }
    }
    getModelRecommendation(specs) {
        // Conservative memory allocation (leave room for OS and app)
        const usableMemory = specs.totalMemory * 0.7;
        if (usableMemory >= 12) {
            // High-end: 16GB+ total RAM
            return {
                modelName: 'llama3.1:latest',
                displayName: 'Llama 3.1 8B',
                minMemory: 12,
                description: 'High-quality responses, best for detailed analysis',
                downloadSize: '4.7GB'
            };
        }
        else if (usableMemory >= 6) {
            // Mid-range: 8-16GB total RAM  
            return {
                modelName: 'llama3.1:latest',
                displayName: 'Llama 3.1 8B',
                minMemory: 6,
                description: 'High-quality responses, best for detailed analysis',
                downloadSize: '4.7GB'
            };
        }
        else {
            // Low-end: 4-8GB total RAM
            return {
                modelName: 'llama3.2:latest',
                displayName: 'Llama 3.2 3B',
                minMemory: 3,
                description: 'Fast and efficient, perfect for quick insights',
                downloadSize: '2.0GB'
            };
        }
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
        ];
    }
}
exports.DeviceDetectionService = DeviceDetectionService;
//# sourceMappingURL=deviceDetection.js.map