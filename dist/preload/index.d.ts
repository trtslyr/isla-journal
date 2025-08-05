declare const electronAPI: {
    getVersion: () => Promise<any>;
    getPlatform: () => Promise<any>;
    openDirectory: () => Promise<any>;
    readDirectory: (path: string) => Promise<any>;
    readFile: (path: string) => Promise<any>;
    writeFile: (path: string, content: string) => Promise<any>;
    createFile: (dirPath: string, fileName: string, content: string) => Promise<any>;
    createDirectory: (dirPath: string, dirName: string) => Promise<any>;
    deleteFile: (filePath: string) => Promise<any>;
    renameFile: (oldPath: string, newName: string) => Promise<any>;
    moveFile: (sourcePath: string, targetDirectoryPath: string) => Promise<any>;
    dbClearAll: () => Promise<any>;
    dbGetStats: () => Promise<any>;
    settingsGet: (key: string) => Promise<any>;
    settingsSet: (key: string, value: string) => Promise<any>;
    searchContent: (query: string) => Promise<any>;
    answerQuestion: (query: string, history?: Array<{
        role: string;
        content: string;
    }>) => Promise<any>;
    contentSearchAndAnswer: (query: string, chatId?: number) => Promise<any>;
    llmSendMessage: (messages: Array<{
        role: string;
        content: string;
    }>) => Promise<any>;
    chatCreate: (title: string) => Promise<any>;
    chatGetAll: () => Promise<any>;
    chatGetActive: () => Promise<any>;
    chatSetActive: (chatId: number) => Promise<any>;
    chatDelete: (chatId: number) => Promise<any>;
    chatRename: (chatId: number, title: string) => Promise<any>;
    chatGetMessages: (chatId: number) => Promise<any>;
    chatAddMessage: (chatId: number, role: string, content: string) => Promise<any>;
    chatClearMessages: (chatId: number) => Promise<any>;
};
declare global {
    interface Window {
        electronAPI: typeof electronAPI;
        autoSaveTimeout?: NodeJS.Timeout;
    }
}
export {};
//# sourceMappingURL=index.d.ts.map