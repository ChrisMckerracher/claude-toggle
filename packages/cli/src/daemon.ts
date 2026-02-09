/**
 * Codex daemon lifecycle management.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProviderPaths } from '@codex-proxy/provider-core';
import { CODEX_PROXY_ENDPOINT } from './shared/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = resolveProviderPaths().rootDir;
const PID_FILE = join(DATA_DIR, 'codex.pid');
const LOG_FILE = join(DATA_DIR, 'codex.log');
const PROXY_PATH = join(__dirname, '../../codex/dist/index.js');

const STOP_TIMEOUT_MS = 4_000;
const STOP_POLL_INTERVAL_MS = 100;

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  proxyPath: string;
  logFile: string;
}

export interface DaemonStartResult {
  success: boolean;
  pid?: number;
  message: string;
}

export interface DaemonStopResult {
  success: boolean;
  message: string;
}

export type CodexAuthStatus = 'valid' | 'missing' | 'expired';

export interface CodexLifecycleStatus {
  daemon: 'running' | 'stopped';
  auth: CodexAuthStatus;
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readPidFile(): Promise<number | null> {
  try {
    const raw = await readFile(PID_FILE, 'utf-8');
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function writePidFile(pid: number): Promise<void> {
  await ensureDataDir();
  await writeFile(PID_FILE, String(pid), 'utf-8');
}

async function removePidFile(): Promise<void> {
  await rm(PID_FILE, { force: true });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_INTERVAL_MS));
  }

  return !isProcessRunning(pid);
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  const pid = await readPidFile();

  if (!pid) {
    return {
      running: false,
      proxyPath: PROXY_PATH,
      logFile: LOG_FILE,
    };
  }

  if (!isProcessRunning(pid)) {
    await removePidFile();
    return {
      running: false,
      proxyPath: PROXY_PATH,
      logFile: LOG_FILE,
    };
  }

  return {
    running: true,
    pid,
    proxyPath: PROXY_PATH,
    logFile: LOG_FILE,
  };
}

export async function startDaemon(): Promise<DaemonStartResult> {
  const status = await getDaemonStatus();
  if (status.running) {
    return {
      success: false,
      pid: status.pid,
      message: `Daemon is already running with PID ${status.pid}`,
    };
  }

  try {
    await access(PROXY_PATH);
  } catch {
    return {
      success: false,
      message: `Codex proxy binary not found at ${PROXY_PATH}. Build @codex-proxy/codex first.`,
    };
  }

  await ensureDataDir();

  const child = spawn(process.execPath, [PROXY_PATH], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: dirname(PROXY_PATH),
  });

  const logStream = createWriteStream(LOG_FILE, { flags: 'a' });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  child.unref();

  await writePidFile(child.pid!);

  await new Promise((resolve) => setTimeout(resolve, 250));
  if (!isProcessRunning(child.pid!)) {
    await removePidFile();
    return {
      success: false,
      message: `Daemon failed to start. Check logs at ${LOG_FILE}`,
    };
  }

  return {
    success: true,
    pid: child.pid,
    message: `Daemon started successfully with PID ${child.pid}`,
  };
}

export async function stopDaemon(): Promise<DaemonStopResult> {
  const status = await getDaemonStatus();
  if (!status.running || !status.pid) {
    return {
      success: false,
      message: 'Daemon is not running',
    };
  }

  try {
    process.kill(status.pid, 'SIGTERM');
  } catch {
    await removePidFile();
    return {
      success: true,
      message: `Daemon (PID ${status.pid}) already stopped`,
    };
  }

  const exitedAfterTerm = await waitForProcessExit(status.pid, STOP_TIMEOUT_MS);

  if (!exitedAfterTerm) {
    try {
      process.kill(status.pid, 'SIGKILL');
      await waitForProcessExit(status.pid, STOP_TIMEOUT_MS);
    } catch {
      // Best effort kill.
    }
  }

  await removePidFile();

  return {
    success: true,
    message: `Daemon (PID ${status.pid}) stopped`,
  };
}

export async function restartDaemon(): Promise<DaemonStartResult> {
  await stopDaemon();
  return startDaemon();
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  try {
    const response = await fetch(`${CODEX_PROXY_ENDPOINT}/auth/status`, {
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
      return 'missing';
    }

    const payload = (await response.json()) as { authenticated?: boolean; expired?: boolean };
    if (!payload.authenticated) {
      return 'missing';
    }

    return payload.expired ? 'expired' : 'valid';
  } catch {
    return 'missing';
  }
}

export async function getCodexStatus(): Promise<CodexLifecycleStatus> {
  const daemonStatus = await getDaemonStatus();
  return {
    daemon: daemonStatus.running ? 'running' : 'stopped',
    auth: daemonStatus.running ? await getCodexAuthStatus() : 'missing',
  };
}

export async function ensureCodexDaemon(): Promise<DaemonStartResult> {
  const status = await getDaemonStatus();
  if (status.running) {
    return {
      success: true,
      pid: status.pid,
      message: `Daemon already running with PID ${status.pid}`,
    };
  }

  return startDaemon();
}

export async function runCodexDaemonAction(): Promise<DaemonStartResult> {
  const status = await getDaemonStatus();
  if (!status.running) {
    return startDaemon();
  }
  return restartDaemon();
}

export async function tailLog(lines = 20): Promise<string> {
  try {
    const text = await readFile(LOG_FILE, 'utf-8');
    const chunks = text.trimEnd().split('\n');
    return chunks.slice(Math.max(0, chunks.length - lines)).join('\n');
  } catch {
    return `Log file not found or empty: ${LOG_FILE}`;
  }
}

export { DATA_DIR, PID_FILE, LOG_FILE, PROXY_PATH };
