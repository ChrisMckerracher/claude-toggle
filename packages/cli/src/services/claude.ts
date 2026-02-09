import { resolve } from 'node:path';
import { renderTeammateSection, upsertTeammateSection } from '@codex-proxy/provider-core';
import { getMappingsAndProviders } from './provider-service.js';

export async function initClaudeMdManagedSection(projectPath = process.cwd()): Promise<void> {
  const { mappings, providers, warnings } = await getMappingsAndProviders();

  const section = renderTeammateSection({
    mappings,
    providers,
    warnings,
  });

  const claudePath = resolve(projectPath, 'CLAUDE.md');
  await upsertTeammateSection(claudePath, section);
}
