import { database } from '../database'
import { LlamaService } from './llamaService'

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
  return fileName
    .replace(/\s+[a-f0-9]{32,}\.md$/i, '')
    .replace(/\.md$/i, '')
    .replace(/^\d+\s+/, '')
    .trim()
}

function extractDateFilter(qIn: string, now = new Date()): DateFilter {
  const q = qIn.toLowerCase()
  const iso = q.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/)
  if (iso) {
    const y = +iso[1], m = +iso[2] - 1, d = iso[3] ? +iso[3] : 1
    const start = new Date(Date.UTC(y, m, d))
    const end = iso[3] ? new Date(Date.UTC(y, m, d + 1)) : new Date(Date.UTC(y, m + 1, 1))
    return { start, end }
  }
  
  // UTC day boundary helpers
  const toUtcStartOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const todayUtc = toUtcStartOfDay(new Date(now.toISOString()))
  
  if (q.includes('today')) return { start: todayUtc, end: new Date(+todayUtc + 86400000) }
  if (q.includes('yesterday')) { const y = new Date(+todayUtc - 86400000); return { start: y, end: todayUtc } }
  if (q.includes('this week')) return { start: new Date(+todayUtc - 7 * 86400000), end: new Date(+todayUtc + 86400000) }
  if (q.includes('last week')) return { start: new Date(+todayUtc - 14 * 86400000), end: new Date(+todayUtc - 7 * 86400000) }
  if (q.includes('this month')) { 
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { start: startOfMonth, end: new Date(+todayUtc + 86400000) }
  }
  if (q.includes('recent') || q.includes('lately') || q.includes('recently')) {
    return { start: new Date(+todayUtc - 30 * 86400000), end: new Date(+todayUtc + 86400000) }
  }
  
  const mRel = q.match(/last (\d+)\s*(days?|weeks?|months?)/)
  if (mRel) { 
    const n = Math.min(365, +mRel[1] || 7)
    const unit = mRel[2]
    let multiplier = 1
    if (unit.startsWith('week')) multiplier = 7
    else if (unit.startsWith('month')) multiplier = 30
    return { start: new Date(+todayUtc - n * multiplier * 86400000), end: todayUtc }
  }
  
  return null
}

