import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import TextInput from 'ink-text-input';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  deleteMapping,
  deleteProvider,
  type ProviderWithCredentials,
  createProvider,
  getCodexModel,
  getProviderSnapshot,
  listCodexModels,
  listMappingsWithWarnings,
  listProvidersDetailed,
  setCodexModel,
  setMapping,
  setProviderEnabled,
  switchProvider,
} from '../../services/provider-service.js';
import { initClaudeMdManagedSection } from '../../services/claude.js';
import { getProviderSectionFromStore } from '../../claude-md.js';
import { getCodexStatus, runCodexDaemonAction } from '../../daemon.js';
import { runCodexAuthAction } from '../../auth.js';
import { Frame } from '../components/Frame.js';
import type { MenuItem } from '../components/Menu.js';
import { Menu } from '../components/Menu.js';
import { Panel } from '../components/Panel.js';
import { Toast, type ToastMessage } from '../components/Toast.js';
import { useViewport } from '../hooks/useViewport.js';
import { PALETTE, UI } from '../theme/tokens.js';
import type { MappingWarning } from '@codex-proxy/provider-core';
import type { MappingDraft, ProviderDraft, Route } from './types.js';
import { BUILTIN_ANTHROPIC_PROVIDER_NAME } from '../../shared/constants.js';

interface ClaudeStatus {
  state: 'missing' | 'managed' | 'unmanaged' | 'malformed';
  message: string;
}

function formatProviderKind(provider: ProviderWithCredentials): string {
  return provider.provider.kind;
}

function isTextEntryRoute(route: Route): boolean {
  return route === 'provider_add_name'
    || route === 'provider_add_generic_base'
    || route === 'provider_add_generic_key'
    || route === 'mapping_set_agent'
    || route === 'mapping_set_suffix';
}

async function readClaudeStatus(): Promise<ClaudeStatus> {
  const path = resolve(process.cwd(), 'CLAUDE.md');

  try {
    await access(path);
  } catch {
    return {
      state: 'missing',
      message: 'CLAUDE.md missing',
    };
  }

  const content = await readFile(path, 'utf-8');
  const startCount = (content.match(/TEAMMATE INSTRUCTIONS START/g) ?? []).length;
  const endCount = (content.match(/TEAMMATE INSTRUCTIONS END/g) ?? []).length;

  if (startCount === 1 && endCount === 1) {
    return {
      state: 'managed',
      message: 'managed section present',
    };
  }

  if (startCount === 0 && endCount === 0) {
    return {
      state: 'unmanaged',
      message: 'no managed section',
    };
  }

  return {
    state: 'malformed',
    message: 'marker mismatch',
  };
}

