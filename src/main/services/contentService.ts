import { database } from '../database'
import { LlamaService } from './llamaService'
import { readFile } from 'fs/promises'
import { normalize, resolve } from 'path'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export interface RAGResponse {
  answer: string
  sources: Array<{
    file_name: string
    file_path: string
    snippet: string
  }>
}

export type DateFilter = { start: Date; end: Date } | null

function extractDateFilter(qIn: string, now = new Date()): DateFilter {
  const q = qIn.toLowerCase()
  const iso = q.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/)
  if (iso) {
    const y = +iso[1], m = +iso[2]-1, d = iso[3] ? +iso[3] : 1
    const start = new Date(Date.UTC(y,m,d))
    const end = iso[3] ? new Date(Date.UTC(y,m,d+1)) : new Date(Date.UTC(y,m+1,1))
    return { start, end }
  }
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = startOfDay(now)
  if (q.includes('today')) return { start: today, end: new Date(+today + 86400000) }
  if (q.includes('yesterday')) { const y = new Date(+today - 86400000); return { start: y, end: today } }
  if (q.includes('last week')) return { start: new Date(+today - 7*86400000), end: today }
  const m = q.match(/last (\d+)\s*days?/) ; if (m) { const n = Math.min(365, +m[1]||7); return { start: new Date(+today - n*86400000), end: today } }
  return null
}

function normalizeScore(x: number, min: number, max: number): number {
  if (!isFinite(x)) return 0
  if (max <= min) return 0
  return Math.max(0, Math.min(1, (x - min) / (max - min)))
}

function mmrSelect<T>(
  items: T[],
  score: (t: T) => number,
  similarity: (a: T, b: T) => number,
  k: number,
  lambda = 0.7
): T[] {
  const selected: T[] = []
  const remaining = [...items]
  while (selected.length < k && remaining.length) {
    let bestIdx = 0
    let bestVal = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const rel = score(candidate)
      const div = selected.length
        ? Math.max(...selected.map(s => similarity(candidate, s)))
        : 0
      const val = lambda * rel - (1 - lambda) * div
      if (val > bestVal) { bestVal = val; bestIdx = i }
    }
    selected.push(remaining.splice(bestIdx, 1)[0])
  }
  return selected
}

function jaccardText(a: string, b: string): number {
  const as = new Set(a.toLowerCase().split(/\W+/).filter(Boolean))
  const bs = new Set(b.toLowerCase().split(/\W+/).filter(Boolean))
  const inter = [...as].filter(x => bs.has(x)).length
  const uni = new Set([...as, ...bs]).size
  return uni ? inter / uni : 0
}

async function expandQueries(llama: LlamaService, query: string): Promise<{ queries: string[]; dateHints: DateFilter | null }> {
  try {
    const prompt = `Rewrite the user's request into 3 short alternative searches for their personal journal notes. Include varied phrasing. If dates are implied, state ISO dates.\nReturn JSON with keys queries (array of strings).\n\nUser: ${query}`
    const raw = await llama.sendMessage([{ role: 'user', content: prompt }])
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return { queries: [query], dateHints: null }
    const obj = JSON.parse(m[0])
    const qs = Array.isArray(obj.queries) ? obj.queries.slice(0, 3).map((s: string) => String(s)).filter(Boolean) : []
    return { queries: Array.from(new Set([query, ...qs])).slice(0, 4), dateHints: extractDateFilter(query) }
  } catch {
    return { queries: [query], dateHints: extractDateFilter(query) }
  }
}

