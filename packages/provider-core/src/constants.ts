export const PROVIDERS_VERSION = 1;
export const CREDENTIALS_VERSION = 1;

export const CODEX_PROXY_PORT = 4096;
export const CODEX_PROXY_BASE_URL = `http://127.0.0.1:${CODEX_PROXY_PORT}/v1`;
export const CODEX_PROXY_URL = `http://127.0.0.1:${CODEX_PROXY_PORT}`;
export const CODEX_DUMMY_KEY = 'dummy_key';
export const CODEX_DEFAULT_MODEL = 'gpt-5.1-codex-mini';
export const CODEX_SUPPORTED_MODELS = [
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'gpt-5.1', name: 'GPT-5.1' },
] as const;

export const TOKENS_MIGRATION_LEDGER_KEY = 'tokens_json_to_credentials_v1';

export const MANAGED_ENV_START = '# >>> ct managed env start >>>';
export const MANAGED_ENV_END = '# <<< ct managed env end <<<';
