import { database } from '../database'
import { LlamaService } from './llamaService'
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

function rrfMerge(fts: any[], vec: any[], k: number = 60): any[] {
  const K = k
  const map = new Map<number, { item: any; score: number }>()
  fts.forEach((r, i) => {
    const score = 1.0 / (K + i + 1)
    if (!map.has(r.id)) map.set(r.id, { item: { ...r, sim: 0 }, score })
    else map.get(r.id)!.score += score
  })
  vec.forEach((r, i) => {
    const score = 1.0 / (K + i + 1)
    if (!map.has(r.id)) map.set(r.id, { item: r, score })
    else map.get(r.id)!.score += score
  })
  return Array.from(map.values()).sort((a,b)=>b.score-a.score).map(x=>({ ...x.item, score: x.score }))
}

function trimContextByChars(lines: string[], maxChars: number): string[] {
  const out: string[] = []
  let total = 0
  for (const l of lines) {
    if (total + l.length > maxChars) break
    out.push(l)
    total += l.length
  }
  return out
}

function approxTokenCount(s: string): number {
  // Rough: 4 chars per token
  return Math.ceil(s.length / 4)
}

function mmrDiversify<T extends { id:number; content_snippet:string }>(items: T[], k: number, lambda: number = 0.7): T[] {
  const selected: typeof items = []
  const remaining = items.slice()
  const sim = (a:string,b:string)=>{
    // Jaccard over terms as a cheap proxy
    const A = new Set(a.toLowerCase().split(/\W+/).filter(Boolean))
    const B = new Set(b.toLowerCase().split(/\W+/).filter(Boolean))
    const inter = [...A].filter(x=>B.has(x)).length
    const union = new Set([...A, ...B]).size || 1
    return inter / union
  }
  while (selected.length < k && remaining.length) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]
      const relevance = 1 // already ranked by RRF; treat as equal baseline
      let diversityPenalty = 0
      for (const s of selected) diversityPenalty = Math.max(diversityPenalty, sim(cand.content_snippet, s.content_snippet))
      const score = lambda * relevance - (1 - lambda) * diversityPenalty
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    selected.push(remaining.splice(bestIdx,1)[0])
  }
  return selected
}

