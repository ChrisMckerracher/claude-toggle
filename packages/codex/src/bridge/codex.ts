/**
 * ChatGPT/Codex API client orchestration.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { DEFAULT_MODEL, resolveModel } from '../shared/models.js'
import { getConfiguredModel } from '../auth/token-store.js'
import { anthropicToCodexInput } from './convert.js'
import { buildTextResponse, buildToolUseResponse } from './responses.js'
import { parseSSE } from './sse.js'
import {
  buildInjectedToolCallResponse,
  buildTeammatePriorityRetryRequest,
  extractUserRequestForInjection,
  shouldRetryTaskOverTeammate,
  shouldRetryToolCallMiss
} from './tool-retry.js'
import { parseToolCallsFromText, stripToolCallBlocks } from './tool-calls.js'
import { injectToolCall, isOllamaAvailable } from './tool-injector.js'
import type {
  AnthropicRequest,
  AnthropicResponse,
  CodexOutputTextDelta,
  CodexRequest,
  CodexResponseCompleted
} from './types.js'

const DEBUG = process.env.DEBUG_TOOL_INJECTION === '1'
// Test cases directory at project root
const TEST_CASES_DIR = path.resolve(process.cwd(), '../../test_cases/tool_retry_debug')

const API_BASE = 'https://chatgpt.com/backend-api'
const CODEX_ENDPOINT = '/codex/responses'
const TOOL_REPAIR_MODEL = 'gpt-5.1-codex-mini'

/**
 * Debug logging for tool injection - saves test cases
 */
async function debugToolInjection(
  request: AnthropicRequest,
  response: AnthropicResponse,
  stage: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!DEBUG) return

  try {
    await fs.promises.mkdir(TEST_CASES_DIR, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const testId = `${timestamp}_${stage}`
    const testCase = {
      timestamp: new Date().toISOString(),
      stage,
      request: {
        model: request.model,
        system: typeof request.system === 'string' ? request.system.slice(0, 500) + '...' : request.system,
        messages: request.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content.slice(0, 500) : '[complex content]'
        })),
        tools: request.tools?.map(t => ({ name: t.name, description: t.description?.slice(0, 100) }))
      },
      response: {
        id: response.id,
        model: response.model,
        stop_reason: response.stop_reason,
        content: response.content.map(c => {
          if (c.type === 'text') {
            return { type: 'text', text: typeof c.text === 'string' ? c.text.slice(0, 500) + '...' : '[complex]' }
          }
          return { type: c.type, name: (c as any).name }
        })
      },
      ...data
    }

    const filePath = path.join(TEST_CASES_DIR, `${testId}.json`)
    await fs.promises.writeFile(filePath, JSON.stringify(testCase, null, 2))
  } catch (err) {
    console.error('[DEBUG] Failed to write test case:', err)
  }
}

type CodexCallMode = 'default' | 'tool_repair'

export type * from './types.js'
export { anthropicToCodexInput } from './convert.js'
export { parseSSE } from './sse.js'

export async function getCodexInstructions(): Promise<string> {
  return ''
}

export function normalizeModel(model: string, fallbackModel: string = DEFAULT_MODEL): string {
  return resolveModel(model, fallbackModel)
}

export function getReasoningConfig(_model: string, mode: CodexCallMode = 'default'): { effort: string; summary: string } {
  if (mode === 'tool_repair') {
    return { effort: 'low', summary: 'auto' }
  }

  return { effort: 'high', summary: 'auto' }
}

