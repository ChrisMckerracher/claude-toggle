/**
 * Anthropic-compatible proxy for ChatGPT/Codex API
 * Runs on localhost only, forwards to ChatGPT backend with OAuth
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { CODEX_PROXY_PORT } from '@codex-proxy/provider-core'
import {
  generatePKCE,
  generateState,
  buildAuthUrl,
  completeAuthCodeExchange,
  setTokens,
  ensureValidTokens,
  getTokens,
  type StoredTokens
} from './auth/oauth.js'
import { renderAuthPage } from './auth/ui.js'
import { callCodexWithToolRetry, type AnthropicRequest } from './bridge/codex.js'
import { SUPPORTED_MODELS } from './shared/models.js'

const fastify: FastifyInstance = Fastify({
  logger: false
})

// Simple in-memory OAuth state storage
const oauthStates = new Map<string, { pkce: { verifier: string }, createdAt: number }>()
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const anthropicRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.unknown()).min(1)
}).passthrough()

// ==================== Type Definitions ====================

interface AuthCallbackQuery {
  code?: string
  state?: string
  error?: string
}

interface AuthStatusResponse {
  authenticated: boolean
  expired?: boolean
}

interface AnthropicErrorResponse {
  type: 'error'
  error: {
    type: string
    message: string
  }
}

interface ModelsResponse {
  data: typeof SUPPORTED_MODELS
  object: 'list'
}

function makeAnthropicError(type: string, message: string): AnthropicErrorResponse {
  return {
    type: "error",
    error: { type, message }
  }
}

function isLocalRequest(request: FastifyRequest): boolean {
  const host = request.headers.host?.split(':')[0]
  const isLocalHostHeader = host === '127.0.0.1' || host === 'localhost'
  const isLocalIp = request.ip === '127.0.0.1' || request.ip === '::1'

  if (!isLocalIp) {
    return false
  }

  return host ? isLocalHostHeader : true
}

function pruneExpiredOAuthStates(): void {
  const now = Date.now()
  for (const [state, value] of oauthStates) {
    if (now - value.createdAt > OAUTH_STATE_TTL_MS) {
      oauthStates.delete(state)
    }
  }
}

// ==================== Health Check ====================

fastify.get('/health', async () => ({ ok: true }))

// ==================== Auth Routes ====================

// Auth: Start login flow
fastify.post('/auth/login', async () => {
  pruneExpiredOAuthStates()
  const pkce = generatePKCE()
  const state = generateState()

  oauthStates.set(state, { pkce, createdAt: Date.now() })

  const url = buildAuthUrl(pkce, state)

  return {
    url,
    instructions: "Open this URL in a browser to authenticate with ChatGPT"
  }
})

// Auth: Handle callback
fastify.get('/auth/callback', async (request: FastifyRequest<{ Querystring: AuthCallbackQuery }>, reply: FastifyReply) => {
  const { code, state, error } = request.query
  pruneExpiredOAuthStates()

  if (error) {
    return reply.type('text/html').send(renderAuthPage('Authentication Failed', error, 'error'))
  }

  if (!state) {
    return reply.type('text/html').send(renderAuthPage('Invalid State', 'The OAuth state is missing.', 'error'))
  }

  const stored = oauthStates.get(state)
  if (!stored) {
    return reply.type('text/html').send(renderAuthPage('Invalid State', 'The OAuth state expired or was invalid.', 'error'))
  }

  if (!code) {
    return reply.type('text/html').send(renderAuthPage('Missing Code', 'The authorization code is missing.', 'error'))
  }

  try {
    const tokens = await completeAuthCodeExchange(code, stored.pkce.verifier)
    await setTokens(tokens)
    oauthStates.delete(state)

    return reply.type('text/html').send(
      renderAuthPage('Authentication Successful', 'You can close this window and return to using the proxy.', 'success')
    )
  } catch (err) {
    const error = err as Error
    return reply.type('text/html').send(renderAuthPage('Token Exchange Failed', error.message, 'error'))
  }
})

// Auth: Check status
fastify.get('/auth/status', async (): Promise<AuthStatusResponse> => {
  const tokens = await getTokens()
  if (!tokens) {
    return { authenticated: false }
  }
  return {
    authenticated: true,
    expired: tokens.expires_at < Date.now()
  }
})

// Auth: Logout
fastify.delete('/auth', async () => {
  await setTokens(null)
  return { ok: true }
})

// ==================== Anthropic-Compatible Messages API ====================

fastify.post('/v1/messages', async (request: FastifyRequest<{ Body: AnthropicRequest }>, reply: FastifyReply) => {
  // Ensure localhost only
  if (!isLocalRequest(request)) {
    return reply.code(403).send(
      makeAnthropicError("permission_error", "This proxy only accepts requests from localhost")
    )
  }

  // Get valid tokens
  const tokens: StoredTokens = await ensureValidTokens()

  // Parse Anthropic request
  const parsedBody = anthropicRequestSchema.safeParse(request.body || {})

  // Validate required fields
  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0]
    const message = issue?.path?.length
      ? `${issue.path.join('.')} ${issue.message}`
      : issue?.message || 'Invalid request payload'
    return reply.code(400).send(
      makeAnthropicError("invalid_request_error", message)
    )
  }
  const body = parsedBody.data as AnthropicRequest

  try {
    const anthropicResponse = await callCodexWithToolRetry(
      tokens.access_token,
      tokens.account_id!,
      body
    )

    return anthropicResponse

  } catch (err) {
    const error = err as Error
    return reply.code(500).send(makeAnthropicError("api_error", error.message))
  }
})

// ==================== Models Endpoint ====================

fastify.get('/v1/models', async (): Promise<ModelsResponse> => ({
  data: SUPPORTED_MODELS,
  object: "list"
}))

// ==================== Start Server ====================

const start = async (): Promise<void> => {
  try {
    await fastify.listen({ port: CODEX_PROXY_PORT, host: '127.0.0.1' })
    console.log(`\n🚀 Codex Proxy running on http://127.0.0.1:${CODEX_PROXY_PORT}`)
    console.log('\n1. First, authenticate:')
    console.log(`   curl -X POST http://127.0.0.1:${CODEX_PROXY_PORT}/auth/login`)
    console.log('\n2. Check status:')
    console.log(`   curl http://127.0.0.1:${CODEX_PROXY_PORT}/auth/status`)
    console.log('\n3. Send messages:')
    console.log(`   curl -X POST http://127.0.0.1:${CODEX_PROXY_PORT}/v1/messages \\`)
    console.log('        -H "Content-Type: application/json" \\')
    console.log('        -d \'{"model":"gpt-5.1-codex","messages":[{"role":"user","content":"hello"}]}\'')
    console.log('')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
