import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderTeammateSection,
  TEAMMATE_SECTION_END,
  TEAMMATE_SECTION_START,
  upsertTeammateSection,
} from '../index.js';

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

async function createClaudePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'provider-core-claude-'));
  cleanupPaths.push(root);
  return join(root, 'CLAUDE.md');
}

test('upserts managed teammate section and replaces prior block', async () => {
  const claudePath = await createClaudePath();

  const sectionV1 = renderTeammateSection({
    mappings: [{ agentType: 'coder', provider: 'codex' }],
    providers: [{ name: 'codex', kind: 'codex', enabled: true, credentialsRef: 'provider:codex' }],
  });

  await upsertTeammateSection(claudePath, sectionV1);

  const sectionV2 = renderTeammateSection({
    mappings: [{ agentType: 'research', provider: 'openrouter' }],
    providers: [{ name: 'openrouter', kind: 'generic', enabled: true, credentialsRef: 'provider:openrouter' }],
  });

  await upsertTeammateSection(claudePath, sectionV2);
  const content = await readFile(claudePath, 'utf-8');

  assert.equal(content.includes('coder'), false);
  assert.equal(content.includes('research'), true);
  assert.equal(content.split(TEAMMATE_SECTION_START).length - 1, 1);
  assert.equal(content.split(TEAMMATE_SECTION_END).length - 1, 1);
});

test('throws when markers are malformed', async () => {
  const claudePath = await createClaudePath();
  await writeFile(claudePath, `${TEAMMATE_SECTION_START}\nbroken`, 'utf-8');

  await assert.rejects(
    async () => {
      await upsertTeammateSection(
        claudePath,
        renderTeammateSection({
          mappings: [],
          providers: [],
        }),
      );
    },
    /mismatch/,
  );
});
