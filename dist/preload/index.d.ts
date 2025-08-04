declare const electronAPI: {
    getVersion: () => Promise<any>;
    getPlatform: () => Promise<any>;
    openDirectory: () => Promise<any>;
    readDirectory: (path: string) => Promise<any>;
    readFile: (path: string) => Promise<any>;
    writeFile: (path: string, content: string) => Promise<any>;
    createFile: (dirPath: string, fileName: string) => Promise<any>;
    createDirectory: (parentPath: string, dirName: string) => Promise<any>;
    minimize: () => Promise<any>;
    maximize: () => Promise<any>;
    close: () => Promise<any>;
};
declare global {
    interface Window {
        electronAPI: typeof electronAPI;
        autoSaveTimeout?: NodeJS.Timeout;
    }
}
export {};
//# sourceMappingURL=index.d.ts.map