import {
  CODEX_DEFAULT_MODEL,
  CODEX_DUMMY_KEY,
  CODEX_PROXY_BASE_URL,
  CODEX_SUPPORTED_MODELS,
  ProviderRepository,
  type CodexExtras,
} from '@codex-proxy/provider-core'
import type { StoredTokens } from './types.js'

const CODEX_CREDENTIALS_REF = 'provider:codex'
const SUPPORTED_MODELS: Set<string> = new Set(CODEX_SUPPORTED_MODELS.map((model) => model.id))

async function readSavedModel(repository: ProviderRepository, credentialsRef: string): Promise<string | undefined> {
  const credentials = await repository.getCredentials(credentialsRef)
  if (!credentials || credentials.kind !== 'codex') {
    return undefined
  }

  const model = credentials.value.extras.model
  if (typeof model === 'string' && SUPPORTED_MODELS.has(model)) {
    return model
  }

  return undefined
}

function extrasToStoredTokens(extras: CodexExtras): StoredTokens | null {
  if (!extras.refresh_token || !extras.access_token || !extras.expires_at || !extras.expires_in) {
    return null
  }

  return {
    refresh_token: extras.refresh_token,
    access_token: extras.access_token,
    expires_at: extras.expires_at,
    expires_in: extras.expires_in,
    account_id: extras.account_id,
  }
}

async function ensureRepository(): Promise<ProviderRepository> {
  return new ProviderRepository()
}

async function getCodexCredentialsRef(repository: ProviderRepository): Promise<string> {
  const codexByName = await repository.getProvider('codex')
  if (codexByName?.kind === 'codex') {
    return codexByName.credentialsRef
  }

  const providers = await repository.listProviders()
  const codex = providers.find((provider) => provider.kind === 'codex')
  return codex?.credentialsRef ?? CODEX_CREDENTIALS_REF
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const repository = await ensureRepository()
  const credentialsRef = await getCodexCredentialsRef(repository)
  const credentials = await repository.getCredentials(credentialsRef)

  if (!credentials || credentials.kind !== 'codex') {
    return null
  }

  return extrasToStoredTokens(credentials.value.extras)
}

export async function saveTokens(tokens: StoredTokens | null): Promise<void> {
  const repository = await ensureRepository()
  await repository.ensureCodexProvider(CODEX_CREDENTIALS_REF)
  const savedModel = await readSavedModel(repository, CODEX_CREDENTIALS_REF)

  if (tokens === null) {
    await repository.saveCredentials(CODEX_CREDENTIALS_REF, {
      kind: 'codex',
      value: {
        anthropic_base_url: CODEX_PROXY_BASE_URL,
        anthropic_key: CODEX_DUMMY_KEY,
        extras: {
          refresh_token: '',
          ...(savedModel ? { model: savedModel } : {}),
        },
      },
    })
    return
  }

  await repository.saveCredentials(CODEX_CREDENTIALS_REF, {
    kind: 'codex',
    value: {
      anthropic_base_url: CODEX_PROXY_BASE_URL,
      anthropic_key: CODEX_DUMMY_KEY,
      extras: {
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        expires_at: tokens.expires_at,
        expires_in: tokens.expires_in,
        account_id: tokens.account_id,
        ...(savedModel ? { model: savedModel } : {}),
      },
    },
  })
}

export async function getTokens(): Promise<StoredTokens | null> {
  return await loadTokens()
}

export async function setTokens(tokens: StoredTokens | null): Promise<void> {
  await saveTokens(tokens)
}

export async function clearTokens(): Promise<void> {
  await saveTokens(null)
}

export async function getConfiguredModel(): Promise<string> {
  const repository = await ensureRepository()
  const credentialsRef = await getCodexCredentialsRef(repository)
  const credentials = await repository.getCredentials(credentialsRef)

  if (!credentials || credentials.kind !== 'codex') {
    return CODEX_DEFAULT_MODEL
  }

  const model = credentials.value.extras.model
  if (typeof model === 'string' && SUPPORTED_MODELS.has(model)) {
    return model
  }

  return CODEX_DEFAULT_MODEL
}
