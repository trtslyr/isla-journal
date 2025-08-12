import { parentPort } from 'worker_threads'
import { Ollama } from 'ollama'

if (!parentPort) {
  throw new Error('embeddingWorker must be run as a worker thread')
}

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' })

type EmbedRequest = { type: 'embed'; requestId: string; model: string; texts: string[] }

type EmbedResult = { type: 'result'; requestId: string; vectors: number[][] }

type EmbedError = { type: 'error'; requestId: string; error: string }

parentPort.on('message', async (msg: EmbedRequest) => {
  if (!msg || msg.type !== 'embed') return
  const { requestId, model, texts } = msg
  try {
    const vectors: number[][] = []
    for (const t of texts) {
      const res: any = await (ollama as any).embeddings({ model, prompt: t })
      const v: number[] = res?.embedding || res?.data?.[0]?.embedding || []
      vectors.push(v)
    }
    const out: EmbedResult = { type: 'result', requestId, vectors }
    parentPort!.postMessage(out)
  } catch (e: any) {
    const err: EmbedError = { type: 'error', requestId, error: e?.message || String(e) }
    parentPort!.postMessage(err)
  }
})
