"use strict";
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
    createWindow();
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
// Security: Prevent new window creation (handled by setWindowOpenHandler above)
// File System Operations
const promises_1 = require("fs/promises");
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
        const entries = await (0, promises_1.readdir)(dirPath, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
            // Skip hidden files and non-markdown files (except directories)
            if (entry.name.startsWith('.'))
                continue;
            if (entry.isFile() && !entry.name.endsWith('.md'))
                continue;
            const fullPath = (0, path_1.join)(dirPath, entry.name);
            const stats = await (0, promises_1.stat)(fullPath);
            files.push({
                name: entry.name,
                path: fullPath,
                type: entry.isDirectory() ? 'directory' : 'file',
                modified: stats.mtime,
                size: stats.size
            });
        }
        // Sort: directories first, then files, both alphabetically
        files.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        return files;
    }
    catch (error) {
        console.error('Error reading directory:', error);
        throw error;
    }
});
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
//# sourceMappingURL=index.js.map