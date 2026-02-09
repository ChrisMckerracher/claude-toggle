/**
 * FULL TOOL DESCRIPTIONS (BACKUP)
 *
 * This file contains the original verbose tool description format that includes
 * all parameter names, types, and descriptions for each tool.
 *
 * This format uses ~200-300 tokens PER TOOL but ensures the model has complete
 * information about all parameters.
 *
 * Kept for reference and potential rollback if simplified format causes issues.
 */

import type {
  AnthropicMessage,
  AnthropicContent,
  AnthropicToolSchema,
} from './types.js'

const TEAMMATE_TOOL_NAMES = new Set([
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'TaskStop',
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
])

function extractTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  const parts: string[] = []
  for (const nested of value as Array<{ text?: string } | string>) {
    if (typeof nested === 'string') {
      parts.push(nested)
      continue
    }

    if (nested?.text) {
      parts.push((nested as { text: string }).text)
    }
  }

  return parts.join('\n')
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

/**
 * Generate the FULL verbose tool bridge prompt with complete parameter descriptions.
 * ~200-300 tokens per tool.
 *
 * @deprecated Use generateToolBridgePrompt from convert.ts for simplified format.
 * This is kept for backup and reference.
 */
export function generateFullToolBridgePrompt(
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
- Do NOT use spawn/subagent tools as a first choice when teammate tools can do the job.`
    : ''

  // FULL format with all parameters
  const toolDescriptions = tools.map((tool) => {
    const params = tool.input_schema?.properties || {}
    const paramList = Object.keys(params).map((key) => {
      const parameter = params[key]!
      return `- \`${key}\` (${parameter.type || "any"}): ${parameter.description || ""}`
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
- If a tool is applicable, NEVER answer in plain text
- Do NOT output code fences with any other language (for example: \`python\`, \`json\`, \`markdown\`)
- A plain-text answer when a tool should be used will be treated as invalid and retried
${teammateGuidance}

# Available Tools

${toolDescriptions}`
}
