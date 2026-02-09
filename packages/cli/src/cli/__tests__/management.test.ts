import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runParsedCommand } from '../runner.js';
import { resetProviderStoreForTests } from '../../services/provider-store.js';

const cleanupPaths: string[] = [];
let originalDataDir: string | undefined;
let originalZshrcPath: string | undefined;
let originalCwd: string;

beforeEach(async () => {
  originalDataDir = process.env.CT_DATA_DIR;
  originalZshrcPath = process.env.CT_ZSHRC_PATH;
  originalCwd = process.cwd();

  const root = await mkdtemp(join(tmpdir(), 'ct-cli-mgmt-'));
  cleanupPaths.push(root);

  process.env.CT_DATA_DIR = join(root, 'data');
  process.env.CT_ZSHRC_PATH = join(root, '.zshrc');
  resetProviderStoreForTests();
});

afterEach(async () => {
  process.chdir(originalCwd);

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

  resetProviderStoreForTests();

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

test('provider and mapping management commands are functional without TUI', async () => {
  const create = await runParsedCommand({
    kind: 'provider-add',
    name: 'openrouter',
    providerKind: 'generic',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'or-key',
  });
  assert.equal(create.exitCode, 0);

  const list = await runParsedCommand({ kind: 'provider-list' });
  const listOutput = (list.stdoutLines ?? []).join('\n');
  assert.match(listOutput, /openrouter/);

  const mapSet = await runParsedCommand({
    kind: 'mapping-set',
    agentType: 'research',
    providerName: 'openrouter',
    teammateSuffix: 'or',
  });
  assert.equal(mapSet.exitCode, 0);

  const mapList = await runParsedCommand({ kind: 'mapping-list' });
  const mapOutput = (mapList.stdoutLines ?? []).join('\n');
  assert.match(mapOutput, /research -> openrouter/);

  const disable = await runParsedCommand({ kind: 'provider-disable', name: 'openrouter' });
  assert.equal(disable.exitCode, 0);

  const status = await runParsedCommand({ kind: 'status' });
  const statusOutput = (status.stdoutLines ?? []).join('\n');
  assert.match(statusOutput, /Mapping warnings/);

  const remove = await runParsedCommand({ kind: 'provider-delete', name: 'openrouter' });
  assert.equal(remove.exitCode, 0);
});

test('anthropic provider is built-in and immutable', async () => {
  const list = await runParsedCommand({ kind: 'provider-list' });
  assert.equal(list.exitCode, 0);
  assert.match((list.stdoutLines ?? []).join('\n'), /anthropic \[anthropic\] enabled \(builtin\)/);

  const disable = await runParsedCommand({ kind: 'provider-disable', name: 'anthropic' });
  assert.equal(disable.exitCode, 1);
  assert.match((disable.stderrLines ?? []).join('\n'), /system-managed and always enabled/);

  const remove = await runParsedCommand({ kind: 'provider-delete', name: 'anthropic' });
  assert.equal(remove.exitCode, 1);
  assert.match((remove.stderrLines ?? []).join('\n'), /system-managed and cannot be deleted/);
});

test('init command manages CLAUDE section idempotently', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'ct-cli-init-'));
  cleanupPaths.push(workspace);

  process.chdir(workspace);

  const first = await runParsedCommand({ kind: 'init' });
  assert.equal(first.exitCode, 0);

  const second = await runParsedCommand({ kind: 'init' });
  assert.equal(second.exitCode, 0);

  const content = await readFile(join(workspace, 'CLAUDE.md'), 'utf-8');
  const startCount = (content.match(/TEAMMATE INSTRUCTIONS START/g) ?? []).length;
  const endCount = (content.match(/TEAMMATE INSTRUCTIONS END/g) ?? []).length;

  assert.equal(startCount, 1);
  assert.equal(endCount, 1);
});

test('codex model can be listed and updated', async () => {
  const before = await runParsedCommand({ kind: 'codex-model-show' });
  assert.equal(before.exitCode, 0);
  assert.match((before.stdoutLines ?? []).join('\n'), /current: gpt-5\.2-codex/);

  const set = await runParsedCommand({ kind: 'codex-model-set', modelId: 'gpt-5.1-codex-mini' });
  assert.equal(set.exitCode, 0);

  const status = await runParsedCommand({ kind: 'codex-status' });
  assert.equal(status.exitCode, 0);
  assert.match((status.stdoutLines ?? []).join('\n'), /model: gpt-5\.1-codex-mini/);

  const invalid = await runParsedCommand({ kind: 'codex-model-set', modelId: 'bad-model-id' });
  assert.equal(invalid.exitCode, 1);
  assert.match((invalid.stderrLines ?? []).join('\n'), /Unsupported codex model/);
});
