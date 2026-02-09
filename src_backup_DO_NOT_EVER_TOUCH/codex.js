/**
 * ChatGPT/Codex API Client - Prompt-based tool calling
 */

import crypto from 'crypto'
import { writeFile, mkdir } from 'node:fs/promises'

// Ensure debug directory exists
await mkdir('/tmp/codex-debug', { recursive: true })

// Debug log function - appends to main log
async function debugLog(label, data) {
  await writeFile('/tmp/codex-debug.log', `${new Date().toISOString()} ${label}: ${JSON.stringify(data, null, 2)}\n\n`, { flag: 'a' })
}

// Save latest input/output for quick debugging access
async function saveLatest(type, data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  await writeFile(`/tmp/codex-debug/${type}-${timestamp}.json`, JSON.stringify(data, null, 2))
  // Also update the "latest" symlink/file
  await writeFile(`/tmp/codex-debug/${type}-latest.json`, JSON.stringify(data, null, 2))
}

const API_BASE = "https://chatgpt.com/backend-api"
const CODEX_ENDPOINT = "/codex/responses"

export async function getCodexInstructions() {
  return ""
}

export function normalizeModel(model) {
  return "gpt-5.2-codex"
}

export function getReasoningConfig(model) {
  return { effort: "high", summary: "auto" }
}

/**
 * Generate a tool-calling bridge prompt
 * This tells the LLM how to request tool calls when it needs them
 */
