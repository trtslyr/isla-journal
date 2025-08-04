"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Define the API that will be available in the renderer process
const electronAPI = {
    // App info
    getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => electron_1.ipcRenderer.invoke('app:getPlatform'),
    // File system operations
    openDirectory: () => electron_1.ipcRenderer.invoke('file:openDirectory'),
    readDirectory: (path) => electron_1.ipcRenderer.invoke('file:readDirectory', path),
    readFile: (path) => electron_1.ipcRenderer.invoke('file:readFile', path),
    writeFile: (path, content) => electron_1.ipcRenderer.invoke('file:writeFile', path, content),
    createFile: (dirPath, fileName) => electron_1.ipcRenderer.invoke('file:createFile', dirPath, fileName),
    createDirectory: (parentPath, dirName) => electron_1.ipcRenderer.invoke('file:createDirectory', parentPath, dirName),
    // AI operations (to be added)
    // sendPrompt: (prompt: string) => ipcRenderer.invoke('ai:sendPrompt', prompt),
    // Window operations
    minimize: () => electron_1.ipcRenderer.invoke('window:minimize'),
    maximize: () => electron_1.ipcRenderer.invoke('window:maximize'),
    close: () => electron_1.ipcRenderer.invoke('window:close'),
};
// Expose the API to the renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
//# sourceMappingURL=index.js.map