/**
 * OAuth Authentication for ChatGPT/Codex API
 */

import crypto from 'crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.tokens.json')

const CONFIG = {
  CLIENT_ID: "app_EMoamEEZ73f0CkXaXp7hrann",
  AUTH_URL: "https://auth.openai.com/oauth/authorize",
  TOKEN_URL: "https://auth.openai.com/oauth/token",
  REDIRECT_URI: "http://localhost:1455/auth/callback",
  SCOPE: "openid profile email offline_access"
}

export function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function generateState() {
  return crypto.randomBytes(16).toString('hex')
}

export function buildAuthUrl(pkce, state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    scope: CONFIG.SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs"
  })
  return `${CONFIG.AUTH_URL}?${params}`
}

export async function exchangeCodeForTokens(code, verifier) {
  const response = await fetch(CONFIG.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CONFIG.REDIRECT_URI,
      client_id: CONFIG.CLIENT_ID,
      code_verifier: verifier
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${text}`)
  }

  const tokens = await response.json()
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    expires_at: Date.now() + (tokens.expires_in * 1000)
  }
}

export async function refreshAccessToken(refreshToken) {
  const response = await fetch(CONFIG.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CONFIG.CLIENT_ID
    })
  })

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }

  const tokens = await response.json()
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || refreshToken,
    expires_in: tokens.expires_in,
    expires_at: Date.now() + (tokens.expires_in * 1000)
  }
}

export function decodeJWT(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
    return payload
  } catch {
    return null
  }
}

export function extractAccountId(token) {
  const payload = decodeJWT(token)
  return payload?.['https://api.openai.com/auth']?.chatgpt_account_id
}

// File-based token store (shared between login script and server)
async function loadTokens() {
  try {
    const data = await readFile(TOKEN_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

async function saveTokens(tokens) {
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2))
}

export async function getTokens() {
  return await loadTokens()
}

export async function setTokens(tokens) {
  await saveTokens(tokens)
}

export async function clearTokens() {
  try {
    await writeFile(TOKEN_FILE, '')
  } catch {}
}

export async function ensureValidTokens() {
  let storedTokens = await loadTokens()
  if (!storedTokens) {
    throw new Error('Not authenticated. Run: node src/login.js')
  }

  // Refresh if expired (with 5min buffer)
  if (storedTokens.expires_at - Date.now() < 300000) {
    const refreshed = await refreshAccessToken(storedTokens.refresh_token)
    storedTokens = {
      ...storedTokens,
      ...refreshed
    }
    await saveTokens(storedTokens)
  }

  return storedTokens
}
