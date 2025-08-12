import { parentPort, workerData } from 'worker_threads'
import { readdir, readFile, stat } from 'fs/promises'
import path from 'path'

if (!parentPort) throw new Error('indexWorker must be run as a worker thread')

function isIndexableFile(name: string): boolean {
  const i = name.lastIndexOf('.')
  if (i < 0) return false
  const ext = name.slice(i).toLowerCase()
  return ext === '.md' || ext === '.mdx' || ext === '.txt'
}

async function walkAndIndex(rootDir: string) {
  let total = 0
  let processed = 0

  async function countFiles(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await countFiles(full)
        else if (isIndexableFile(entry.name)) total++
      }
    } catch {}
  }

  async function indexDir(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await indexDir(full)
        } else if (isIndexableFile(entry.name)) {
          try {
            const s = await stat(full)
            const content = await readFile(full, 'utf-8')
            parentPort!.postMessage({ type: 'file', path: full, name: entry.name, mtime: s.mtimeMs, size: s.size, content })
            processed++
            if (processed % 25 === 0) parentPort!.postMessage({ type: 'progress', processed, total })
          } catch (e) {
            parentPort!.postMessage({ type: 'warn', path: full, error: String(e?.message || e) })
          }
        }
      }
    } catch (e) {
      parentPort!.postMessage({ type: 'warn', path: dir, error: String(e?.message || e) })
    }
  }

  await countFiles(rootDir)
  parentPort!.postMessage({ type: 'start', total })
  await indexDir(rootDir)
  parentPort!.postMessage({ type: 'done', processed, total })
}

parentPort.on('message', async (msg: any) => {
  if (!msg || msg.type !== 'start' || !msg.rootDir) return
  await walkAndIndex(msg.rootDir)
})