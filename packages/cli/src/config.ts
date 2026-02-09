import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.local', 'share', 'ct');
const CONFIG_FILE = join(CONFIG_DIR, 'providers.json');
const TOKEN_FILE = join(CONFIG_DIR, 'tokens.json');

export interface Provider {
  name: string;
  type: 'direct' | 'codex' | 'generic';
  baseUrl?: string;
  pidFile?: string;
  apiKeyEnv?: string;
  enabled: boolean;
}

export interface AgentCategory {
  name: string;
  provider: string;
}

export interface Config {
  version: number;
  providers: Provider[];
  active: string;
  agentCategories: AgentCategory[];
}

export type ProviderConfig = Config;

export interface TokenData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

const DEFAULT_CONFIG: Config = {
  version: 1,
  providers: [
    { name: 'direct', type: 'direct', enabled: true },
    {
      name: 'codex',
      type: 'codex',
      baseUrl: 'http://127.0.0.1:4096/v1',
      pidFile: join(CONFIG_DIR, 'codex.pid'),
      enabled: true
    }
  ],
  active: 'direct',
  agentCategories: [
    { name: 'High-Quality', provider: 'direct' },
    { name: 'High-Volume', provider: 'codex' }
  ]
};

export async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data) as Partial<Config>;
    // Merge with defaults to handle schema evolution
    return {
      version: parsed.version ?? DEFAULT_CONFIG.version,
      providers: parsed.providers ?? DEFAULT_CONFIG.providers,
      active: parsed.active ?? DEFAULT_CONFIG.active,
      agentCategories: parsed.agentCategories ?? DEFAULT_CONFIG.agentCategories
    };
  } catch {
    await ensureConfigDir();
    await writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getProvider(config: Config, name: string): Provider | undefined {
  return config.providers.find(p => p.name === name);
}

export function getActiveProvider(config: Config): Provider | undefined {
  return getProvider(config, config.active);
}

export async function setActiveProvider(name: string): Promise<Provider> {
  const config = await loadConfig();
  const provider = getProvider(config, name);
  if (!provider) {
    throw new Error(`Provider not found: ${name}`);
  }
  if (!provider.enabled) {
    throw new Error(`Provider is disabled: ${name}`);
  }
  config.active = name;
  await saveConfig(config);
  return provider;
}

export async function addProvider(provider: Provider): Promise<Config> {
  const config = await loadConfig();
  if (config.providers.find(p => p.name === provider.name)) {
    throw new Error(`Provider already exists: ${provider.name}`);
  }
  config.providers.push(provider);
  await saveConfig(config);
  return config;
}

export async function removeProvider(name: string): Promise<Config> {
  const config = await loadConfig();
  config.providers = config.providers.filter(p => p.name !== name);
  if (config.active === name) {
    const directProvider = config.providers.find(p => p.type === 'direct');
    config.active = directProvider?.name ?? config.providers[0]?.name ?? 'direct';
  }
  // Remove categories that reference the deleted provider
  config.agentCategories = config.agentCategories.filter(c => c.provider !== name);
  await saveConfig(config);
  return config;
}

export async function updateProvider(name: string, updates: Partial<Provider>): Promise<Config> {
  const config = await loadConfig();
  const index = config.providers.findIndex(p => p.name === name);
  if (index === -1) {
    throw new Error(`Provider not found: ${name}`);
  }
  config.providers[index] = { ...config.providers[index], ...updates };
  await saveConfig(config);
  return config;
}

export async function toggleProvider(name: string): Promise<Config> {
  const config = await loadConfig();
  const provider = getProvider(config, name);
  if (!provider) {
    throw new Error(`Provider not found: ${name}`);
  }
  provider.enabled = !provider.enabled;
  if (!provider.enabled && config.active === name) {
    const nextProvider = config.providers.find(p => p.enabled && p.name !== name);
    if (nextProvider) {
      config.active = nextProvider.name;
    }
  }
  await saveConfig(config);
  return config;
}

export async function loadTokens(): Promise<TokenData> {
  try {
    const data = await readFile(TOKEN_FILE, 'utf-8');
    return JSON.parse(data) as TokenData;
  } catch {
    return {};
  }
}

export async function saveTokens(tokens: TokenData): Promise<void> {
  await ensureConfigDir();
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function isTokenValid(tokens: TokenData): boolean {
  if (!tokens.accessToken || !tokens.expiresAt) {
    return false;
  }
  return Date.now() < tokens.expiresAt;
}

export async function addAgentCategory(category: AgentCategory): Promise<Config> {
  const config = await loadConfig();
  if (config.agentCategories.find(c => c.name === category.name)) {
    throw new Error(`Category already exists: ${category.name}`);
  }
  config.agentCategories.push(category);
  await saveConfig(config);
  return config;
}

export async function removeAgentCategory(name: string): Promise<Config> {
  const config = await loadConfig();
  config.agentCategories = config.agentCategories.filter(c => c.name !== name);
  await saveConfig(config);
  return config;
}

export { CONFIG_DIR, CONFIG_FILE, TOKEN_FILE };
