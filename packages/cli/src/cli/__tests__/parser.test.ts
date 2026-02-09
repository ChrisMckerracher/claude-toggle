import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../parser.js';

test('parses help and daemon commands deterministically', () => {
  assert.deepEqual(parseCommand(['--help']), { kind: 'help' });
  assert.deepEqual(parseCommand(['daemon', 'start']), { kind: 'daemon', action: 'start' });
  assert.deepEqual(parseCommand(['status']), { kind: 'status' });
  assert.deepEqual(parseCommand(['codex']), { kind: 'switch-provider', providerName: 'codex' });
  assert.deepEqual(parseCommand(['codex', 'status']), { kind: 'codex-status' });
  assert.deepEqual(parseCommand(['codex', '--status']), { kind: 'codex-status' });
  assert.deepEqual(parseCommand(['codex', '--daemon']), { kind: 'codex-daemon-action' });
  assert.deepEqual(parseCommand(['codex', '--auth']), { kind: 'codex-auth-action' });
  assert.deepEqual(parseCommand(['codex', '--onboard']), { kind: 'codex-onboard-action' });
  assert.deepEqual(parseCommand(['codex', '--model']), { kind: 'codex-model-show' });
  assert.deepEqual(parseCommand(['codex', 'model']), { kind: 'codex-model-show' });
  assert.deepEqual(parseCommand(['codex', '--model', 'gpt-5.2-codex']), { kind: 'codex-model-set', modelId: 'gpt-5.2-codex' });
  assert.deepEqual(parseCommand(['codex', 'model', 'gpt-5.2-codex']), { kind: 'codex-model-set', modelId: 'gpt-5.2-codex' });
  assert.deepEqual(parseCommand(['--repo', 'init']), { kind: 'init' });
});

test('parses unknown flags as errors and bare words as provider resolution', () => {
  const unknownFlag = parseCommand(['-x']);
  assert.equal(unknownFlag.kind, 'error');

  const invalidRepo = parseCommand(['--repo', 'nope']);
  assert.equal(invalidRepo.kind, 'error');

  assert.deepEqual(parseCommand(['openrouter']), { kind: 'switch-provider', providerName: 'openrouter' });
});

test('parses provider and mapping command families', () => {
  assert.deepEqual(parseCommand(['provider', 'list']), { kind: 'provider-list' });
  assert.deepEqual(parseCommand(['provider', 'add', 'openrouter', 'generic', 'https://openrouter.ai/api/v1']), {
    kind: 'provider-add',
    name: 'openrouter',
    providerKind: 'generic',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: undefined,
  });
  assert.deepEqual(parseCommand(['mapping', 'set', 'research', 'openrouter']), {
    kind: 'mapping-set',
    agentType: 'research',
    providerName: 'openrouter',
    teammateSuffix: undefined,
  });

  const directAlias = parseCommand(['provider', 'add', 'primary', 'direct']);
  assert.equal(directAlias.kind, 'error');

  const anthropicKind = parseCommand(['provider', 'add', 'primary', 'anthropic']);
  assert.equal(anthropicKind.kind, 'error');
});
