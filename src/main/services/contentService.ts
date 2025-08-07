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

      // 2. Search for relevant content (prefer FTS5 with date filter, fallback is internal)
      const searchResults = (database as any).searchContentFTS
        ? (database as any).searchContentFTS(query, 10, dateFilter)
        : database.searchContent(query, 10)

      // 3. Build context blocks
      const pinnedBlock = pinnedContent ? `Pinned notes:\n${pinnedContent}` : ''

      let dateBlock = ''
      if (dateFilter) {
        const start = dateFilter.start.toISOString().slice(0,10)
        const end = new Date(+dateFilter.end - 1).toISOString().slice(0,10)
        dateBlock = `Date range: ${start} → ${end}`
      }

      let retrievedBlock = ''
      if (searchResults.length > 0) {
        retrievedBlock = searchResults.map((r, i) => `(${i+1}) ${r.file_name}: ${r.content_snippet.replace(/<\/?mark>/g, '')}`).join('\n')
      }

      if (searchResults.length === 0 && !pinnedContent) {
        return {
          answer: "I couldn't find anything specific in your notes. Try broadening the query or specify a date (e.g., 2024-01 or last 7 days).",
          sources: []
        }
      }

      // 4. Add conversation context if available
      let conversationContext = ''
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-4)
        conversationContext = recentMessages.map(msg => `${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content}`).join('\n')
      }

      // 5. Build general notes assistant prompt with blocks
      const today = new Date().toISOString()
      const ragPrompt = `You are a concise, friendly assistant for the user's local notes.\nToday is ${today}.\n\nContext from notes:\n${pinnedBlock}\n${dateBlock}\n${retrievedBlock}\n\nUser’s request: ${query}\n\nInstructions:\n- Prefer the supplied context; cite filenames.\n- Keep answers tight (2–4 short paragraphs; bullets for steps).\n- If context is sparse, say so and suggest next steps or date ranges.\n- If the request implies dates, prioritize those notes.\n- End with 1–2 helpful follow‑ups.`

      const totalSources = searchResults.length + (pinnedContent ? pinnedContent.split('📌 Pinned:').length - 1 : 0)
      console.log(`🧠 [ContentService] Sending to LLM with ${totalSources} sources (${searchResults.length} search + pinned files)`)      

      // 6. Get LLM response
      const llamaService = LlamaService.getInstance()
      const llmResponse = await llamaService.sendMessage([
        { role: 'user', content: ragPrompt }
      ])

      // 7. Sources list
      const sources = searchResults.map((r: any) => ({
        file_name: r.file_name,
        file_path: r.file_path,
        snippet: r.content_snippet.replace(/<\/?mark>/g, '')
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