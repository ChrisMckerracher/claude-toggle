/**
 * Codex auth lifecycle helpers.
 */

import open from 'open';
import { CODEX_PROXY_ENDPOINT } from './shared/constants.js';

export class AuthError extends Error {
  constructor(message: string, readonly code: 'daemon_unreachable' | 'login_start_failed' | 'timeout' | 'status_failed') {
    super(message);
    this.name = 'AuthError';
  }
}

async function requestAuthStatus(): Promise<{ authenticated: boolean; expired?: boolean }> {
  const response = await fetch(`${CODEX_PROXY_ENDPOINT}/auth/status`, {
    signal: AbortSignal.timeout(3_000),
  });

  if (!response.ok) {
    throw new AuthError(`Auth status request failed with HTTP ${response.status}`, 'status_failed');
  }

  return (await response.json()) as { authenticated: boolean; expired?: boolean };
}

async function waitForAuthCompletion(timeoutMs = 5 * 60_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    try {
      const status = await requestAuthStatus();
      if (status.authenticated && !status.expired) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
  }

  throw new AuthError('Authentication timed out', 'timeout');
}

export async function authenticateCodex(): Promise<void> {
  try {
    const health = await fetch(`${CODEX_PROXY_ENDPOINT}/health`, {
      signal: AbortSignal.timeout(2_000),
    });

    if (!health.ok) {
      throw new AuthError('Codex proxy is not reachable. Start daemon first.', 'daemon_unreachable');
    }
  } catch {
    throw new AuthError('Codex proxy is not reachable. Start daemon first.', 'daemon_unreachable');
  }

  const response = await fetch(`${CODEX_PROXY_ENDPOINT}/auth/login`, {
    method: 'POST',
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new AuthError('Failed to start auth flow', 'login_start_failed');
  }

  const payload = (await response.json()) as { url: string };
  await open(payload.url);

  await waitForAuthCompletion();
}

export async function reauthenticateCodex(): Promise<void> {
  await authenticateCodex();
}

export async function runCodexAuthAction(): Promise<'authenticated' | 'reauthenticated'> {
  const status = await checkAuthStatus();
  if (status === 'valid') {
    await reauthenticateCodex();
    return 'reauthenticated';
  }

  await authenticateCodex();
  return 'authenticated';
}

export async function checkAuthStatus(): Promise<'valid' | 'missing' | 'expired'> {
  try {
    const status = await requestAuthStatus();
    if (!status.authenticated) {
      return 'missing';
    }

    return status.expired ? 'expired' : 'valid';
  } catch {
    return 'missing';
  }
}

// Backward-compatible names used in TUI.
export async function authenticate(): Promise<void> {
  await authenticateCodex();
}
