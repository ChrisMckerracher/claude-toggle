# How to Use ChatGPT/Codex API Directly (No Proxy Needed)

## The Simple Truth

The original howto.md described building a complex proxy. **You don't need that.**

OpenCode (and the `opencode-openai-codex-auth` plugin) work by **calling ChatGPT's backend API directly** with OAuth tokens. You can do the same thing.

---

## The Actual API

### Endpoint
```
POST https://chatgpt.com/backend-api/codex/responses
```

### Headers Required
```http
Authorization: Bearer <access_token>
chatgpt-account-id: <account_id_from_jwt>
OpenAI-Beta: responses=experimental
originator: codex_cli_rs
accept: text/event-stream
Content-Type: application/json
```

### Request Body Format
```json
{
  "model": "gpt-5.1-codex",
  "stream": true,
  "store": false,
  "instructions": "<system prompt fetched from github>",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [{"type": "input_text", "text": "your prompt here"}]
    }
  ],
  "reasoning": {
    "effort": "medium",
    "summary": "auto"
  },
  "text": {
    "verbosity": "medium"
  },
  "include": ["reasoning.encrypted_content"]
}
```

---

## Step 1: Get OAuth Tokens

You need an access token and refresh token from ChatGPT's OAuth.

### OAuth Constants
```javascript
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const AUTH_URL = "https://auth.openai.com/oauth/authorize"
const TOKEN_URL = "https://auth.openai.com/oauth/token"
const REDIRECT_URI = "http://localhost:1455/auth/callback"
const SCOPE = "openid profile email offline_access"
```

### Step 1a: Generate PKCE
```javascript
import crypto from 'crypto'

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function generateState() {
  return crypto.randomBytes(16).toString('hex')
}

const pkce = generatePKCE()
const state = generateState()
```

### Step 1b: Build Authorization URL
```javascript
const params = new URLSearchParams({
  response_type: "code",
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  scope: SCOPE,
  code_challenge: pkce.challenge,
  code_challenge_method: "S256",
  state: state,
  id_token_add_organizations: "true",
  codex_cli_simplified_flow: "true",
  originator: "codex_cli_rs"
})

const authUrl = `${AUTH_URL}?${params}`
// Open this in browser - user logs into ChatGPT
```

### Step 1c: Exchange Code for Tokens
After user logs in, you'll get a callback with `code` and `state`:

```javascript
async function exchangeCodeForTokens(code) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier
    })
  })

  const tokens = await response.json()
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in
  }
}
```

### Step 1d: Extract Account ID from JWT
```javascript
function decodeJWT(token) {
  const parts = token.split('.')
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
  return payload
}

const decoded = decodeJWT(access_token)
const accountId = decoded['https://api.openai.com/auth']?.chatgpt_account_id
```

### Step 1e: Refresh Token (when expired)
```javascript
async function refreshAccessToken(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID
    })
  })

  return await response.json()
}
```

---

## Step 2: Fetch Model Instructions

Codex requires model-specific system prompts. These are hosted on GitHub.

```javascript
const INSTRUCTIONS_BASE = "https://raw.githubusercontent.com/openai/codex/main/protocol/src/prompts"

async function getCodexInstructions(model) {
  // Map model to prompt file
  const modelFamily = model.includes("codex-max") ? "codex-max"
    : model.includes("codex-mini") ? "codex-mini"
    : model.includes("codex") ? "codex"
    : "gpt-5"

  const url = `${INSTRUCTIONS_BASE}/${modelFamily}.txt`
  const response = await fetch(url)
  return await response.text()
}
```

---

## Step 3: Make the API Call

```javascript
async function callCodexAPI(accessToken, accountId, messages, model = "gpt-5.1-codex") {
  const instructions = await getCodexInstructions(model)

  const requestBody = {
    model: model,
    stream: true,
    store: false,
    instructions: instructions,
    input: messages.map(msg => ({
      type: "message",
      role: msg.role,
      content: [{ type: "input_text", text: msg.content }]
    })),
    reasoning: {
      effort: "medium",
      summary: "auto"
    },
    text: {
      verbosity: "medium"
    },
    include: ["reasoning.encrypted_content"]
  }

  const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "chatgpt-account-id": accountId,
      "OpenAI-Beta": "responses=experimental",
      "originator": "codex_cli_rs",
      "accept": "text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  })

  // Parse SSE stream
  return parseSSE(response.body)
}
```

---

## Step 4: Parse the SSE Response

The API returns Server-Sent Events. Key event types:

```
data: {"type":"response.status","status":"in_progress"}
data: {"type":"response.output_item.done","index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}}
data: {"type":"response.done","response":{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}]}}
```

```javascript
async function* parseSSE(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const data = line.slice(6)
      try {
        const event = JSON.parse(data)
        yield event
      } catch {}
    }
  }
}

// Usage
for await (const event of parseSSE(response.body)) {
  if (event.type === "response.output_item.done") {
    console.log(event.item.content[0].text)
  }
}
```

---

## Complete Working Example

```javascript
import crypto from 'crypto'

const CONFIG = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  apiUrl: "https://chatgpt.com/backend-api/codex/responses",
  redirectUri: "http://localhost:1455/auth/callback"
}

// Simple in-memory token store
let tokens = null

async function login() {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')

  const url = `${CONFIG.authUrl}?${new URLSearchParams({
    response_type: "code",
    client_id: CONFIG.clientId,
    redirect_uri: CONFIG.redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs"
  })}`

  console.log("Open this URL:", url)
  console.log("Paste the callback URL:")

  // Read callback from stdin
  const callback = await readline()
  const callbackUrl = new URL(callback.trim())
  const code = callbackUrl.searchParams.get("code")

  const resp = await fetch(CONFIG.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CONFIG.redirectUri,
      client_id: CONFIG.clientId,
      code_verifier: verifier
    })
  })

  tokens = await resp.json()

  // Extract account ID
  const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64'))
  tokens.accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id
}

async function chat(message, model = "gpt-5.1-codex") {
  if (!tokens) await login()

  const resp = await fetch(CONFIG.apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${tokens.access_token}`,
      "chatgpt-account-id": tokens.accountId,
      "OpenAI-Beta": "responses=experimental",
      "originator": "codex_cli_rs",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: true,
      store: false,
      instructions: "You are a helpful coding assistant.",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: message }]
      }],
      reasoning: { effort: "medium", summary: "auto" },
      text: { verbosity: "medium" },
      include: ["reasoning.encrypted_content"]
    })
  })

  // Read full response and parse
  const text = await resp.text()
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === "response.output_item.done") {
          return event.item.content[0].text
        }
      } catch {}
    }
  }
}
```

---

## Supported Models

- `gpt-5.2-codex` (low/medium/high/xhigh)
- `gpt-5.1-codex-max` (low/medium/high/xhigh)
- `gpt-5.1-codex` (low/medium/high)
- `gpt-5.1-codex-mini` (medium/high)
- `gpt-5.1` (none/low/medium/high)

Set `reasoning.effort` accordingly. Codex models don't support "none".

---

## Why This Works

1. **ChatGPT OAuth**: Uses official OpenAI OAuth flow (same as Codex CLI)
2. **Backend API**: Direct call to `chatgpt.com/backend-api/codex/responses`
3. **Your Subscription**: Uses your ChatGPT Plus/Pro subscription
4. **No API Keys**: OAuth tokens only, no platform API keys

No proxy needed. Just call the API.
