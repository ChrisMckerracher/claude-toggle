# CLI Rewrite Plan: `packages/cli`

**Status:** Draft  
**Owner:** CLI/Platform  
**Last Updated:** 2026-02-07

## 1. Purpose

Rewrite `packages/cli` into a maintainable, testable, and visually strong TUI application with clear module boundaries, low duplication, and reliable operational behavior.

This plan addresses:
- Architecture debt (SRP/DRY violations, tight coupling, dead code, weak boundaries)
- Product debt (unfinished flows, fragile UX)
- Visual debt (inconsistent styling, brittle box drawing, poor information hierarchy)

## 2. Current State Summary

`packages/cli` currently works as a mixed CLI/TUI/provider manager, but it is difficult to evolve safely.

Key issues:
- Monolithic TUI file (`src/tui.tsx`, ~1190 lines)
- Typecheck is currently broken due to prop mismatch in TUI
- Command parsing and side effects are tightly coupled in `src/index.ts`
- Daemon/auth/config concerns are mixed with presentation and process-control details
- Several unfinished/placeholder flows (category edit/delete)
- Repeated manual layout logic and fixed-width spacing that can fail at runtime
- Installed dependencies are not leveraged (`ink-select-input`, `ink-spinner`, `open`)

## 3. Rewrite Objectives

## 3.1 Engineering Objectives

- Enforce clear boundaries: CLI orchestration, domain services, persistence, process control, UI
- Reduce file-level and function-level complexity
- Remove dead code and unused state
- Add typed contracts and schema validation at persistence boundaries
- Add automated tests for critical flows
- Ensure strict typecheck and stable behavior across shells/platforms

## 3.2 UX and Visual Objectives

- Deliver a cohesive, intentional visual system (not ad hoc ASCII art)
- Build reusable TUI primitives (frame, menu, status chips, toasts, form controls)
- Improve keyboard discoverability and action feedback
- Support variable terminal widths without brittle spacing math
- Replace placeholders with complete category/provider workflows

## 4. Non-Goals

- Rewriting `packages/codex` server behavior
- Adding remote sync/cloud state
- Supporting legacy Node runtimes below project baseline

## 4.1 New Product Constraints (From Feature Discussion)

- Providers are first-class entities with persisted credentials.
- Credentials live in a local share directory (`~/.local/share/...`) and should be reusable across CLI and codex flows.
- Codex credentials are a subtype of base provider credentials with typed provider-specific extras.
- Existing `.tokens.json` should be migrated into provider credential storage (new format), then read from shared storage.
- `ct <provider-name>` must resolve dynamically from stored providers (not a fixed command list).
- Agent-type to provider mapping must be typed, persisted, validated against existing providers, and surfaced as warnings when invalid.
- `CLAUDE.md` teammate instructions are managed via a single replaceable section with deterministic markers.
- Codex is a special provider flow with OAuth + local proxy lifecycle.
- There is only one codex proxy runtime (singleton daemon), not one per provider record.
- Codex provider endpoint is fixed to localhost on the configured codex proxy port.
- Codex provider uses a placeholder key (`dummy_key`) for Anthropic-compatible clients, while real auth material lives in codex extras.
- Codex setup actions are stateful:
  - daemon action: start if stopped, restart if already running
  - auth action: auth if missing/expired, reauth if already present

## 5. Target Architecture (Subfolder Model)

Mirror `packages/codex` style: domain-oriented directories with small files and explicit exports.

```text
packages/cli/src/
  index.ts
  shared/
    constants.ts
    errors.ts
    types.ts
  config/
    paths.ts
    schema.ts
    repository.ts
    migrations.ts
  providers/
    model.ts
    service.ts
    validation.ts
  daemon/
    process-manager.ts
    status.ts
    service.ts
  auth/
    client.ts
    browser.ts
    polling.ts
  shell/
    adapters/
      bash.ts
      zsh.ts
      fish.ts
      tmux.ts
    service.ts
  claude/
    generator.ts
    service.ts
  cli/
    parser.ts
    runner.ts
    commands/
      switch-provider.ts
      status.ts
      daemon.ts
      init.ts
      help.ts
  tui/
    app/
      App.tsx
      router.ts
      state-machine.ts
    theme/
      tokens.ts
      palette.ts
    components/
      Frame.tsx
      Menu.tsx
      InputField.tsx
      StatusPill.tsx
      Toast.tsx
      HelpBar.tsx
    hooks/
      useAsyncAction.ts
      useKeymap.ts
    screens/
      Home.tsx
      Providers.tsx
      ProviderCreate.tsx
      ProviderEdit.tsx
      ProviderDelete.tsx
      CodexSetup.tsx
      Agents.tsx
      CategoryCreate.tsx
      CategoryEdit.tsx
      CategoryDelete.tsx
      SetupRepo.tsx
```

