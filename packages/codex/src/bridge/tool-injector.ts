import type { AnthropicToolSchema } from './types.js'

interface ToolInjectionRequest {
  userRequest: string
  modelResponse: string
  availableTools: AnthropicToolSchema[]
  model?: string
}

interface ToolInjectionResult {
  shouldCallTool: boolean
  toolCall?: {
    name: string
    input: Record<string, unknown>
  }
  error?: string
}

interface OllamaGenerateResponse {
  response: string
  model: string
  done: boolean
}

interface OllamaModelsResponse {
  models: Array<{ name: string }>
}

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b'

/**
 * Inject a tool call using a local lightweight LLM.
 * Used when the main model fails to call a tool but should have.
 */
export async function injectToolCall(request: ToolInjectionRequest): Promise<ToolInjectionResult> {
  const { userRequest, modelResponse, availableTools, model = DEFAULT_MODEL } = request

  const toolList = availableTools.map(t => {
    const shortDesc = (t.description || '').split('.')[0]
    const params = Object.keys(t.input_schema?.properties || {})
    return `- \`${t.name}\` (${params.length > 0 ? `params: ${params.join(', ')}` : 'no params'}): ${shortDesc}`
  }).join('\n')

  const systemPrompt = `You are a tool selection assistant. Your job is to determine if a tool should be called based on a user request and an AI response.

Available tools:
${toolList}

Respond ONLY with valid JSON. Two options:
1. If no tool is needed: {"shouldCallTool": false}
2. If a tool is needed: {"shouldCallTool": true, "toolCall": {"name": "tool_name", "input": {...}}}

Important:
- Be conservative - only call a tool if it's clearly needed
- Use exact tool names from the list above
- For input parameters, extract from the user request and AI response
- If you're unsure, set shouldCallTool to false`

  const userPrompt = `User request: ${userRequest}

AI response: ${modelResponse}

Should a tool be called? If so, which one and with what parameters? Respond with JSON only.`

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10 second timeout for tool injection
      body: JSON.stringify({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1, // Low temperature for consistent tool selection
          num_ctx: 2048,    // Context window
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as OllamaGenerateResponse
    const result = JSON.parse(data.response)

    // Validate result structure
    if (typeof result.shouldCallTool !== 'boolean') {
      throw new Error('Invalid response: shouldCallTool must be a boolean')
    }

    if (result.shouldCallTool && result.toolCall) {
      if (!result.toolCall.name || typeof result.toolCall.name !== 'string') {
        throw new Error('Invalid response: toolCall.name is required')
      }

      // Verify tool exists
      const toolExists = availableTools.some(t => t.name === result.toolCall.name)
      if (!toolExists) {
        throw new Error(`Unknown tool: ${result.toolCall.name}`)
      }

      return {
        shouldCallTool: true,
        toolCall: {
          name: result.toolCall.name,
          input: result.toolCall.input || {}
        }
      }
    }

    return { shouldCallTool: false }

  } catch (error) {
    return {
      shouldCallTool: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

// Cache availability check for 30 seconds
let cachedAvailability: boolean | null = null
let cacheExpiry = 0

/**
 * Check if the Ollama service is available (cached for 30s).
 */
export async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now()
  if (cachedAvailability !== null && now < cacheExpiry) {
    return cachedAvailability
  }

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(500) // 500ms timeout - quick check
    })
    cachedAvailability = response.ok
    cacheExpiry = now + 30000 // 30 second cache
    return cachedAvailability
  } catch {
    cachedAvailability = false
    cacheExpiry = now + 30000
    return false
  }
}

/**
 * Get list of available models from Ollama.
 */
export async function getAvailableModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`)
    if (!response.ok) return []

    const data = await response.json() as OllamaModelsResponse
    return data.models?.map((m) => m.name) || []
  } catch {
    return []
  }
}
