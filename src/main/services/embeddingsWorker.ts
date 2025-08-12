import { parentPort } from 'worker_threads'
import { Ollama } from 'ollama'

if (!parentPort) {
  throw new Error('embeddingsWorker must be run as a worker thread')
}

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' })

type Job = { jobId: string; text: string; model: string }

declare const self: never

parentPort.on('message', async (job: Job) => {
  try {
    // @ts-ignore types may differ by version
    const result = await (ollama as any).embeddings({ model: job.model, prompt: job.text })
    const vector: number[] = result?.embedding || result?.data?.[0]?.embedding || []
    parentPort!.postMessage({ jobId: job.jobId, vector, dim: vector.length, model: job.model })
  } catch (error: any) {
    parentPort!.postMessage({ jobId: job.jobId, error: error?.message || String(error) })
  }
})