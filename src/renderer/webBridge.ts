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

// Indexable extensions similar to desktop app
const INDEXABLE_EXTENSIONS = new Set<string>([
	'.md', '.mdx', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.yml', '.yaml',
	'.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h', '.rb', '.php', '.sh', '.toml'
])
const hasIndexableExt = (name: string): boolean => {
	const lower = name.toLowerCase()
	const i = lower.lastIndexOf('.')
	if (i < 0) return false
	return INDEXABLE_EXTENSIONS.has(lower.slice(i))
}

// In-memory index for PWA session
interface IndexedFile { path: string; name: string; content: string; file_mtime?: string; note_date?: string; size: number }
interface IndexedChunk { id: number; file_path: string; file_name: string; chunk_text: string; chunk_index: number; file_mtime?: string; note_date?: string }
;(window as any).__isla_files = [] as IndexedFile[]
;(window as any).__isla_chunks = [] as IndexedChunk[]

// Date parsing similar to desktop
function deriveNoteDate(fileName: string, content?: string): string | null {
	if (content) {
		const fm = content.match(/^---[\s\S]*?date:\s*['"]?(\d{4}-\d{2}-\d{2})['"]?[\s\S]*?---/i)
		if (fm) return fm[1]
		const firstLines = content.split('\n').slice(0, 3).join('\n')
		const iso = firstLines.match(/(\d{4}-\d{2}-\d{2})/)
		if (iso) return iso[1]
		const us = firstLines.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
		if (us) {
			const mo = parseInt(us[1]).toString().padStart(2, '0')
			const d = parseInt(us[2]).toString().padStart(2, '0')
			return `${us[3]}-${mo}-${d}`
		}
		const monthMap: Record<string,string> = { january:'01',jan:'01',february:'02',feb:'02',march:'03',mar:'03',april:'04',apr:'04',may:'05',june:'06',jun:'06',july:'07',jul:'07',august:'08',aug:'08',september:'09',sep:'09',october:'10',oct:'10',november:'11',nov:'11',december:'12',dec:'12' }
		const written = firstLines.match(/(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+(\d{1,2}),?\s+(\d{4})/i)
		if (written) {
			const mo = monthMap[written[1].toLowerCase()]
			const d = parseInt(written[2]).toString().padStart(2, '0')
			return `${written[3]}-${mo}-${d}`
		}
		const reverse = firstLines.match(/(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec),?\s+(\d{4})/i)
		if (reverse) {
			const mo = monthMap[reverse[2].toLowerCase()]
			const d = parseInt(reverse[1]).toString().padStart(2, '0')
			return `${reverse[3]}-${mo}-${d}`
		}
	}
	const isoInName = fileName.match(/(\d{4})-(\d{2})-(\d{2})/)
	if (isoInName) return `${isoInName[1]}-${isoInName[2]}-${isoInName[3]}`
	return null
}

// Chunking similar to desktop, heading-aware
function chunkContentStructured(content: string): Array<{ text: string; headingPath: string; heading: string; level: number }> {
	const lines = content.split(/\r?\n/)
	const pathStack: Array<{ level: number; text: string }> = []
	const textBlocks: Array<{ start: number; end: number; text: string; level: number; heading: string; headingPath: string }> = []
	let currentStart = 0
	let currentLevel = 0
	let currentHeading = ''
	let currentPath = ''
	const flush = (end: number) => {
		const block = lines.slice(currentStart, end).join('\n').trim()
		if (block) textBlocks.push({ start: currentStart, end, text: block, level: currentLevel, heading: currentHeading, headingPath: currentPath })
	}
	for (let i=0;i<lines.length;i++) {
		const m = lines[i].match(/^(#{1,6})\s+(.*)$/)
		if (m) {
			flush(i)
			const level = m[1].length
			const text = (m[2] || '').trim()
			while (pathStack.length && pathStack[pathStack.length-1].level >= level) pathStack.pop()
			pathStack.push({ level, text })
			currentPath = pathStack.map(h=>h.text).join(' > ')
			currentHeading = text
			currentLevel = level
			currentStart = i + 1
		}
	}
	flush(lines.length)
	const chunks: Array<{ text:string; headingPath:string; heading:string; level:number }> = []
	const maxLen = 800
	const overlap = 150
	for (const b of textBlocks) {
		const t = b.text.replace(/\s+/g, ' ').trim()
		if (!t) continue
		if (t.length <= maxLen) chunks.push({ text: t, headingPath: b.headingPath, heading: b.heading, level: b.level || 0 })
		else {
			for (let i=0;i<t.length;i += (maxLen - overlap)) {
				const slice = t.slice(i, i+maxLen)
				if (slice.trim().length > 50) chunks.push({ text: slice.trim(), headingPath: b.headingPath, heading: b.heading, level: b.level || 0 })
			}
		}
	}
	if (chunks.length === 0 && content.trim()) chunks.push({ text: content.trim(), headingPath: '', heading: '', level: 0 })
	return chunks
}

// FS helpers
async function getDirectoryHandleByPath(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle | null> {
	const rel = path.replace('fsroot://', '').replace(/^\/+/, '')
	if (!rel) return root
	const parts = rel.split('/').filter(Boolean)
	let current: FileSystemDirectoryHandle = root
	for (const p of parts) {
		try {
			// @ts-ignore
			current = await current.getDirectoryHandle(p, { create: false })
		} catch { return null }
	}
	return current
}

async function indexDirectoryRecursive(dir: FileSystemDirectoryHandle, basePath: string): Promise<void> {
	for await (const [name, handle] of (dir as any).entries()) {
		if (name.startsWith('.')) continue
		if ((handle as any).kind === 'directory') {
			await indexDirectoryRecursive(handle as FileSystemDirectoryHandle, `${basePath}/${name}`)
		} else {
			if (!hasIndexableExt(name)) continue
			try {
				const file = await (handle as FileSystemFileHandle).getFile()
				const text = await file.text()
				const filePath = `fsroot://${basePath}/${name}`.replace(/\\/g, '/').replace(/\/+/g, '/')
				const rec: IndexedFile = { path: filePath, name, content: text, size: file.size, file_mtime: new Date(file.lastModified).toISOString(), note_date: deriveNoteDate(name, text) || undefined }
				;(window as any).__isla_files.push(rec)
				const chunks = chunkContentStructured(text)
				chunks.forEach((c, idx) => {
					;(window as any).__isla_chunks.push({ id: (window as any).__isla_chunks.length + 1, file_path: filePath, file_name: name, chunk_text: c.text, chunk_index: idx, file_mtime: rec.file_mtime, note_date: rec.note_date })
				})
			} catch {}
		}
	}
}

async function buildIndexFromRoot(root: FileSystemDirectoryHandle): Promise<void> {
	;(window as any).__isla_files = []
	;(window as any).__isla_chunks = []
	await indexDirectoryRecursive(root, '')
}

// File System Access helpers
async function pickDirectory(): Promise<string | null> {
	try {
		// @ts-ignore
		if (!window.showDirectoryPicker) return null
		// @ts-ignore
		const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
		;(window as any).__isla_rootHandle = handle
		;(window as any).__isla_rootName = (handle as any).name || 'Directory'
		
		// Persist directory information
		try { 
			storage.set('selectedDirectoryName', (handle as any).name || '')
			storage.set('selectedDirectory', 'fsroot://')
			console.log('💾 [webBridge] Directory persisted:', (handle as any).name)
		} catch {} 
		
		await buildIndexFromRoot(handle)
		return 'fsroot://'
	} catch {
		return null
	}
}

async function listDirectory(path: string): Promise<any[]> {
    try {
        let root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
        if (!root) {
            // No handle available - return empty to show "click to access" message
            console.log('⚠️ [webBridge] No directory handle available for listDirectory')
            return []
        }
		const dirHandle = await getDirectoryHandleByPath(root, path)
		if (!dirHandle) return []
		const results: any[] = []
		for await (const [name, handle] of (dirHandle as any).entries()) {
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
			const subPath = (path.endsWith('/') || path === 'fsroot://') ? `${path}${name}` : `${path}/${name}`
			results.push({ name, path: subPath, type: isDirectory ? 'directory' : 'file', modified, size })
		}
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
		const rel = path.replace('fsroot://', '').replace(/^\/+/, '')
		const dir = await getDirectoryHandleByPath(root, 'fsroot://' + rel.split('/').slice(0, -1).join('/'))
		if (!dir) throw new Error('Directory not found')
		const name = rel.split('/').pop()!
		const fileHandle = await dir.getFileHandle(name, { create: false })
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
		const rel = path.replace('fsroot://', '').replace(/^\/+/, '')
		const dir = await getDirectoryHandleByPath(root, 'fsroot://' + rel.split('/').slice(0, -1).join('/'))
		if (!dir) throw new Error('Directory not found')
		const name = rel.split('/').pop()!
		const fileHandle = await dir.getFileHandle(name, { create: true })
		const writable = await fileHandle.createWritable()
		await writable.write(content)
		await writable.close()
		// Update in-memory index
		const idx = (window as any).__isla_files.findIndex((f:IndexedFile)=>f.path===path)
		if (idx >= 0) {
			;(window as any).__isla_files[idx].content = content
			;(window as any).__isla_files[idx].file_mtime = new Date().toISOString()
		} else {
			;(window as any).__isla_files.push({ path, name, content, size: content.length, file_mtime: new Date().toISOString(), note_date: deriveNoteDate(name, content) || undefined })
		}
		// Re-chunk for this file
		;(window as any).__isla_chunks = (window as any).__isla_chunks.filter((c:IndexedChunk)=>c.file_path!==path)
		const chunks = chunkContentStructured(content)
		chunks.forEach((c, i) => (window as any).__isla_chunks.push({ id: (window as any).__isla_chunks.length + 1, file_path: path, file_name: name, chunk_text: c.text, chunk_index: i }))
		return true
	} catch (e:any) {
		throw new Error(e?.message || 'Write failed')
	}
}

async function createFileAt(dirPath: string, fileName: string): Promise<string> {
	const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
	if (!root) throw new Error('No directory selected')
	if (!fileName.endsWith('.md')) fileName += '.md'
	const dir = await getDirectoryHandleByPath(root, dirPath)
	if (!dir) throw new Error('Directory not found')
	const handle = await dir.getFileHandle(fileName, { create: true })
	const writable = await handle.createWritable()
	const initial = `# ${fileName.replace(/\.md$/,'')}\n\n*Created on ${new Date().toLocaleDateString()}*\n\n`
	await writable.write(initial)
	await writable.close()
	const newPath = (dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`)
	;(window as any).__isla_files.push({ path: newPath, name: fileName, content: initial, size: initial.length, file_mtime: new Date().toISOString(), note_date: deriveNoteDate(fileName, initial) || undefined })
	;(window as any).__isla_chunks.push({ id: (window as any).__isla_chunks.length + 1, file_path: newPath, file_name: fileName, chunk_text: initial, chunk_index: 0 })
	return newPath
}

async function createDirectoryAt(parentPath: string, dirName: string): Promise<string> {
	const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
	if (!root) throw new Error('No directory selected')
	const dir = await getDirectoryHandleByPath(root, parentPath)
	if (!dir) throw new Error('Directory not found')
	// @ts-ignore
	await dir.getDirectoryHandle(dirName, { create: true })
	return (parentPath.endsWith('/') ? `${parentPath}${dirName}` : `${parentPath}/${dirName}`)
}

async function deleteEntry(targetPath: string): Promise<boolean> {
	const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
	if (!root) throw new Error('No directory selected')
	const rel = targetPath.replace('fsroot://', '').replace(/^\/+/, '')
	const parent = await getDirectoryHandleByPath(root, 'fsroot://' + rel.split('/').slice(0, -1).join('/'))
	if (!parent) throw new Error('Directory not found')
	const name = rel.split('/').pop()!
	// @ts-ignore
	await parent.removeEntry(name, { recursive: true }).catch(() => {})
	;(window as any).__isla_files = (window as any).__isla_files.filter((f:IndexedFile)=>!f.path.startsWith(targetPath))
	;(window as any).__isla_chunks = (window as any).__isla_chunks.filter((c:IndexedChunk)=>!c.file_path.startsWith(targetPath))
	return true
}

async function renameEntry(oldPath: string, newName: string): Promise<{ success: boolean; newPath: string }> {
	const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
	if (!root) throw new Error('No directory selected')
	const rel = oldPath.replace('fsroot://', '').replace(/^\/+/, '')
	const parent = await getDirectoryHandleByPath(root, 'fsroot://' + rel.split('/').slice(0, -1).join('/'))
	if (!parent) return { success: false, newPath: oldPath }
	try {
		const oldName = rel.split('/').pop()!
		const fileHandle = await parent.getFileHandle(oldName, { create: false })
		const file = await fileHandle.getFile()
		const newPath = 'fsroot://' + rel.split('/').slice(0, -1).concat([newName]).join('/')
		const newHandle = await parent.getFileHandle(newName, { create: true })
		const writable = await newHandle.createWritable()
		await writable.write(await file.text())
		await writable.close()
		// @ts-ignore
		await parent.removeEntry(oldName).catch(()=>{})
		;(window as any).__isla_files = (window as any).__isla_files.map((f:IndexedFile)=> f.path===oldPath ? { ...f, path: newPath, name: newName } : f)
		;(window as any).__isla_chunks = (window as any).__isla_chunks.map((c:IndexedChunk)=> c.file_path===oldPath ? { ...c, file_path: newPath, file_name: newName } : c)
		return { success: true, newPath }
	} catch {
		return { success: false, newPath: oldPath }
	}
}

async function moveEntry(sourcePath: string, targetDirectoryPath: string): Promise<{ success: boolean; newPath: string; message?: string }> {
	// Not supported without writable DirectoryHandle for deep trees; return a message
	return { success: false, newPath: sourcePath, message: 'Move is not supported in PWA mode yet' }
}

async function saveImage(dirPath: string, baseName: string, dataBase64: string, ext: string): Promise<string | null> {
	try {
		const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle
		if (!root) return null
		const dir = await getDirectoryHandleByPath(root, dirPath)
		if (!dir) return null
		const safeExt = (ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
		const fileName = `${baseName.replace(/[^a-zA-Z0-9-_]/g, '_')}_${Date.now()}.${safeExt}`
		const handle = await dir.getFileHandle(fileName, { create: true })
		const writable = await handle.createWritable()
		const commaIdx = dataBase64.indexOf(',')
		const payload = commaIdx >= 0 ? dataBase64.slice(commaIdx + 1) : dataBase64
		const buf = Uint8Array.from(atob(payload), c => c.charCodeAt(0))
		await writable.write(buf)
		await writable.close()
		const fullPath = (dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`)
		return fullPath
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
let __resolvedOllamaHost: string | null = null

async function probeHost(base: string): Promise<boolean> {
	try {
		const url = base ? `${base}/api/version` : `/api/version`
		console.log(`[webBridge] Probing host: ${url}`)
		const res = await fetch(url, { method: 'GET', mode: base ? 'cors' : 'same-origin', credentials: 'omit' })
		console.log(`[webBridge] Probe result for ${url}: ${res.ok ? 'OK' : 'FAIL'} (${res.status})`)
		if (!res.ok) return false
		await res.json().catch(()=>null)
		return true
	} catch (e) {
		console.log(`[webBridge] Probe error for ${url}:`, e)
		return false
	}
}

async function getResolvedOllamaHost(): Promise<string> {
	const userOverride = storage.get('ollamaHost')
	if (userOverride) {
		console.log(`[webBridge] Using user override host: ${userOverride}`)
		return userOverride
	}
	if (__resolvedOllamaHost) {
		console.log(`[webBridge] Using cached host: ${__resolvedOllamaHost}`)
		return __resolvedOllamaHost
	}
	
	console.log('[webBridge] Resolving Ollama host...')
	// Try same-origin proxy first (works when served via local helper)
	if (await probeHost('')) { 
		console.log('[webBridge] Using same-origin proxy')
		__resolvedOllamaHost = ''; 
		storage.set('ollamaHostResolved', ''); 
		return '' 
	}
	// Try helper default port
	if (await probeHost('http://127.0.0.1:11435')) { 
		console.log('[webBridge] Using helper on 11435')
		__resolvedOllamaHost = 'http://127.0.0.1:11435'; 
		storage.set('ollamaHostResolved', __resolvedOllamaHost); 
		return __resolvedOllamaHost 
	}
	// Try helper on 5173 (when running bundled server locally)
	if (await probeHost('http://127.0.0.1:5173')) { 
		console.log('[webBridge] Using helper on 5173')
		__resolvedOllamaHost = 'http://127.0.0.1:5173'; 
		storage.set('ollamaHostResolved', __resolvedOllamaHost); 
		return __resolvedOllamaHost 
	}
	// Fallback to direct Ollama (may be blocked by CORS in browsers)
	console.log('[webBridge] Falling back to direct Ollama')
	__resolvedOllamaHost = OLLAMA_HOST_DEFAULT
	storage.set('ollamaHostResolved', __resolvedOllamaHost)
	return __resolvedOllamaHost
}
async function ollamaList(host: string) {
	try {
		const r = await fetch(`${host}/api/tags`, { method: 'GET', mode: host ? 'cors' : 'same-origin', credentials: 'omit' })
		if (!r.ok) throw new Error(`tags ${r.status}`)
		return await r.json()
	} catch (e:any) {
		return { models: [] }
	}
}
async function ollamaGenerate(host: string, model: string, prompt: string, onToken?: (t:string)=>void): Promise<string> {
	let res: Response
	try {
		res = await fetch(`${host}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			mode: host ? 'cors' : 'same-origin',
			credentials: 'omit',
			body: JSON.stringify({ model, prompt, stream: !!onToken })
		})
	} catch (err:any) {
		throw new Error(`Ollama generate failed: network error${err?.message ? ` - ${err.message}` : ''}`)
	}
	if (!res.ok) {
		let body = ''
		try { body = await res.text() } catch {}
		throw new Error(`Ollama generate failed: ${res.status}${body ? ` - ${body.slice(0,200)}` : ''}`)
	}
	if (!onToken) {
		const json = await res.json().catch(()=>null)
		return json?.response || ''
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
				const chunk = obj?.response || ''
				if (chunk) { full += chunk; onToken?.(chunk) }
			} catch {}
		}
	}
	return full
}

function flattenMessages(messages: Array<{role:string, content:string}>): string {
	return messages.map(m => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'}: ${m.content}`).join('\n') + '\nAssistant:'
}

async function ollamaChat(host: string, model: string, messages: Array<{role:string, content:string}>, onToken?: (t:string)=>void): Promise<string> {
	let res: Response
	try {
		res = await fetch(`${host}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			mode: host ? 'cors' : 'same-origin',
			credentials: 'omit',
			body: JSON.stringify({ model, messages, stream: !!onToken })
		})
	} catch (err:any) {
		// Network error: try generate as a fallback
		const prompt = flattenMessages(messages)
		return ollamaGenerate(host, model, prompt, onToken)
	}
	if (res.status === 404 || res.status === 405) {
		// Older Ollama without /api/chat
		const prompt = flattenMessages(messages)
		return ollamaGenerate(host, model, prompt, onToken)
	}
	if (!res.ok) {
		let body = ''
		try { body = await res.text() } catch {}
		// Fallback on certain server errors too
		if (res.status >= 500 || res.status === 400) {
			const prompt = flattenMessages(messages)
			return ollamaGenerate(host, model, prompt, onToken)
		}
		throw new Error(`Ollama chat failed: ${res.status}${body ? ` - ${body.slice(0,200)}` : ''}`)
	}
	if (!onToken) {
		const json = await res.json().catch(()=>null)
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
async function ollamaEmbed(host: string, model: string, text: string): Promise<number[]> {
	try {
		const res = await fetch(`${host}/api/embeddings`, { method:'POST', headers:{'Content-Type':'application/json'}, mode: host ? 'cors' : 'same-origin', credentials:'omit', body: JSON.stringify({ model, prompt: text }) })
		if (!res.ok) return []
		const json: any = await res.json().catch(()=>null)
		return (json?.embedding || json?.data?.[0]?.embedding || []) as number[]
	} catch { return [] }
}

async function chooseOllamaModel(host: string): Promise<string> {
	// Preference: user-set, then installed llama3.2:1b/2b, then first installed
	const user = storage.get('ollamaModel')
	const tags = await ollamaList(host)
	const installed: string[] = (tags?.models || []).map((m:any)=>m.name)
	const pick = (name: string) => installed.find(n=>n===name)
	if (user && installed.includes(user)) return user
	const preferred = pick('llama3.2:1b') || pick('llama3.2:2b') || installed[0]
	if (preferred) return preferred
	throw new Error('No Ollama models installed. Install one, e.g.: "ollama pull llama3.2:1b"')
}

// Query utils
type DateFilter = { start: Date; end: Date } | null
function extractDateFilter(qIn: string, now = new Date()): DateFilter {
	const q = qIn.toLowerCase()
	const iso = q.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/)
	if (iso) {
		const y = +iso[1], m = +iso[2] - 1, d = iso[3] ? +iso[3] : 1
		const start = new Date(Date.UTC(y, m, d))
		const end = iso[3] ? new Date(Date.UTC(y, m, d + 1)) : new Date(Date.UTC(y, m + 1, 1))
		return { start, end }
	}
	const toUtcStartOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
	const todayUtc = toUtcStartOfDay(new Date(now.toISOString()))
	if (q.includes('today')) return { start: todayUtc, end: new Date(+todayUtc + 86400000) }
	if (q.includes('yesterday')) { const y = new Date(+todayUtc - 86400000); return { start: y, end: todayUtc } }
	if (q.includes('this week')) return { start: new Date(+todayUtc - 7 * 86400000), end: new Date(+todayUtc + 86400000) }
	if (q.includes('last week')) return { start: new Date(+todayUtc - 14 * 86400000), end: new Date(+todayUtc - 7 * 86400000) }
	if (q.includes('this month')) { const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); return { start: startOfMonth, end: new Date(+todayUtc + 86400000) } }
	const mRel = q.match(/last (\d+)\s*(days?|weeks?|months?)/)
	if (mRel) { const n = Math.min(365, +mRel[1] || 7); const unit = mRel[2]; let mul = 1; if (unit.startsWith('week')) mul = 7; else if (unit.startsWith('month')) mul = 30; return { start: new Date(+todayUtc - n * mul * 86400000), end: todayUtc } }
	return null
}

async function tryExpandQuery(original: string): Promise<string> {
	const enabled = ((storage.get('ragExpandQuery') || 'true').toLowerCase() === 'true')
	if (!enabled) return original
	try {
		const host = await getResolvedOllamaHost()
		const model = storage.get('ollamaModel') || 'llama3.2:latest'
		const prompt = `For the user query below, output 8-15 literal search terms (single words or short noun phrases) separated by spaces. No punctuation, no sentences.\n\nQuery: ${original}\n\nTerms:`
		const out = await ollamaChat(host, model, [{ role: 'user', content: prompt }])
		const terms = String(out || '').replace(/[\n,;]+/g, ' ').replace(/\s+/g, ' ').trim()
		if (!terms) return original
		return `${original} ${terms}`
	} catch { return original }
}

function rankAndFilter(results: IndexedChunk[], expanded: string, dateFilter: DateFilter, limit: number): any[] {
	const tokens = expanded.toLowerCase().split(/\s+/).filter(t => t.length > 2)
	const now = Date.now()
	const scored = results.map((r, idx) => {
		const textLC = r.chunk_text.toLowerCase()
		const covered = tokens.reduce((acc, t) => acc + (textLC.includes(t) ? 1 : 0), 0)
		const coverage = Math.min(1, covered / Math.max(3, Math.min(tokens.length, 10)))
		let recency = 0
		try { if (r.file_mtime) { const days = Math.max(0, (now - new Date(r.file_mtime).getTime())/86400000); recency = 1/(1+days/45) } } catch {}
		const bm = 1 / (1 + idx)
		const score = 0.5*coverage + 0.35*bm + 0.15*recency
		return { r, score }
	}).sort((a,b)=>b.score-a.score)
	const filtered = scored.map(s=>s.r).slice(0, limit)
	return filtered.map((r, i) => ({ id: i+1, file_id: 0, file_path: r.file_path, file_name: r.file_name, content_snippet: r.chunk_text.slice(0, 240), rank: i+1, chunk_index: r.chunk_index, file_mtime: r.file_mtime, note_date: r.note_date }))
}

async function searchContent(query: string, limit: number = 20): Promise<any[]> {
	const dateFilter = extractDateFilter(query)
	const expanded = await tryExpandQuery(query)
	let rows: IndexedChunk[] = (window as any).__isla_chunks || []
	// Apply date filter
	if (dateFilter) {
		rows = rows.filter(r => {
			try {
				const d1 = r.note_date ? new Date(r.note_date).getTime() : (r.file_mtime ? new Date(r.file_mtime).getTime() : 0)
				return d1 && d1 >= dateFilter.start.getTime() && d1 < dateFilter.end.getTime()
			} catch { return true }
		})
	}
	// Text match: include chunks containing any expanded token
	const tokens = expanded.toLowerCase().split(/\s+/).filter(t => t.length > 2)
	const matched = rows.filter(r => {
		const lc = r.chunk_text.toLowerCase()
		return tokens.some(t => lc.includes(t))
	})
	if (matched.length === 0) return []
	return rankAndFilter(matched, expanded, dateFilter, limit)
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
	dbClearAll: async () => { (window as any).__isla_files = []; (window as any).__isla_chunks = []; return true },
	dbGetStats: async () => ({ fileCount: ((window as any).__isla_files||[]).length, chunkCount: ((window as any).__isla_chunks||[]).length, indexSize: ((window as any).__isla_chunks||[]).length }),
	dbReindexAll: async () => { const root: FileSystemDirectoryHandle | undefined = (window as any).__isla_rootHandle; if (root) await buildIndexFromRoot(root); return { fileCount: ((window as any).__isla_files||[]).length, chunkCount: ((window as any).__isla_chunks||[]).length, indexSize: ((window as any).__isla_chunks||[]).length } },

	// Settings
	settingsGet: async (key: string) => storage.get(key),
	settingsSet: async (key: string, value: string) => { storage.set(key, value); return true },

	// RAG/Content search (PWA)
	searchContent: (query: string, limit?: number) => searchContent(query, limit ?? 20),
	contentSearchAndAnswer: async (query: string, _chatId?: number) => {
		const sources = await searchContent(query, 18)
		const today = new Date().toISOString()
		const context = sources.map(s=>`• ${s.file_name} — ${s.content_snippet}`).join('\n')
		const prompt = `You are a concise, friendly assistant for the user's local notes.\n\nToday is ${today}.\n${context ? `\nContext from notes:\n${context}` : ''}\n\nUser’s request: ${query}\n\nInstructions:\n- Use ONLY the context above.\n- Prefer 2–4 short paragraphs with occasional bullets.\n- If context is sparse, say what's missing and suggest one next step.`
		const host = await getResolvedOllamaHost()
		let currentModel: string
		try { currentModel = await chooseOllamaModel(host) } catch (e:any) { throw e }
		const answer = await ollamaChat(host, currentModel, [{ role: 'user', content: prompt }])
		return { answer, sources }
	},
	contentStreamSearchAndAnswer: async (query: string, _chatId?: number) => {
		const host = await getResolvedOllamaHost()
		let currentModel: string
		try { currentModel = await chooseOllamaModel(host) } catch (e:any) { throw e }
		// Reuse existing listeners registered by the UI instead of overwriting them
		const listeners: Array<(d:any)=>void> = (window as any).__isla_streamListeners || []
		;(window as any).__isla_streamListeners = listeners
		const sources = await searchContent(query, 18)
		const today = new Date().toISOString()
		const context = sources.map(s=>`• ${s.file_name} — ${s.content_snippet}`).join('\n')
		const prompt = `You are a concise, friendly assistant for the user's local notes.\n\nToday is ${today}.\n${context ? `\nContext from notes:\n${context}` : ''}\n\nUser’s request: ${query}`
		setTimeout(async () => {
			let full = ''
			try {
				await ollamaChat(host, currentModel, [{ role: 'user', content: prompt }], (chunk) => {
					full += chunk
					// Emit to any listeners the UI registered
					try { (listeners || []).forEach(fn=>fn({ chunk })) } catch {}
				})
				const done = (window as any).__isla_streamDone
				done && done({ answer: full, sources })
			} catch (e:any) {
				const done = (window as any).__isla_streamDone
				done && done({ answer: `Error: ${e?.message || e}`, sources })
			}
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
		const host = await getResolvedOllamaHost()
		const model = await chooseOllamaModel(host)
		return await ollamaChat(host, model, messages)
	},
	llmGetStatus: async () => ({ isInitialized: true, currentModel: storage.get('ollamaModel') || null }),
	llmGetCurrentModel: async () => storage.get('ollamaModel') || null,
	llmGetDeviceSpecs: async () => null,
	llmGetRecommendedModel: async () => null,
	llmGetAvailableModels: async () => {
		const host = await getResolvedOllamaHost()
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

	// Events (no-op shims for compatibility)
	onSettingsChanged: (callback: (payload: { key: string; value: any }) => void) => (()=>{}),
	onEmbeddingsProgress: (cb: any) => (()=>{})
}

;(window as any).electronAPI = electronAPI

declare global {
	interface Window { electronAPI: typeof electronAPI }
}
