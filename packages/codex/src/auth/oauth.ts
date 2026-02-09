/**
 * OAuth Authentication for ChatGPT/Codex API
 */

import crypto from 'crypto'
import { decodeJwt } from 'jose'
import { loadTokens, saveTokens } from './token-store.js'
import type {
  JWTPayload,
  OAuthConfig,
  OAuthRefreshResponse,
  OAuthTokenResponse,
  PKCEPair,
  StoredTokens
} from './types.js'
export type {
  JWTPayload,
  OAuthConfig,
  PKCEPair,
  StoredTokens,
  Tokens
} from './types.js'
export { clearTokens, getTokens, setTokens } from './token-store.js'

const CONFIG: OAuthConfig = {
  CLIENT_ID: "app_EMoamEEZ73f0CkXaXp7hrann",
  AUTH_URL: "https://auth.openai.com/oauth/authorize",
  TOKEN_URL: "https://auth.openai.com/oauth/token",
  REDIRECT_URI: "http://localhost:1455/auth/callback",
  SCOPE: "openid profile email offline_access"
}

export function generatePKCE(): PKCEPair {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function buildAuthUrl(pkce: PKCEPair, state: string): string {
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

export async function exchangeCodeForTokens(code: string, verifier: string): Promise<StoredTokens> {
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

  const tokens = await response.json() as OAuthTokenResponse
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    expires_at: Date.now() + (tokens.expires_in * 1000)
  }
}

export async function completeAuthCodeExchange(code: string, verifier: string): Promise<StoredTokens> {
  const tokens = await exchangeCodeForTokens(code, verifier)
  tokens.account_id = extractAccountId(tokens.access_token)
  return tokens
}

export async function refreshAccessToken(refreshToken: string): Promise<Omit<StoredTokens, 'account_id'>> {
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

  const tokens = await response.json() as OAuthRefreshResponse
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || refreshToken,
    expires_in: tokens.expires_in,
    expires_at: Date.now() + (tokens.expires_in * 1000)
  }
}

export function decodeJWT(token: string): JWTPayload | null {
  try {
    return decodeJwt(token) as JWTPayload
  } catch {
    return null
  }
}

export function extractAccountId(token: string): string | undefined {
  const payload = decodeJWT(token)
  return payload?.['https://api.openai.com/auth']?.chatgpt_account_id
}

export async function ensureValidTokens(): Promise<StoredTokens> {
  let storedTokens = await loadTokens()
  if (!storedTokens) {
    throw new Error('Not authenticated. Run: npm --prefix packages/codex run login')
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
