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

function cleanFileName(fileName: string): string {
  // Remove hash IDs and clean up filename for natural references
  return fileName
    .replace(/\s+[a-f0-9]{32,}\.md$/i, '') // Remove hash + .md
    .replace(/\.md$/i, '') // Remove remaining .md
    .replace(/^\d+\s+/, '') // Remove leading dates/numbers
    .trim()
}

function extractDateFilter(qIn: string, now = new Date()): DateFilter {
  const q = qIn.toLowerCase()
  const iso = q.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/)
  if (iso) {
    const y = +iso[1], m = +iso[2]-1, d = iso[3] ? +iso[3] : 1
    // Use UTC boundaries consistently
    const start = new Date(Date.UTC(y,m,d))
    const end = iso[3] ? new Date(Date.UTC(y,m,d+1)) : new Date(Date.UTC(y,m+1,1))
    return { start, end }
  }
  // UTC midnight helpers
  const toUtcStartOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const todayUtc = toUtcStartOfDay(new Date(now.toISOString()))
  if (q.includes('today')) return { start: todayUtc, end: new Date(+todayUtc + 86400000) }
  if (q.includes('yesterday')) { const y = new Date(+todayUtc - 86400000); return { start: y, end: todayUtc } }
  if (q.includes('last week')) return { start: new Date(+todayUtc - 7*86400000), end: todayUtc }
  const mRel = q.match(/last (\d+)\s*days?/)
  if (mRel) { const n = Math.min(365, +mRel[1]||7); return { start: new Date(+todayUtc - n*86400000), end: todayUtc } }
  return null
}