Additionally, extract cross-package reusable domain/storage logic:

```text
packages/provider-core/src/
  index.ts
  types.ts
  schema.ts
  paths.ts
  repository.ts
  migrations/
    migrate-tokens-json.ts
  mapping/
    agent-provider-map.ts
  claude/
    section-markers.ts
    section-renderer.ts
    section-upsert.ts
```

`packages/cli` and `packages/codex` consume `@codex-proxy/provider-core` rather than implementing duplicate storage rules.

## 5.1 Domain Model (Typed)

Use discriminated unions plus typed extras:

```ts
type ProviderKind = 'anthropic' | 'generic' | 'codex';

interface ProviderCredentialsBase<TExtras extends Record<string, unknown> = Record<string, unknown>> {
  anthropic_base_url: string;
  anthropic_key?: string;
  extras: TExtras;
}

interface CodexExtras {
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
  expires_in?: number;
  account_id?: string;
}

type ProviderCredentials =
  | {
      kind: 'codex';
      value: ProviderCredentialsBase<CodexExtras>;
    }
  | {
      kind: 'anthropic' | 'generic';
      value: ProviderCredentialsBase<Record<string, unknown>>;
    };

interface Provider {
  name: string;
  kind: ProviderKind;
  enabled: boolean;
  credentialsRef: string;
}
```

Notes:
- `anthropic_key` should support secure resolution via env ref in a later hardening step, but initial implementation can store raw string to match current behavior.
- `credentialsRef` decouples provider metadata from credential document storage.
- codex provider credentials are normalized to:
  - `anthropic_base_url = "http://127.0.0.1:4096/v1"` (or single configured codex port constant)
  - `anthropic_key = "dummy_key"`
  - OAuth material in `extras` only
- enforce at-most-one provider of `kind: 'codex'`

## 5.2 Storage Layout (Shared)

Proposed default root:

`~/.local/share/ct/`

Files:

```text
providers.json              # Provider metadata + active provider + agent mappings
credentials.json            # Credential documents keyed by credentialsRef
```

Minimal shape:

```json
{
  "version": 1,
  "activeProvider": "anthropic",
  "providers": [],
  "agentTypeMappings": []
}
```

```json
{
  "version": 1,
  "credentials": {}
}
```

## 5.3 Repository Contract (Testable, TUI-Agnostic)

Core repository/service operations:

- `createProvider(input)`
- `getProvider(name)`
- `listProviders()`
- `updateProvider(name, updates)`
- `deleteProvider(name)`
- `setActiveProvider(name)`
- `getActiveProvider()`
- `saveCredentials(ref, credentials)`
- `getCredentials(ref)`
- `deleteCredentials(ref)`
- `setAgentProviderMapping(agentType, providerName)`
- `deleteAgentProviderMapping(agentType)`
- `listAgentProviderMappings()`
- `validateMappings()` -> returns warnings for missing providers

All business logic should be driven through these functions/classes, with CLI/TUI as adapters.

## 5.4 Migration Plan from `.tokens.json`

One-time migration path:

1. Detect `.tokens.json` (project-local path and/or `CODEX_PROXY_TOKEN_FILE` if set).
2. Read keys (`access_token`, `refresh_token`, `expires_at`, `expires_in`, `account_id`).
3. Create/ensure a `codex` provider and credentials entry.
4. Write codex credentials as:
   - `anthropic_base_url = "http://127.0.0.1:4096/v1"`
   - `anthropic_key = "dummy_key"`
   - `extras = { refresh_token, access_token, expires_at, expires_in, account_id }`
5. Mark migration complete (schema version flag or migration ledger).
6. Future reads use shared repository only.

Migration must be idempotent and non-destructive.

## 5.5 Dynamic Provider Command Resolution

Behavior for `ct <arg>`:

1. Attempt command parse (`status`, `daemon`, `init`, etc.).
2. If not a known command, resolve `<arg>` as provider name via repository.
3. If found and enabled:
   - load credentials
   - emit shell/tmux environment updates from credentials
   - set active provider
4. If missing, return explicit error with nearest matches.

This removes hard-coded provider assumptions from parser logic.

