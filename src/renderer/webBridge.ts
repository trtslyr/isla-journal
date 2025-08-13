// Provide a browser-based shim that mimics the Electron preload API
// This enables the existing renderer code to keep calling window.electronAPI.*

// Storage helpers
const storage = {
	get: (key: string) => {
		try { return localStorage.getItem(key) } catch { return null }
	},
	set: (key: string, value: string) => {
		try { localStorage.setItem(key, value) } catch {}
	}
}

// Basic IndexedDB wrapper for files index if needed later (placeholder)
// For now, we read directly from the file system via File System Access API

// File System Access helpers
async function pickDirectory(): Promise<string | null> {
	try {
		// @ts-ignore
		if (!window.showDirectoryPicker) return null
		// @ts-ignore
		const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
		;(window as any).__isla_rootHandle = handle
		return 'fsroot://'
	} catch {
		return null
	}
}

async function listDirectory(path: string): Promise<any[]> {
	try {
		const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
		if (!root) return []
		const results: any[] = []
		for await (const [name, handle] of (root as any).entries()) {
			if (name.startsWith('.')) continue
			const isDirectory = handle.kind === 'directory'
			let size = 0
			let modified = new Date().toISOString()
			if (!isDirectory) {
				try {
					const file = await (handle as FileSystemFileHandle).getFile()
					size = file.size
					modified = new Date(file.lastModified).toISOString()
				} catch {}
			}
			results.push({
				name,
				path: `fsroot://${name}`,
				type: isDirectory ? 'directory' : 'file',
				modified,
				size
			})
		}
		// directories first
		results.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'directory' ? -1 : 1))
		return results
	} catch {
		return []
	}
}

async function readFileAt(path: string): Promise<string> {
	try {
		const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
		if (!root) throw new Error('No directory selected')
		const name = path.replace('fsroot://', '')
		const fileHandle = await root.getFileHandle(name, { create: false })
		const file = await fileHandle.getFile()
		return await file.text()
	} catch (e:any) {
		throw new Error(e?.message || 'Read failed')
	}
}

async function writeFileAt(path: string, content: string): Promise<boolean> {
	try {
		const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
		if (!root) throw new Error('No directory selected')
		const name = path.replace('fsroot://', '')
		const fileHandle = await root.getFileHandle(name, { create: true })
		const writable = await fileHandle.createWritable()
		await writable.write(content)
		await writable.close()
		return true
	} catch (e:any) {
		throw new Error(e?.message || 'Write failed')
	}
}

async function createFileAt(dirPath: string, fileName: string): Promise<string> {
	const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
	if (!root) throw new Error('No directory selected')
	if (!fileName.endsWith('.md')) fileName += '.md'
	const handle = await root.getFileHandle(fileName, { create: true })
	const writable = await handle.createWritable()
	await writable.write(`# ${fileName.replace(/\.md$/,'')}\n\n*Created on ${new Date().toLocaleDateString()}*\n\n`)
	await writable.close()
	return `fsroot://${fileName}`
}

async function createDirectoryAt(parentPath: string, dirName: string): Promise<string> {
	const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
	if (!root) throw new Error('No directory selected')
	// @ts-ignore
	const dir = await root.getDirectoryHandle(dirName, { create: true })
	return `fsroot://${dirName}`
}

async function deleteEntry(targetPath: string): Promise<boolean> {
	const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
	if (!root) throw new Error('No directory selected')
	const name = targetPath.replace('fsroot://', '')
	// @ts-ignore
	await root.removeEntry(name, { recursive: true }).catch(() => {})
	return true
}