class ContentService {
  /**
   * Prepare prompt and sources for RAG (without sending to LLM)
   */
  async preparePrompt(query: string, conversationHistory?: Array<{role: string, content: string}>): Promise<{ prompt: string; sources: Array<{file_name:string; file_path:string; snippet:string}> }> {
    // Add conversation context if available
    let conversationContext = ''
    if (conversationHistory && conversationHistory.length > 0) {
      const recentMessages = conversationHistory.slice(-4)
      conversationContext = `\nRecent conversation:\n${recentMessages.map(msg => `${msg.role === 'user' ? 'You' : 'Me'}: ${msg.content}`).join('\n')}\n`
    }
    // Date filter
    const dateFilter = extractDateFilter(query)
    if (dateFilter) {
      console.log(`📅 [ContentService] Date filter detected: ${dateFilter.start.toISOString().slice(0,10)} to ${dateFilter.end.toISOString().slice(0,10)}`)
    }

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
    const ftsResults: any[] = hasFTS ? (database as any).searchContentFTS(query, 20, dateFilter) : (database as any).searchContent(query, 20, dateFilter)
    let results: any[] = ftsResults

    // Define recency boost functions to use for all search results
    const currentTime = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    
    const getFileDate = (result: any): number => {
      // Priority 1: Use database note_date if available (most accurate)
      if (result.note_date) {
        return new Date(result.note_date).getTime()
      }
      
      // Priority 2: Use file_mtime from database
      if (result.file_mtime) {
        return new Date(result.file_mtime).getTime()
      }
      
      // Priority 3: Try to parse from filename
      const fileName = result.file_name || ''
      
      // ISO format: 2025-08-12
      let dateMatch = fileName.match(/(\d{4})-(\d{2})-(\d{2})/)
      if (dateMatch) {
        return new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`).getTime()
      }
      
      // Various month formats - map month names
      const monthMap: Record<string, number> = {
        jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
        apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
        aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
        nov: 11, november: 11, dec: 12, december: 12
      }
      
      // "4 aug" or "12 august" format (day + month)
      let monthMatch = fileName.toLowerCase().match(/(\d{1,2})\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)/i)
      if (monthMatch) {
        const day = parseInt(monthMatch[1])
        const month = monthMap[monthMatch[2].toLowerCase()]
        const currentYear = new Date().getFullYear()
        return new Date(currentYear, month - 1, day).getTime()
      }
      
      // "17 Jan" format (day + month abbreviation, reverse order)
      monthMatch = fileName.toLowerCase().match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)
      if (monthMatch) {
        const day = parseInt(monthMatch[1])
        const month = monthMap[monthMatch[2].toLowerCase()]
        const currentYear = new Date().getFullYear()
        return new Date(currentYear, month - 1, day).getTime()
      }
      
      // "Jan 17" format (month + day)
      monthMatch = fileName.toLowerCase().match(/(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\s+(\d{1,2})/i)
      if (monthMatch) {
        const month = monthMap[monthMatch[1].toLowerCase()]
        const day = parseInt(monthMatch[2])
        const currentYear = new Date().getFullYear()
        return new Date(currentYear, month - 1, day).getTime()
      }
      
      return currentTime - (365 * dayMs) // fallback to 1 year ago if no date
    }

    const applyRecencyBoost = (searchResults: any[]): any[] => {
      return searchResults.map(result => {
        const fileDate = getFileDate(result)
        const daysSinceFile = (currentTime - fileDate) / dayMs
        
        // Strong recency boost to prioritize recent content
        // Files from today: +1.0, 1 week ago: +0.8, 1 month ago: +0.5, 6+ months: +0
        let recencyBoost = 0
        if (daysSinceFile <= 1) recencyBoost = 1.0        // Today - very strong boost
        else if (daysSinceFile <= 7) recencyBoost = 0.8   // This week - strong boost
        else if (daysSinceFile <= 30) recencyBoost = 0.5  // This month
        else if (daysSinceFile <= 90) recencyBoost = 0.3  // Last 3 months
        else if (daysSinceFile <= 180) recencyBoost = 0.1 // Last 6 months
        
        console.log(`📅 [ContentService] File "${result.file_name}" - Date: ${new Date(fileDate).toISOString().slice(0,10)}, Days ago: ${daysSinceFile.toFixed(1)}, Recency boost: +${recencyBoost}`)
        
        return {
          ...result,
          originalScore: result.score || result.rank || 0,
          recencyBoost,
          finalScore: (result.score || result.rank || 0) + recencyBoost,
          fileDate,
          daysSinceFile
        }
      })
    }

    try {
      const llama = LlamaService.getInstance()
      const model = llama.getCurrentModel()
      if (model && typeof (database as any).getEmbeddingsForChunks === 'function') {
        // Embedding/hybrid path
        const candidateIds = ftsResults.map(r => r.id).slice(0, 200)
        const embRows = (database as any).getEmbeddingsForChunks(model, candidateIds) as Array<{ chunk_id:number; file_id:number; file_path:string; file_name:string; chunk_text:string; vector:number[] }>
        const qVec = (await llama.embedTexts([query], model))[0] || []
        const scored = embRows.map(e => ({ id:e.chunk_id, file_id:e.file_id, file_path:e.file_path, file_name:e.file_name, content_snippet:e.chunk_text.slice(0,200), sim: cosineSimilarity(qVec, e.vector) }))
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
        
        // Apply recency boost to hybrid results
        const boostedResults = applyRecencyBoost(Array.from(merged.values()))
        results = boostedResults
          .sort((a,b) => b.finalScore - a.finalScore) // Sort by boosted score
          .slice(0,20)
      } else {
        // FTS-only path - also apply recency boost!
        console.log('🔍 [ContentService] Using FTS-only search with recency boost')
        const boostedResults = applyRecencyBoost(ftsResults)
        results = boostedResults
          .sort((a,b) => b.finalScore - a.finalScore) // Sort by boosted score
          .slice(0,20)
      }
    } catch {
      // Fallback: still apply recency boost to FTS results
      console.log('⚠️ [ContentService] Search fallback with recency boost')
      const boostedResults = applyRecencyBoost(ftsResults)
      results = boostedResults
        .sort((a,b) => b.finalScore - a.finalScore)
        .slice(0,20)
    }

    const dateBlock = (()=>{
      if (!dateFilter) return ''
      const start = dateFilter.start.toISOString().slice(0,10)
      const end = new Date(+dateFilter.end - 1).toISOString().slice(0,10)
      return `Date range: ${start} → ${end}`
    })()

    // Cap per-file hits and overall count/size
    const perFileCap = 2
    const seenPerFile = new Map<string, number>()
    const finalResults: any[] = []
    let totalChars = 0
    const charBudget = 2400
    for (const r of results) {
      const key = r.file_path
      const count = seenPerFile.get(key) || 0
      const snippet = String(r.content_snippet || '')
      if (count < perFileCap && totalChars + snippet.length <= charBudget) {
        finalResults.push(r)
        seenPerFile.set(key, count + 1)
        totalChars += snippet.length
      }
      if (finalResults.length >= 20 || totalChars >= charBudget) break
    }

    const retrievedBlock = finalResults.length>0
      ? finalResults.map((r)=>`• From "${cleanFileName(r.file_name)}": ${String(r.content_snippet||'').replace(/<\/?mark>/g,'')}`).join('\n')
      : ''
    const today = new Date().toISOString()
    const prompt = `You are a helpful, conversational AI assistant who has access to the user's personal notes and journal entries. Your goal is to have natural conversations while drawing insights from their notes when relevant.

Today is ${today}.
${conversationContext}
Available context from their notes:
${pinnedContent ? `\nPinned notes (always relevant):\n${pinnedContent}` : ''}
${dateBlock ? `\nDate filter: ${dateBlock}` : ''}
${retrievedBlock ? `\nRelevant entries:\n${retrievedBlock}` : ''}

User's question: ${query}

Instructions:
- Answer the user's question directly and conversationally, like a thoughtful friend
- Use insights from their notes to provide personalized responses, but focus on answering the question
- Reference their notes naturally when relevant (e.g., "I remember you mentioned..." or "Based on your thoughts about...")
- Don't over-cite or list sources unless specifically asked - just have a natural conversation
- Be warm, insightful, and helpful - draw from their notes to give meaningful advice and perspectives
- Ask follow-up questions to continue meaningful dialogue`

    const sources: Array<{file_name:string; file_path:string; snippet:string}> = finalResults.map((r:any)=>({ file_name:r.file_name, file_path:r.file_path, snippet:String(r.content_snippet||'').replace(/<\/?mark>/g,'') }))
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
      if (dateFilter) {
        console.log(`📅 [ContentService] Date filter detected: ${dateFilter.start.toISOString().slice(0,10)} to ${dateFilter.end.toISOString().slice(0,10)}`)
      } else {
        console.log(`📅 [ContentService] No date filter found in query: "${query}" - using recency boost for ordering`)
      }

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
      const ftsResults: any[] = hasFTS ? (database as any).searchContentFTS(query, 20, dateFilter) : (database as any).searchContent(query, 20, dateFilter)

      let hybridResults: any[] = ftsResults
      try {
        const llama = LlamaService.getInstance()
        const model = llama.getCurrentModel()
        if (model && typeof (database as any).getEmbeddingsForChunks === 'function') {
          let candidateIds = ftsResults.map(r => r.id).slice(0, 200)
          if (candidateIds.length === 0 && typeof (database as any).getEmbeddingsForModel === 'function') {
            const allEmbMeta = (database as any).getEmbeddingsForModel(model) as Array<{ chunk_id:number; file_id:number; file_path:string; file_name:string; chunk_text:string; vector:number[] }>
            candidateIds = allEmbMeta.slice(0, 500).map(e => e.chunk_id)
          }
          const embRows = (database as any).getEmbeddingsForChunks(model, candidateIds) as Array<{ chunk_id:number; file_id:number; file_path:string; file_name:string; chunk_text:string; vector:number[] }>
          // Build query vector
          const qVec = (await llama.embedTexts([query], model))[0] || []
          // Score top-N embeddings
          const scored = embRows.map(e => ({
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
              existing.score = (existing.score || 0) + eScore
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
        .reduce((acc: any[], r: any) => acc.concat(r), [])
        .slice(0, 100)

      // Cap per-file hits to at most 2
      const perFileCap = 2
      const seenPerFile = new Map<string, number>()
      const capped = [] as any[]
      for (const r of results) {
        const key = r.file_path
        const count = seenPerFile.get(key) || 0
        if (count < perFileCap) {
          capped.push(r)
          seenPerFile.set(key, count + 1)
        }
        if (capped.length >= 20) break
      }

      // 3. Build context blocks
      const pinnedBlock = pinnedContent ? `Pinned notes:\n${pinnedContent}` : ''

      let dateBlock = ''
      if (dateFilter) {
        const start = dateFilter.start.toISOString().slice(0,10)
        const end = new Date(+dateFilter.end - 1).toISOString().slice(0,10)
        dateBlock = `Date range: ${start} → ${end}`
      }

      let retrievedBlock = ''
      if (capped.length > 0) {
        retrievedBlock = capped.map((r) => `• From "${cleanFileName(r.file_name)}": ${String(r.content_snippet || '').replace(/<\/?mark>/g, '')}`).join('\n')
      }

      if (capped.length === 0 && !pinnedContent) {
        return {
          answer: "I couldn't find anything specific in your notes. Try broadening the query or specify a date (e.g., 2024-01 or last 7 days).",
          sources: []
        }
      }

      // 4. Add conversation context if available
      let conversationContext = ''
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-4)
        conversationContext = `\nRecent conversation:\n${recentMessages.map(msg => `${msg.role === 'user' ? 'You' : 'Me'}: ${msg.content}`).join('\n')}\n`
      }

      // 5. Build conversational notes assistant prompt
      const today = new Date().toISOString()
      const ragPrompt = `You are a helpful, conversational AI assistant who has access to the user's personal notes and journal entries. Your goal is to have natural conversations while drawing insights from their notes when relevant.

Today is ${today}.
${conversationContext}
Available context from their notes:
${pinnedContent ? `\nPinned notes (always relevant):\n${pinnedContent}` : ''}
${dateBlock ? `\nDate filter: ${dateBlock}` : ''}
${retrievedBlock ? `\nRelevant entries:\n${retrievedBlock}` : ''}

User's question: ${query}

Instructions:
- Answer the user's question directly and conversationally, like a thoughtful friend
- Use insights from their notes to provide personalized responses, but focus on answering the question
- Reference their notes naturally when relevant (e.g., "I remember you mentioned..." or "Based on your thoughts about...")
- Don't over-cite or list sources unless specifically asked - just have a natural conversation
- Be warm, insightful, and helpful - draw from their notes to give meaningful advice and perspectives
- Ask follow-up questions to continue meaningful dialogue`

      const totalSources = capped.length + (pinnedContent ? pinnedContent.split('📌 Pinned:').length - 1 : 0)
      console.log(`🧠 [ContentService] Sending to LLM with ${totalSources} sources (${capped.length} search + pinned files)`)      

      // 6. Get LLM response
      const llamaService = LlamaService.getInstance()
      const llmResponse = await llamaService.sendMessage([
        { role: 'user', content: ragPrompt }
      ])

      // 7. Sources list
      const sources = capped.map((r: any) => ({
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