For codex provider resolution:
- verify singleton daemon state from codex daemon service
- use fixed localhost base URL (not user-editable for codex kind)
- keep active-provider switching independent from daemon/auth actions
- expose codex status (daemon + auth) in CLI status and TUI codex setup screen
- apply provider env changes across three layers:
  - current shell eval output
  - tmux environment
  - persisted startup shell config (`~/.zshrc`)

## 5.5.1 Environment Variable Contract

Managed base URL vars:
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_API_URL`
- `ANTHROPIC_API_BASE`
- `OPENAI_API_BASE`

Managed key vars:
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`

Switch rules:
- non-direct providers:
  - set all managed base URL vars from provider `anthropic_base_url`
  - if provider has `anthropic_key`, set both managed key vars to that value
  - if provider has no `anthropic_key`, unset both managed key vars
- direct provider:
  - unset all managed base URL vars
  - set/unset managed key vars from provider `anthropic_key` (deterministic, no carryover)
- codex provider:
  - force base URL to localhost codex endpoint
  - force key to `dummy_key`

Layer application:
- current shell: emit eval-able shell commands
- tmux: always emit `tmux set-environment`/`tmux set-environment -u` commands
- `~/.zshrc`: maintain one idempotent managed block for startup shell state

`~/.zshrc` managed markers:
- `# >>> ct managed env start >>>`
- `# <<< ct managed env end <<<`

Rewrite strategy for `~/.zshrc` block:
- remove existing managed block if present
- append a freshly rendered block at file end
- if markers malformed, return explicit error and refuse partial write

## 5.8 Codex-Specific Lifecycle Contract

Codex flow is a managed lifecycle, not generic provider CRUD.

Service operations:
- `getCodexStatus()` -> `{ daemon: 'running' | 'stopped', auth: 'valid' | 'missing' | 'expired' }`
- `ensureCodexDaemon()` -> starts daemon if stopped
- `restartCodexDaemon()` -> restarts if running
- `authenticateCodex()` -> initial auth
- `reauthenticateCodex()` -> replace/refresh existing auth session
- `runCodexDaemonAction()` -> start-or-restart behavior
- `runCodexAuthAction()` -> auth-or-reauth behavior

Invariants:
- only one daemon PID file/log target for codex
- only one codex auth token set in shared credentials store
- codex provider cannot point at arbitrary non-localhost URLs
- codex proxy port is centralized constant shared by cli/codex

## 5.6 Agent-Type Mapping Feature

Persist typed mappings:

```ts
interface AgentProviderMapping {
  agentType: string;      // ex: "designer", "coder", "research"
  provider: string;       // provider name
  teammateSuffix?: string; // ex: "anthropic", "zai"
}
```

Validation rules:
- mapped provider must exist and be enabled
- duplicate `agentType` entries forbidden
- unresolved mappings are warnings in UI and surfaced in `ct status`

## 5.7 CLAUDE.md Section Management

Markers:

- `<!-- TEAMMATE INSTRUCTIONS START -->`
- `<!-- TEAMMATE INSTRUCTIONS END -->`

Rules:
- There must be at most one managed section.
- Write behavior is full replace: delete existing managed section (if present), then insert rendered section.
- If file missing, create with minimal heading and section.
- If markers malformed (start without end), return explicit error and refuse unsafe partial edits.

Renderer input:
- list of `AgentProviderMapping`
- list of providers
- warning summary for broken mappings (optional block)

## 6. Design Principles

- Thin entrypoints, thick services
- Side effects live in services, not render paths
- One state model per UI workflow
- No repeated key handling boilerplate
- No manual string padding for layout alignment
- Typed errors for user-facing failures
- Every command path has test coverage
- Features are validated in repository/service tests before any TUI wiring

## 7. Phased Execution Plan

## Phase 0: Baseline and Safety Net

Goal: lock current behavior where intentional; expose regressions quickly.

Deliverables:
- Baseline test harness for CLI command outputs and exits
- Smoke test for TUI boot and screen routing
- Known-issues ledger documenting current bugs/limitations
- CI check target for `@codex-proxy/cli` typecheck + tests
- Shared contract tests drafted for provider repository behavior

Exit criteria:
- Tests execute in CI
- Current breakages are captured as known failures or fixed before moving on

## Phase 1: Structural Refactor (No Behavior Change)

Goal: split files and establish architectural seams.

Deliverables:
- Directory structure created per target architecture
- Existing logic moved into modules with compatibility exports
- `src/index.ts` reduced to command bootstrap
- `src/tui.tsx` split into app/router/screens/components

Exit criteria:
- Same runtime behavior as pre-refactor (excluding explicitly fixed bugs)
- Typecheck clean
- File complexity reduced (no single file > 350 LOC target)

