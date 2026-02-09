import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runParsedCommand } from '../runner.js';
import { resetProviderStoreForTests } from '../../services/provider-store.js';

const cleanupPaths: string[] = [];
let originalDataDir: string | undefined;
let originalZshrcPath: string | undefined;
let originalPath: string | undefined;
let originalTmuxLog: string | undefined;

beforeEach(async () => {
  originalDataDir = process.env.CT_DATA_DIR;
  originalZshrcPath = process.env.CT_ZSHRC_PATH;
  originalPath = process.env.PATH;
  originalTmuxLog = process.env.CT_TMUX_LOG;

  const root = await mkdtemp(join(tmpdir(), 'ct-cli-test-'));
  cleanupPaths.push(root);

  process.env.CT_DATA_DIR = join(root, 'data');
  process.env.CT_ZSHRC_PATH = join(root, '.zshrc');
  process.env.CT_TMUX_LOG = join(root, 'tmux.log');

  const binDir = join(root, 'bin');
  await mkdir(binDir, { recursive: true });
  const tmuxPath = join(binDir, 'tmux');
  await writeFile(
    tmuxPath,
    '#!/bin/sh\n' +
      'if [ -n "$CT_TMUX_LOG" ]; then\n' +
      '  echo "$@" >> "$CT_TMUX_LOG"\n' +
      'fi\n',
    'utf-8',
  );
  await chmod(tmuxPath, 0o755);
  process.env.PATH = `${binDir}:${originalPath ?? ''}`;

  resetProviderStoreForTests();
});

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env.CT_DATA_DIR;
  } else {
    process.env.CT_DATA_DIR = originalDataDir;
  }

  if (originalZshrcPath === undefined) {
    delete process.env.CT_ZSHRC_PATH;
  } else {
    process.env.CT_ZSHRC_PATH = originalZshrcPath;
  }

  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  if (originalTmuxLog === undefined) {
    delete process.env.CT_TMUX_LOG;
  } else {
    process.env.CT_TMUX_LOG = originalTmuxLog;
  }

  resetProviderStoreForTests();

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

test('switching to anthropic emits unset env contract and persists managed zshrc block', async () => {
  const result = await runParsedCommand({ kind: 'switch-provider', providerName: 'anthropic' });

  assert.equal(result.exitCode, 0);
  const output = (result.stdoutLines ?? []).join('\n');

  assert.match(output, /unset ANTHROPIC_BASE_URL/);
  assert.match(output, /unset ANTHROPIC_API_KEY/);
  assert.doesNotMatch(output, /tmux set-environment/);

  const zshrcContent = await readFile(process.env.CT_ZSHRC_PATH!, 'utf-8');
  assert.match(zshrcContent, /ct managed env start/);
  assert.match(zshrcContent, /ct managed env end/);

  const tmuxLog = await readFile(process.env.CT_TMUX_LOG!, 'utf-8');
  assert.match(tmuxLog, /set-environment -u ANTHROPIC_BASE_URL/);
  assert.match(tmuxLog, /set-environment -u ANTHROPIC_API_KEY/);
});

test('switching to codex forces localhost base URL and dummy key', async () => {
  const result = await runParsedCommand({ kind: 'switch-provider', providerName: 'codex' });
  assert.equal(result.exitCode, 0);

  const output = (result.stdoutLines ?? []).join('\n');
  assert.match(output, /export ANTHROPIC_BASE_URL='http:\/\/127\.0\.0\.1:4096'/);
  assert.match(output, /export ANTHROPIC_API_KEY='dummy_key'/);
  assert.doesNotMatch(output, /tmux set-environment/);

  const tmuxLog = await readFile(process.env.CT_TMUX_LOG!, 'utf-8');
  assert.match(tmuxLog, /set-environment ANTHROPIC_BASE_URL http:\/\/127\.0\.0\.1:4096/);
  assert.match(tmuxLog, /set-environment ANTHROPIC_API_KEY dummy_key/);
});

test('switching to direct remains a compatibility alias for anthropic', async () => {
  const result = await runParsedCommand({ kind: 'switch-provider', providerName: 'direct' });
  assert.equal(result.exitCode, 0);
});
