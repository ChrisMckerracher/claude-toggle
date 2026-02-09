# Provider + Agent Setup TUI Flow

## 1. Home

Sections:
- Provider Setup
- Agent Setup
- Readiness
- Exit

Always-visible summary:
- active provider
- codex daemon/auth status
- mapping warning count
- CLAUDE managed section status

## 2. Provider Setup

Actions:
- List Providers
- Add Provider
- Edit Provider
- Enable/Disable Provider
- Delete Provider
- Back

Provider list row fields:
- provider name
- provider type
- enabled/disabled
- active marker

## 3. Add Provider

Step 1:
- Choose type: generic | codex

Step 2:
- Enter common fields (provider name)

Step 3 (type-specific):
- generic: endpoint (+ optional API key)
- codex: enter Codex Setup subflow, then return to finalize

Step 4:
- Confirm create
- optional toggle: set active now

## 4. Codex Setup (Provider Subflow)

Status panel:
- daemon: running/stopped
- auth: valid/missing/expired

Actions:
- Daemon Action: start if stopped, restart if running
- Auth Action: authenticate if missing/expired, re-authenticate if valid
- Back to Provider Setup

Codex constraints shown as immutable system-managed values:
- endpoint fixed to localhost codex proxy
- key fixed to dummy_key for compatibility

## 5. Edit Provider

Behavior:
- anthropic: built-in provider, immutable, custom switch flow unsets managed env vars
- generic: edit allowed fields
- codex: edit metadata only (name/enabled), plus jump to Codex Setup

Save with validation and explicit error messaging.

## 6. Delete Provider

Flow:
- select provider
- explicit confirm screen with target name

Constraints:
- block delete when required by invariants
- if mapped by agents, require remap/confirm behavior

## 7. Agent Setup

Actions:
- List Mappings
- Set Mapping
- Delete Mapping
- Validate
- Project Integration
- Back

Mapping model:
- agentType -> provider
- optional teammate suffix

Validation:
- detect missing provider references
- detect disabled provider references
- surface warnings inline

## 8. Project Integration (within Agent Setup)

Actions:
- Preview managed CLAUDE section
- Write/Replace managed CLAUDE section

Behavior:
- managed section uses deterministic markers
- malformed existing markers fail safely with explicit error
- warnings can be included in the rendered section

## 9. Readiness

Checklist:
- at least one enabled provider
- active provider is set
- codex daemon/auth healthy when codex is used
- no broken mappings (or acknowledged warnings)
- CLAUDE managed section up to date

Quick actions:
- switch active provider
- run codex daemon action
- run codex auth action
- regenerate CLAUDE managed section

## 10. Daily Runtime

After setup:
- use `ct <provider>` for fast switching
- use TUI for management workflows

Design principle:
- TUI handles setup and management
- command mode handles fast operational switching
