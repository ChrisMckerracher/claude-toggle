import type {
  AnthropicContent,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicResponse,
  AnthropicToolUseContent,
  AnthropicTextContent,
  AnthropicToolSchema
} from './types.js'

const TOOL_ACTION_PATTERN = /\b(read|open|search|find|grep|glob|scan|inspect|analy[sz]e|summari[sz]e|list|run|execute|call|use|invoke)\b/i
const TOOL_CONTEXT_PATTERN = /\b(file|files|folder|directory|path|repo|repository|project|command|tool|code)\b/i
const USE_TOOL_PATTERN = /\b(use|call|invoke|run)\b.{0,40}\btool\b/i
const FILE_OPERATION_PATTERN = /\b(read|open|cat|summari[sz]e|inspect|search|grep|find)\b/i
const PATH_LIKE_PATTERN = /(?:\.{0,2}\/|\/)?[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,12}\b/i
const TEAMMATE_TOOL_NAMES = new Set([
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'TaskStop',
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
])

function extractTextValue(value: AnthropicTextContent['text']): string {
  if (typeof value === 'string') {
    return value
  }

  const parts: string[] = []
  for (const nested of value) {
    if (typeof nested === 'string') {
      parts.push(nested)
      continue
    }

    if (nested?.text) {
      parts.push(nested.text)
    }
  }

  return parts.join('\n')
}

function extractTextFromContent(content: AnthropicContent[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type !== 'text') {
      continue
    }

    const text = extractTextValue(block.text)
    if (text) {
      parts.push(text)
    }
  }

  return parts.join('\n')
}

function extractLastUserText(messages: AnthropicMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'user') {
      continue
    }

    if (typeof message.content === 'string') {
      return message.content
    }

    if (Array.isArray(message.content)) {
      return extractTextFromContent(message.content)
    }
  }

  return ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionsToolByName(text: string, tools: AnthropicToolSchema[]): boolean {
  const lowered = text.toLowerCase()

  for (const tool of tools) {
    const name = tool.name.trim().toLowerCase()
    if (!name) {
      continue
    }

    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i')
    if (pattern.test(lowered)) {
      return true
    }
  }

  return false
}

function isObviousToolIntent(request: AnthropicRequest): boolean {
  if (!request.tools || request.tools.length === 0) {
    return false
  }

  const lastUserText = extractLastUserText(request.messages).trim()
  if (!lastUserText) {
    return false
  }

  if (mentionsToolByName(lastUserText, request.tools)) {
    return true
  }

  if (USE_TOOL_PATTERN.test(lastUserText)) {
    return true
  }

  if (FILE_OPERATION_PATTERN.test(lastUserText) && PATH_LIKE_PATTERN.test(lastUserText)) {
    return true
  }

  return TOOL_ACTION_PATTERN.test(lastUserText) && TOOL_CONTEXT_PATTERN.test(lastUserText)
}

function hasToolNamed(request: AnthropicRequest, name: string): boolean {
  return (request.tools || []).some((tool) => tool.name.trim() === name)
}

function isSpawnStyleTool(tool: AnthropicToolSchema): boolean {
  const name = tool.name.trim()
  if (name === 'Task') {
    return true
  }

  const details = `${name} ${tool.description || ''}`.toLowerCase()
  if (/\b(spawn|subagent)\b/.test(details)) {
    return true
  }

  return details.includes('launch a new agent')
}

function getSpawnStyleToolNames(request: AnthropicRequest): Set<string> {
  return new Set((request.tools || [])
    .filter((tool) => isSpawnStyleTool(tool))
    .map((tool) => tool.name.trim()))
}

function getConfiguredTeammateToolNames(request: AnthropicRequest): string[] {
  return (request.tools || [])
    .map((tool) => tool.name.trim())
    .filter((name) => TEAMMATE_TOOL_NAMES.has(name))
}

function userExplicitlyRequestsTeammateTools(request: AnthropicRequest): boolean {
  const text = extractLastUserText(request.messages).toLowerCase()
  if (!text) {
    return false
  }

  if (/\b(use|prefer|prioriti[sz]e)\b.{0,50}\b(team|teammate)\b.{0,20}\btools?\b/.test(text)) {
    return true
  }

  const teammateTools = getConfiguredTeammateToolNames(request).map((name) => name.toLowerCase())
  return teammateTools.some((name) => text.includes(name.toLowerCase()))
}

function isTeammateContext(request: AnthropicRequest): boolean {
  const systemText = systemToText(request.system).toLowerCase()
  return /\bteammate\b/.test(systemText)
}

function shouldPrioritizeTeammateTools(request: AnthropicRequest): boolean {
  if (getConfiguredTeammateToolNames(request).length === 0) {
    return false
  }

  return isTeammateContext(request) || userExplicitlyRequestsTeammateTools(request)
}

function responseUsesSubagentTool(request: AnthropicRequest, response: AnthropicResponse): boolean {
  if (response.stop_reason !== 'tool_use') {
    return false
  }

  const spawnStyleToolNames = getSpawnStyleToolNames(request)
  if (spawnStyleToolNames.size === 0) {
    return false
  }

  for (const block of response.content) {
    if (block.type !== 'tool_use') {
      continue
    }

    const name = (block as AnthropicToolUseContent).name
    if (spawnStyleToolNames.has(name)) {
      return true
    }
  }

  return false
}