function generateToolBridgePrompt(tools) {
  if (!tools || tools.length === 0) return ""

  // Build tool descriptions
  const toolDescriptions = tools.map(tool => {
    const params = tool.input_schema?.properties || {}
    const paramList = Object.keys(params).map(key => {
      const p = params[key]
      return `- \`${key}\` (${p.type || "any"}): ${p.description || ""}`
    }).join("\n    ")

    return `\`${tool.name}\`: ${tool.description}\n    Parameters:\n    ${paramList || "None"}`
  }).join("\n\n")

  return `# Tool Calling Instructions

You MUST use tools when available. To call a tool, respond with a code block with language "tool_call" containing JSON:

${'```'}tool_call
{
  "name": "tool_name",
  "input": {
    "param1": "value1"
  }
}
${'```'}

CRITICAL RULES:
- ALL tool calls must use the exact format above
- The code block language must be "tool_call" (with underscore)
- Do NOT include any text before or after the tool call block
- If calling multiple tools, put each in a separate code block
- Only respond with plain text if no tools are applicable

# Available Tools

${toolDescriptions}`
}

/**
 * Extract text from content blocks
 */
function extractTextFromContent(content) {
  const parts = []
  for (const c of content) {
    if (c.type === "text") {
      const t = c.text
      if (typeof t === "string") {
        parts.push(t)
      } else if (Array.isArray(t)) {
        for (const nested of t) {
          if (typeof nested === "string") {
            parts.push(nested)
          } else if (nested?.text) {
            parts.push(nested.text)
          }
        }
      }
    }
  }
  return parts.join("\n")
}

/**
 * Parse tool_use blocks from assistant messages
 * Returns: { text, toolCalls: [] }
 */
function parseToolUseFromContent(content) {
  if (!Array.isArray(content)) {
    return { text: typeof content === "string" ? content : "", toolCalls: [] }
  }

  const textParts = []
  const toolCalls = []

  for (const c of content) {
    if (c.type === "text") {
      textParts.push(c.text)
    } else if (c.type === "tool_use") {
      toolCalls.push({
        id: c.id,
        name: c.name,
        input: c.input || {}
      })
    }
  }

  return {
    text: textParts.join("\n"),
    toolCalls
  }
}

/**
 * Parse tool_result blocks from user messages
 */
function parseToolResultFromContent(content) {
  if (!Array.isArray(content)) return []

  const toolResults = []
  let textContent = ""

  for (const c of content) {
    if (c.type === "tool_result") {
      toolResults.push({
        tool_use_id: c.tool_use_id,
        content: c.content
      })
    } else if (c.type === "text") {
      textContent += c.text
    }
  }

  // Return with tool_use_id preserved for later mapping
  return toolResults.map(tr => ({
    tool_use_id: tr.tool_use_id,
    content: tr.content,
    output: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content)
  }))
}

/**
 * Convert Anthropic messages to Codex input format
 * Handles: regular messages, tool_use, tool_result
 */
export function anthropicToCodexInput(messages, system, tools) {
  const input = []

  // Map Anthropic tool_use IDs to Codex function_call IDs
  // Codex expects IDs starting with "fc_" (function call)
  const idMap = new Map()

  // Add system message if present
  if (system) {
    const systemText = typeof system === 'string' ? system : extractTextFromContent(system)
    input.push({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: systemText }]
    })
  }

  // Add tool bridge prompt if tools exist
  const toolBridge = generateToolBridgePrompt(tools)
  if (toolBridge) {
    input.push({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: toolBridge }]
    })
  }

  // Convert messages
  for (const msg of messages) {
    const role = msg.role === "assistant" ? "assistant" : "user"
    const content = msg.content

    // String content
    if (typeof content === "string") {
      const contentType = role === "assistant" ? "output_text" : "input_text"
      input.push({
        type: "message",
        role,
        content: [{ type: contentType, text: content }]
      })
      continue
    }

    if (!Array.isArray(content)) continue

    // Assistant with tool_use
    if (role === "assistant") {
      const { text, toolCalls } = parseToolUseFromContent(content)

      // Add assistant message (even if empty text, to maintain order)
      input.push({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: text || "" }]
      })

      // Add function_call items immediately after the message
      for (const tc of toolCalls) {
        // If the tool_use already has an fc_ ID (from our previous response), use it directly
        // Otherwise, generate a new fc_ ID and map the old ID to it
        let codexId
        if (tc.id.startsWith('fc_')) {
          codexId = tc.id
        } else {
          codexId = 'fc_' + crypto.randomUUID().replace(/-/g, '').substring(0, 24)
          idMap.set(tc.id, codexId)
        }

        input.push({
          type: "function_call",
          id: codexId,
          call_id: codexId,  // Codex API requires both id and call_id
          name: tc.name,
          arguments: JSON.stringify(tc.input)
        })
      }
      continue
    }

    // User with tool_result
    if (role === "user") {
      const functionOutputs = parseToolResultFromContent(content)

      // Add function_call_output items first with mapped call_id
      for (const fo of functionOutputs) {
        const codexCallId = idMap.get(fo.tool_use_id) || fo.tool_use_id
        input.push({
          type: "function_call_output",
          call_id: codexCallId,
          output: fo.output
        })
      }

      // Then any text content
      const text = extractTextFromContent(content.filter(c => c.type === "text"))
      if (text) {
        input.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }]
        })
      }
      continue
    }

    // Regular text content
    const text = extractTextFromContent(content)
    if (text) {
      const contentType = role === "assistant" ? "output_text" : "input_text"
      input.push({
        type: "message",
        role,
        content: [{ type: contentType, text }]
      })
    }
  }

  return input
}

export async function callCodexAPI(accessToken, accountId, request) {
  const model = normalizeModel(request.model)
  const instructions = await getCodexInstructions()
  const reasoning = getReasoningConfig(model)

  // Convert messages (handles tools internally via prompt)
  const input = anthropicToCodexInput(request.messages, request.system, request.tools)

  await debugLog('INPUT_TO_CODEX', { input, hasTools: !!request.tools })

  const codexRequest = {
    model,
    stream: true,
    store: false,
    instructions,
    input,
    reasoning,
    text: { verbosity: "medium" },
    include: ["reasoning.encrypted_content"]
  }

  await debugLog('FULL_CODEX_REQUEST', codexRequest)

  const response = await fetch(API_BASE + CODEX_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + accessToken,
      "chatgpt-account-id": accountId,
      "OpenAI-Beta": "responses=experimental",
      "originator": "codex_cli_rs",
      "accept": "text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(codexRequest)
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error("Codex API error: " + response.status + " " + text)
  }

  return response
}

export async function* parseSSE(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      let i = 0
      while (i < lines.length) {
        const line = lines[i]
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim()
          if (data) {
            try {
              const event = JSON.parse(data)
              yield event
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
        i++
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Parse tool_call blocks from LLM text response
 * Format: code blocks with language "tool_call" containing JSON
 */
async function parseToolCallsFromText(text) {
  const toolCalls = []

  // Match tool_call code blocks
  // Format: ```tool_call\n{...}\n```
  const TICK = String.fromCharCode(96)
  const parts = text.split(TICK + TICK + TICK)

  await debugLog('PARSE_PARTS', { partsCount: parts.length, parts: parts.map((p, i) => ({ i, preview: p.slice(0, 100) })) })

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    // Each part between ``` markers may contain: LANG\ncode
    // First line is the language, rest is the code
    const newlineIdx = part.indexOf('\n')
    if (newlineIdx === -1) continue

    const lang = part.slice(0, newlineIdx).trim()
    const codeBlock = part.slice(newlineIdx + 1)

    if (lang === 'tool_call') {
      try {
        const toolCall = JSON.parse(codeBlock.trim())
        // Generate fc_ prefixed ID for Codex (will be converted to tool_use with this ID)
        const id = 'fc_' + crypto.randomUUID().replace(/-/g, '').substring(0, 24)
        toolCalls.push({
          id,
          name: toolCall.name,
          input: toolCall.input || toolCall.arguments || {}
        })
      } catch (e) {
        await debugLog('PARSE_ERROR', { error: e.message, codeBlock: codeBlock.slice(0, 200) })
      }
    }
  }

  await debugLog('PARSED_TOOL_CALLS', { count: toolCalls.length, toolCalls })

  return toolCalls
}

