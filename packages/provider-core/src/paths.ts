import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderRepositoryOptions } from './types.js';

export interface ProviderPaths {
  rootDir: string;
  providersFile: string;
  credentialsFile: string;
}

export function resolveProviderPaths(options: ProviderRepositoryOptions = {}): ProviderPaths {
  const rootDir = options.rootDir ?? process.env.CT_DATA_DIR ?? join(homedir(), '.local', 'share', 'ct');

  return {
    rootDir,
    providersFile: join(rootDir, 'providers.json'),
    credentialsFile: join(rootDir, 'credentials.json'),
  };
}
