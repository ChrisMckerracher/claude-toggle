import { deleteMapping, listMappingsWithWarnings, setMapping } from '../../services/provider-service.js';
import { failure, success, type CommandResult } from '../types.js';

export async function runMappingList(): Promise<CommandResult> {
  try {
    const { mappings, warnings } = await listMappingsWithWarnings();
    const lines = ['Agent Mappings:', ''];

    if (mappings.length === 0) {
      lines.push('(none)');
    } else {
      for (const mapping of mappings) {
        lines.push(
          `- ${mapping.agentType} -> ${mapping.provider}${
            mapping.teammateSuffix ? ` (suffix: ${mapping.teammateSuffix})` : ''
          }`,
        );
      }
    }

    if (warnings.length > 0) {
      lines.push('', 'Warnings:');
      for (const warning of warnings) {
        const reason = warning.reason === 'missing_provider' ? 'missing provider' : 'disabled provider';
        lines.push(`- ${warning.agentType} -> ${warning.provider} (${reason})`);
      }
    }

    return success(lines);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runMappingSet(
  agentType: string,
  providerName: string,
  teammateSuffix?: string,
): Promise<CommandResult> {
  try {
    await setMapping(agentType, providerName, teammateSuffix);
    return success([`\x1b[32m✓ Set mapping '${agentType}' -> '${providerName}'\x1b[0m`]);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runMappingDelete(agentType: string): Promise<CommandResult> {
  try {
    await deleteMapping(agentType);
    return success([`\x1b[32m✓ Deleted mapping '${agentType}'\x1b[0m`]);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}