function buildWarmPrompt(opts: {
  query: string
  pinnedBlock: string
  dateBlock: string
  contextBlocks: string
}): string {
  const today = new Date().toISOString()
  return `You are a warm, friendly assistant for the user's local journal. Today is ${today}.\n\nUse the provided context first. If it isn't enough, say so gently and suggest what to search next. Keep citations minimal inline (only filenames if necessary) because detailed sources appear below.\n\nContext from notes:\n${opts.pinnedBlock}${opts.dateBlock ? `\n${opts.dateBlock}\n` : ''}${opts.contextBlocks}\n\nUser’s request: ${opts.query}\n\nGuidelines:\n- Be conversational and concise (2–4 short paragraphs; bullets for steps).\n- Reference files by name sparingly in-line; full citations will be listed below.\n- Prefer recent and specific entries when relevant.\n- Offer 1–2 thoughtful follow-ups at the end.`
}

function compressChunksToBullets(chunks: Array<{ chunk_index: number; text: string }>, maxBullets = 3): string {
  const bullets: string[] = []
  for (const c of chunks.slice(0, maxBullets)) {
    const oneLine = c.text.replace(/\s+/g, ' ').trim()
    bullets.push(`- ${oneLine.slice(0, 240)}`)
  }
  return bullets.join('\n')
}

class ContentService {
  /**
   * Prepare prompt and sources for RAG (without sending to LLM)
   */
  async preparePrompt(query: string, conversationHistory?: Array<{role: string, content: string}>): Promise<{ prompt: string; sources: Array<{file_name:string; file_path:string; snippet:string}> }> {
    // Date filter
    const dateFilter = extractDateFilter(query)

    // Pinned content
    let pinnedContent = ''
    try {
      const pinnedItemsJson = database.getSetting('pinnedItems')
      if (pinnedItemsJson) {
        const pinnedItems = JSON.parse(pinnedItemsJson)
        const pinnedSources: string[] = []
        for (const item of pinnedItems) {
          if (item.type === 'file' && item.path.endsWith('.md')) {
            try {
              const normalizedPath = normalize(resolve(item.path))
              const content = await readFile(normalizedPath, 'utf-8')
              const snippet = content.length > 300 ? content.substring(0, 300) + '...' : content
              pinnedSources.push(`[📌 Pinned: "${item.name}"]: ${snippet}`)
            } catch {}
          }
        }
        if (pinnedSources.length > 0) pinnedContent = `Pinned notes:\n${pinnedSources.join('\n\n')}\n\n`
      }
    } catch {}

    // Retrieval (FTS/Hybrid)
    const hasFTS = typeof (database as any).searchContentFTS === 'function'
    const ftsResults: any[] = hasFTS ? (database as any).searchContentFTS(query, 20, dateFilter) : database.searchContent(query, 20)
    let results: any[] = ftsResults
    try {
      const llama = LlamaService.getInstance()
      const model = llama.getCurrentModel()
      if (model && typeof (database as any).getEmbeddingsForModel === 'function') {
        const allEmb = (database as any).getEmbeddingsForModel(model) as Array<{ chunk_id:number; file_id:number; file_path:string; file_name:string; chunk_text:string; vector:number[] }>
        const qVec = (await llama.embedTexts([query], model))[0] || []
        const scored = allEmb.map(e => ({ id:e.chunk_id, file_id:e.file_id, file_path:e.file_path, file_name:e.file_name, content_snippet:e.chunk_text.slice(0,200), sim: cosineSimilarity(qVec, e.vector) }))
        scored.sort((a,b)=>b.sim-a.sim)
        const topE = scored.slice(0, 30)
        const merged = new Map<number, any>()
        for (const r of ftsResults) merged.set(r.id, { ...r, sim:0, score: 0.4 * (typeof r.rank==='number'? 1/(1+r.rank): 1) })
        for (const e of topE) {
          const existing = merged.get(e.id)
          const sim = Math.max(0, e.sim)
          const eScore = 0.6 * sim
          if (existing) { existing.sim = Math.max(existing.sim||0, sim); existing.score = (existing.score||0)+eScore; merged.set(e.id, existing) }
          else merged.set(e.id, { ...e, rank:0, score: eScore })
        }
        results = Array.from(merged.values()).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,20)
      }
    } catch {}