async function renameEntry(oldPath: string, newName: string): Promise<{ success: boolean; newPath: string }> {
	// File System Access API does not support rename directly. Perform copy+delete for files.
	const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
	if (!root) throw new Error('No directory selected')
	const oldName = oldPath.replace('fsroot://', '')
	try {
		const fileHandle = await root.getFileHandle(oldName, { create: false })
		const file = await fileHandle.getFile()
		const newPath = `fsroot://${newName}`
		const newHandle = await root.getFileHandle(newName, { create: true })
		const writable = await newHandle.createWritable()
		await writable.write(await file.text())
		await writable.close()
		// delete old
		// @ts-ignore
		await root.removeEntry(oldName).catch(()=>{})
		return { success: true, newPath }
	} catch {
		return { success: false, newPath: oldPath }
	}
}

async function moveEntry(sourcePath: string, targetDirectoryPath: string): Promise<{ success: boolean; newPath: string }> {
	// Not directly supported without DirectoryHandle for target; keep no-op
	return { success: false, newPath: sourcePath }
}

async function saveImage(dirPath: string, baseName: string, dataBase64: string, ext: string): Promise<string | null> {
	try {
		const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
		if (!root) return null
		const safeExt = (ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
		const fileName = `${baseName.replace(/[^a-zA-Z0-9-_]/g, '_')}_${Date.now()}.${safeExt}`
		const handle = await root.getFileHandle(fileName, { create: true })
		const writable = await handle.createWritable()
		const commaIdx = dataBase64.indexOf(',')
		const payload = commaIdx >= 0 ? dataBase64.slice(commaIdx + 1) : dataBase64
		const buf = Uint8Array.from(atob(payload), c => c.charCodeAt(0))
		await writable.write(buf)
		await writable.close()
		return `fsroot://${fileName}`
	} catch {
		return null
	}
}

// Minimal DB shims using localStorage for settings and in-memory for chats/messages
let chatAutoId = 1
const chatsKey = 'isla_chats'
const messagesKey = 'isla_chat_messages'
function loadJson<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback } }
function saveJson<T>(key: string, v: T) { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }

const chatStore = {
	getAll: (): any[] => loadJson<any[]>(chatsKey, []),
	saveAll: (arr: any[]) => saveJson(chatsKey, arr),
	getMsgs: (id: number): any[] => loadJson<any[]>(`${messagesKey}_${id}`, []),
	saveMsgs: (id: number, arr: any[]) => saveJson(`${messagesKey}_${id}`, arr)
}

// Ollama via fetch
const OLLAMA_HOST_DEFAULT = 'http://127.0.0.1:11434'
async function ollamaList(host: string) {
	const r = await fetch(`${host}/api/tags`).then(r=>r.json()).catch(()=>({models:[]}))
	return r
}
async function ollamaChat(host: string, model: string, messages: Array<{role:string, content:string}>, onToken?: (t:string)=>void): Promise<string> {
	const res = await fetch(`${host}/api/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model, messages, stream: !!onToken }) })
	if (!res.ok) throw new Error('Ollama chat failed')
	if (!onToken) {
		const json = await res.json()
		return json?.message?.content || ''
	}
	let full = ''
	const reader = res.body!.getReader()
	const decoder = new TextDecoder()
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		const text = decoder.decode(value, { stream: true })
		for (const line of text.split('\n')) {
			if (!line.trim()) continue
			try {
				const obj = JSON.parse(line)
				const chunk = obj?.message?.content || ''
				if (chunk) { full += chunk; onToken?.(chunk) }
			} catch {}
		}
	}
	return full
}

// Minimal content search shim: naive in-memory search over currently opened root directory (reads only top-level files)
async function searchContentShim(query: string, limit: number = 20): Promise<any[]> {
	try {
		const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
		if (!root) return []
		const results: any[] = []
		for await (const [name, handle] of (root as any).entries()) {
			if (handle.kind !== 'file') continue
			const file = await (handle as FileSystemFileHandle).getFile()
			const text = await file.text()
			const idx = text.toLowerCase().indexOf(query.toLowerCase())
			if (idx >= 0) {
				results.push({ id: results.length+1, file_id: 0, file_path: `fsroot://${name}`, file_name: name, content_snippet: text.slice(Math.max(0, idx-60), idx+200), rank: 1, chunk_index: 0 })
				if (results.length >= limit) break
			}
		}
		return results
	} catch { return [] }
}

