export interface DeviceSpecs {
    totalMemory: number;
    availableMemory: number;
    cpuCores: number;
    cpuSpeed: number;
    platform: string;
    arch: string;
    osVersion: string;
    isAppleSilicon: boolean;
    supportsAVX: boolean;
}
export interface ModelRecommendation {
    modelName: string;
    displayName: string;
    minMemory: number;
    description: string;
    downloadSize: string;
    compatiblePlatforms: string[];
    compatibleArchitectures: string[];
    isOptimized: boolean;
    fallbackModel?: string;
}
export interface ModelCompatibility {
    [key: string]: {
        windows: boolean;
        macos: boolean;
        linux: boolean;
        x64: boolean;
        arm64: boolean;
        requiresAVX?: boolean;
    };
}
export declare class DeviceDetectionService {
    private static instance;
    private deviceSpecs;
    private modelCompatibility;
    static getInstance(): DeviceDetectionService;
    private constructor();
    getDeviceSpecs(): Promise<DeviceSpecs>;
    private normalizePlatform;
    private normalizeArchitecture;
    getModelRecommendation(specs: DeviceSpecs): ModelRecommendation;
    getRecommendedModel(): Promise<ModelRecommendation>;
    getAllSupportedModels(): ModelRecommendation[];
    isModelCompatible(modelName: string, specs: DeviceSpecs): boolean;
    getCompatibleModels(specs: DeviceSpecs): ModelRecommendation[];
}
//# sourceMappingURL=deviceDetection.d.ts.map