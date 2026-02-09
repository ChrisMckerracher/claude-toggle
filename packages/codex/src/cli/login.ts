#!/usr/bin/env node

/**
 * Login script for ChatGPT/Codex OAuth authentication.
 */

import {
  generatePKCE,
  generateState,
  buildAuthUrl,
  completeAuthCodeExchange,
  setTokens,
  type PKCEPair,
} from '../auth/oauth.js'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { renderAuthPage } from '../auth/ui.js'
import open from 'open'

const pkce: PKCEPair = generatePKCE()
const state: string = generateState()
const authUrl: string = buildAuthUrl(pkce, state)

console.log('\n🔐 Opening browser for ChatGPT authentication...\n')

// Start a simple callback server
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(renderAuthPage('Authentication Failed', error, 'error'))
    server.close()
    process.exit(1)
  }

  if (!returnedState || returnedState !== state) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(renderAuthPage('Invalid State', 'The OAuth state was missing or invalid.', 'error'))
    server.close()
    process.exit(1)
  }

  if (code) {
    completeAuthCodeExchange(code, pkce.verifier).then(async (tokens) => {
      await setTokens(tokens)

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(renderAuthPage('Authentication Successful', 'You can close this window.', 'success'))
      console.log('✅ Authentication successful!')
      server.close()
      process.exit(0)
    }).catch((err: Error) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(renderAuthPage('Token Exchange Failed', err.message, 'error'))
      server.close()
      process.exit(1)
    })
  } else {
    res.writeHead(400, { 'Content-Type': 'text/html' })
    res.end(renderAuthPage('Missing Code', 'The authorization code is missing.', 'error'))
    server.close()
    process.exit(1)
  }
})

server.listen(1455, '127.0.0.1', () => {
  console.log('Waiting for callback on http://localhost:1455')
  console.log('\nIf browser doesn\'t open, visit this URL:\n' + authUrl + '\n')

  // Try to open browser
  open(authUrl).catch(() => {
    // Ignore errors if browser command fails
  })
})
