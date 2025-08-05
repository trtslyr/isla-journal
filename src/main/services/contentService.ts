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

class ContentService {
  /**
   * Perform RAG search and generate response with conversation context
   */
  async searchAndAnswer(query: string, conversationHistory?: Array<{role: string, content: string}>): Promise<RAGResponse> {
    try {
      console.log(`🔍 [ContentService] Searching for: ${query}`)

      // 1. Search for relevant content
      const searchResults = database.searchContent(query, 5)
      
      if (searchResults.length === 0) {
        return {
          answer: "I couldn't find anything specific about that in your journal entries. What would you like to explore or share with me?",
          sources: []
        }
      }

      // 2. Build context from search results
      const contextSources = searchResults.map((result, index) => 
        `[Source ${index + 1} from "${result.file_name}"]: ${result.content_snippet.replace(/<\/?mark>/g, '')}`
      ).join('\n\n')

      // 3. Add conversation context if available
      let conversationContext = ''
      if (conversationHistory && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-4) // Last 4 messages for context
        conversationContext = `\n**Recent conversation:**\n${recentMessages.map(msg => 
          `${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content}`
        ).join('\n')}\n`
      }

      // 4. Build conversational RAG prompt
      const ragPrompt = `You are the user's personal journal AI assistant. You have access to their private journal entries and should respond in a warm, supportive, and conversational way - like a close friend who knows them well.

**Context from their journal:**
${contextSources}${conversationContext}

**User's question:** ${query}

**Instructions:**
- Respond naturally and conversationally, like you're chatting with a close friend
- Reference specific details from their journal entries when relevant
- Be supportive, insightful, and encouraging  
- If they mention people (like Abby), acknowledge the relationship warmly
- Ask thoughtful follow-up questions to keep the conversation going
- Use "you" and "your" to make it personal
- If this is a follow-up question, build on the previous conversation naturally
- If the journal context doesn't directly answer their question, still try to be helpful based on what you know about them
- Keep responses focused but conversational (2-4 paragraphs max)

Remember: This is THEIR personal journal, so speak to them like you know their story and care about their journey.`

      console.log(`🧠 [ContentService] Sending to LLM with ${searchResults.length} sources`)

      // 4. Get LLM response
      const llamaService = LlamaService.getInstance()
      const llmResponse = await llamaService.sendMessage([
        {
          role: 'user',
          content: ragPrompt
        }
      ])

      // 5. Prepare sources
      const sources = searchResults.map(result => ({
        file_name: result.file_name,
        file_path: result.file_path,
        snippet: result.content_snippet.replace(/<\/?mark>/g, '')
      }))

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