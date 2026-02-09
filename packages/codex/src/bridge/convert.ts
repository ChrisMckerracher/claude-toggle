import type {
  AnthropicContent,
  AnthropicMessage,
  AnthropicTextContent,
  AnthropicToolSchema,
  CodexInputItem
} from './types.js'
import { generateFunctionCallId } from './id.js'

const TEAMMATE_TOOL_NAMES = new Set([
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'TaskStop',
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
])

// Tiered tool description complexity for token optimization (~5000-7500 token savings)
//
// COMPLEX_TOOLS: Require full parameter descriptions due to:
// - Complex nested structures (e.g., questions[] with options)
// - Enum parameters that aren't obvious from context
// - Complex option interactions that aren't guessable
//
// All other tools get simplified one-line descriptions.
const COMPLEX_TOOLS = new Set([
  'Task',           // subagent_type enum, mode enum, resume vs fresh
  'TaskCreate',     // activeForm must match subject pattern
  'TaskUpdate',     // addBlocks/addBlockedBy array behavior
  'TeamCreate',     // agent_type enum
  'SendMessage',    // type enum changes required fields
])

interface ParsedToolUse {
  text: string
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
}

interface ParsedToolResult {
  tool_use_id: string
  output: string
}

function toCodexContentType(role: 'developer' | 'user' | 'assistant'): 'input_text' | 'output_text' {
  return role === 'assistant' ? 'output_text' : 'input_text'
}

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

function shouldPrioritizeTeammateTools(
  messages: AnthropicMessage[],
  system: string | AnthropicContent[] | undefined,
  teammateTools: string[],
): boolean {
  if (teammateTools.length === 0) {
    return false
  }

  const systemText = system
    ? (typeof system === 'string' ? system : extractTextFromContent(system))
    : ''
  const lastUserText = extractLastUserText(messages)
  const lowerUser = lastUserText.toLowerCase()
  const lowerSystem = systemText.toLowerCase()

  const teammateContext = /\bteammate\b/.test(lowerSystem)
  const explicitTeamToolRequest =
    /\b(use|prefer|prioriti[sz]e)\b.{0,50}\b(team|teammate)\b.{0,20}\btools?\b/.test(lowerUser)
    || teammateTools.some((name) => new RegExp(`\\b${name.toLowerCase()}\\b`).test(lowerUser))

  return teammateContext || explicitTeamToolRequest
}

function generateToolBridgePrompt(
  messages: AnthropicMessage[],
  system: string | AnthropicContent[] | undefined,
  tools?: AnthropicToolSchema[],
): string {
  if (!tools || tools.length === 0) return ""

  const teammateTools = tools
    .map((tool) => tool.name.trim())
    .filter((name) => TEAMMATE_TOOL_NAMES.has(name))

  const prioritizeTeammates = shouldPrioritizeTeammateTools(messages, system, teammateTools)

  const teammateGuidance = prioritizeTeammates
    ? `
TEAMMATE TOOL PRIORITY:
- Prefer teammate workflow tools before spawning generic subagents.
- If one of these tools can satisfy the request, use it first: ${teammateTools.map((name) => `\`${name}\``).join(', ')}
- Do NOT use spawn/subagent tools as a first choice when teammate tools can do the job.

SUBAGENT VS TEAMMATE (Task tool):
- Subagent (one-off): Task({ subagent_type, description }) → Agent ID: "{type}-{random}"
- Teammate (team member): Task({ subagent_type, name, team_name, prompt }) → Agent ID: "{name}@{team_name}"
- Teammates coordinate via shared task list; subagents are independent helpers.`
    : ''

  const toolDescriptions = tools.map((tool) => {
    const toolName = tool.name.trim()

    // Complex tools get full parameter descriptions
    if (COMPLEX_TOOLS.has(toolName)) {
      const params = tool.input_schema?.properties || {}
      const paramList = Object.keys(params).map((key) => {
        const parameter = params[key]!
        return `- \`${key}\` (${parameter.type || "any"}): ${parameter.description || ""}`
      }).join("\n    ")

      return `\`${tool.name}\`: ${tool.description}\n    Parameters:\n    ${paramList || "None"}`
    }

    // Simple tools get one-line description
    const shortDesc = (tool.description || '').split('.')[0] + '.'
    return `- \`${tool.name}\`: ${shortDesc}`
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
- If a tool is applicable, NEVER answer in plain text
- Do NOT output code fences with any other language (for example: \`python\`, \`json\`, \`markdown\`)
- A plain-text answer when a tool should be used will be treated as invalid and retried
${teammateGuidance}

# Available Tools

${toolDescriptions}`
}

function extractTextFromContent(content: AnthropicContent[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      const text = extractTextValue(block.text)
      if (text) {
        parts.push(text)
      }
    }
  }

  return parts.join('\n')
}