/**
 * Collect response and convert to Anthropic format
 * Handles both text and tool_use (parsed from text)
 */
export async function collectResponse(stream, debug = false) {
  let fullText = ""
  let id = `msg_${crypto.randomUUID()}`
  let model = null
  let eventCount = 0

  for await (const event of parseSSE(stream)) {
    eventCount++

    if (debug) {
      console.error('[DEBUG event]', event.type)
    }

    if (event.type === "response.output_text.delta") {
      fullText += event.delta || ""
    }

    if (event.type === "response.completed") {
      model = event.response?.model
    }
  }

  // Try to parse tool calls from the text
  await debugLog('RAW_RESPONSE_TEXT', { text: fullText })
  const toolCalls = await parseToolCallsFromText(fullText)

  if (debug) {
    console.error('[DEBUG] Total events:', eventCount, 'Text length:', fullText.length, 'Tool calls found:', toolCalls.length)
  }

  // If tool calls were found, return tool_use format
  if (toolCalls.length > 0) {
    // Remove the tool_call blocks from text
    const cleanText = fullText.replace(new RegExp('```tool_call\\n[\\s\\S]*?```', 'g'), "").trim()

    const content = []

    if (cleanText) {
      content.push({ type: "text", text: cleanText })
    }

    for (const tc of toolCalls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input
      })
    }

    // Calculate approximate token usage (rough estimation)
    const inputTokens = Math.ceil(fullText.length / 4)
    const outputTokens = Math.ceil((cleanText.length + JSON.stringify(toolCalls).length) / 4)

    return {
      id,
      type: "message",
      role: "assistant",
      model: model || "gpt-5.2-codex",
      content,
      stop_reason: "tool_use",
      // Add usage field - Claude Code may require this
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
      }
    }
  }

  // Regular text response
  const inputTokens = Math.ceil(fullText.length / 4)
  const outputTokens = Math.ceil(fullText.length / 4)

  return {
    id,
    type: "message",
    role: "assistant",
    model: model || "gpt-5.2-codex",
    content: [{ type: "text", text: fullText }],
    stop_reason: "end_turn",
    // Add usage field for consistency
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  }
}