function userExplicitlyRequestsTask(request: AnthropicRequest): boolean {
  const text = extractLastUserText(request.messages).toLowerCase()
  if (!text) {
    return false
  }

  return /\bsubagent\b/.test(text)
    || /\bspawn\b.{0,40}\bagent\b/.test(text)
    || /\buse\b.{0,40}\btask\b/.test(text)
}

function textResponsePreview(response: AnthropicResponse): string {
  if (response.stop_reason !== 'end_turn') {
    return ''
  }

  const first = response.content[0]
  if (!first || first.type !== 'text') {
    return ''
  }

  const collapsed = extractTextValue(first.text).replace(/\s+/g, ' ').trim()
  return collapsed.slice(0, 220)
}

function systemToText(system: AnthropicRequest['system']): string {
  if (!system) {
    return ''
  }

  return typeof system === 'string' ? system : extractTextFromContent(system)
}

function buildRetryInstruction(_request: AnthropicRequest, response: AnthropicResponse, strict: boolean): string {
  const preview = textResponsePreview(response)

  // Condensed retry prompt - the tool bridge with format rules is already in conversation history,
  // so we only need to prompt the model to actually call a tool.
  // This saves ~100-150 tokens compared to the previous verbose retry prompt.
  if (strict) {
    return preview
      ? `You must call a tool. Your previous response "${preview.slice(0, 80)}..." was rejected.`
      : `You must call a tool. Do not respond with plain text.`
  }

  return `Consider calling a tool if any are available for this request.`
}

export function shouldRetryToolCallMiss(request: AnthropicRequest, response: AnthropicResponse): boolean {
  if (!request.tools || request.tools.length === 0) {
    return false
  }

  if (response.stop_reason === 'tool_use') {
    return false
  }

  return isObviousToolIntent(request)
}

export function shouldRetryTaskOverTeammate(request: AnthropicRequest, response: AnthropicResponse): boolean {
  if (!request.tools || request.tools.length === 0) {
    return false
  }

  if (!shouldPrioritizeTeammateTools(request)) {
    return false
  }

  const teammateTools = getConfiguredTeammateToolNames(request)
  if (teammateTools.length === 0) {
    return false
  }

  const hasSpawnStyleTools = hasToolNamed(request, 'Task')
    || getSpawnStyleToolNames(request).size > 0
  if (!hasSpawnStyleTools) {
    return false
  }

  if (!responseUsesSubagentTool(request, response)) {
    return false
  }

  if (userExplicitlyRequestsTask(request)) {
    return false
  }

  return true
}

export function buildToolRetryRequest(request: AnthropicRequest, response: AnthropicResponse): AnthropicRequest {
  const strict = isObviousToolIntent(request)
  const retryInstruction = buildRetryInstruction(request, response, strict)
  const baseSystem = systemToText(request.system)

  return {
    ...request,
    system: baseSystem ? `${baseSystem}\n\n${retryInstruction}` : retryInstruction
  }
}

export function buildTeammatePriorityRetryRequest(request: AnthropicRequest, response: AnthropicResponse): AnthropicRequest {
  const teammateTools = getConfiguredTeammateToolNames(request)
  const teammateInstruction = `Use teammate tools first: ${teammateTools.map((name) => `\`${name}\``).join(', ')}. Do not use spawn/subagent tools unless explicitly requested.`

  const base = buildToolRetryRequest(request, response)
  const baseSystem = systemToText(base.system)

  return {
    ...base,
    system: baseSystem ? `${baseSystem}\n\n${teammateInstruction}` : teammateInstruction
  }
}

/**
 * Extract the user request text from messages for tool injection.
 * Looks for the last meaningful user message, skipping system/template prompts.
 */
export function extractUserRequestForInjection(messages: AnthropicMessage[]): string {
  // Patterns that indicate non-user-intent messages
  const skipPatterns = [
    /\[SUGGESTION MODE/i,
    /\[system-reminder/i,
    /^You are (Claude|an AI)/i,
    /Analyze if this message/i,
  ]

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg.role !== 'user') continue

    let text = ''
    if (typeof msg.content === 'string') {
      text = msg.content
    } else if (Array.isArray(msg.content)) {
      text = extractTextFromContent(msg.content)
    }

    // Skip if it looks like a system/template message
    const isSkipMessage = skipPatterns.some(pattern => pattern.test(text.slice(0, 200)))
    if (!isSkipMessage && text.trim().length > 0) {
      return text.trim()
    }
  }
  return ''
}

/**
 * Build a synthetic tool use response by injecting a tool call into a text response.
 * Used when local LLM determines a tool should be called.
 */
export function buildInjectedToolCallResponse(
  _request: AnthropicRequest,
  textResponse: AnthropicResponse,
  toolCall: { name: string; input: Record<string, unknown> },
  generateId: () => string
): AnthropicResponse {
  // Preserve any text content that came before the tool call should happen
  const textBlocks = textResponse.content.filter((b) => b.type === 'text')
  const existingText = textBlocks
    .map((block) => extractTextValue((block as AnthropicTextContent).text))
    .join('\n')

  return {
    id: textResponse.id,
    type: 'message',
    role: 'assistant',
    content: [
      // Keep the original text if it exists
      ...(existingText ? [{ type: 'text' as const, text: existingText }] : []),
      // Add the injected tool call
      {
        type: 'tool_use',
        id: generateId(),
        name: toolCall.name,
        input: toolCall.input
      }
    ],
    model: textResponse.model,
    stop_reason: 'tool_use',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0
    }
  }
}