    const dateBlock = (()=>{
      if (!dateFilter) return ''
      const start = dateFilter.start.toISOString().slice(0,10)
      const end = new Date(+dateFilter.end - 1).toISOString().slice(0,10)
      return `Date range: ${start} → ${end}`
    })()

    const retrievedBlock = results.length>0
      ? results.map((r,i)=>`(${i+1}) ${r.file_name}: ${String(r.content_snippet||'').replace(/<\/?mark>/g,'')}`).join('\n')
      : ''
    const today = new Date().toISOString()
    const prompt = `You are a concise, friendly assistant for the user's local notes.\nToday is ${today}.\n\nContext from notes:\n${pinnedContent}${dateBlock}\n${retrievedBlock}\n\nUser’s request: ${query}\n\nInstructions:\n- Prefer the supplied context; cite filenames.\n- Keep answers tight (2–4 short paragraphs; bullets for steps).\n- If context is sparse, say so and suggest next steps or date ranges.\n- If the request implies dates, prioritize those notes.\n- End with 1–2 helpful follow‑ups.`

    const sources: Array<{file_name:string; file_path:string; snippet:string}> = results.map((r:any)=>({ file_name:r.file_name, file_path:r.file_path, snippet:String(r.content_snippet||'').replace(/<\/?mark>/g,'') }))
    try {
      const pinnedItemsJson = database.getSetting('pinnedItems')
      if (pinnedItemsJson) {
        const pinnedItems = JSON.parse(pinnedItemsJson)
        pinnedItems.forEach((item:any)=>{ if(item.type==='file' && item.path.endsWith('.md')) sources.push({ file_name:`📌 ${item.name}`, file_path:item.path, snippet:'(Pinned)' }) })
      }
    } catch {}