function parseToolUseFromContent(content: AnthropicContent[]): ParsedToolUse {
  const textParts: string[] = []
  const toolCalls: ParsedToolUse['toolCalls'] = []

  for (const block of content) {
    if (block.type === 'text') {
      const text = extractTextValue(block.text)
      if (text) {
        textParts.push(text)
      }
      continue
    }

    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input || {}
      })
    }
  }

  return {
    text: textParts.join('\n'),
    toolCalls
  }
}

function parseToolResultFromContent(content: AnthropicContent[]): ParsedToolResult[] {
  const toolResults: ParsedToolResult[] = []

  for (const block of content) {
    if (block.type !== 'tool_result') {
      continue
    }

    toolResults.push({
      tool_use_id: block.tool_use_id,
      output: stringifyToolResultContent(block.content)
    })
  }

  return toolResults
}

function stringifyToolResultContent(content: string | Array<AnthropicTextContent> | undefined): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

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

function pushTextMessage(input: CodexInputItem[], role: 'developer' | 'user' | 'assistant', text: string): void {
  input.push({
    type: 'message',
    role,
    content: [{ type: toCodexContentType(role), text }]
  })
}

function hasToolCallsInHistory(messages: AnthropicMessage[]): boolean {
  return messages.some(msg => {
    if (msg.role !== 'assistant') return false
    if (typeof msg.content === 'string') return false
    return Array.isArray(msg.content) &&
      msg.content.some(block => block.type === 'tool_use')
  })
}

function pushSystemContext(
  input: CodexInputItem[],
  messages: AnthropicMessage[],
  system: string | AnthropicContent[] | undefined,
  tools: AnthropicToolSchema[] | undefined,
  skipToolBridge: boolean = false
): void {
  if (system) {
    const systemText = typeof system === 'string' ? system : extractTextFromContent(system)
    pushTextMessage(input, 'developer', systemText)
  }

  // Skip tool bridge if:
  // 1. Explicitly requested (for retries)
  // 2. Tool calls already exist in conversation history (model has seen the bridge)
  const shouldSkipToolBridge = skipToolBridge || hasToolCallsInHistory(messages)

  if (!shouldSkipToolBridge) {
    const toolBridge = generateToolBridgePrompt(messages, system, tools)
    if (toolBridge) {
      pushTextMessage(input, 'developer', toolBridge)
    }
  }
}

function mapToolCallId(toolCallId: string, idMap: Map<string, string>): string {
  if (toolCallId.startsWith('fc_')) {
    return toolCallId
  }

  const existing = idMap.get(toolCallId)
  if (existing) {
    return existing
  }

  const mapped = generateFunctionCallId()
  idMap.set(toolCallId, mapped)
  return mapped
}

function convertAssistantContentToCodexInput(
  content: AnthropicContent[],
  input: CodexInputItem[],
  idMap: Map<string, string>
): void {
  const { text, toolCalls } = parseToolUseFromContent(content)
  if (text || toolCalls.length === 0) {
    pushTextMessage(input, 'assistant', text || '')
  }

  for (const toolCall of toolCalls) {
    const codexId = mapToolCallId(toolCall.id, idMap)
    input.push({
      type: 'function_call',
      id: codexId,
      call_id: codexId,
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.input)
    })
  }
}

function convertUserContentToCodexInput(
  content: AnthropicContent[],
  input: CodexInputItem[],
  idMap: Map<string, string>
): void {
  const functionOutputs = parseToolResultFromContent(content)
  for (const output of functionOutputs) {
    const codexCallId = idMap.get(output.tool_use_id) || output.tool_use_id
    input.push({
      type: 'function_call_output',
      call_id: codexCallId,
      output: output.output
    })
  }

  const text = extractTextFromContent(content)
  if (text) {
    pushTextMessage(input, 'user', text)
  }
}

export interface AnthropicToCodexInputOptions {
  /** Skip the tool bridge prompt. Useful for retries where it's already in conversation history. */
  skipToolBridge?: boolean
}

export function anthropicToCodexInput(
  messages: AnthropicMessage[],
  system?: string | AnthropicContent[],
  tools?: AnthropicToolSchema[],
  options?: AnthropicToCodexInputOptions
): CodexInputItem[] {
  const input: CodexInputItem[] = []
  const idMap = new Map<string, string>()

  pushSystemContext(input, messages, system, tools, options?.skipToolBridge)

  for (const message of messages) {
    const role: 'assistant' | 'user' = message.role === 'assistant' ? 'assistant' : 'user'
    const { content } = message

    if (typeof content === 'string') {
      pushTextMessage(input, role, content)
      continue
    }

    if (!Array.isArray(content)) {
      continue
    }

    if (role === 'assistant') {
      convertAssistantContentToCodexInput(content, input, idMap)
      continue
    }

    convertUserContentToCodexInput(content, input, idMap)
  }

  return input
}