## Phase 2: Config and Domain Hardening

Goal: make persisted state safe and evolvable.

Deliverables:
- `zod` schemas for provider metadata, credentials, agent mappings
- Parse/validation error handling distinct from file-not-found behavior
- Service-level invariants (active provider exists, mappings reference existing providers)
- Atomic write pattern for persistence
- new shared package `@codex-proxy/provider-core`
- idempotent migration from `.tokens.json` into codex provider credentials

Exit criteria:
- Corrupt config yields actionable error without silent reset
- Migration path defined and tested, including `.tokens.json` import

## Phase 3: CLI Command Layer Rewrite

Goal: deterministic command handling and clean outputs.

Deliverables:
- Explicit parser and command registry
- Standardized command result type (`stdout`, `stderr`, `exitCode`)
- Correct handling for `--help`, `-h`, unknown command/provider ambiguity
- Shell output selection policy centralized
- dynamic `ct <provider>` resolution via repository lookup

Exit criteria:
- All command behaviors covered by integration tests
- No direct business logic inside command dispatch switch

## Phase 4: Daemon/Auth Reliability

Goal: robust local process and auth orchestration.

Deliverables:
- Daemon service ensures config/log directory existence
- Process control via Node APIs (avoid shell-string `kill` where possible)
- Correct build path/help text to `packages/codex`
- Browser launch via `open` package
- Retry/timeout policies with typed errors for auth polling
- codex singleton daemon lifecycle service (start-or-restart semantics)
- codex auth lifecycle service (auth-or-reauth semantics)
- centralized codex endpoint constant and dummy-key normalization

Exit criteria:
- Daemon start/stop/status/restart deterministic on macOS/Linux
- Auth flow failures are user-actionable and non-hanging
- codex status accurately reflects daemon+auth matrix and drives action labels

## Phase 5: TUI Application Architecture

Goal: eliminate monolith and side-effect-heavy screens.

Deliverables:
- App router + state machine for navigation flow
- Shared hooks for input and async action handling
- Screens focused on rendering and intent dispatch
- Service boundary for provider/category/daemon/auth operations

Exit criteria:
- No screen directly mutates persistence/process without service call
- Navigation and form flows are testable with component tests

## Phase 6: Visual System and “Sick TUI” Pass

Goal: deliver an intentional and polished terminal UI.

Deliverables:
- Theme tokens (colors, spacing, emphasis levels)
- Reusable visual primitives (`Frame`, `Menu`, `StatusPill`, `Toast`, `HelpBar`)
- Responsive width-aware layout strategy
- Strong visual hierarchy for status, actions, confirmations, and errors
- Consistent iconography and keyboard hints

Styling direction:
- Dark graphite base with high-contrast accents
- Distinct semantic colors for success/warn/error/info
- Compact but premium command-center feel
- Avoid decorative noise; prioritize clarity and velocity

Exit criteria:
- Visual consistency across all screens
- No manual fixed-width padding with `repeat` for core layout
- Readable at common terminal widths (80/100/120)

## Phase 7: Complete Missing Product Flows

Goal: remove placeholders and finish core management workflows.

Deliverables:
- Implement category edit/delete flows
- Implement provider edit for all provider types
- Improve codex setup screen with richer status and progress states
- Confirm and undo patterns for destructive actions where applicable
- implement and expose agentType -> provider mapping CRUD
- surface unresolved mapping warnings in UI status views
- implement deterministic CLAUDE.md teammate-section replace flow
- codex setup screen buttons/actions are state-derived:
  - `Start Daemon` vs `Restart Daemon`
  - `Authenticate` vs `Re-authenticate`

Exit criteria:
- No “Coming soon” placeholders in primary navigation
- All menu items map to complete workflows

## Phase 8: Cleanup, Docs, and Rollout

Goal: production-ready stabilization.

Deliverables:
- Remove unused dependencies and dead exports
- Final contributor docs for CLI architecture and TUI patterns
- Migration notes for users
- Performance/smoke checks for startup and key workflows

Exit criteria:
- Clean lint/type/test pipeline
- Docs match implementation

## 8. Testing Strategy

Test layers:
- Unit tests: parser, shell adapters, config migrations, provider/category invariants
- Integration tests: command execution and output contract
- UI tests: screen routing, interaction flows, async error/success states
- Smoke checks: daemon lifecycle + auth status path (mocked + optional live gate)

