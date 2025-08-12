import { database } from '../database'
import { LlamaService } from './llamaService'
import { readFile } from 'fs/promises'
import { normalize, resolve } from 'path'

export interface RAGResponse {
  answer: string
  sources: Array<{
    file_name: string
    file_path: string
    snippet: string
  }>
}

export type DateFilter = { start: Date; end: Date } | null
export function extractDateFilter(qIn: string, now = new Date()): DateFilter {
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
   * Perform RAG search and generate response with conversation context
   */
  async searchAndAnswer(query: string, conversationHistory?: Array<{role: string, content: string}>): Promise<RAGResponse> {
    try {
      console.log(`🔍 [ContentService] Searching for: ${query}`)

      // Date filter
      const dateFilter = extractDateFilter(query)

      // 1. Get pinned files content first with cross-platform path handling
      let pinnedContent = ''
      let pinnedCount = 0
      try {
        const pinnedItemsJson = database.getSetting('pinnedItems')
        if (pinnedItemsJson) {
          const pinnedItems = JSON.parse(pinnedItemsJson)
          const pinnedSources: string[] = []
          for (let i = 0; i < pinnedItems.length && pinnedSources.length < 5; i++) {
            const item = pinnedItems[i]
            if (item.type === 'file' && item.path.endsWith('.md')) {
              try {
                const normalizedPath = normalize(resolve(item.path))
                const content = await readFile(normalizedPath, 'utf-8')
                const snippet = content.length > 240 ? content.substring(0, 240) + '…' : content
                pinnedSources.push(`[${item.name}]: ${snippet}`)
              } catch {}
            }
          }
          pinnedCount = pinnedSources.length
          if (pinnedSources.length > 0) {
            pinnedContent = pinnedSources.map(s => `- ${s}`).join('\n')
          }
        }
      } catch {}

      // 2. Search for relevant content (FTS preferred)
      let results = (database as any).searchContentFTS ? (database as any).searchContentFTS(query, 20, dateFilter || undefined) : database.searchContent(query, 10)

      // Embeddings hybrid union (Phase 3)
      try {
        const llama = LlamaService.getInstance()
        const emb = await llama.embedText(query)
        if (emb.vector && emb.vector.length > 0 && (database as any).topByEmbeddingSimilarity) {
          const embTop = (database as any).topByEmbeddingSimilarity(emb.vector, 20)
          const combined = new Map<string, { file_id: number; file_path: string; file_name: string; content_snippet: string; score: number }>()
          const add = (key: string, item: any, score: number) => {
            const existing = combined.get(key)
            if (!existing || score > existing.score) combined.set(key, { ...item, score })
          }
          // Normalize FTS to score (lower bm25 is better). Use inverse as heuristic.
          results.forEach((r: any) => add(`${r.file_id}:${r.id || r.content_snippet}`, r, 1 / (1 + (r.rank || 1))))
          embTop.forEach((r: any) => add(`${r.file_id}:${r.content_snippet}`, r, 0.6 * r.sim + 0.4))
          results = Array.from(combined.values()).sort((a, b) => b.score - a.score).slice(0, 20) as any
        }
      } catch {}

      // Build DATE_SCOPED block if date filter applied
      let dateScopedBlock = ''
      if (dateFilter && results.length > 0) {
        const byFile = new Map<number, { file: string; path: string; snippets: string[] }>()
        for (const r of results) {
          const entry = byFile.get(r.file_id) || { file: r.file_name, path: r.file_path, snippets: [] }
          if (entry.snippets.length < 2) entry.snippets.push(r.content_snippet.replace(/\n/g, ' '))
          byFile.set(r.file_id, entry)
        }
        dateScopedBlock = Array.from(byFile.values()).slice(0, 5).map(e => `- [${e.file}] ${e.snippets.join(' … ')}`).join('\n')
      }

      // 3. Build RETRIEVED block from top-k
      const retrievedBlock = results.slice(0, 8).map((r, i) => `- [${r.file_name}] ${r.content_snippet.replace(/<\/?.*?>/g, '')}`).join('\n')

      if (results.length === 0 && !pinnedContent) {
        return {
          answer: "I couldn't find much in your notes about that. Try adding a date (e.g., 2024-05 or yesterday) or opening more files.",
          sources: []
        }
      }

      // 4. Conversation context
      let conversationContext = ''
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-4)
        conversationContext = recentMessages.map(msg => `${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content}`).join('\n')
      }

      // 5. Build general notes assistant prompt
      const today = new Date()
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
      const prompt = `You are a concise, friendly assistant for the user's local notes.
Today is ${today.toISOString().slice(0,10)} (timezone: ${tz}).

Context from notes:
${pinnedContent ? 'Pinned:\n' + pinnedContent + '\n\n' : ''}${dateScopedBlock ? 'Date-scoped:\n' + dateScopedBlock + '\n\n' : ''}${retrievedBlock ? 'Retrieved:\n' + retrievedBlock + '\n\n' : ''}
User’s request: ${query}

Instructions:
- Prefer the supplied context; cite filenames.
- Keep answers tight (2–4 short paragraphs; bullets for steps).
- If context is sparse, say so and suggest next steps or date ranges.
- If the request implies dates, prioritize those notes.
${conversationContext ? '\nRecent conversation:\n' + conversationContext : ''}`

      const llamaService = LlamaService.getInstance()
      const llmResponse = await llamaService.sendMessage([{ role: 'user', content: prompt }])

      const sources = results.slice(0, 8).map(r => ({
        file_name: r.file_name,
        file_path: r.file_path,
        snippet: r.content_snippet.replace(/<\/?.*?>/g, '')
      }))

      return {
        answer: llmResponse,
        sources
      }

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
    const dateFilter = extractDateFilter(query)
    if ((database as any).searchContentFTS) {
      return (database as any).searchContentFTS(query, limit, dateFilter || undefined)
    }
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