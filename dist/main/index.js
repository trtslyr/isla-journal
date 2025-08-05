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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = require("path");
const is_dev_1 = require("./utils/is-dev");
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    electron_1.app.quit();
}
let mainWindow = null;
const createWindow = () => {
    // Create the browser window.
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        show: false,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: (0, path_1.join)(__dirname, '../preload/index.js'),
            webSecurity: !is_dev_1.isDev
        }
    });
    // Load the app
    if (is_dev_1.isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile((0, path_1.join)(__dirname, '../renderer/index.html'));
    }
    // Show window when ready to prevent visual flash
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        if (is_dev_1.isDev) {
            mainWindow?.webContents.openDevTools();
        }
    });
    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
};
// This method will be called when Electron has finished initialization
electron_1.app.whenReady().then(() => {
    // Initialize database
    try {
        database_1.database.initialize();
    }
    catch (error) {
        console.error('❌ [Main] Failed to initialize database:', error);
        // Continue without database for now - could show error dialog
    }
    createWindow();
    // Initialize LLM service (async, don't block app startup)
    const llamaService = llamaService_1.LlamaService.getInstance();
    llamaService.setMainWindow(mainWindow);
    llamaService.initialize().catch(error => {
        console.error('❌ [Main] Failed to initialize LLM service:', error);
        // LLM will be unavailable but app continues to work
    });
    // Initialize License service
    const licenseService = licenseService_1.LicenseService.getInstance();
    licenseService.setMainWindow(mainWindow);
    // Perform startup license check (async, don't block app startup)
    licenseService.performStartupLicenseCheck().catch(error => {
        console.error('❌ [Main] License check failed:', error);
        // App will continue but with limited functionality
    });
    // Set app menu
    if (process.platform === 'darwin') {
        // macOS menu
        const template = [
            {
                label: electron_1.app.getName(),
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            },
            // File menu, Edit menu, etc. will be added here
        ];
        electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
    }
    else {
        // Windows/Linux - hide menu bar for VS Code-like experience
        electron_1.Menu.setApplicationMenu(null);
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
// Quit when all windows are closed, except on macOS
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// Clean up database when app is about to quit
electron_1.app.on('before-quit', () => {
    database_1.database.close();
});
// Security: Prevent new window creation (handled by setWindowOpenHandler above)
// File System Operations
const promises_1 = require("fs/promises");
const path_2 = __importDefault(require("path"));
// Database
const database_1 = require("./database");
// LLM Services
const llamaService_1 = require("./services/llamaService");
const deviceDetection_1 = require("./services/deviceDetection");
const contentService_1 = require("./services/contentService");
// License Service
const licenseService_1 = require("./services/licenseService");
// Basic app info handlers
electron_1.ipcMain.handle('app:getVersion', () => {
    return electron_1.app.getVersion();
});
electron_1.ipcMain.handle('app:getPlatform', () => {
    return process.platform;
});
// File operations handlers
electron_1.ipcMain.handle('file:openDirectory', async () => {
    if (!mainWindow) {
        throw new Error('Main window not available');
    }
    try {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Select Journal Directory'
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    }
    catch (error) {
        console.error('Error opening directory dialog:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('file:readDirectory', async (_, dirPath) => {
    try {
        console.log('📁 Reading directory:', dirPath);
        // Check if this is a directory switch by getting current saved directory
        let shouldClearDatabase = false;
        try {
            const currentSavedDirectory = await database_1.database.getSetting('selectedDirectory');
            if (currentSavedDirectory && currentSavedDirectory !== dirPath) {
                console.log('🔄 [Directory Switch] From:', currentSavedDirectory, 'To:', dirPath);
                shouldClearDatabase = true;
            }
        }
        catch (error) {
            console.log('📁 [First Time] No previous directory found, proceeding with indexing');
        }
        // Clear database if switching directories
        if (shouldClearDatabase) {
            database_1.database.clearAllContent();
        }
        // Save the new directory
        database_1.database.setSetting('selectedDirectory', dirPath);
        const entries = await (0, promises_1.readdir)(dirPath, { withFileTypes: true });
        console.log('📋 Found entries:', entries.length);
        const files = [];
        for (const entry of entries) {
            console.log('🔍 Processing:', entry.name, 'Type:', entry.isDirectory() ? 'directory' : 'file');
            // Skip hidden files and non-markdown files (except directories)
            if (entry.name.startsWith('.')) {
                console.log('⏭️ Skipping hidden file:', entry.name);
                continue;
            }
            if (entry.isFile() && !entry.name.endsWith('.md')) {
                console.log('⏭️ Skipping non-markdown file:', entry.name);
                continue;
            }
            const fullPath = (0, path_1.join)(dirPath, entry.name);
            const stats = await (0, promises_1.stat)(fullPath);
            const fileItem = {
                name: entry.name,
                path: fullPath,
                type: entry.isDirectory() ? 'directory' : 'file',
                modified: stats.mtime.toISOString(), // FIX: Convert Date to ISO string
                size: stats.size
            };
            // Process markdown files for RAG (read content and chunk it)
            if (entry.isFile() && entry.name.endsWith('.md')) {
                try {
                    console.log('📖 Reading content for RAG processing:', entry.name);
                    const content = await (0, promises_1.readFile)(fullPath, 'utf-8');
                    // Save to database with RAG chunking and FTS indexing
                    database_1.database.saveFile(fullPath, entry.name, content);
                    console.log('🧠 RAG processed:', entry.name);
                }
                catch (contentError) {
                    console.error('⚠️ Failed to process content for', entry.name, ':', contentError);
                    // Continue with metadata-only entry
                }
            }
            // Recursively process directories to find markdown files
            if (entry.isDirectory()) {
                try {
                    console.log('📂 Recursively processing directory:', entry.name);
                    await processDirectoryRecursively(fullPath);
                }
                catch (dirError) {
                    console.error('⚠️ Failed to process directory', entry.name, ':', dirError);
                }
            }
            console.log('✅ Added:', fileItem.name, fileItem.type);
            files.push(fileItem);
        }
        // Sort: directories first, then files, both alphabetically
        files.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        // Log database stats after indexing
        const stats = database_1.database.getStats();
        console.log(`📊 [Database Stats] Files: ${stats.fileCount}, Chunks: ${stats.chunkCount}, FTS Index: ${stats.indexSize}`);
        console.log('📤 Returning files count:', files.length);
        return files;
    }
    catch (error) {
        console.error('Error reading directory:', error);
        throw error;
    }
});
// Helper function to recursively process directories for markdown files
async function processDirectoryRecursively(dirPath) {
    try {
        const entries = await (0, promises_1.readdir)(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            // Skip hidden files
            if (entry.name.startsWith('.')) {
                continue;
            }
            const fullPath = (0, path_1.join)(dirPath, entry.name);
            if (entry.isFile() && entry.name.endsWith('.md')) {
                try {
                    console.log('📖 [Recursive] Reading content for RAG processing:', entry.name, 'in', dirPath);
                    const content = await (0, promises_1.readFile)(fullPath, 'utf-8');
                    // Save to database with RAG chunking and FTS indexing
                    database_1.database.saveFile(fullPath, entry.name, content);
                    console.log('🧠 [Recursive] RAG processed:', entry.name);
                }
                catch (contentError) {
                    console.error('⚠️ [Recursive] Failed to process content for', entry.name, ':', contentError);
                }
            }
            else if (entry.isDirectory()) {
                // Recursively process subdirectories (with depth limit to prevent infinite loops)
                const depth = dirPath.split('/').length;
                if (depth < 10) { // Reasonable depth limit
                    await processDirectoryRecursively(fullPath);
                }
            }
        }
    }
    catch (error) {
        console.error('Error in recursive directory processing:', error);
    }
}
electron_1.ipcMain.handle('file:readFile', async (_, filePath) => {
    try {
        const content = await (0, promises_1.readFile)(filePath, 'utf-8');
        return content;
    }
    catch (error) {
        console.error('Error reading file:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('file:writeFile', async (_, filePath, content) => {
    try {
        await (0, promises_1.writeFile)(filePath, content, 'utf-8');
        // If it's a markdown file, also update the database for RAG
        if (filePath.endsWith('.md')) {
            const fileName = path_2.default.basename(filePath);
            database_1.database.saveFile(filePath, fileName, content);
            console.log('🧠 Updated RAG index for:', fileName);
        }
        return true;
    }
    catch (error) {
        console.error('Error writing file:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('file:createFile', async (_, dirPath, fileName) => {
    try {
        // Ensure .md extension
        if (!fileName.endsWith('.md')) {
            fileName += '.md';
        }
        const filePath = (0, path_1.join)(dirPath, fileName);
        const initialContent = `# ${fileName.replace('.md', '')}\n\n*Created on ${new Date().toLocaleDateString()}*\n\n`;
        await (0, promises_1.writeFile)(filePath, initialContent, 'utf-8');
        return filePath;
    }
    catch (error) {
        console.error('Error creating file:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('file:createDirectory', async (_, parentPath, dirName) => {
    try {
        const dirPath = (0, path_1.join)(parentPath, dirName);
        await (0, promises_1.mkdir)(dirPath, { recursive: true });
        return dirPath;
    }
    catch (error) {
        console.error('Error creating directory:', error);
        throw error;
    }
});
// Database operations handlers
electron_1.ipcMain.handle('db:saveFile', async (_, filePath, fileName, content) => {
    try {
        database_1.database.saveFile(filePath, fileName, content);
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error saving file to database:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('db:getFile', async (_, filePath) => {
    try {
        return database_1.database.getFile(filePath);
    }
    catch (error) {
        console.error('❌ [IPC] Error getting file from database:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('db:searchFiles', async (_, query) => {
    try {
        return database_1.database.searchFiles(query);
    }
    catch (error) {
        console.error('❌ [IPC] Error searching files in database:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('db:clearAll', async () => {
    try {
        database_1.database.clearAllContent();
        console.log('🗑️ [IPC] Database cleared successfully');
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error clearing database:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('db:getStats', async () => {
    try {
        return database_1.database.getStats();
    }
    catch (error) {
        console.error('❌ [IPC] Error getting database stats:', error);
        throw error;
    }
});
// LLM IPC handlers
electron_1.ipcMain.handle('llm:sendMessage', async (_, messages) => {
    try {
        const llamaService = llamaService_1.LlamaService.getInstance();
        // Convert messages to proper ChatMessage format
        const chatMessages = messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: new Date()
        }));
        return await llamaService.sendMessage(chatMessages);
    }
    catch (error) {
        console.error('❌ [IPC] Error sending message to LLM:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('llm:getStatus', async () => {
    try {
        const llamaService = llamaService_1.LlamaService.getInstance();
        const currentModel = llamaService.getCurrentModel();
        const deviceService = deviceDetection_1.DeviceDetectionService.getInstance();
        const recommendation = await deviceService.getRecommendedModel();
        console.log('🔧 [IPC] LLM Status Check:');
        console.log('🔧 [IPC] currentModel:', currentModel);
        console.log('🔧 [IPC] isInitialized:', currentModel !== null);
        return {
            isInitialized: currentModel !== null,
            currentModel,
            recommendedModel: recommendation
        };
    }
    catch (error) {
        console.error('❌ [IPC] Error getting LLM status:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('llm:getDeviceSpecs', async () => {
    try {
        const deviceService = deviceDetection_1.DeviceDetectionService.getInstance();
        return await deviceService.getDeviceSpecs();
    }
    catch (error) {
        console.error('❌ [IPC] Error getting device specs:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('llm:switchModel', async (_, modelName) => {
    try {
        const llamaService = llamaService_1.LlamaService.getInstance();
        await llamaService.switchModel(modelName);
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error switching LLM model:', error);
        throw error;
    }
});
// Chat IPC handlers
electron_1.ipcMain.handle('chat:create', async (_, title) => {
    try {
        return database_1.database.createChat(title);
    }
    catch (error) {
        console.error('❌ [IPC] Error creating chat:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('chat:getAll', async () => {
    try {
        return database_1.database.getAllChats();
    }
    catch (error) {
        console.error('❌ [IPC] Error getting all chats:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('chat:getActive', async () => {
    try {
        return database_1.database.getActiveChat();
    }
    catch (error) {
        console.error('❌ [IPC] Error getting active chat:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('chat:setActive', async (_, chatId) => {
    try {
        database_1.database.setActiveChat(chatId);
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error setting active chat:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('chat:addMessage', async (_, chatId, role, content) => {
    try {
        return database_1.database.addChatMessage(chatId, role, content);
    }
    catch (error) {
        console.error('❌ [IPC] Error adding chat message:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('chat:getMessages', async (_, chatId) => {
    try {
        return database_1.database.getChatMessages(chatId);
    }
    catch (error) {
        console.error('❌ [IPC] Error getting chat messages:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('chat:delete', async (_, chatId) => {
    try {
        database_1.database.deleteChat(chatId);
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error deleting chat:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('chat:rename', async (_, chatId, newTitle) => {
    try {
        database_1.database.renameChat(chatId, newTitle);
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error renaming chat:', error);
        throw error;
    }
});
// RAG/Content Search IPC handlers
electron_1.ipcMain.handle('content:search', async (_, query, limit) => {
    try {
        console.log(`🔍 [IPC] Content search: ${query}`);
        return contentService_1.contentService.searchOnly(query, limit);
    }
    catch (error) {
        console.error('❌ [IPC] Error searching content:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('content:searchAndAnswer', async (_, query, chatId) => {
    try {
        console.log(`🧠 [IPC] RAG search and answer: ${query}`);
        // Get recent conversation history if chatId provided
        let conversationHistory = [];
        if (chatId) {
            const recentMessages = database_1.database.getChatMessages(chatId, 8); // Get last 8 messages
            conversationHistory = recentMessages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
        }
        return await contentService_1.contentService.searchAndAnswer(query, conversationHistory);
    }
    catch (error) {
        console.error('❌ [IPC] Error in RAG search:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('content:getFile', async (_, fileId) => {
    try {
        return contentService_1.contentService.getFileContent(fileId);
    }
    catch (error) {
        console.error('❌ [IPC] Error getting file content:', error);
        throw error;
    }
});
// Settings IPC handlers
electron_1.ipcMain.handle('settings:get', async (_, key) => {
    try {
        return database_1.database.getSetting(key);
    }
    catch (error) {
        console.error('❌ [IPC] Error getting setting:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('settings:set', async (_, key, value) => {
    try {
        database_1.database.setSetting(key, value);
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error setting value:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('settings:getAll', async () => {
    try {
        // For now, return empty object since getAllSettings doesn't exist
        return {};
    }
    catch (error) {
        console.error('❌ [IPC] Error getting all settings:', error);
        throw error;
    }
});
// File system operations - Delete
electron_1.ipcMain.handle('file:delete', async (_, filePath) => {
    try {
        const { unlink, rmdir } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const stats = await (0, promises_1.stat)(filePath);
        if (stats.isDirectory()) {
            // For directories, use recursive removal
            await rmdir(filePath, { recursive: true });
            console.log('🗑️ [IPC] Directory deleted:', filePath);
        }
        else {
            // For files
            await unlink(filePath);
            console.log('🗑️ [IPC] File deleted:', filePath);
            // Remove from database if it was a markdown file
            if (filePath.endsWith('.md')) {
                // TODO: Add method to remove file from database
                console.log('🗑️ [Database] Should remove from index:', filePath);
            }
        }
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error deleting file/directory:', error);
        throw error;
    }
});
// File system operations - Rename/Move
electron_1.ipcMain.handle('file:rename', async (_, oldPath, newName) => {
    try {
        const { rename } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const parentDir = path_2.default.dirname(oldPath);
        const newPath = path_2.default.join(parentDir, newName);
        // Check if new path already exists
        try {
            await (0, promises_1.stat)(newPath);
            throw new Error(`A file or directory with the name "${newName}" already exists`);
        }
        catch (checkError) {
            // File doesn't exist, which is what we want
            if (checkError.code !== 'ENOENT') {
                throw checkError;
            }
        }
        // Rename the file/directory
        await rename(oldPath, newPath);
        console.log('✏️ [IPC] Renamed:', oldPath, '->', newPath);
        // Update database if it was a markdown file
        if (oldPath.endsWith('.md') && newPath.endsWith('.md')) {
            try {
                const content = await (0, promises_1.readFile)(newPath, 'utf-8');
                const fileName = path_2.default.basename(newPath);
                // Remove old entry and add new one
                // TODO: Add method to update file path in database
                database_1.database.saveFile(newPath, fileName, content);
                console.log('📝 [Database] Updated index for renamed file:', fileName);
            }
            catch (dbError) {
                console.error('⚠️ [Database] Failed to update index after rename:', dbError);
            }
        }
        return { success: true, newPath };
    }
    catch (error) {
        console.error('❌ [IPC] Error renaming file/directory:', error);
        throw error;
    }
});
// File system operations - Move to different directory
electron_1.ipcMain.handle('file:move', async (_, sourcePath, targetDirectoryPath) => {
    try {
        const { rename } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const fileName = path_2.default.basename(sourcePath);
        const newPath = path_2.default.join(targetDirectoryPath, fileName);
        // Check if source and target are the same
        if (sourcePath === newPath) {
            return { success: true, newPath: sourcePath, message: 'File is already in target location' };
        }
        // Check if new path already exists
        try {
            await (0, promises_1.stat)(newPath);
            throw new Error(`A file or directory with the name "${fileName}" already exists in the target directory`);
        }
        catch (checkError) {
            // File doesn't exist, which is what we want
            if (checkError.code !== 'ENOENT') {
                throw checkError;
            }
        }
        // Move the file/directory
        await rename(sourcePath, newPath);
        console.log('🚚 [IPC] Moved:', sourcePath, '->', newPath);
        // Update database if it was a markdown file
        if (sourcePath.endsWith('.md') && newPath.endsWith('.md')) {
            try {
                const content = await (0, promises_1.readFile)(newPath, 'utf-8');
                const fileName = path_2.default.basename(newPath);
                // Remove old entry and add new one
                // TODO: Add method to update file path in database
                database_1.database.saveFile(newPath, fileName, content);
                console.log('📝 [Database] Updated index for moved file:', fileName);
            }
            catch (dbError) {
                console.error('⚠️ [Database] Failed to update index after move:', dbError);
            }
        }
        return { success: true, newPath };
    }
    catch (error) {
        console.error('❌ [IPC] Error moving file/directory:', error);
        throw error;
    }
});
// License IPC handlers
electron_1.ipcMain.handle('license:validate', async (_, licenseKey) => {
    try {
        const licenseService = licenseService_1.LicenseService.getInstance();
        return await licenseService.validateLicense(licenseKey);
    }
    catch (error) {
        console.error('❌ [IPC] Error validating license:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('license:getStatus', async () => {
    try {
        const licenseService = licenseService_1.LicenseService.getInstance();
        return await licenseService.getCurrentLicenseStatus();
    }
    catch (error) {
        console.error('❌ [IPC] Error getting license status:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('license:clear', async () => {
    try {
        const licenseService = licenseService_1.LicenseService.getInstance();
        await licenseService.clearLicense();
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error clearing license:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('license:setBackendUrl', async (_, url) => {
    try {
        const licenseService = licenseService_1.LicenseService.getInstance();
        licenseService.setBackendUrl(url);
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error setting backend URL:', error);
        throw error;
    }
});
// System operations
electron_1.ipcMain.handle('system:openExternal', async (_, url) => {
    try {
        await electron_1.shell.openExternal(url);
        return true;
    }
    catch (error) {
        console.error('❌ [IPC] Error opening external URL:', error);
        throw error;
    }
});
//# sourceMappingURL=index.js.map