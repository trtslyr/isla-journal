declare const electronAPI: {
    getVersion: () => Promise<any>;
    getPlatform: () => Promise<any>;
    minimize: () => Promise<any>;
    maximize: () => Promise<any>;
    close: () => Promise<any>;
};
declare global {
    interface Window {
        electronAPI: typeof electronAPI;
    }
}
export {};
//# sourceMappingURL=index.d.ts.map