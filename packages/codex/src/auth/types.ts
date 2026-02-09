export interface OAuthConfig {
  CLIENT_ID: string
  AUTH_URL: string
  TOKEN_URL: string
  REDIRECT_URI: string
  SCOPE: string
}

export interface PKCEPair {
  verifier: string
  challenge: string
}

export interface Tokens {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at: number
  account_id?: string
}

export interface JWTPayload {
  [key: string]: unknown
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
}

export interface StoredTokens extends Tokens {
  account_id?: string
}

export interface OAuthTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface OAuthRefreshResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}
