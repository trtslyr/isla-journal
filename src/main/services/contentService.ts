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
    // Build conversation context (last few messages) if available
    let conversationContext = ''
    if (conversationHistory && conversationHistory.length > 0) {
      const recentMessages = conversationHistory.slice(-6)
      conversationContext = recentMessages.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')
    }

    const today = new Date().toISOString()
    const prompt = `You are a grounded assistant for the user's local notes.\nToday is ${today}.\n\nConversation so far (most recent last):\n${conversationContext || '(no prior context)'}\n\nContext from notes (numbered, cite with [#]):\n${pinnedContent}${dateBlock}\n${retrievedBlock}\n\nUser’s request: ${query}\n\nStrict instructions:\n- Use ONLY the context above. If it is insufficient, reply exactly: "No relevant notes found for that request."\n- Include source citations like [#1] or [#2, #5] that correspond to the numbered items.\n- Be concise (2–4 short paragraphs; bullets for steps).\n- If the request implies dates, prioritize date‑matching notes.\n- End with one brief follow‑up question.`

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

      // Date filter
      const dateFilter = extractDateFilter(query)

      // 1. Get pinned files content first with cross-platform path handling
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
                // Normalize path for cross-platform compatibility
                const normalizedPath = normalize(resolve(item.path))
                const content = await readFile(normalizedPath, 'utf-8')
                // Get first 300 chars as snippet
                const snippet = content.length > 300 ? content.substring(0, 300) + '...' : content
                pinnedSources.push(`[📌 Pinned: "${item.name}"]: ${snippet}`)
                console.log(`📌 [ContentService] Successfully read pinned file: ${item.name} (${normalizedPath})`)
              } catch (error) {
                console.log(`⚠️ [ContentService] Could not read pinned file: ${item.name} - ${error.message}`)
              }
            }
          }
          
          if (pinnedSources.length > 0) {
            pinnedContent = `**📌 Your pinned files (always included):**\n${pinnedSources.join('\n\n')}\n\n`
            console.log(`📌 [ContentService] Added ${pinnedSources.length} pinned files to context`)
          }
        }
      } catch (error) {
        console.log('⚠️ [ContentService] Error loading pinned files:', error)
      }

      // 2. Retrieval: FTS + embeddings hybrid if available
      const hasFTS = typeof (database as any).searchContentFTS === 'function'
      const ftsResults: any[] = hasFTS ? (database as any).searchContentFTS(query, 20, dateFilter) : database.searchContent(query, 20)

      let hybridResults: any[] = ftsResults
      try {
        const llama = LlamaService.getInstance()
        const model = llama.getCurrentModel()
        if (model && typeof (database as any).getEmbeddingsForModel === 'function') {
          const allEmb = (database as any).getEmbeddingsForModel(model) as Array<{ chunk_id:number; file_id:number; file_path:string; file_name:string; chunk_text:string; vector:number[] }>
          // Build query vector
          const qVec = (await llama.embedTexts([query], model))[0] || []
          // Score top-N embeddings
          const scored = allEmb.map(e => ({
            id: e.chunk_id,
            file_id: e.file_id,
            file_path: e.file_path,
            file_name: e.file_name,
            content_snippet: e.chunk_text.slice(0, 200),
            sim: cosineSimilarity(qVec, e.vector)
          }))
          scored.sort((a,b) => b.sim - a.sim)
          const topE = scored.slice(0, 30)

          // Merge with FTS: weighted score: 0.6*sim + 0.4*(normalized BM25 inverse)
          const ftsMap = new Map<number, any>()
          ftsResults.forEach((r, idx) => ftsMap.set(r.id, { ...r, ftsRank: 1/(1+idx) }))

          const merged = new Map<number, any>()
          // Seed with FTS
          for (const r of ftsResults) {
            merged.set(r.id, { ...r, sim: 0, score: 0.4 * (typeof r.rank === 'number' ? 1/(1+r.rank) : r.ftsRank || 1) })
          }
          // Add embeddings
          for (const e of topE) {
            const existing = merged.get(e.id)
            const sim = Math.max(0, e.sim)
            const eScore = 0.6 * sim
            if (existing) {
              existing.sim = Math.max(existing.sim || 0, sim)
              existing.score = Math.max(existing.score || 0, existing.score + eScore)
              merged.set(e.id, existing)
            } else {
              merged.set(e.id, { ...e, rank: 0, ftsRank: 0, score: eScore })
            }
          }

          hybridResults = Array.from(merged.values())
          hybridResults.sort((a,b) => (b.score || 0) - (a.score || 0))
          hybridResults = hybridResults.slice(0, 20)
        }
      } catch (e) {
        console.log('⚠️ [ContentService] Hybrid retrieval fallback:', e)
      }

      const results = hybridResults

      // 3. Build context blocks
      const pinnedBlock = pinnedContent ? `Pinned notes:\n${pinnedContent}` : ''

      let dateBlock = ''
      if (dateFilter) {
        const start = dateFilter.start.toISOString().slice(0,10)
        const end = new Date(+dateFilter.end - 1).toISOString().slice(0,10)
        dateBlock = `Date range: ${start} → ${end}`
      }

      let retrievedBlock = ''
      if (results.length > 0) {
        retrievedBlock = results.map((r, i) => `(${i+1}) ${r.file_name}: ${String(r.content_snippet || '').replace(/<\/?mark>/g, '')}`).join('\n')
      }

      if (results.length === 0 && !pinnedContent) {
        return {
          answer: "I couldn't find anything specific in your notes. Try broadening the query or specify a date (e.g., 2024-01 or last 7 days).",
          sources: []
        }
      }

      // 4. Add conversation context if available
      let conversationContext = ''
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-6)
        conversationContext = recentMessages.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')
      }

      // 5. Build general notes assistant prompt with blocks
      const today = new Date().toISOString()
      const ragPrompt = `You are a grounded assistant for the user's local notes.\nToday is ${today}.\n\nConversation so far (most recent last):\n${conversationContext || '(no prior context)'}\n\nContext from notes (numbered, cite with [#]):\n${pinnedBlock}\n${dateBlock}\n${retrievedBlock}\n\nUser’s request: ${query}\n\nStrict instructions:\n- Use ONLY the context above. If it is insufficient, reply exactly: "No relevant notes found for that request."\n- Include source citations like [#1] or [#2, #5] that correspond to the numbered items.\n- Be concise (2–4 short paragraphs; bullets for steps).\n- If the request implies dates, prioritize date‑matching notes.\n- End with one brief follow‑up question.`

      const totalSources = results.length + (pinnedContent ? pinnedContent.split('📌 Pinned:').length - 1 : 0)
      console.log(`🧠 [ContentService] Sending to LLM with ${totalSources} sources (${results.length} search + pinned files)`)      

      // 6. Get LLM response
      const llamaService = LlamaService.getInstance()
      const llmResponse = await llamaService.sendMessage([
        { role: 'user', content: ragPrompt }
      ])

      // 7. Sources list
      const sources = results.map((r: any) => ({
        file_name: r.file_name,
        file_path: r.file_path,
        snippet: String(r.content_snippet || '').replace(/<\/?mark>/g, '')
      }))
      // Add pinned labels (without reading again)
      if (pinnedContent) {
        try {
          const pinnedItemsJson = database.getSetting('pinnedItems')
          if (pinnedItemsJson) {
            const pinnedItems = JSON.parse(pinnedItemsJson)
            pinnedItems.forEach((item: any) => {
              if (item.type === 'file' && item.path.endsWith('.md')) {
                sources.push({ file_name: `📌 ${item.name}`, file_path: item.path, snippet: '(Pinned)' })
              }
            })
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