function applySimpleFilters(query: string): { cleaned: string; pathPrefix?: string; tag?: string } {
  let cleaned = query
  let pathPrefix: string | undefined
  let tag: string | undefined
  const pathMatch = query.match(/\bpath:([^\s]+)/)
  if (pathMatch) { pathPrefix = pathMatch[1]; cleaned = cleaned.replace(pathMatch[0], '').trim() }
  const tagMatch = query.match(/\btag:([^\s]+)/)
  if (tagMatch) { tag = tagMatch[1]; cleaned = cleaned.replace(tagMatch[0], '').trim() }
  return { cleaned, pathPrefix, tag }
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
                              const dbFile = database.getFile(normalizedPath)
                const content = dbFile?.content || ''
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
      const embeddingsModel = database.getSetting('embeddingsModel') || llama.getCurrentModel()
      if (embeddingsModel && typeof (database as any).getEmbeddingsForModel === 'function') {
        const allEmb = (database as any).getEmbeddingsForModel(embeddingsModel) as Array<{ chunk_id:number; file_id:number; file_path:string; file_name:string; chunk_text:string; vector:number[] }>
        const qVec = (await llama.embedTexts([query], embeddingsModel))[0] || []
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

      const { cleaned, pathPrefix } = applySimpleFilters(query)
      const dateFilter = extractDateFilter(cleaned)

      // Conversation context
      let conversationContext = ''
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-6)
        conversationContext = recentMessages.map(msg => `${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content}`).join('\n')
      }

      // Pinned (from DB cache)
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
                const dbFile = database.getFile(normalizedPath)
                const content = dbFile?.content || ''
                const snippet = content.length > 300 ? content.substring(0, 300) + '...' : content
                pinnedSources.push(`[📌 Pinned: "${item.name}"]: ${snippet}`)
              } catch (e) {}
            }
          }
          if (pinnedSources.length > 0) pinnedContent = `Pinned notes:\n${pinnedSources.join('\n\n')}\n\n`
        }
      } catch {}

      // Retrieval
      const hasFTS = typeof (database as any).searchContentFTS === 'function'
      let ftsResults: any[] = hasFTS ? (database as any).searchContentFTS(cleaned, 60, dateFilter) : database.searchContent(cleaned, 60)
      if (pathPrefix) {
        ftsResults = ftsResults.filter(r => String(r.file_path || '').includes(pathPrefix!))
      }

      // Embeddings set
      let vecResults: any[] = []
      try {
        const llama = LlamaService.getInstance()
        const embeddingsModel = database.getSetting('embeddingsModel') || llama.getCurrentModel()
        if (embeddingsModel && typeof (database as any).getEmbeddingsForModel === 'function') {
          const allEmb = (database as any).getEmbeddingsForModel(embeddingsModel) as Array<{ chunk_id:number; file_id:number; file_path:string; file_name:string; chunk_text:string; vector:number[] }>
          const qVec = (await llama.embedTexts([cleaned], embeddingsModel))[0] || []
          const scored = allEmb.map(e => ({ id:e.chunk_id, file_id:e.file_id, file_path:e.file_path, file_name:e.file_name, content_snippet:e.chunk_text.slice(0,200), sim: cosineSimilarity(qVec, e.vector) }))
          scored.sort((a,b)=>b.sim-a.sim)
          vecResults = scored.slice(0, 60)
          if (pathPrefix) vecResults = vecResults.filter(r => String(r.file_path || '').includes(pathPrefix!))
        }
      } catch {}

      let results: any[]
      if ((ftsResults?.length||0) === 0 && (vecResults?.length||0) === 0) {
        results = (database as any).getRecentChunks?.(20) || []
      } else {
        results = rrfMerge(ftsResults, vecResults)
      }

      // Parent-child expansion: expand each top result with neighboring chunks
      const expandWindow = 1
      const expanded: any[] = []
      for (const r of results.slice(0, 20)) {
        const win = (database as any).getChunkWindow?.(r.id, expandWindow)
        if (win) expanded.push(win)
        else expanded.push(r)
      }

      // MMR diversify top-N
      const diversified = mmrDiversify(expanded, 12, 0.7)

      // Token-ish cap
      const maxTokens = 1200
      const lines: string[] = []
      let tokens = 0
      for (const r of diversified) {
        const line = `${r.file_name}: ${String(r.content_snippet||'').replace(/<\/?mark>/g,'')}`
        const t = approxTokenCount(line)
        if (tokens + t > maxTokens) break
        lines.push(line)
        tokens += t
      }
      const retrievedBlock = lines.map((t,i)=>`(${i+1}) ${t}`).join('\n')

      const dateBlock = (()=>{
        if (!dateFilter) return ''
        const start = dateFilter.start.toISOString().slice(0,10)
        const end = new Date(+dateFilter.end - 1).toISOString().slice(0,10)
        return `Date range: ${start} → ${end}`
      })()

      if (lines.length === 0 && !pinnedContent) {
        return { answer: "I couldn't find anything specific in your notes. Try broadening the query or specify a date (e.g., 2024-01 or last 7 days).", sources: [] }
      }

      const today = new Date().toISOString()
      const ragPrompt = `You are a concise, friendly assistant for the user's local notes.\nToday is ${today}.\n\nConversation context (recent):\n${conversationContext}\n\nContext from notes:\n${pinnedContent}${dateBlock}\n${retrievedBlock}\n\nUser’s request: ${query}\n\nInstructions:\n- Prefer the supplied context; cite filenames.\n- Keep answers tight (2–4 short paragraphs; bullets for steps).\n- If context is sparse, say so and suggest next steps or date ranges.\n- If the request implies dates, prioritize those notes.\n- End with 1–2 helpful follow‑ups.`

      const llamaService = LlamaService.getInstance()
      const llmResponse = await llamaService.sendMessage([{ role: 'user', content: ragPrompt }])

      const sources = diversified.map((r:any)=>({ file_name:r.file_name, file_path:r.file_path, snippet:String(r.content_snippet||'').replace(/<\/?mark>/g,'') }))
      if (pinnedContent) {
        try {
          const pinnedItemsJson = database.getSetting('pinnedItems')
          if (pinnedItemsJson) {
            const pinnedItems = JSON.parse(pinnedItemsJson)
            pinnedItems.forEach((item: any) => { if (item.type === 'file' && item.path.endsWith('.md')) { sources.push({ file_name: `📌 ${item.name}`, file_path: item.path, snippet: '(Pinned)' }) } })
          }
        } catch {}
      }

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