export async function callCodexAPI(
  accessToken: string,
  accountId: string,
  request: AnthropicRequest,
  mode: CodexCallMode = 'default'
): Promise<Response> {
  const configuredModel = await getConfiguredModel()
  const requestedModel = mode === 'tool_repair' ? TOOL_REPAIR_MODEL : request.model
  const model = normalizeModel(requestedModel, configuredModel)
  const instructions = await getCodexInstructions()
  const reasoning = getReasoningConfig(model, mode)

  // Skip tool bridge on retry - it's already in the conversation history from the first request.
  // Additionally, pushSystemContext() automatically skips the bridge if tool calls exist in history.
  //
  // This saves ~5000-7500 tokens per retry, and ~5000-7500 tokens on each conversation turn after tools are used.
  // If this causes issues, remove the skipToolBridge option and the hasToolCallsInHistory check.
  // TODO: Monitor if models struggle with tool format on retry/follow-up requests without the bridge prompt.
  const input = anthropicToCodexInput(
    request.messages,
    request.system,
    request.tools,
    mode === 'tool_repair' ? { skipToolBridge: true } : undefined
  )

  const codexRequest: CodexRequest = {
    model,
    stream: true,
    store: false,
    instructions,
    input,
    reasoning,
    text: { verbosity: 'medium' },
    include: mode === 'tool_repair' ? [] : ['reasoning.encrypted_content']
  }

  const response = await fetch(API_BASE + CODEX_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'chatgpt-account-id': accountId,
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      accept: 'text/event-stream',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(codexRequest)
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Codex API error: ${response.status} ${text}`)
  }

  return response
}

export async function collectResponse(stream: ReadableStream<Uint8Array> | null): Promise<AnthropicResponse> {
  if (!stream) {
    throw new Error('No response stream received')
  }

  let fullText = ''
  let model: string | null = null

  for await (const event of parseSSE(stream)) {
    if ((event as { type?: string }).type === 'response.output_text.delta') {
      fullText += (event as CodexOutputTextDelta).delta || ''
      continue
    }

    if ((event as { type?: string }).type === 'response.completed') {
      model = (event as CodexResponseCompleted).response?.model || null
    }
  }

  const toolCalls = parseToolCallsFromText(fullText)
  const responseId = `msg_${crypto.randomUUID()}`
  const resolvedModel = model || DEFAULT_MODEL

  if (toolCalls.length > 0) {
    const cleanText = stripToolCallBlocks(fullText)
    return buildToolUseResponse(responseId, resolvedModel, fullText, cleanText, toolCalls)
  }

  return buildTextResponse(responseId, resolvedModel, fullText)
}

async function callCodexAndCollect(
  accessToken: string,
  accountId: string,
  request: AnthropicRequest,
  mode: CodexCallMode = 'default'
): Promise<AnthropicResponse> {
  const response = await callCodexAPI(accessToken, accountId, request, mode)
  if (!response.body) {
    throw new Error('No response body received from Codex API')
  }

  return await collectResponse(response.body)
}

export async function callCodexWithToolRetry(
  accessToken: string,
  accountId: string,
  request: AnthropicRequest
): Promise<AnthropicResponse> {
  const firstResponse = await callCodexAndCollect(accessToken, accountId, request, 'default')

  await debugToolInjection(request, firstResponse, '01_initial_response')

  if (shouldRetryTaskOverTeammate(request, firstResponse)) {
    await debugToolInjection(request, firstResponse, '02_task_over_teammate_retry')
    const teammateRetryRequest = buildTeammatePriorityRetryRequest(request, firstResponse)
    return await callCodexAndCollect(accessToken, accountId, teammateRetryRequest, 'tool_repair')
  }

  if (!shouldRetryToolCallMiss(request, firstResponse)) {
    await debugToolInjection(request, firstResponse, 'no_retry_needed')
    return firstResponse
  }

  await debugToolInjection(request, firstResponse, '03_tool_miss_detected')

  // CRITICAL: Don't do tool injection on follow-up requests with tool results
  // Only inject on the initial request where user is asking for something
  const hasToolResults = request.messages.some(msg => {
    if (msg.role !== 'user') return false
    if (typeof msg.content === 'string') return false
    if (!Array.isArray(msg.content)) return false
    return msg.content.some(block => block.type === 'tool_result')
  })

  if (hasToolResults) {
    await debugToolInjection(request, firstResponse, 'skip_followup_with_tool_results')
    return firstResponse
  }

  // Try local LLM tool injection - if it fails, just return the original response
  // We NEVER fall back to expensive API retry for tool call injection
  const ollamaAvailable = await isOllamaAvailable()

  await debugToolInjection(request, firstResponse, '04_ollama_available', {
    ollamaAvailable,
    ollamaUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  })

  if (ollamaAvailable && request.tools) {
    const userRequest = extractUserRequestForInjection(request.messages)
    const textBlocks = firstResponse.content.filter((b) => b.type === 'text')
    const modelResponse = textBlocks
      .map((b) => typeof (b as any).text === 'string' ? (b as any).text : '')
      .join('\n')

    await debugToolInjection(request, firstResponse, '05_before_injection', {
      userRequest: userRequest.slice(0, 200),
      modelResponse: modelResponse.slice(0, 200)
    })

    const injectionResult = await injectToolCall({
      userRequest,
      modelResponse,
      availableTools: request.tools
    })

    await debugToolInjection(request, firstResponse, '06_after_injection', {
      shouldCallTool: injectionResult.shouldCallTool,
      toolCall: injectionResult.toolCall,
      error: injectionResult.error
    })

    if (injectionResult.shouldCallTool && injectionResult.toolCall) {
      // Success - build synthetic response with injected tool call
      const finalResponse = buildInjectedToolCallResponse(
        request,
        firstResponse,
        injectionResult.toolCall,
        () => `toolu_${crypto.randomUUID()}`
      )

      await debugToolInjection(request, finalResponse, '07_injection_success', {
        injectedTool: injectionResult.toolCall
      })

      return finalResponse
    }

    // If tool injection failed or no tool needed, return original response as-is
    await debugToolInjection(request, firstResponse, '08_injection_failed_returning_original', {
      error: injectionResult.error
    })
    return firstResponse
  }

  // Ollama not available - return original response without retry
  await debugToolInjection(request, firstResponse, '09_ollama_unavailable_returning_original')
  return firstResponse
}