class ContentService {
  // Optional light query expansion (disabled by default unless setting enabled)
  private async tryExpandQuery(original: string): Promise<string> {
    const enabled = (((database as any).getSetting?.('ragExpandQuery') || 'false') as string).toLowerCase() === 'true'
    if (!enabled) return original
    try {
      const llama = LlamaService.getInstance()
      try { await llama.initialize() } catch {}
      const prompt = `For the user query below, output 5-10 literal search terms (single words or short noun phrases) separated by spaces. No punctuation, no sentences.\n\nQuery: ${original}\n\nTerms:`
      const out = await llama.sendMessage([{ role: 'user', content: prompt }])
      const terms = String(out || '')
        .replace(/[\n,;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!terms) return original
      return `${original} ${terms}`
    } catch {
      return original
    }
  }
  // FTS-only search (date-aware). Falls back to LIKE if FTS unavailable
  searchOnly(query: string, limit: number = 20) {
    const dateFilter = extractDateFilter(query)
    const operator = ((database as any).getSetting?.('ftsOperator') || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    const hasFTS = typeof (database as any).searchContentFTS === 'function'
    return hasFTS
      ? (database as any).searchContentFTS(query, limit, dateFilter, operator)
      : database.searchContent(query, limit)
  }

  private buildAnswer(query: string, sources: Array<{ file_name: string; file_path: string; snippet: string }>): string {
    if (!sources.length) {
      return `No direct matches found for "${query}".`
    }
    const header = `Top matches for "${query}":\n\n`
    const body = sources.slice(0, 10)
      .map((r, i) => `${i + 1}. ${cleanFileName(r.file_name)} — ${String(r.snippet || '').replace(/<\/?mark>/g, '')}`)
      .join('\n\n')
    return header + body
  }

  // Keep signature compatible; ignore conversation history
  async searchAndAnswer(query: string, _conversationHistory?: Array<{ role: string; content: string }>): Promise<RAGResponse> {
    const trimmed = (query || '').trim()
    // Guard against vague/empty prompts; keep responses grounded
    if (trimmed.length < 2 || /^(hi|hello|hey|yo|sup|hola|howdy|\?$)/i.test(trimmed)) {
      const safe = 'Hi! I can search your notes or help with a question. Ask something specific (e.g., “ideas from last week’s meeting” or “todos today”).'
      return { answer: safe, sources: [] }
    }
    const { prompt, sources } = await this.preparePromptWithHybrid(query)
    const llama = LlamaService.getInstance()
    try { await llama.initialize() } catch {}
    const answer = await llama.sendMessage([{ role: 'user', content: prompt }])
    return { answer, sources }
  }

  preparePrompt(query: string): { prompt: string; sources: Array<{ file_name: string; file_path: string; snippet: string }> } {
    const dateFilter = extractDateFilter(query)
    const rows = this.searchOnly(query, 20) as any[]
    // Simple per-file cap and size guard
    const seen = new Map<string, number>()
    const sources: Array<{ file_name: string; file_path: string; snippet: string }> = []
    const budget = parseInt(((database as any).getSetting?.('ftsCharBudget') || '2400') as string) || 2400
    const perFileCap = parseInt(((database as any).getSetting?.('ftsPerFileCap') || '2') as string) || 2
    let totalChars = 0
    for (const r of rows) {
      const key = r.file_path
      const count = seen.get(key) || 0
      const snippet = String(r.content_snippet || '').replace(/<\/?mark>/g, '')
      if (count < perFileCap && totalChars + snippet.length <= budget) {
        sources.push({ file_name: r.file_name, file_path: r.file_path, snippet })
        seen.set(key, count + 1)
        totalChars += snippet.length
      }
      const maxResults = parseInt(((database as any).getSetting?.('ftsMaxResults') || '20') as string) || 20
      if (sources.length >= maxResults || totalChars >= budget) break
    }
    const retrievedBlock = sources.map(s => `• ${cleanFileName(s.file_name)} — ${s.snippet}`).join('\n')
    const dateBlock = dateFilter ? `Date filter: ${dateFilter.start.toISOString().slice(0,10)} → ${new Date(+dateFilter.end - 1).toISOString().slice(0,10)}` : ''
    const today = new Date().toISOString()
    const prompt = `You are a concise, friendly assistant. Use only the following context from the user's notes when helpful. If unsure, say so clearly.

Today is ${today}.
${dateBlock ? `\n${dateBlock}` : ''}
${retrievedBlock ? `\nRelevant entries:\n${retrievedBlock}` : ''}

User's request: ${query}

Instructions:
- Prefer the supplied context; cite filenames naturally.
- Keep answers tight (2–4 short paragraphs; bullets for steps).
- If context is sparse, say so and suggest next steps or date ranges.`
    return { prompt, sources }
  }

  private async preparePromptWithHybrid(query: string): Promise<{ prompt: string; sources: Array<{ file_name: string; file_path: string; snippet: string }> }> {
    // Base FTS results
      const dateFilter = extractDateFilter(query)
    const operator = ((database as any).getSetting?.('ftsOperator') || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    const candidateLimit = parseInt(((database as any).getSetting?.('ftsCandidateLimit') || '400') as string) || 400
    const hasFTS = typeof (database as any).searchContentFTS === 'function'
    const expanded = await this.tryExpandQuery(query)
    let ftsRows = hasFTS
      ? (database as any).searchContentFTS(expanded, candidateLimit, dateFilter, operator)
      : database.searchContent(expanded, candidateLimit)
    // Retry with OR if AND yielded nothing
    if (hasFTS && operator === 'AND' && (!ftsRows || ftsRows.length === 0)) {
      ftsRows = (database as any).searchContentFTS(query, 40, dateFilter, 'OR')
    }
    // Fallbacks: LIKE search then filename search
    if (!ftsRows || ftsRows.length === 0) {
      ftsRows = database.searchContent(query, 40)
    }
    if ((!ftsRows || ftsRows.length === 0) && (database as any).searchFilesByName) {
      const nameRows = (database as any).searchFilesByName(query, 40)
      ftsRows = nameRows
    }

    let candidateRows = ftsRows as any[]

    // Optional Embeddings re-rank if available per Phase 3
      try {
        const llama = LlamaService.getInstance()
        const model = llama.getCurrentModel()
      const getEmbForChunks = (database as any).getEmbeddingsForChunks as undefined | ((m: string, ids: number[]) => any[])
      if (model && typeof getEmbForChunks === 'function' && candidateRows.length) {
        const candidateIds = candidateRows.slice(0, Math.min(1000, candidateRows.length)).map(r => r.id)
        const embRows = getEmbForChunks(model, candidateIds) as Array<{ chunk_id:number; vector:number[] }>
        // Build query vector using expanded text for better recall
        const qVec = (await llama.embedTexts([expanded], model))[0] || []
        // Cosine similarity
        const cos = (a:number[], b:number[]): number => {
          let dot=0, na=0, nb=0; const len = Math.min(a.length, b.length)
          for (let i=0;i<len;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i] }
          if (!na || !nb) return 0; return dot/(Math.sqrt(na)*Math.sqrt(nb))
        }
        const simMap = new Map<number, number>()
        for (const e of embRows) simMap.set(e.chunk_id, cos(qVec, (e as any).vector || []))
        // Merge: normalized FTS rank + sim
        const timeIntent = !!dateFilter || /(today|yesterday|recent|this\s+week|this\s+month|last\s+\d+\s*(days?|weeks?|months?)|ago|since|before|after)/i.test(query)
        const merged = candidateRows.map((r, idx) => {
          const bm = typeof r.rank === 'number' ? r.rank : (idx + 1)
          const bmScore = 1 / (1 + bm)
          const simScore = simMap.get(r.id) || 0
          // Token coverage over snippet content
          const snippetLC = String(r.content_snippet || '').toLowerCase()
          const tokens = expanded.toLowerCase().split(/\s+/).filter(t => t.length > 2)
          const covered = tokens.reduce((acc, t) => acc + (snippetLC.includes(t) ? 1 : 0), 0)
          const coverageScore = Math.min(1, covered / Math.max(3, Math.min(tokens.length, 8)))
          let recencyScore = 0
          try {
            if (r.file_mtime) {
              const days = Math.max(0, (Date.now() - new Date(r.file_mtime as any).getTime()) / 86400000)
              recencyScore = 1 / (1 + days / 45)
            }
          } catch {}
          // Light filename boost
          const name = String(r.file_name || '').toLowerCase()
          const fileHit = tokens.some(t => name.includes(t)) ? 0.1 : 0
          const score = timeIntent
            ? (0.38 * simScore + 0.22 * bmScore + 0.3 * recencyScore + 0.1 * coverageScore + fileHit)
            : (0.48 * simScore + 0.32 * bmScore + 0.1 * recencyScore + 0.1 * coverageScore + fileHit)
          return { row: r, score }
        })
        merged.sort((a,b)=>b.score - a.score)
        candidateRows = merged.map(m=>m.row)
      }
    } catch {}

    // Diversity-first selection: ensure wide file coverage before adding multiples
    const seen = new Map<string, number>()
    const budget = parseInt(((database as any).getSetting?.('ftsCharBudget') || '3600') as string) || 3600
    const perFileCap = parseInt(((database as any).getSetting?.('ftsPerFileCap') || '3') as string) || 3
    const maxResults = parseInt(((database as any).getSetting?.('ftsMaxResults') || '24') as string) || 24
    const sources: Array<{ file_name: string; file_path: string; snippet: string }> = []
    let totalChars = 0
    const expandedTokens = expanded.toLowerCase().split(/\s+/).filter(t => t.length > 2)
    const seenSnippetSig = new Set<string>()

    const addWithNeighbors = (r: any) => {
      let text = String(r.content_snippet || '').replace(/<\/?mark>/g, '')
      try {
        if (typeof r.file_id === 'number' && typeof r.chunk_index === 'number') {
          const neighbors = database.getNeighborChunks(r.file_id, r.chunk_index, 1)
          const merged = neighbors.map(n => n.chunk_text).join('\n')
          if (merged && merged.length > text.length) text = merged
        }
      } catch {}
      // Drop very short/low-signal snippets
      if (text.length < 60) return
      const snippet = text.length > 650 ? (text.slice(0, 630) + '…') : text
      // De-duplicate similar snippets
      const sig = snippet.toLowerCase().replace(/\s+/g, ' ').slice(0, 160)
      if (seenSnippetSig.has(sig)) return
      const key = r.file_path
      const count = seen.get(key) || 0
      // Basic relevance guard: require at least one token match unless we have very few sources
      const tokenHit = expandedTokens.some(t => snippet.toLowerCase().includes(t))
      if (!tokenHit && sources.length >= Math.min(8, maxResults)) return
      if (count < perFileCap && totalChars + snippet.length <= budget) {
        sources.push({ file_name: r.file_name, file_path: r.file_path, snippet })
        seen.set(key, count + 1)
        totalChars += snippet.length
        seenSnippetSig.add(sig)
      }
    }

    // Pass 1: one per file (maximize coverage)
    const topByFile = new Map<string, any>()
    for (const r of candidateRows) {
      if (!topByFile.has(r.file_path)) topByFile.set(r.file_path, r)
      if (topByFile.size >= maxResults) break
    }
    for (const r of topByFile.values()) {
      if (sources.length >= maxResults || totalChars >= budget) break
      addWithNeighbors(r)
    }

    // Pass 2: fill remaining slots up to per-file cap
    if (sources.length < maxResults && totalChars < budget) {
      for (const r of candidateRows) {
        if (sources.length >= maxResults || totalChars >= budget) break
        addWithNeighbors(r)
      }
    }
    // Add dates for better temporal grounding (no bracket tags in output)
    const enriched = sources.map((s) => ({
      file_name: s.file_name,
      file_path: s.file_path,
      snippet: s.snippet,
      displayDate: (() => {
        try {
          const file = (database as any).getFileByPath?.(s.file_path)
          const d = (file?.note_date || file?.file_mtime) as string | undefined
          return d ? d.slice(0,10) : ''
        } catch { return '' }
      })()
    }))
    const retrievedBlock = enriched
      .map(s => `• ${cleanFileName(s.file_name)}${s.displayDate ? ` (${s.displayDate})` : ''}: ${s.snippet}`)
      .join('\n')
    const dateBlock = dateFilter ? `Date filter: ${dateFilter.start.toISOString().slice(0,10)} → ${new Date(+dateFilter.end - 1).toISOString().slice(0,10)}` : ''
      const today = new Date().toISOString()
    const prompt = `You are a concise, friendly assistant for the user's local notes.

Today is ${today}.
${dateBlock ? `\n${dateBlock}` : ''}
${retrievedBlock ? `\nContext from notes:\n${retrievedBlock}` : ''}

User’s request: ${query}

Instructions:
- Use ONLY the context above. Do not include bracket citations like [S1].
- Be very conversational, like a thoughtful friend. Integrate details naturally.
- Prefer 2–4 short paragraphs with occasional bullets. Avoid filler and repetition.
- If context is sparse, say what's missing and suggest one next step.
- If timing or recency matters, prefer newer notes and mention that explicitly.`
    return { prompt, sources: enriched.map(({file_name, file_path, snippet}) => ({ file_name, file_path, snippet })) }
  }

  getFileContent(fileId: number): string | null {
    return database.getFileContent(fileId)
  }
}

export const contentService = new ContentService() 