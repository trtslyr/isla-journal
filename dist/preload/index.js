"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Define the API that will be available in the renderer process
const electronAPI = {
    // App info
    getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => electron_1.ipcRenderer.invoke('app:getPlatform'),
    // File system operations (to be added)
    // openDirectory: () => ipcRenderer.invoke('file:openDirectory'),
    // readFile: (path: string) => ipcRenderer.invoke('file:readFile', path),
    // writeFile: (path: string, content: string) => ipcRenderer.invoke('file:writeFile', path, content),
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