export function TuiApp() {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const viewport = useViewport();

  const [route, setRoute] = useState<Route>('home');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [providers, setProviders] = useState<ProviderWithCredentials[]>([]);
  const [activeProviderName, setActiveProviderName] = useState<string | null>(null);
  const [mappingWarnings, setMappingWarnings] = useState<MappingWarning[]>([]);
  const [mappings, setMappings] = useState<Array<{ agentType: string; provider: string; teammateSuffix?: string }>>([]);
  const [codexStatus, setCodexStatus] = useState<{ daemon: 'running' | 'stopped'; auth: 'valid' | 'missing' | 'expired' }>({
    daemon: 'stopped',
    auth: 'missing',
  });
  const [codexModel, setCodexModelState] = useState('gpt-5.2-codex');
  const [codexModels, setCodexModels] = useState<Array<{ id: string; name: string }>>([]);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus>({ state: 'missing', message: 'not checked' });
  const [sectionPreview, setSectionPreview] = useState<string>('');

  const [providerDraft, setProviderDraft] = useState<ProviderDraft>({
    kind: null,
    name: '',
    baseUrl: '',
    apiKey: '',
  });
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>({
    agentType: '',
    providerName: '',
    teammateSuffix: '',
  });

  const [providerSelectionName, setProviderSelectionName] = useState<string>('');
  const [mappingSelectionAgentType, setMappingSelectionAgentType] = useState<string>('');
  const [codexReturnRoute, setCodexReturnRoute] = useState<Route>('provider_setup');

  const showToast = useCallback((message: ToastMessage) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const refreshData = useCallback(async () => {
    const [providerList, snapshot, mappingResult, codex, claude, model] = await Promise.all([
      listProvidersDetailed(),
      getProviderSnapshot(),
      listMappingsWithWarnings(),
      getCodexStatus(),
      readClaudeStatus(),
      getCodexModel(),
    ]);

    setProviders(providerList);
    setActiveProviderName(snapshot.activeProviderName);
    setMappingWarnings(mappingResult.warnings);
    setMappings(mappingResult.mappings);
    setCodexStatus(codex);
    setCodexModelState(model);
    setCodexModels(listCodexModels());
    setClaudeStatus(claude);
  }, []);

  useEffect(() => {
    refreshData().catch((error: Error) => {
      showToast({ type: 'error', text: error.message });
    });
  }, [refreshData, showToast]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [route]);

  const withBusy = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
      await refreshData();
    } finally {
      setBusy(false);
    }
  }, [refreshData]);

  const homeMenu = useMemo<MenuItem[]>(() => ([
    { label: 'Provider Setup', value: 'provider_setup' },
    { label: 'Agent Setup', value: 'agent_setup' },
    { label: 'Initialize Repo', value: 'readiness' },
    { label: 'Exit', value: 'exit' },
  ]), []);

  const providerMenu = useMemo<MenuItem[]>(() => ([
    { label: 'Switch Active Provider', value: 'switch' },
    { label: 'Add Provider', value: 'add' },
    { label: 'Enable/Disable Provider', value: 'toggle' },
    { label: 'Delete Provider', value: 'delete' },
    { label: 'Back', value: 'back' },
  ]), []);

  const agentMenu = useMemo<MenuItem[]>(() => ([
    { label: 'Set Mapping', value: 'set' },
    { label: 'Delete Mapping', value: 'delete' },
    { label: 'Project Integration', value: 'integration' },
    { label: 'Back', value: 'back' },
  ]), []);

  const readinessMenu = useMemo<MenuItem[]>(() => ([
    { label: codexStatus.daemon === 'running' ? 'Restart Codex Daemon' : 'Start Codex Daemon', value: 'daemon' },
    { label: codexStatus.auth === 'valid' ? 'Re-authenticate Codex' : 'Authenticate Codex', value: 'auth' },
    { label: 'Regenerate CLAUDE Section', value: 'claude' },
    { label: 'Back', value: 'back' },
  ]), [codexStatus.auth, codexStatus.daemon]);

  const codexMenu = useMemo<MenuItem[]>(() => ([
    { label: codexStatus.daemon === 'running' ? 'Restart Daemon' : 'Start Daemon', value: 'daemon' },
    { label: codexStatus.auth === 'valid' ? 'Re-authenticate' : 'Authenticate', value: 'auth' },
    { label: 'Select Model', hint: codexModel, value: 'model' },
    { label: 'Back', value: 'back' },
  ]), [codexModel, codexStatus.auth, codexStatus.daemon]);

  const codexModelMenu = useMemo<MenuItem[]>(() => {
    const items = codexModels.map((model) => ({
      label: model.name,
      hint: model.id === codexModel ? 'current' : model.id,
      value: model.id,
    }));

    return [...items, { label: 'Back', value: '__back' }];
  }, [codexModel, codexModels]);

  const providerSelectMenu = useMemo<MenuItem[]>(() => {
    if (route === 'provider_switch' || route === 'provider_toggle' || route === 'provider_delete') {
      const selectableProviders = route === 'provider_switch'
        ? providers
        : providers.filter((provider) => provider.provider.name !== BUILTIN_ANTHROPIC_PROVIDER_NAME);

      const items: MenuItem[] = selectableProviders.map((provider) => ({
        label: `${provider.provider.name} [${formatProviderKind(provider)}]`,
        hint: provider.provider.name === activeProviderName ? 'active' : provider.provider.enabled ? 'enabled' : 'disabled',
        value: provider.provider.name,
      }));
      return [...items, { label: 'Back', value: '__back' }];
    }

    if (route === 'mapping_set_provider') {
      const items: MenuItem[] = providers
        .filter((provider) => provider.provider.enabled)
        .map((provider) => ({
          label: `${provider.provider.name} [${formatProviderKind(provider)}]`,
          value: provider.provider.name,
        }));
      return [...items, { label: 'Back', value: '__back' }];
    }

    if (route === 'mapping_delete') {
      const items: MenuItem[] = mappings.map((mapping) => ({
        label: `${mapping.agentType} -> ${mapping.provider}`,
        value: mapping.agentType,
      }));
      return [...items, { label: 'Back', value: '__back' }];
    }

    return [];
  }, [activeProviderName, mappings, providers, route]);

  const providerDeleteConfirmMenu = useMemo<MenuItem[]>(() => ([
    { label: `Delete ${providerSelectionName}`, value: 'confirm' },
    { label: 'Cancel', value: 'cancel' },
  ]), [providerSelectionName]);

  const providerKindMenu = useMemo<MenuItem[]>(() => ([
    { label: 'Generic', hint: 'custom endpoint + optional key', value: 'generic' },
    { label: 'Codex', hint: 'managed localhost codex proxy', value: 'codex' },
    { label: 'Back', value: 'back' },
  ]), []);

  const currentMenu: MenuItem[] = useMemo(() => {
    if (route === 'home') return homeMenu;
    if (route === 'provider_setup') return providerMenu;
    if (route === 'provider_add_kind') return providerKindMenu;
    if (route === 'provider_switch' || route === 'provider_toggle' || route === 'provider_delete' || route === 'mapping_set_provider' || route === 'mapping_delete') return providerSelectMenu;
    if (route === 'provider_delete_confirm') return providerDeleteConfirmMenu;
    if (route === 'agent_setup') return agentMenu;
    if (route === 'project_integration') return [
      { label: 'Refresh Preview', value: 'preview' },
      { label: 'Write Managed Section', value: 'write' },
      { label: 'Back', value: 'back' },
    ];
    if (route === 'readiness') return readinessMenu;
    if (route === 'codex_setup') return codexMenu;
    if (route === 'codex_model') return codexModelMenu;

    return [];
  }, [agentMenu, codexMenu, codexModelMenu, homeMenu, providerDeleteConfirmMenu, providerKindMenu, providerMenu, providerSelectMenu, readinessMenu, route]);

  const activeMenuItem = currentMenu[selectedIndex] ?? null;

  const goBack = useCallback(() => {
    if (route === 'home') {
      exit();
      return;
    }

    if (route === 'provider_setup' || route === 'agent_setup' || route === 'readiness') {
      setRoute('home');
      return;
    }

    if (route === 'provider_add_kind') {
      setRoute('provider_setup');
      return;
    }

    if (route === 'provider_add_name') {
      setRoute('provider_add_kind');
      return;
    }

    if (route === 'provider_add_generic_base') {
      setRoute('provider_add_name');
      return;
    }

    if (route === 'provider_add_generic_key') {
      setRoute('provider_add_generic_base');
      return;
    }

    if (route === 'provider_switch' || route === 'provider_toggle' || route === 'provider_delete' || route === 'provider_delete_confirm') {
      setRoute('provider_setup');
      return;
    }

    if (route === 'mapping_set_agent' || route === 'mapping_delete' || route === 'project_integration') {
      setRoute('agent_setup');
      return;
    }

    if (route === 'mapping_set_provider') {
      setRoute('mapping_set_agent');
      return;
    }

    if (route === 'mapping_set_suffix') {
      setRoute('mapping_set_provider');
      return;
    }

    if (route === 'codex_setup') {
      setRoute(codexReturnRoute);
      return;
    }

    if (route === 'codex_model') {
      setRoute('codex_setup');
      return;
    }

    setRoute('home');
  }, [codexReturnRoute, exit, route]);

  const finishProviderCreate = useCallback(async () => {
    if (!providerDraft.kind) {
      throw new Error('Provider type not selected');
    }

    await createProvider({
      name: providerDraft.name.trim(),
      kind: providerDraft.kind,
      baseUrl: providerDraft.baseUrl.trim(),
      apiKey: providerDraft.apiKey.trim() || undefined,
    });

    await switchProvider(providerDraft.name.trim());

    setProviderDraft({ kind: null, name: '', baseUrl: '', apiKey: '' });
    setRoute('provider_setup');
    showToast({ type: 'success', text: `Provider '${providerDraft.name.trim()}' created and activated` });
  }, [providerDraft, showToast]);

  const handleSelect = useCallback(async () => {
    if (!activeMenuItem || busy) return;

    if (route === 'home') {
      if (activeMenuItem.value === 'provider_setup') setRoute('provider_setup');
      if (activeMenuItem.value === 'agent_setup') setRoute('agent_setup');
      if (activeMenuItem.value === 'readiness') setRoute('readiness');
      if (activeMenuItem.value === 'exit') exit();
      return;
    }

    if (route === 'provider_setup') {
      if (activeMenuItem.value === 'switch') setRoute('provider_switch');
      if (activeMenuItem.value === 'add') setRoute('provider_add_kind');
      if (activeMenuItem.value === 'toggle') setRoute('provider_toggle');
      if (activeMenuItem.value === 'delete') setRoute('provider_delete');
      if (activeMenuItem.value === 'back') setRoute('home');
      return;
    }

    if (route === 'provider_add_kind') {
      if (activeMenuItem.value === 'back') {
        setRoute('provider_setup');
        return;
      }

      setProviderDraft({ kind: activeMenuItem.value as ProviderDraft['kind'], name: '', baseUrl: '', apiKey: '' });

      if (activeMenuItem.value === 'codex') {
        setCodexReturnRoute('provider_add_kind');
        setRoute('codex_setup');
        return;
      }

      setRoute('provider_add_name');
      return;
    }

    if (route === 'provider_switch') {
      if (activeMenuItem.value === '__back') {
        setRoute('provider_setup');
        return;
      }

      await withBusy(async () => {
        await switchProvider(activeMenuItem.value);
        showToast({ type: 'success', text: `Switched to ${activeMenuItem.value}` });
        setRoute('provider_setup');
      });
      return;
    }

    if (route === 'provider_toggle') {
      if (activeMenuItem.value === '__back') {
        setRoute('provider_setup');
        return;
      }

      const provider = providers.find((item) => item.provider.name === activeMenuItem.value);
      if (!provider) return;

      await withBusy(async () => {
        await setProviderEnabled(provider.provider.name, !provider.provider.enabled);
        showToast({ type: 'success', text: `${provider.provider.name} ${provider.provider.enabled ? 'disabled' : 'enabled'}` });
      });
      return;
    }

    if (route === 'provider_delete') {
      if (activeMenuItem.value === '__back') {
        setRoute('provider_setup');
        return;
      }
      setProviderSelectionName(activeMenuItem.value);
      setRoute('provider_delete_confirm');
      return;
    }

    if (route === 'provider_delete_confirm') {
      if (activeMenuItem.value === 'cancel') {
        setRoute('provider_setup');
        return;
      }

      await withBusy(async () => {
        await deleteProvider(providerSelectionName);
        showToast({ type: 'success', text: `Deleted ${providerSelectionName}` });
        setRoute('provider_setup');
      });
      return;
    }

    if (route === 'agent_setup') {
      if (activeMenuItem.value === 'set') setRoute('mapping_set_agent');
      if (activeMenuItem.value === 'delete') setRoute('mapping_delete');
      if (activeMenuItem.value === 'integration') {
        setRoute('project_integration');
      }
      if (activeMenuItem.value === 'back') setRoute('home');
      return;
    }

    if (route === 'mapping_set_provider') {
      if (activeMenuItem.value === '__back') {
        setRoute('mapping_set_agent');
        return;
      }

      setMappingDraft((current) => ({ ...current, providerName: activeMenuItem.value }));
      setRoute('mapping_set_suffix');
      return;
    }

    if (route === 'mapping_delete') {
      if (activeMenuItem.value === '__back') {
        setRoute('agent_setup');
        return;
      }

      setMappingSelectionAgentType(activeMenuItem.value);

      await withBusy(async () => {
        await deleteMapping(activeMenuItem.value);
        showToast({ type: 'success', text: `Deleted mapping '${activeMenuItem.value}'` });
        setRoute('agent_setup');
      });
      return;
    }

    if (route === 'project_integration') {
      if (activeMenuItem.value === 'preview') {
        await withBusy(async () => {
          const preview = await getProviderSectionFromStore();
          setSectionPreview(preview);
          showToast({ type: 'info', text: 'Preview refreshed' });
        });
      }

      if (activeMenuItem.value === 'write') {
        await withBusy(async () => {
          await initClaudeMdManagedSection();
          showToast({ type: 'success', text: 'CLAUDE managed section updated' });
        });
      }

      if (activeMenuItem.value === 'back') setRoute('agent_setup');
      return;
    }

    if (route === 'readiness') {
      if (activeMenuItem.value === 'daemon') {
        await withBusy(async () => {
          const result = await runCodexDaemonAction();
          if (!result.success) {
            throw new Error(result.message);
          }
          showToast({ type: 'success', text: result.message });
        });
      }

      if (activeMenuItem.value === 'auth') {
        await withBusy(async () => {
          const result = await runCodexAuthAction();
          showToast({ type: 'success', text: result === 'reauthenticated' ? 'Re-authenticated codex' : 'Authenticated codex' });
        });
      }

      if (activeMenuItem.value === 'claude') {
        await withBusy(async () => {
          await initClaudeMdManagedSection();
          showToast({ type: 'success', text: 'CLAUDE managed section updated' });
        });
      }

      if (activeMenuItem.value === 'back') setRoute('home');
      return;
    }

    if (route === 'codex_setup') {
      if (activeMenuItem.value === 'daemon') {
        await withBusy(async () => {
          const result = await runCodexDaemonAction();
          if (!result.success) {
            throw new Error(result.message);
          }
          showToast({ type: 'success', text: result.message });
        });
      }

      if (activeMenuItem.value === 'auth') {
        await withBusy(async () => {
          const result = await runCodexAuthAction();
          showToast({ type: 'success', text: result === 'reauthenticated' ? 'Re-authenticated codex' : 'Authenticated codex' });
        });
      }

      if (activeMenuItem.value === 'model') {
        setRoute('codex_model');
      }

      if (activeMenuItem.value === 'back') setRoute(codexReturnRoute);
      return;
    }

    if (route === 'codex_model') {
      if (activeMenuItem.value === '__back') {
        setRoute('codex_setup');
        return;
      }

      await withBusy(async () => {
        await setCodexModel(activeMenuItem.value);
        showToast({ type: 'success', text: `Codex model set to ${activeMenuItem.value}` });
        setRoute('codex_setup');
      });
      return;
    }
  }, [activeMenuItem, busy, codexReturnRoute, exit, providerSelectionName, providers, route, setRoute, showToast, withBusy]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (input === 'q' && !isTextEntryRoute(route)) {
      exit();
      return;
    }

    if (key.escape) {
      goBack();
      return;
    }

    if (isTextEntryRoute(route)) {
      return;
    }

    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex((current) => current - 1);
      return;
    }

    if (key.downArrow && selectedIndex < currentMenu.length - 1) {
      setSelectedIndex((current) => current + 1);
      return;
    }

    if (key.return) {
      handleSelect().catch((error: Error) => {
        showToast({ type: 'error', text: error.message });
      });
    }
  }, { isActive: isRawModeSupported });

  useEffect(() => {
    if (route === 'project_integration') {
      getProviderSectionFromStore()
        .then((preview) => setSectionPreview(preview))
        .catch((error: Error) => showToast({ type: 'error', text: error.message }));
    }
  }, [route, showToast]);

  const readinessChecks = useMemo(() => {
    const enabledProviders = providers.filter((provider) => provider.provider.enabled).length;
    const hasActive = Boolean(activeProviderName);
    const mappingOk = mappingWarnings.length === 0;
    const codexOk = codexStatus.daemon === 'running' && codexStatus.auth === 'valid';

    return {
      enabledProviders,
      hasActive,
      mappingOk,
      codexOk,
    };
  }, [activeProviderName, codexStatus.auth, codexStatus.daemon, mappingWarnings.length, providers]);

  if (!isRawModeSupported) {
    return <Text color={PALETTE.error}>TUI requires an interactive terminal (raw mode).</Text>;
  }

  if (viewport.isTiny) {
    return (
      <Box flexDirection="column">
        <Text color={PALETTE.warn}>Terminal too small for full-screen mode.</Text>
        <Text color={PALETTE.dim}>Current: {viewport.width}x{viewport.height}</Text>
        <Text color={PALETTE.dim}>Minimum: {UI.minWidth}x{UI.minHeight}</Text>
      </Box>
    );
  }

  type LayoutTier = 'small' | 'medium' | 'large';
  const layoutTier: LayoutTier = viewport.width < 100 || viewport.height < 26
    ? 'small'
    : viewport.width < 140 || viewport.height < 38
      ? 'medium'
      : 'large';
  const isCompactViewport = layoutTier === 'small';
  const shouldCenterCompact = layoutTier === 'small';
  const spacingUnit = layoutTier === 'small' ? 0 : 1;
  const contentGap = spacingUnit;
  const stateColumns = layoutTier === 'small' ? 2 : 3;
  const providerRowLimit = layoutTier === 'small' ? 3 : layoutTier === 'medium' ? 6 : 10;
  const showGlobalCurrentState = route !== 'provider_setup';
  const compactPanelWidth = shouldCenterCompact ? Math.max(38, Math.min(viewport.width - 8, 76)) : undefined;
  const statePanelWidth = Math.max(48, viewport.width - 12);
  const stateColumnWidth = Math.max(18, Math.floor((statePanelWidth - (spacingUnit * (stateColumns - 1))) / stateColumns));
  const truncateMetric = (value: string): string => {
    const maxLength = layoutTier === 'small' ? 14 : layoutTier === 'medium' ? 20 : 28;
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 1)}…`;
  };
  const statusMetrics = layoutTier === 'small'
    ? [
        {
          label: 'Active',
          value: truncateMetric(activeProviderName ?? '(none)'),
          color: PALETTE.accent,
        },
        {
          label: 'Warnings',
          value: String(mappingWarnings.length),
          color: mappingWarnings.length > 0 ? PALETTE.warn : PALETTE.success,
        },
        {
          label: 'Codex Daemon',
          value: truncateMetric(codexStatus.daemon),
          color: codexStatus.daemon === 'running' ? PALETTE.success : PALETTE.warn,
        },
        {
          label: 'Codex Auth',
          value: truncateMetric(codexStatus.auth),
          color: codexStatus.auth === 'valid' ? PALETTE.success : PALETTE.warn,
        },
      ]
    : [
        {
          label: 'Active',
          value: truncateMetric(activeProviderName ?? '(none)'),
          color: PALETTE.accent,
        },
        {
          label: 'Providers',
          value: String(providers.length),
          color: PALETTE.accent,
        },
        {
          label: 'Warnings',
          value: String(mappingWarnings.length),
          color: mappingWarnings.length > 0 ? PALETTE.warn : PALETTE.success,
        },
        {
          label: 'Codex Daemon',
          value: truncateMetric(codexStatus.daemon),
          color: codexStatus.daemon === 'running' ? PALETTE.success : PALETTE.warn,
        },
        {
          label: 'Codex Auth',
          value: truncateMetric(codexStatus.auth),
          color: codexStatus.auth === 'valid' ? PALETTE.success : PALETTE.warn,
        },
        {
          label: 'CLAUDE',
          value: truncateMetric(claudeStatus.message),
          color: claudeStatus.state === 'managed' ? PALETTE.success : PALETTE.warn,
        },
      ];
  const statusRows: Array<Array<(typeof statusMetrics)[number]>> = [];
  for (let index = 0; index < statusMetrics.length; index += stateColumns) {
    statusRows.push(statusMetrics.slice(index, index + stateColumns));
  }

  const currentStatePanel = (
    <Panel title="Current State" compact={isCompactViewport} width={compactPanelWidth}>
      {statusRows.map((row, rowIndex) => (
        <Box
          key={row.map((metric) => metric.label).join('-')}
          flexDirection="row"
          justifyContent="space-between"
          gap={spacingUnit}
          marginTop={rowIndex === 0 ? 0 : spacingUnit}
        >
          {row.map((metric) => (
            <Box key={`${metric.label}-${metric.value}`} width={stateColumnWidth}>
              <Text color={PALETTE.text}>
                {metric.label}: <Text color={metric.color}>{metric.value}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Panel>
  );

  const content = (() => {
    if (route === 'home') {
      return (
        <Panel title="Navigation" compact={isCompactViewport} width={compactPanelWidth}>
          <Menu items={homeMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
        </Panel>
      );
    }

    if (route === 'provider_setup') {
      const rankedProviders = [...providers].sort((left, right) => {
        const leftActive = left.provider.name === activeProviderName ? 1 : 0;
        const rightActive = right.provider.name === activeProviderName ? 1 : 0;
        if (leftActive !== rightActive) {
          return rightActive - leftActive;
        }
        return left.provider.name.localeCompare(right.provider.name);
      });
      const visibleProviders = rankedProviders.slice(0, providerRowLimit);
      const hiddenProviderCount = rankedProviders.length - visibleProviders.length;

      return (
        <Box flexDirection="column" gap={contentGap}>
          <Panel title="Providers" compact={isCompactViewport} width={compactPanelWidth}>
            {providers.length === 0 ? <Text color={PALETTE.dim}>(none)</Text> : null}
            <Box flexDirection="column" gap={spacingUnit}>
              {visibleProviders.map((provider) => (
                <Box key={provider.provider.name}>
                  <Text color={provider.provider.name === activeProviderName ? PALETTE.accent : PALETTE.text}>
                    {provider.provider.name === activeProviderName ? '▶ ' : '  '}
                    {provider.provider.name}
                  </Text>
                  <Text color={PALETTE.dim}> [{formatProviderKind(provider)}]</Text>
                  {provider.provider.name === BUILTIN_ANTHROPIC_PROVIDER_NAME ? <Text color={PALETTE.dim}> [builtin]</Text> : null}
                  <Text color={provider.provider.enabled ? PALETTE.success : PALETTE.warn}> {provider.provider.enabled ? 'enabled' : 'disabled'}</Text>
                  {provider.provider.kind === 'codex' ? (
                    <>
                      <Text color={codexStatus.auth === 'valid' ? PALETTE.success : PALETTE.error}>
                        {' '}[{codexStatus.auth === 'valid' ? 'authed' : 'not authed'}]
                      </Text>
                      <Text color={codexStatus.daemon === 'running' ? PALETTE.success : PALETTE.error}>
                        {' '}[{codexStatus.daemon === 'running' ? 'daemon' : 'no daemon'}]
                      </Text>
                      <Text color={PALETTE.dim}>
                        {' '}[model {codexModel}]
                      </Text>
                    </>
                  ) : null}
                </Box>
              ))}
            </Box>
            {hiddenProviderCount > 0 ? <Text color={PALETTE.dim}>… {hiddenProviderCount} more providers</Text> : null}
          </Panel>
          <Panel title="Actions" compact={isCompactViewport} width={compactPanelWidth}>
            <Menu items={providerMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
          </Panel>
        </Box>
      );
    }

    if (route === 'provider_add_kind' || route === 'provider_switch' || route === 'provider_toggle' || route === 'provider_delete' || route === 'provider_delete_confirm') {
      return (
        <Panel title="Selection" compact={isCompactViewport} width={compactPanelWidth}>
          <Menu items={currentMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
        </Panel>
      );
    }

    if (route === 'provider_add_name') {
      return (
        <Panel title="Provider Name" compact={isCompactViewport} width={compactPanelWidth}>
          <Text color={PALETTE.dim}>Type: {providerDraft.kind}</Text>
          <Text color={PALETTE.dim}>Allowed: lowercase letters, numbers, hyphens.</Text>
          <Box marginTop={spacingUnit}>
            <Text color={PALETTE.accent}>name: </Text>
            <TextInput
              value={providerDraft.name}
              onChange={(value) => setProviderDraft((current) => ({ ...current, name: value }))}
              onSubmit={(value) => {
                const trimmed = value.trim();
                if (!trimmed || !/^[a-z0-9-]+$/.test(trimmed)) {
                  showToast({ type: 'error', text: 'Invalid name format' });
                  return;
                }

                setProviderDraft((current) => ({ ...current, name: trimmed }));

                if (providerDraft.kind === 'generic') {
                  setRoute('provider_add_generic_base');
                  return;
                }

                withBusy(async () => {
                  await finishProviderCreate();
                }).catch((error: Error) => showToast({ type: 'error', text: error.message }));
              }}
            />
          </Box>
        </Panel>
      );
    }

    if (route === 'provider_add_generic_base') {
      return (
        <Panel title="Generic Provider Endpoint" compact={isCompactViewport} width={compactPanelWidth}>
          <Text color={PALETTE.dim}>Example: https://openrouter.ai/api/v1</Text>
          <Box marginTop={spacingUnit}>
            <Text color={PALETTE.accent}>base_url: </Text>
            <TextInput
              value={providerDraft.baseUrl}
              onChange={(value) => setProviderDraft((current) => ({ ...current, baseUrl: value }))}
              onSubmit={(value) => {
                try {
                  const parsed = new URL(value.trim());
                  setProviderDraft((current) => ({ ...current, baseUrl: parsed.toString().replace(/\/$/, '') }));
                  setRoute('provider_add_generic_key');
                } catch {
                  showToast({ type: 'error', text: 'Invalid URL' });
                }
              }}
            />
          </Box>
        </Panel>
      );
    }

    if (route === 'provider_add_generic_key') {
      return (
        <Panel title="Generic API Key (Optional)" compact={isCompactViewport} width={compactPanelWidth}>
          <Text color={PALETTE.dim}>Press Enter with empty input to skip.</Text>
          <Box marginTop={spacingUnit}>
            <Text color={PALETTE.accent}>api_key: </Text>
            <TextInput
              value={providerDraft.apiKey}
              onChange={(value) => setProviderDraft((current) => ({ ...current, apiKey: value }))}
              onSubmit={(value) => {
                setProviderDraft((current) => ({ ...current, apiKey: value.trim() }));
                withBusy(async () => {
                  await finishProviderCreate();
                }).catch((error: Error) => showToast({ type: 'error', text: error.message }));
              }}
            />
          </Box>
        </Panel>
      );
    }

    if (route === 'agent_setup') {
      return (
        <Box flexDirection="column" gap={contentGap}>
          <Panel title="Mappings" compact={isCompactViewport} width={compactPanelWidth}>
            {mappings.length === 0 ? <Text color={PALETTE.dim}>(none)</Text> : null}
            <Box flexDirection="column" gap={spacingUnit}>
              {mappings.map((mapping) => (
                <Text key={mapping.agentType} color={PALETTE.text}>
                  {mapping.agentType} {'->'} {mapping.provider}{mapping.teammateSuffix ? ` (${mapping.teammateSuffix})` : ''}
                </Text>
              ))}
            </Box>
            {mappingWarnings.length > 0 ? (
              <Box flexDirection="column" marginTop={spacingUnit} gap={spacingUnit}>
                <Text color={PALETTE.warn}>Warnings:</Text>
                {mappingWarnings.map((warning, index) => (
                  <Text key={`${warning.agentType}-${index}`} color={PALETTE.warn}>
                    {warning.agentType} {'->'} {warning.provider} ({warning.reason === 'missing_provider' ? 'missing' : 'disabled'})
                  </Text>
                ))}
              </Box>
            ) : null}
          </Panel>
          <Panel title="Actions" compact={isCompactViewport} width={compactPanelWidth}>
            <Menu items={agentMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
          </Panel>
        </Box>
      );
    }

    if (route === 'mapping_set_agent') {
      return (
        <Panel title="Set Mapping / Agent Type" compact={isCompactViewport} width={compactPanelWidth}>
          <Text color={PALETTE.dim}>Example: coder, research, designer</Text>
          <Box marginTop={spacingUnit}>
            <Text color={PALETTE.accent}>agent_type: </Text>
            <TextInput
              value={mappingDraft.agentType}
              onChange={(value) => setMappingDraft((current) => ({ ...current, agentType: value }))}
              onSubmit={(value) => {
                const trimmed = value.trim();
                if (!trimmed) {
                  showToast({ type: 'error', text: 'Agent type is required' });
                  return;
                }
                setMappingDraft((current) => ({ ...current, agentType: trimmed }));
                setRoute('mapping_set_provider');
              }}
            />
          </Box>
        </Panel>
      );
    }

    if (route === 'mapping_set_provider' || route === 'mapping_delete') {
      return (
        <Panel title={route === 'mapping_set_provider' ? 'Set Mapping / Provider' : 'Delete Mapping'} compact={isCompactViewport} width={compactPanelWidth}>
          <Menu items={currentMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
        </Panel>
      );
    }

    if (route === 'mapping_set_suffix') {
      return (
        <Panel title="Set Mapping / Teammate Suffix" compact={isCompactViewport} width={compactPanelWidth}>
          <Text color={PALETTE.dim}>Optional. Press Enter empty to skip.</Text>
          <Box marginTop={spacingUnit}>
            <Text color={PALETTE.accent}>suffix: </Text>
            <TextInput
              value={mappingDraft.teammateSuffix}
              onChange={(value) => setMappingDraft((current) => ({ ...current, teammateSuffix: value }))}
              onSubmit={(value) => {
                const trimmed = value.trim();
                withBusy(async () => {
                  await setMapping(mappingDraft.agentType, mappingDraft.providerName, trimmed || undefined);
                  showToast({ type: 'success', text: `Mapped ${mappingDraft.agentType} -> ${mappingDraft.providerName}` });
                  setMappingDraft({ agentType: '', providerName: '', teammateSuffix: '' });
                  setRoute('agent_setup');
                }).catch((error: Error) => showToast({ type: 'error', text: error.message }));
              }}
            />
          </Box>
        </Panel>
      );
    }

    if (route === 'project_integration') {
      const previewMaxLines = layoutTier === 'small' ? 4 : layoutTier === 'medium' ? 6 : 8;
      const previewOffset = layoutTier === 'small' ? 16 : 14;
      const previewLines = sectionPreview.split('\n').slice(0, Math.max(previewMaxLines, viewport.height - previewOffset));
      return (
        <Box flexDirection="column" gap={contentGap}>
          <Panel title="CLAUDE.md Preview" compact={isCompactViewport} width={compactPanelWidth}>
            {previewLines.length === 0 ? <Text color={PALETTE.dim}>No preview loaded.</Text> : null}
            {previewLines.map((line, index) => (
              <Text key={index} color={PALETTE.text}>{line}</Text>
            ))}
          </Panel>
          <Panel title="Actions" compact={isCompactViewport} width={compactPanelWidth}>
            <Menu items={currentMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
          </Panel>
        </Box>
      );
    }

    if (route === 'readiness') {
      return (
        <Box flexDirection="column" gap={contentGap}>
          <Panel title="Init Checklist" compact={isCompactViewport} width={compactPanelWidth}>
            <Text color={readinessChecks.enabledProviders > 0 ? PALETTE.success : PALETTE.error}>
              Providers enabled: {readinessChecks.enabledProviders}
            </Text>
            <Text color={readinessChecks.hasActive ? PALETTE.success : PALETTE.error}>
              Active provider: {activeProviderName ?? '(none)'}
            </Text>
            <Text color={readinessChecks.mappingOk ? PALETTE.success : PALETTE.warn}>
              Mapping warnings: {mappingWarnings.length}
            </Text>
            <Text color={readinessChecks.codexOk ? PALETTE.success : PALETTE.warn}>
              Codex health: daemon={codexStatus.daemon}, codexAuth={codexStatus.auth}
            </Text>
            <Text color={claudeStatus.state === 'managed' ? PALETTE.success : PALETTE.warn}>
              CLAUDE: {claudeStatus.message}
            </Text>
          </Panel>
          <Panel title="Init Actions" compact={isCompactViewport} width={compactPanelWidth}>
            <Menu items={readinessMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
          </Panel>
        </Box>
      );
    }

    if (route === 'codex_setup') {
      return (
        <Box flexDirection="column" gap={contentGap}>
          <Panel title="Codex Status" compact={isCompactViewport} width={compactPanelWidth}>
            <Text color={codexStatus.daemon === 'running' ? PALETTE.success : PALETTE.warn}>Daemon: {codexStatus.daemon}</Text>
            <Text color={codexStatus.auth === 'valid' ? PALETTE.success : PALETTE.warn}>Codex Auth: {codexStatus.auth}</Text>
            <Text color={PALETTE.text}>Model: {codexModel}</Text>
            <Text color={PALETTE.dim}>Endpoint: http://127.0.0.1:4096 (managed)</Text>
            <Text color={PALETTE.dim}>Key: dummy_key (managed)</Text>
          </Panel>
          <Panel title="Actions" compact={isCompactViewport} width={compactPanelWidth}>
            <Menu items={codexMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
          </Panel>
        </Box>
      );
    }

    if (route === 'codex_model') {
      return (
        <Panel title="Codex Model" compact={isCompactViewport} width={compactPanelWidth}>
          <Text color={PALETTE.dim}>Choose model for proxy fallback + default routing.</Text>
          <Box marginTop={spacingUnit}>
            <Menu items={codexModelMenu} selectedIndex={selectedIndex} variant="buttons" compact={isCompactViewport} spacing={spacingUnit} />
          </Box>
        </Panel>
      );
    }

    return <Text color={PALETTE.dim}>No content for route: {route}</Text>;
  })();

  return (
    <Frame
      viewport={viewport}
      compact={isCompactViewport}
      spacing={spacingUnit}
      footer={
        busy
          ? (isCompactViewport ? `Working · ${viewport.width}x${viewport.height}` : `Working... · ${viewport.width}x${viewport.height}`)
          : (isCompactViewport
            ? `↑/↓ Enter Esc q · ${viewport.width}x${viewport.height}`
            : `↑/↓ navigate · Enter select · Esc back · q quit · ${viewport.width}x${viewport.height}`)
      }
    >
      <Box flexDirection="column" gap={contentGap} alignItems={shouldCenterCompact ? 'center' : undefined}>
        {showGlobalCurrentState ? currentStatePanel : null}
        {content}
        {toast ? <Toast message={toast} /> : null}
      </Box>
    </Frame>
  );
}
