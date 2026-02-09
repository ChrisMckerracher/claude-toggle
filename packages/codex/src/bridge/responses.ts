import type {
  AnthropicTextContent,
  AnthropicTextResponse,
  AnthropicToolUseContent,
  AnthropicToolUseResponse,
  AnthropicUsage
} from './types.js'
import type { ParsedToolCallFromText } from './tool-calls.js'

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

function buildUsage(inputText: string, outputText: string): AnthropicUsage {
  const inputTokens = estimateTokenCount(inputText)
  const outputTokens = estimateTokenCount(outputText)
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens
  }
}

export function buildToolUseResponse(
  id: string,
  model: string,
  fullText: string,
  cleanText: string,
  toolCalls: ParsedToolCallFromText[]
): AnthropicToolUseResponse {
  const content: Array<AnthropicTextContent | AnthropicToolUseContent> = []

  if (cleanText) {
    content.push({ type: 'text', text: cleanText })
  }

  for (const toolCall of toolCalls) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input
    })
  }

  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: 'tool_use',
    usage: buildUsage(fullText, cleanText + JSON.stringify(toolCalls))
  }
}

export function buildTextResponse(id: string, model: string, fullText: string): AnthropicTextResponse {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: fullText }],
    stop_reason: 'end_turn',
    usage: buildUsage(fullText, fullText)
  }
}
