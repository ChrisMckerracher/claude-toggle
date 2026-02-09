#!/usr/bin/env node

import { exec } from 'child_process'
import { generatePKCE, generateState, buildAuthUrl, exchangeCodeForTokens, setTokens, extractAccountId } from './auth.js'
import { createServer } from 'http'

const pkce = generatePKCE()
const state = generateState()
const authUrl = buildAuthUrl(pkce, state)

console.log('\n🔐 Opening browser for ChatGPT authentication...\n')

// Start a simple callback server
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><body style="font-family:system-ui;text-align:center;padding:50px;background:#1a1a1a;color:#fff;"><h1 style="color:#f87171">Authentication Failed</h1><p>' + error + '</p></body></html>')
    server.close()
    process.exit(1)
  }

  if (code) {
    exchangeCodeForTokens(code, pkce.verifier).then(async tokens => {
      const accountId = extractAccountId(tokens.access_token)
      tokens.account_id = accountId
      await setTokens(tokens)

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="font-family:system-ui;text-align:center;padding:50px;background:#1a1a1a;color:#fff;"><h1 style="color:#4ade80">Authentication Successful!</h1><p>You can close this window.</p></body></html>')
      console.log('✅ Authentication successful!')
      server.close()
      process.exit(0)
    }).catch(err => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="font-family:system-ui;text-align:center;padding:50px;background:#1a1a1a;color:#fff;"><h1 style="color:#f87171">Token Exchange Failed</h1><p>' + err.message + '</p></body></html>')
      server.close()
      process.exit(1)
    })
  }
})

server.listen(1455, '127.0.0.1', () => {
  console.log('Waiting for callback on http://localhost:1455')
  console.log('\nIf browser doesn\'t open, visit this URL:\n' + authUrl + '\n')

  // Try to open browser
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${command} "${authUrl}"`)
})
