import { contextBridge, ipcRenderer } from 'electron'

// Define the API that will be available in the renderer process
const electronAPI = {
  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // File system operations
  openDirectory: () => ipcRenderer.invoke('file:openDirectory'),
  readDirectory: (path: string) => ipcRenderer.invoke('file:readDirectory', path),
  readFile: (path: string) => ipcRenderer.invoke('file:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('file:writeFile', path, content),
  createFile: (dirPath: string, fileName: string) => ipcRenderer.invoke('file:createFile', dirPath, fileName),
  createDirectory: (parentPath: string, dirName: string) => ipcRenderer.invoke('file:createDirectory', parentPath, dirName),

  // AI operations (to be added)
  // sendPrompt: (prompt: string) => ipcRenderer.invoke('ai:sendPrompt', prompt),
  
  // Window operations
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for TypeScript
declare global {
  interface Window {
    electronAPI: typeof electronAPI
    autoSaveTimeout?: NodeJS.Timeout
  }
} 