    return { prompt, sources }
  }

  /**
   * Perform RAG search and generate response with conversation context
   */
  async searchAndAnswer(query: string, conversationHistory?: Array<{role: string, content: string}>): Promise<RAGResponse> {
    try {
      console.log(`🔍 [ContentService] Searching for: ${query}`)

      const llama = LlamaService.getInstance()
      const model = llama.getCurrentModel()

      // 0) Query expansion (recall boost)
      const { queries, dateHints } = await expandQueries(llama, query)
      const dateFilter = dateHints || extractDateFilter(query)

      // 1) Pinned
      let pinnedContent = ''
      try {
        const pinnedItemsJson = database.getSetting('pinnedItems')
        if (pinnedItemsJson) {
          const pinnedItems = JSON.parse(pinnedItemsJson)
          const pinnedSources = []
          for (let i = 0; i < pinnedItems.length; i++) {
            const item = pinnedItems[i]
            if (item.type === 'file' && item.path.endsWith('.md')) {
              try {
                const normalizedPath = normalize(resolve(item.path))
                const content = await readFile(normalizedPath, 'utf-8')
                const snippet = content.length > 300 ? content.substring(0, 300) + '...' : content
                pinnedSources.push(`[📌 Pinned: "${item.name}"]: ${snippet}`)
              } catch {}
            }
          }
          if (pinnedSources.length > 0) {
            pinnedContent = `${pinnedSources.join('\n\n')}\n\n`
          }
        }
      } catch {}

      // 2) Retrieval across ENTIRE selected directory (DB already indexes full root + watcher)
      const ftsResultsAll: any[] = []
      for (const q of queries) {
        const fts = typeof (database as any).searchContentFTS === 'function'
          ? (database as any).searchContentFTS(q, 30, dateFilter)
          : database.searchContent(q, 30)
        ftsResultsAll.push(...fts)
      }
      // Dedup by chunk id
      const byId = new Map<number, any>()
      for (const r of ftsResultsAll) { if (!byId.has(r.id)) byId.set(r.id, r) }
      let candidates: any[] = Array.from(byId.values())

      // Optional embedding rerank mix
      try {
        if (model && typeof (database as any).getEmbeddingsForModel === 'function') {
          const allEmb = (database as any).getEmbeddingsForModel(model) as Array<{ chunk_id:number; file_id:number; file_path:string; file_name:string; chunk_text:string; vector:number[] }>
          const qVec = (await llama.embedTexts([query], model))[0] || []
          // Map embeddings by chunk_id for fast join
          const embById = new Map<number, any>()
          for (const e of allEmb) embById.set(e.chunk_id, e)

          // Compute combined score for existing candidates; also add top purely-embedding items
          const scoredFromFTS = candidates.map(r => {
            const rank = typeof r.rank === 'number' ? r.rank : 1
            const bm25Inv = 1 / (1 + rank)
            const emb = embById.get(r.id)
            const sim = emb ? cosineSimilarity(qVec, emb.vector) : 0
            // Recency prior
            const recency = 0 // could be filled using file_mtime if fetched
            const final = 0.55 * Math.max(0, sim) + 0.35 * bm25Inv + 0.10 * recency
            return { ...r, sim, bm25Inv, score: final }
          })

          // Add top-N purely embedding hits not already present
          const embOnly = allEmb
            .map(e => ({ id: e.chunk_id, file_id: e.file_id, file_path: e.file_path, file_name: e.file_name, content_snippet: e.chunk_text.slice(0, 200), sim: cosineSimilarity(qVec, e.vector) }))
            .filter(e => !byId.has(e.id))
            .sort((a,b)=>b.sim-a.sim)
            .slice(0, 50)
            .map(e => ({ ...e, bm25Inv: 0, score: 0.55 * Math.max(0, e.sim) }))

          candidates = [...scoredFromFTS, ...embOnly]
        }
      } catch (e) {
        console.log('⚠️ [ContentService] Embedding mix failed, using FTS only')
      }

      // 3) MMR diversify and per-file cap
      const textOf = (r:any) => String(r.content_snippet||'')
      const simText = (a:any,b:any)=> jaccardText(textOf(a), textOf(b))
      // Normalize scores for MMR
      const scores = candidates.map(c=>c.score||0)
      const minS = Math.min(...scores, 0)
      const maxS = Math.max(...scores, 1)
      candidates.forEach(c=> c._norm = normalizeScore(c.score||0, minS, maxS))

      const diversified = mmrSelect(candidates, c=>c._norm, simText, 50, 0.75)
      // Cap per file
      const perFileCap = 3
      const fileCounts = new Map<number, number>()
      const capped: any[] = []
      for (const c of diversified) {
        const count = fileCounts.get(c.file_id) || 0
        if (count < perFileCap) {
          fileCounts.set(c.file_id, count + 1)
          capped.push(c)
        }
        if (capped.length >= 30) break
      }

      // 4) Optional LLM reranker (batch strict 1–5)
      let reranked = capped
      try {
        const batchSize = 15
        const scored: Array<{ id:number; score:number }> = []
        for (let i = 0; i < capped.length; i += batchSize) {
          const batch = capped.slice(i, i+batchSize)
          const list = batch.map((c, idx)=>`${i+idx+1}. (${c.file_name}) ${textOf(c)}`).join('\n')
          const judgePrompt = `Score each candidate 1–5 for how relevant it is to the user's query. Be strict; 5 = directly answers.\n\nQuery: ${query}\nCandidates:\n${list}\n\nReturn JSON as an array: [{"id":1,"score":5}, ...] where id matches the list number.`
          const raw = await llama.sendMessage([{ role:'user', content: judgePrompt }])
          const m = raw.match(/\[[\s\S]*\]/)
          if (m) {
            const arr = JSON.parse(m[0])
            for (const it of arr) {
              const local = batch[(it.id-1) - i]
              if (local) scored.push({ id: local.id, score: Number(it.score)||0 })
            }
          }
        }
        const scoreMap = new Map(scored.map(s=>[s.id, s.score]))
        reranked = [...capped].sort((a,b)=>(scoreMap.get(b.id)||0)-(scoreMap.get(a.id)||0))
      } catch (e) {
        console.log('⚠️ [ContentService] LLM reranker skipped')
      }

      // 5) Neighbor expansion and per-file compression
      const withNeighbors: Record<number, Array<{ chunk_index:number; text:string }>> = {}
      for (const r of reranked.slice(0, 20)) {
        const center = typeof r.chunk_index === 'number' ? r.chunk_index : 0
        try {
          const neighbors = (database as any).getNeighborChunks?.(r.file_id, center, 1) || []
          withNeighbors[r.file_id] = withNeighbors[r.file_id] || []
          neighbors.forEach((n: any) => withNeighbors[r.file_id].push({ chunk_index: n.chunk_index, text: String(n.chunk_text||'') }))
        } catch {}
      }

      // Merge and de-dup neighbor indices per file and sort
      Object.keys(withNeighbors).forEach(k => {
        const arr = withNeighbors[Number(k)]
        const uniq = new Map<number, { chunk_index:number; text:string }>()
        for (const a of arr) uniq.set(a.chunk_index, a)
        withNeighbors[Number(k)] = Array.from(uniq.values()).sort((a,b)=>a.chunk_index-b.chunk_index)
      })

      // Build per-file blocks
      const fileBlocks: string[] = []
      const sources: Array<{file_name:string; file_path:string; snippet:string}> = []
      const seenFiles = new Set<number>()
      for (const r of reranked.slice(0, 12)) {
        if (seenFiles.has(r.file_id)) continue
        seenFiles.add(r.file_id)
        const chunks = withNeighbors[r.file_id] || [{ chunk_index: r.chunk_index ?? 0, text: textOf(r) }]
        const bullets = compressChunksToBullets(chunks, 3)
        fileBlocks.push(`${r.file_name}:\n${bullets}`)
        sources.push({ file_name: r.file_name, file_path: r.file_path, snippet: textOf(r) })
      }

      // Add pinned labels to sources (no re-read)
      if (pinnedContent) {
        try {
          const pinnedItemsJson = database.getSetting('pinnedItems')
          if (pinnedItemsJson) {
            const pinnedItems = JSON.parse(pinnedItemsJson)
            pinnedItems.forEach((item: any) => { if(item.type==='file' && item.path.endsWith('.md')) sources.push({ file_name:`📌 ${item.name}`, file_path:item.path, snippet:'(Pinned)' }) })
          }
        } catch {}
      }

      // 6) Build warm prompt
      const dateBlock = (() => {
        if (!dateFilter) return ''
        const start = dateFilter.start.toISOString().slice(0,10)
        const end = new Date(+dateFilter.end - 1).toISOString().slice(0,10)
        return `Date range: ${start} → ${end}`
      })()
      const contextBlocks = fileBlocks.join('\n\n')
      const pinnedBlock = pinnedContent ? `Pinned notes:\n${pinnedContent}` : ''
      const prompt = buildWarmPrompt({ query, pinnedBlock, dateBlock, contextBlocks })

      if (fileBlocks.length === 0 && !pinnedContent) {
        return {
          answer: "I couldn’t locate anything specific in your journal for this. Try a broader phrasing or add a date hint (e.g., ‘last 7 days’, ‘2024‑01’).",
          sources: []
        }
      }

      const llmResponse = await llama.sendMessage([{ role: 'user', content: prompt }])
      return { answer: llmResponse, sources }
    } catch (error) {
      console.error('❌ [ContentService] RAG search failed:', error)
      throw new Error('Failed to search and generate response')
    }
  }

  /**
   * Just search without LLM (for testing)
   */
  searchOnly(query: string, limit: number = 10) {
    console.log(`🔍 [ContentService] Text search for: ${query}`)
    return database.searchContent(query, limit)
  }

  /**
   * Get full file content by ID
   */
  getFileContent(fileId: number): string | null {
    return database.getFileContent(fileId)
  }
}

export const contentService = new ContentService() 