Quality gates:
- `pnpm --filter @codex-proxy/cli typecheck`
- `pnpm --filter @codex-proxy/cli test`
- Snapshot or structured output tests for core screens/commands

## 9. Risk Register

- Refactor churn may temporarily regress command behavior
- TUI rewrite may shift keyboard ergonomics if not tested with real users
- Daemon behavior can vary by OS/process permissions

Mitigations:
- Keep Phase 0 baseline tests mandatory before large moves
- Ship in thin vertical slices with quick manual validation
- Keep command behavior explicit and documented even when breaking old storage formats

## 10. Milestones and Suggested PR Slicing

- PR1: Phase 0 + critical breakage fixes (typecheck red to green)
- PR2: Phase 1 structural split
- PR3: Phase 2 config hardening
- PR4: Phase 3 command layer rewrite
- PR5: Phase 4 daemon/auth reliability
- PR6: Phase 5 app architecture
- PR7: Phase 6 visual system
- PR8: Phase 7 product completeness
- PR9: Phase 8 cleanup/docs

Each PR should include:
- scope summary
- test evidence
- migration/compatibility notes

## 11. Definition of Done

The rewrite is complete when:
- Architecture matches the target subfolder model
- No monolithic files remain in critical paths
- All primary workflows are complete and tested
- Typecheck/tests are green in CI
- TUI style is cohesive, responsive, and clearly improved
- `ct` command UX remains stable and predictable for existing users

## 12. Decision Record

`DR-001` Storage root: **Decided**
- Use `ct` namespace for everything: `~/.local/share/ct/`.

`DR-002` Secrets at rest: **Decided**
- Plaintext storage is acceptable for v1.

`DR-003` `.tokens.json` handling: **Decided**
- One-time import path allowed for migration, but runtime source of truth is only the new shared store.
- After migration, `.tokens.json` is ignored.
- Migration code is temporary and may be removed after successful local migration rollout.

`DR-004` Codex provider mutability: **Decided**
- Hard-lock codex credentials normalization:
  - `anthropic_base_url` fixed to localhost codex proxy endpoint
  - `anthropic_key` fixed to `dummy_key`

`DR-005` Codex port: **Decided**
- Keep fixed port (`4096`) via shared constant.

`DR-006` Provider naming: **Decided**
- Provider names are case-sensitive.

`DR-007` Agent type taxonomy: **Decided**
- `agentType` is free-form string.

`DR-008` Invalid mappings policy: **Decided**
- Non-blocking warning model by default:
  - show warnings in UI + `ct status`
  - allow section generation with warning block
- Add optional strict mode later if needed.

`DR-009` CLAUDE section placement: **Decided**
- Managed section belongs at end of file.
- Upsert algorithm: find existing marked block anywhere, remove it, then append newly rendered block once.

`DR-010` Env application layers: **Decided**
- Apply updates to all three layers:
  - current shell
  - tmux environment
  - `~/.zshrc`

`DR-011` Backward compatibility: **Decided**
- No backward compatibility requirement for old storage schema.

`DR-012` Warning exit codes: **Decided**
- Invalid agent-provider mappings are warning-only and do not force non-zero exits.
- `ct status` returns `0` with warnings printed.
- `ct init` returns `0` when section write succeeds (even with mapping warnings).
- Non-zero exits reserved for operational failures (parse/write/runtime errors).

`DR-013` Codex auth validity threshold: **Decided**
- Treat tokens as requiring reauth when missing, expired, or within 5-minute expiry window.

`DR-014` Migration precedence: **Decided**
- Migration is explicit one-time import; no merge/conflict policy needed after cutover.
- New store is authoritative immediately after migration.

`DR-015` tmux command behavior: **Decided**
- Always emit tmux commands in output contract.
- Commands should be safe to run even when no active tmux session (suppress/no-op failure paths).

`DR-016` Direct mode key semantics: **Decided**
- Direct mode always unsets proxy/base-url vars.
- Direct mode key vars are written from provider credentials (or unset), never inherited from previous mode.

`DR-017` Near-duplicate provider blocking: **Decided**
- Provider names are case-sensitive for display/identity.
- Creation/update rejects near duplicates by canonical collision (`trim().toLowerCase()`).
- Example blocked pairs: `zai` vs `ZAI`, `anthropic` vs ` anthropic `.

## 13. Immediate Next Actions

1. Create tracking issue with this phase plan and checklist.
2. Execute Phase 0 baseline tests and lock current behavior contract.
3. Fix current typecheck breakage before structural moves.
4. Start Phase 1 by extracting `cli/parser`, `cli/commands`, and `tui/app/router`.
