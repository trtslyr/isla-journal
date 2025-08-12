import { contextBridge, ipcRenderer } from 'electron'

// Define the API that will be available in the renderer process
const electronAPI = {
  // Version info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  
  // File system operations
  openDirectory: () => ipcRenderer.invoke('file:openDirectory'),
  readDirectory: (path: string) => ipcRenderer.invoke('file:readDirectory', path),
  readFile: (path: string) => ipcRenderer.invoke('file:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('file:writeFile', path, content),
  createFile: (dirPath: string, fileName: string) => 
    ipcRenderer.invoke('file:createFile', dirPath, fileName),
  createDirectory: (dirPath: string, dirName: string) => 
    ipcRenderer.invoke('file:createDirectory', dirPath, dirName),
  deleteFile: (filePath: string) => ipcRenderer.invoke('file:delete', filePath),
  renameFile: (oldPath: string, newName: string) => ipcRenderer.invoke('file:rename', oldPath, newName),
  moveFile: (sourcePath: string, targetDirectoryPath: string) => ipcRenderer.invoke('file:move', sourcePath, targetDirectoryPath),
  
  // Image operations
  saveImage: (dirPath: string, baseName: string, dataBase64: string, ext: string) =>
    ipcRenderer.invoke('file:saveImage', dirPath, baseName, dataBase64, ext),
  
  // Database operations
  dbClearAll: () => ipcRenderer.invoke('db:clearAll'),
  dbGetStats: () => ipcRenderer.invoke('db:getStats'),
  dbReindexAll: () => ipcRenderer.invoke('db:reindexAll'),
  
  // Settings operations
  settingsGet: (key: string) => ipcRenderer.invoke('settings:get', key),
  settingsSet: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  
  // RAG/Content search
  searchContent: (query: string, limit?: number) => ipcRenderer.invoke('content:search', query, limit),
  contentSearchAndAnswer: (query: string, chatId?: number) => 
    ipcRenderer.invoke('content:searchAndAnswer', query, chatId),
  contentStreamSearchAndAnswer: (query: string, chatId?: number) =>
    ipcRenderer.invoke('content:streamSearchAndAnswer', query, chatId),
  // Embeddings
  embeddingsRebuildAll: (model?: string) => ipcRenderer.invoke('embeddings:rebuildAll', model),
  onEmbeddingsProgress: (cb: (payload: { total?: number; embedded?: number; model?: string; status?: string; error?: string }) => void) => {
    const handler = (_: any, payload: any) => cb(payload)
    ipcRenderer.on('embeddings:progress', handler)
    return () => ipcRenderer.removeListener('embeddings:progress', handler)
  },
  onContentStreamChunk: (cb: (payload: { chunk: string }) => void) => {
    const handler = (_: any, payload: any) => cb(payload)
    ipcRenderer.on('content:streamChunk', handler)
    return () => ipcRenderer.removeListener('content:streamChunk', handler)
  },
  onContentStreamDone: (cb: (payload: { answer: string; sources: any[] }) => void) => {
    const handler = (_: any, payload: any) => cb(payload)
    ipcRenderer.on('content:streamDone', handler)
    return () => ipcRenderer.removeListener('content:streamDone', handler)
  },
  
  // LLM operations (minimal status + messaging)
  llmSendMessage: (messages: Array<{role: string, content: string}>) => 
    ipcRenderer.invoke('llm:sendMessage', messages),
  llmGetStatus: () => ipcRenderer.invoke('llm:getStatus'),
  llmGetCurrentModel: () => ipcRenderer.invoke('llm:getCurrentModel'),
  llmGetDeviceSpecs: () => ipcRenderer.invoke('llm:getDeviceSpecs'),
  llmGetRecommendedModel: () => ipcRenderer.invoke('llm:getRecommendedModel'),
  llmGetAvailableModels: () => ipcRenderer.invoke('llm:getAvailableModels'),
  llmSwitchModel: (modelName: string) => ipcRenderer.invoke('llm:switchModel', modelName),
  
  // LLM events
  onLLMDownloadProgress: (callback: (data: any) => void) => {
    const unsubscribe = () => ipcRenderer.removeAllListeners('llm:downloadProgress')
    ipcRenderer.on('llm:downloadProgress', (_, data) => callback(data))
    return unsubscribe
  },
  
  // Chat operations
  chatCreate: (title: string) => ipcRenderer.invoke('chat:create', title),
  chatGetAll: () => ipcRenderer.invoke('chat:getAll'),
  chatGetActive: () => ipcRenderer.invoke('chat:getActive'),
  chatSetActive: (chatId: number) => ipcRenderer.invoke('chat:setActive', chatId),
  chatDelete: (chatId: number) => ipcRenderer.invoke('chat:delete', chatId),
  chatRename: (chatId: number, title: string) => ipcRenderer.invoke('chat:rename', chatId, title),
  chatGetMessages: (chatId: number) => ipcRenderer.invoke('chat:getMessages', chatId),
  chatAddMessage: (chatId: number, role: string, content: string, metadata?: any) => 
    ipcRenderer.invoke('chat:addMessage', chatId, role, content, metadata),

  
  // License operations removed - now handled in renderer process only
  
  // System operations
  openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url),

  // Events
  onSettingsChanged: (callback: (payload: { key: string; value: any }) => void) => {
    const handler = (_: any, payload: any) => callback(payload)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  }
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for TypeScript
declare global {
  interface Window {
    electronAPI: typeof electronAPI
    autoSaveTimeout?: NodeJS.Timeout
    searchTimeout?: NodeJS.Timeout
  }
} 