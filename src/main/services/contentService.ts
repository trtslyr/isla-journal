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

class ContentService {
  /**
   * Perform RAG search and generate response with conversation context
   */
  async searchAndAnswer(
    query: string,
    conversationHistory?: Array<{role: string, content: string}>,
    scope?: { includePaths?: string[]; includeDirectories?: string[]; useRoot?: boolean }
  ): Promise<RAGResponse> {
    try {
      console.log(`🔍 [ContentService] Searching for: ${query}`)

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

      // 2. Search for relevant content (optionally scoped)
      let searchResults
      if (scope?.useRoot) {
        // If root selected, no filtering needed
        searchResults = database.searchContent(query, 5)
      } else if (scope?.includePaths?.length || scope?.includeDirectories?.length) {
        searchResults = database.searchContentScoped(query, 5, {
          includePaths: scope.includePaths || [],
          includeDirectories: scope.includeDirectories || []
        })
      } else {
        searchResults = database.searchContent(query, 5)
      }
      
      // 3. Build context from search results
      let contextSources = ''
      if (searchResults.length > 0) {
        contextSources = `**🔍 Relevant content found:**\n${searchResults.map((result, index) => 
          `[Source ${index + 1} from "${result.file_name}"]: ${result.content_snippet.replace(/<\/?mark>/g, '')}`
        ).join('\n\n')}`
      }

      // If no search results but we have pinned content, still proceed
      if (searchResults.length === 0 && !pinnedContent) {
        return {
          answer: "I couldn't find anything specific about that in your journal entries. What would you like to explore or share with me?",
          sources: []
        }
      }

      // 4. Add conversation context if available
      let conversationContext = ''
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-4) // Last 4 messages for context
        conversationContext = `\n**Recent conversation:**\n${recentMessages.map(msg => 
          `${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content}`
        ).join('\n')}\n`
      }

      // 5. Build conversational RAG prompt with pinned files always included
      const ragPrompt = `You are the user's personal journal AI assistant. You have access to their private journal entries and should respond in a warm, supportive, and conversational way - like a close friend who knows them well.

**Context from their journal:**
${pinnedContent}${contextSources}${conversationContext}

**User's question:** ${query}

**Instructions:**
- Respond naturally and conversationally, like you're chatting with a close friend
- Reference specific details from their journal entries when relevant
- Be supportive, insightful, and encouraging  
- When they mention people in their life, acknowledge those relationships warmly
- Ask thoughtful follow-up questions to keep the conversation going
- Use "you" and "your" to make it personal
- If this is a follow-up question, build on the previous conversation naturally
- If the journal context doesn't directly answer their question, still try to be helpful based on what you know about them
- Keep responses focused but conversational (2-4 paragraphs max)

Remember: This is THEIR personal journal, so speak to them like you know their story and care about their journey.`

      const totalSources = searchResults.length + (pinnedContent ? pinnedContent.split('📌 Pinned:').length - 1 : 0)
      console.log(`🧠 [ContentService] Sending to LLM with ${totalSources} sources (${searchResults.length} search + pinned files)${scope?.includePaths?.length || scope?.includeDirectories?.length ? ' [SCOPED]' : ''}`)

      // 6. Get LLM response
      const llamaService = LlamaService.getInstance()
      const llmResponse = await llamaService.sendMessage([
        {
          role: 'user',
          content: ragPrompt
        }
      ])

      // 7. Prepare sources (include both search results and pinned files info)
      const sources = searchResults.map(result => ({
        file_name: result.file_name,
        file_path: result.file_path,
        snippet: result.content_snippet.replace(/<\/?mark>/g, '')
      }))

      // Add pinned files info to sources
      if (pinnedContent) {
        try {
          const pinnedItemsJson = database.getSetting('pinnedItems')
          if (pinnedItemsJson) {
            const pinnedItems = JSON.parse(pinnedItemsJson)
            pinnedItems.forEach((item: any) => {
              if (item.type === 'file' && item.path.endsWith('.md')) {
                sources.push({
                  file_name: `📌 ${item.name}`,
                  file_path: item.path,
                  snippet: '(Pinned file - always included in context)'
                })
              }
            })
          }
        } catch (error) {
          console.log('⚠️ [ContentService] Error adding pinned files to sources:', error)
        }
      }

      console.log(`✅ [ContentService] Generated RAG response`)

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