/**
 * Anthropic-compatible proxy for ChatGPT/Codex API
 * Runs on localhost only, forwards to ChatGPT backend with OAuth
 */

import Fastify from 'fastify'
import { generatePKCE, generateState, buildAuthUrl, exchangeCodeForTokens, setTokens, extractAccountId, ensureValidTokens, getTokens } from './auth.js'
import { callCodexAPI, collectResponse } from './codex.js'

const fastify = Fastify({
  logger: false
})

// Simple in-memory OAuth state storage
const oauthStates = new Map()

// Health check
fastify.get('/health', async () => ({ ok: true }))

// Auth: Start login flow
fastify.post('/auth/login', async (request, reply) => {
  const pkce = generatePKCE()
  const state = generateState()

  oauthStates.set(state, { pkce })

  const url = buildAuthUrl(pkce, state)

  return {
    url,
    instructions: "Open this URL in a browser to authenticate with ChatGPT"
  }
})

// Auth: Handle callback
fastify.get('/auth/callback', async (request, reply) => {
  const { code, state, error } = request.query

  if (error) {
    return reply.type('text/html').send(`
      <html><body style="font-family:system-ui;text-align:center;padding:50px;background:#1a1a1a;color:#fff;">
        <h1 style="color:#f87171">Authentication Failed</h1>
        <p>${error}</p>
      </body></html>
    `)
  }

  const stored = oauthStates.get(state)
  if (!stored) {
    return reply.type('text/html').send(`
      <html><body style="font-family:system-ui;text-align:center;padding:50px;background:#1a1a1a;color:#fff;">
        <h1 style="color:#f87171">Invalid State</h1>
        <p>The OAuth state expired or was invalid.</p>
      </body></html>
    `)
  }

  try {
    const tokens = await exchangeCodeForTokens(code, stored.pkce.verifier)
    const accountId = extractAccountId(tokens.access_token)

    tokens.account_id = accountId
    await setTokens(tokens)
    oauthStates.delete(state)

    return reply.type('text/html').send(`
      <html><body style="font-family:system-ui;text-align:center;padding:50px;background:#1a1a1a;color:#fff;">
        <h1 style="color:#4ade80">Authentication Successful</h1>
        <p>You can close this window and return to using the proxy.</p>
      </body></html>
    `)
  } catch (err) {
    return reply.type('text/html').send(`
      <html><body style="font-family:system-ui;text-align:center;padding:50px;background:#1a1a1a;color:#fff;">
        <h1 style="color:#f87171">Token Exchange Failed</h1>
        <p>${err.message}</p>
      </body></html>
    `)
  }
})

// Auth: Check status
fastify.get('/auth/status', async () => {
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

// Anthropic-compatible Messages API
fastify.post('/v1/messages', async (request, reply) => {
  // Ensure localhost only
  const host = request.headers.host
  if (!host?.startsWith('127.0.0.1') && !host?.startsWith('localhost')) {
    return reply.code(403).send({
      type: "error",
      error: { type: "permission_error", message: "This proxy only accepts requests from localhost" }
    })
  }

  // Get valid tokens
  const tokens = await ensureValidTokens()

  // Parse Anthropic request
  const body = request.body || {}

  // Validate required fields
  if (!body.messages || !Array.isArray(body.messages)) {
    return reply.code(400).send({
      type: "error",
      error: { type: "invalid_request_error", message: "messages array is required" }
    })
  }

  try {
    // Call Codex API
    const response = await callCodexAPI(
      tokens.access_token,
      tokens.account_id,
      body
    )

    // Collect and convert response
    const anthropicResponse = await collectResponse(response.body, true)

    return anthropicResponse

  } catch (err) {
    return reply.code(500).send({
      type: "error",
      error: { type: "api_error", message: err.message }
    })
  }
})

// Models endpoint
fastify.get('/v1/models', async () => ({
  data: [
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", type: "model" },
    { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", type: "model" },
    { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", type: "model" },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", type: "model" },
    { id: "gpt-5.2", name: "GPT-5.2", type: "model" },
    { id: "gpt-5.1", name: "GPT-5.1", type: "model" }
  ],
  object: "list"
}))

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 4096, host: '127.0.0.1' })
    console.log('\n🚀 Codex Proxy running on http://127.0.0.1:4096')
    console.log('\n1. First, authenticate:')
    console.log('   curl -X POST http://127.0.0.1:4096/auth/login')
    console.log('\n2. Check status:')
    console.log('   curl http://127.0.0.1:4096/auth/status')
    console.log('\n3. Send messages:')
    console.log('   curl -X POST http://127.0.0.1:4096/v1/messages \\')
    console.log('        -H "Content-Type: application/json" \\')
    console.log('        -d \'{"model":"gpt-5.1-codex","messages":[{"role":"user","content":"hello"}]}\'')
    console.log('')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
