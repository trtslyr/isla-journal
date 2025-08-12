import { Worker } from 'worker_threads'
import path from 'path'
import { database } from '../database'
import { BrowserWindow } from 'electron'

export class EmbeddingsService {
  private static instance: EmbeddingsService
  private workers: Worker[] = []
  private queue: Array<{ chunkId: number; text: string }> = []
  private model: string = 'nomic-embed-text'
  private mainWindow: BrowserWindow | null = null
  private activeJobs: Map<string, { chunkId: number }> = new Map()

  static getInstance(): EmbeddingsService {
    if (!EmbeddingsService.instance) EmbeddingsService.instance = new EmbeddingsService()
    return EmbeddingsService.instance
  }

  setMainWindow(win: BrowserWindow) { this.mainWindow = win }
  setModel(model: string) { this.model = model }

  async start(poolSize: number = 1) {
    // Small pool to avoid CPU contention
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(path.join(__dirname, './embeddingsWorker.js'))
      worker.on('message', (msg: any) => this.onWorkerMessage(worker, msg))
      worker.on('error', (e) => this.onWorkerError(worker, e))
      this.workers.push(worker)
    }
    await database.ensureReady()
    this.fillQueue()
    this.pump()
  }

  private onWorkerMessage(worker: Worker, msg: any) {
    const job = this.activeJobs.get(msg.jobId)
    if (!job) return
    this.activeJobs.delete(msg.jobId)
    if (msg.error) {
      this.sendProgress({ status: 'error', error: msg.error })
    } else {
      try {
        ;(database as any).upsertEmbedding(job.chunkId, msg.vector, msg.dim, msg.model)
        this.sendProgress({ status: 'ok', chunkId: job.chunkId })
      } catch (e) {
        this.sendProgress({ status: 'error', error: String(e) })
      }
    }
    this.pump()
  }

  private onWorkerError(worker: Worker, e: any) {
    this.sendProgress({ status: 'error', error: e?.message || String(e) })
  }

  private sendProgress(payload: any) {
    if (this.mainWindow) {
      this.mainWindow.webContents.send('embeddings:progress', payload)
    }
  }

  private fillQueue(limit: number = 100) {
    const pending = (database as any).listChunksNeedingEmbeddings ? (database as any).listChunksNeedingEmbeddings(limit) : []
    this.queue.push(...pending.map((p: any) => ({ chunkId: p.id, text: p.chunk_text })))
  }

  private pump() {
    for (const worker of this.workers) {
      if (this.queue.length === 0) return
      const job = this.queue.shift()!
      const jobId = `${job.chunkId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.activeJobs.set(jobId, { chunkId: job.chunkId })
      worker.postMessage({ jobId, text: job.text, model: this.model })
    }
  }
}