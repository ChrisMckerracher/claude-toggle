import { TEAMMATE_SECTION_END, TEAMMATE_SECTION_START } from './section-markers.js';
import type { AgentProviderMapping, MappingWarning, Provider } from '../types.js';

export interface RenderSectionInput {
  mappings: AgentProviderMapping[];
  providers: Provider[];
  warnings?: MappingWarning[];
}

function describeWarning(warning: MappingWarning): string {
  if (warning.reason === 'missing_provider') {
    return `${warning.agentType}: mapped provider '${warning.provider}' is missing`;
  }
  return `${warning.agentType}: mapped provider '${warning.provider}' is disabled`;
}

export function renderTeammateSection(input: RenderSectionInput): string {
  const lines: string[] = [];

  lines.push(TEAMMATE_SECTION_START);
  lines.push('## Agent Provider Configuration', '');

  if (input.mappings.length === 0) {
    lines.push('No agent/provider mappings configured yet.', '');
  } else {
    lines.push('| Agent Type | Provider | Command |');
    lines.push('|------------|----------|---------|');

    for (const mapping of input.mappings) {
      lines.push(`| ${mapping.agentType} | ${mapping.provider} | \`eval "$(ct ${mapping.provider})"\` |`);
    }

    lines.push('');
  }

  if (input.warnings && input.warnings.length > 0) {
    lines.push('### Mapping Warnings');
    for (const warning of input.warnings) {
      lines.push(`- ${describeWarning(warning)}`);
    }
    lines.push('');
  }

  lines.push('### Provider Commands');
  for (const provider of input.providers.filter((item) => item.enabled)) {
    lines.push(`- \`eval "$(ct ${provider.name})"\``);
  }
  lines.push('- `ct status`', '');
  lines.push(TEAMMATE_SECTION_END);

  return `${lines.join('\n')}\n`;
}