const electronAPI = {
	// Version/platform (best-effort)
	getVersion: async () => '0.1.0',
	getPlatform: async () => navigator.userAgentData?.platform || navigator.platform || 'web',

	// File system operations
	openDirectory: () => pickDirectory(),
	readDirectory: (p: string) => listDirectory(p),
	readFile: (p: string) => readFileAt(p),
	writeFile: (p: string, c: string) => writeFileAt(p, c),
	createFile: (dirPath: string, fileName: string) => createFileAt(dirPath, fileName),
	createDirectory: (dirPath: string, dirName: string) => createDirectoryAt(dirPath, dirName),
	deleteFile: (filePath: string) => deleteEntry(filePath),
	renameFile: (oldPath: string, newName: string) => renameEntry(oldPath, newName),
	moveFile: (src: string, dstDir: string) => moveEntry(src, dstDir),
	saveImage: (dirPath: string, baseName: string, dataBase64: string, ext: string) => saveImage(dirPath, baseName, dataBase64, ext),

	// Database-like operations (settings only here)
	dbClearAll: async () => true,
	dbGetStats: async () => ({ fileCount: 0, chunkCount: 0, indexSize: 0 }),
	dbReindexAll: async () => ({ fileCount: 0, chunkCount: 0, indexSize: 0 }),

	// Settings
	settingsGet: async (key: string) => storage.get(key),
	settingsSet: async (key: string, value: string) => { storage.set(key, value); return true },

	// RAG/Content search (shim)
	searchContent: (query: string, limit?: number) => searchContentShim(query, limit ?? 20),
	contentSearchAndAnswer: async (query: string, _chatId?: number) => {
		const sources = await searchContentShim(query, 10)
		const today = new Date().toISOString()
		const context = sources.map(s=>`• ${s.file_name} — ${s.content_snippet}`).join('\n')
		const prompt = `Today is ${today}.\n${context ? `\nContext from notes:\n${context}` : ''}\n\nUser’s request: ${query}`
		const host = storage.get('ollamaHost') || OLLAMA_HOST_DEFAULT
		const models = await ollamaList(host)
		const currentModel = (storage.get('ollamaModel') || models?.models?.[0]?.name || 'llama3.2:latest')
		const answer = await ollamaChat(host, currentModel, [{ role: 'user', content: prompt }])
		return { answer, sources }
	},
	contentStreamSearchAndAnswer: async (query: string, _chatId?: number) => {
		const host = storage.get('ollamaHost') || OLLAMA_HOST_DEFAULT
		const models = await ollamaList(host)
		const currentModel = (storage.get('ollamaModel') || models?.models?.[0]?.name || 'llama3.2:latest')
		let listeners: Array<(d:any)=>void> = []
		;(window as any).__isla_streamListeners = listeners
		const sources = await searchContentShim(query, 10)
		const today = new Date().toISOString()
		const context = sources.map(s=>`• ${s.file_name} — ${s.content_snippet}`).join('\n')
		const prompt = `Today is ${today}.\n${context ? `\nContext from notes:\n${context}` : ''}\n\nUser’s request: ${query}`
		setTimeout(async () => {
			let full = ''
			await ollamaChat(host, currentModel, [{ role: 'user', content: prompt }], (chunk) => {
				full += chunk
				listeners.forEach(fn=>fn({ chunk }))
			})
			// done event
			const done = (window as any).__isla_streamDone
			done && done({ answer: full, sources })
		}, 0)
		return { started: true }
	},
	onContentStreamChunk: (cb: (payload: { chunk: string }) => void) => {
		const listeners: Array<(d:any)=>void> = (window as any).__isla_streamListeners || []
		listeners.push(cb)
		;(window as any).__isla_streamListeners = listeners
		return () => {
			const arr: Array<(d:any)=>void> = (window as any).__isla_streamListeners || []
			;(window as any).__isla_streamListeners = arr.filter(f=>f!==cb)
		}
	},
	onContentStreamDone: (cb: (payload: { answer: string; sources: any[] }) => void) => {
		;(window as any).__isla_streamDone = cb
		return () => { (window as any).__isla_streamDone = undefined }
	},

	// LLM
	llmSendMessage: async (messages: Array<{role: string, content: string}>) => {
		const host = storage.get('ollamaHost') || OLLAMA_HOST_DEFAULT
		const model = storage.get('ollamaModel') || 'llama3.2:latest'
		return await ollamaChat(host, model, messages)
	},
	llmGetStatus: async () => ({ isInitialized: true, currentModel: storage.get('ollamaModel') || 'llama3.2:latest' }),
	llmGetCurrentModel: async () => storage.get('ollamaModel') || 'llama3.2:latest',
	llmGetDeviceSpecs: async () => null,
	llmGetRecommendedModel: async () => null,
	llmGetAvailableModels: async () => {
		const host = storage.get('ollamaHost') || OLLAMA_HOST_DEFAULT
		const tags = await ollamaList(host)
		return tags?.models?.map((m:any)=>m.name) || []
	},
	llmSwitchModel: async (modelName: string) => { storage.set('ollamaModel', modelName); return true },

	// Chat ops (localStorage-based)
	chatCreate: async (title: string) => {
		const chats = chatStore.getAll()
		const id = (chats.reduce((m, c)=>Math.max(m, c.id||0), 0) + 1) || chatAutoId++
		const rec = { id, title, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_active: false }
		chats.unshift(rec)
		chatStore.saveAll(chats)
		return rec
	},
	chatGetAll: async () => chatStore.getAll(),
	chatGetActive: async () => chatStore.getAll().find(c=>c.is_active) || null,
	chatSetActive: async (chatId: number) => {
		const chats = chatStore.getAll().map(c=>({ ...c, is_active: c.id===chatId }))
		chatStore.saveAll(chats)
		return true
	},
	chatAddMessage: async (chatId: number, role: string, content: string, metadata?: any) => {
		const msgs = chatStore.getMsgs(chatId)
		const id = (msgs.reduce((m, c)=>Math.max(m, c.id||0), 0) + 1)
		const rec = { id, chat_id: chatId, role, content, created_at: new Date().toISOString(), metadata }
		msgs.push(rec)
		chatStore.saveMsgs(chatId, msgs)
		// bump chat updated
		const chats = chatStore.getAll().map(c=>c.id===chatId?{...c, updated_at:new Date().toISOString()}:c)
		chatStore.saveAll(chats)
		return rec
	},
	chatGetMessages: async (chatId: number) => chatStore.getMsgs(chatId),
	chatDelete: async (chatId: number) => {
		const chats = chatStore.getAll().filter(c=>c.id!==chatId)
		chatStore.saveAll(chats)
		saveJson(`${messagesKey}_${chatId}`, [])
		return true
	},
	chatRename: async (chatId: number, newTitle: string) => {
		const chats = chatStore.getAll().map(c=>c.id===chatId?{...c, title:newTitle, updated_at:new Date().toISOString()}:c)
		chatStore.saveAll(chats)
		return true
	},
	chatGetMessagesSince: async (_chatId: number, _iso: string) => [],

	// System operations
	openExternal: async (url: string) => { try { window.open(url, '_blank', 'noopener,noreferrer') } catch {} return true },

	// Events
	onSettingsChanged: (callback: (payload: { key: string; value: any }) => void) => {
		// No central event bus; return a no-op unregister
		return () => {}
	}
}

;(window as any).electronAPI = electronAPI

declare global {
	interface Window { electronAPI: typeof electronAPI }
}