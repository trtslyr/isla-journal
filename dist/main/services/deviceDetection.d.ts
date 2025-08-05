export interface DeviceSpecs {
    totalMemory: number;
    availableMemory: number;
    cpuCores: number;
    cpuSpeed: number;
    platform: string;
    arch: string;
}
export interface ModelRecommendation {
    modelName: string;
    displayName: string;
    minMemory: number;
    description: string;
    downloadSize: string;
}
export declare class DeviceDetectionService {
    private static instance;
    private deviceSpecs;
    static getInstance(): DeviceDetectionService;
    private constructor();
    getDeviceSpecs(): Promise<DeviceSpecs>;
    getModelRecommendation(specs: DeviceSpecs): ModelRecommendation;
    getRecommendedModel(): Promise<ModelRecommendation>;
    getAllSupportedModels(): ModelRecommendation[];
}
//# sourceMappingURL=deviceDetection.d.ts.map