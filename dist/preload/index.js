"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Define the API that will be available in the renderer process
const electronAPI = {
    // Version info
    getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => electron_1.ipcRenderer.invoke('app:getPlatform'),
    // File system operations
    openDirectory: () => electron_1.ipcRenderer.invoke('file:openDirectory'),
    readDirectory: (path) => electron_1.ipcRenderer.invoke('file:readDirectory', path),
    readFile: (path) => electron_1.ipcRenderer.invoke('file:readFile', path),
    writeFile: (path, content) => electron_1.ipcRenderer.invoke('file:writeFile', path, content),
    createFile: (dirPath, fileName, content) => electron_1.ipcRenderer.invoke('file:createFile', dirPath, fileName, content),
    createDirectory: (dirPath, dirName) => electron_1.ipcRenderer.invoke('file:createDirectory', dirPath, dirName),
    deleteFile: (filePath) => electron_1.ipcRenderer.invoke('file:delete', filePath),
    renameFile: (oldPath, newName) => electron_1.ipcRenderer.invoke('file:rename', oldPath, newName),
    moveFile: (sourcePath, targetDirectoryPath) => electron_1.ipcRenderer.invoke('file:move', sourcePath, targetDirectoryPath),
    // Database operations
    dbClearAll: () => electron_1.ipcRenderer.invoke('db:clearAll'),
    dbGetStats: () => electron_1.ipcRenderer.invoke('db:getStats'),
    dbReindexAll: () => electron_1.ipcRenderer.invoke('db:reindexAll'),
    // Settings operations
    settingsGet: (key) => electron_1.ipcRenderer.invoke('settings:get', key),
    settingsSet: (key, value) => electron_1.ipcRenderer.invoke('settings:set', key, value),
    // RAG/Content search
    searchContent: (query) => electron_1.ipcRenderer.invoke('content:search', query),
    answerQuestion: (query, history) => electron_1.ipcRenderer.invoke('content:answer', query, history),
    contentSearchAndAnswer: (query, chatId) => electron_1.ipcRenderer.invoke('content:searchAndAnswer', query, chatId),
    // LLM operations
    llmSendMessage: (messages) => electron_1.ipcRenderer.invoke('llm:sendMessage', messages),
    // Chat operations
    chatCreate: (title) => electron_1.ipcRenderer.invoke('chat:create', title),
    chatGetAll: () => electron_1.ipcRenderer.invoke('chat:getAll'),
    chatGetActive: () => electron_1.ipcRenderer.invoke('chat:getActive'),
    chatSetActive: (chatId) => electron_1.ipcRenderer.invoke('chat:setActive', chatId),
    chatDelete: (chatId) => electron_1.ipcRenderer.invoke('chat:delete', chatId),
    chatRename: (chatId, title) => electron_1.ipcRenderer.invoke('chat:rename', chatId, title),
    chatGetMessages: (chatId) => electron_1.ipcRenderer.invoke('chat:getMessages', chatId),
    chatAddMessage: (chatId, role, content) => electron_1.ipcRenderer.invoke('chat:addMessage', chatId, role, content),
    chatClearMessages: (chatId) => electron_1.ipcRenderer.invoke('chat:clearMessages', chatId),
    // License operations removed - now handled in renderer process only
    // System operations
    openExternal: (url) => electron_1.ipcRenderer.invoke('system:openExternal', url)
};
// Expose the API to the renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
//# sourceMappingURL=index.js.map