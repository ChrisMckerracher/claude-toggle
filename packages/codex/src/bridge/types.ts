export interface AnthropicTextContent {
  type: 'text'
  text: string | Array<string | { text?: string }>
}

export interface AnthropicToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input?: Record<string, unknown>
}

export interface AnthropicToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  content?: string | Array<AnthropicTextContent>
}

export type AnthropicContent = AnthropicTextContent | AnthropicToolUseContent | AnthropicToolResultContent

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContent[]
}

export interface AnthropicToolSchema {
  type?: 'object'
  name: string
  description: string
  input_schema: {
    type?: string
    properties?: Record<string, {
      type?: string
      description?: string
    }>
    required?: string[]
  }
}

export interface AnthropicRequest {
  model: string
  messages: AnthropicMessage[]
  system?: string | AnthropicContent[]
  tools?: AnthropicToolSchema[]
  stream?: boolean
  max_tokens?: number
}

export interface CodexInputText {
  type: 'input_text'
  text: string
}

export interface CodexOutputText {
  type: 'output_text'
  text: string
}

export type CodexContent = CodexInputText | CodexOutputText

export interface CodexMessage {
  type: 'message'
  role: 'developer' | 'user' | 'assistant'
  content: CodexContent[]
}

export interface CodexFunctionCall {
  type: 'function_call'
  id: string
  call_id: string
  name: string
  arguments: string
}

export interface CodexFunctionCallOutput {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type CodexInputItem = CodexMessage | CodexFunctionCall | CodexFunctionCallOutput

export interface CodexRequest {
  model: string
  stream: boolean
  store: boolean
  instructions: string
  input: CodexInputItem[]
  reasoning: {
    effort: string
    summary: string
  }
  text: {
    verbosity: string
  }
  include: string[]
}

export interface CodexResponseCompleted {
  type: 'response.completed'
  response?: {
    model: string
  }
}

export interface CodexOutputTextDelta {
  type: 'response.output_text.delta'
  delta: string
}

export type CodexSSEEvent = CodexResponseCompleted | CodexOutputTextDelta | Record<string, unknown>

export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

export interface AnthropicTextResponse {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: [AnthropicTextContent]
  stop_reason: 'end_turn'
  usage: AnthropicUsage
}

export interface AnthropicToolUseResponse {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: Array<AnthropicTextContent | AnthropicToolUseContent>
  stop_reason: 'tool_use'
  usage: AnthropicUsage
}

export type AnthropicResponse = AnthropicTextResponse | AnthropicToolUseResponse
