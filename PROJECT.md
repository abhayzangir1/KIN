# Project: KIN Desktop UX, E2E Verification, Security Hygiene & Cross-Platform Release

## Architecture
KIN is a local-first desktop application combining:
1. **Frontend (`ui/`)**: React 19 + TypeScript + Tailwind CSS + Lucide Icons + Zustand (`kinStore.ts`), packaged in a multi-pane workspace (`TitleBar`, `HeaderBar`, `Sidebar`, `CenterView`, `AgentInspector`).
2. **Backend Daemon / Sidecar (`core/`)**: Node.js 22 runtime + Express API (`core_server.ts`) + SQLite (`schema.sql` via `node:sqlite`) + SSE stream (`/api/events`) + Agent Kernel & Execution Loop (`agent_kernel.ts`, `agent_loop.ts`, `model_gateway.ts`, `tool_gateway.ts`).
3. **Desktop Shell (`src-tauri/`)**: Tauri v2 in Rust, managing native windows, tray, system events, and embedding `kin-core.exe` as a sidecar binary with Windows Job Object process supervision.
4. **Installed Release Target (`D:\KIN-App\`)**: Production deployment containing `kin-desktop.exe`, `kin-core.exe`, and `schema.sql`.
5. **CI/CD & Release Automation (`.github/workflows/`)**: Cross-platform quality gates and release packaging for Windows, Linux, and macOS.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | M4 Integrity & Deployment Verification | Confirm identical SHA256 hashes between build outputs and D:\KIN-App, verify 100% test pass rate. | M0 | Survey (explorer 1) |
| F2 | Toast & Notification De-noising | Remove redundant toasts on approval card dismissal (CenterView.tsx:1042) and dual toast+banner in AutomationsModal/AutomationsView. | M1 | Survey (explorer 1) |
| F3 | Model Selection UX Polish | Connect AddAgentModal to ModelSelectorModal via "Browse Models..." button, provide direct "+ Add Provider" route, and adapt AgentModelBadge to Light Theme semantic tokens. | M1 | Survey (explorer 1) |
| F4 | Semantic Token Color Standardization | Replace residual hardcoded hexes in SettingsModal (134 hexes), SwarmMap (119 hexes), and ConnectorsManager (69 hexes) with semantic design tokens. | M1 | Survey (explorer 1) |
| F5 | NVIDIA NIM Fallback Catalog Completeness | Add nvidia/meta/llama-3.1-70b-instruct and nvidia/meta/llama-3.1-8b-instruct to offline fallback catalog in model_gateway.ts. | M2 | Survey (explorer 2) |
| F6 | NVIDIA NIM Streaming & 429 Test Coverage | Implement unit tests for NVIDIA NIM SSE streaming thinking tokens, usage tracking, and multi-key 429 backoff in nvidia_nim_provider.test.ts. | M2 | Survey (explorer 2) |
| F7 | Environment Template & Gitignore Hardening | Add NVIDIA_NIM_API_KEY to .env.example, unignore .env.example in .gitignore (!.env.example), and verify .env security. | M2 | Survey (explorer 2, 3) |
| F8 | End-to-End System Regression Verification | Verify 100% pass rate across core vitests, cargo tests, and TypeScript typecheck. | M2 | Survey (explorer 2) |
| F9 | Worktree & Stale Branch Reclamation | Safely unlock and prune 98 git worktrees, delete core/.kin/worktrees and .kin/worktrees, delete stale test folders, and prune transient feat/kin-* branches. | M3 | Survey (explorer 3) |
| F10 | Build Cache & Binary De-duplication | Run cargo clean in src-tauri, remove duplicate binaries in core/binaries, freeing ~6.70 GB disk space. | M3 | Survey (explorer 3) |
| F11 | Pre-Commit Secret & Security Audit | Verify zero hardcoded secrets or credentials exist in git-tracked files or commit history, run git gc --prune=now. | M3 | Survey (explorer 3) |
| F12 | Remote Origin Rebase & Divergence Reconciliation | Fetch origin/main, reconcile 7 local commits with 2 remote commits, verify clean compile. | M4 | Survey (explorer 3) |
| F13 | GitHub Actions CI/CD Quality Gates | Configure .github/workflows/ci.yml with typecheck, test suites, cargo tests, and standalone binary health check across Windows, Linux, and macOS. | M4 | Survey (explorer 3) |
| F14 | Cross-Platform Release Packaging & One-Click Install | Configure .github/workflows/release.yml for Windows (.exe/.msi), Linux (.AppImage/.deb), macOS (.dmg/.app), SHA256SUMS, and installation scripts. | M4 | Survey (explorer 3) |
| F15 | Commit and Push to Remote Origin | Commit cleaned codebase and documentation, push to origin/main, verify remote tracking. | M4 | Survey (explorer 3) |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Survey & Comprehensive Research | F1, full codebase audit across UI/UX, NVIDIA NIM, hygiene, and CI/CD. | none | DONE |
| M1 | UI/UX & Model Selection Polish | F2, F3, F4 | M0 | DONE |
| M2 | NVIDIA NIM Completeness & E2E Tests | F5, F6, F7, F8 | M0 | DONE |
| M3 | Workspace Cleanup & Security Audit | F9, F10, F11 | M1, M2 | DONE |
| M4 | CI/CD, Release Packaging & Push to Origin | F12, F13, F14, F15 | M3 | IN_PROGRESS |

## Interface Contracts

### M1 (UI/UX Polish) ↔ Core / Store
- `AddAgentModal.tsx`: Calls `openModelSelector(targetAgentId, onSelectCallback)` or sets local `selectedModelId` state when a model is selected in `ModelSelectorModal`.
- `AgentModelBadge.tsx`: Uses semantic tokens `bg-kin-card hover:bg-kin-cardHover text-kin-muted hover:text-kin-text border-kin-border hover:border-kin-borderSubtle` without hardcoded slate hexes.
- `SettingsModal.tsx`: Uses `bg-kin-card`, `bg-kin-surface`, `border-kin-border`, `text-kin-text`, `text-kin-muted` across tabs and autonomy cards.

### M2 (NVIDIA NIM Provider) ↔ Core Server / Gateway
- `model_gateway.ts`: Resolves `NVIDIA_NIM_API_KEY` or `NVIDIA_API_KEY` from process.env or `managed_credentials`. Offline fallback list includes both Llama 3.3 and Llama 3.1 models.
- `.gitignore`: Allows `.env.example` via `!.env.example` while strictly keeping `.env` and `.env.*` ignored.

### M4 (CI/CD Workflows) ↔ Platform Binaries
- `.github/workflows/ci.yml`: Executes `npm ci`, `npm run typecheck`, `npm run build`, `node core/scripts/package_binary.js`, `npm run test --workspace=core`, `cargo test --manifest-path src-tauri/Cargo.toml`, and health check verification.
- `.github/workflows/release.yml`: Builds release packages via `tauri-apps/tauri-action@v1` on `windows-latest`, `ubuntu-latest`, and `macos-latest`, producing `.exe`, `.msi`, `.AppImage`, `.deb`, `.dmg`, `.app` and generating `SHA256SUMS.txt`.

## Code Layout & Write Boundaries

- **M1 Worker Exclusive Ownership**:
  - `ui/src/components/AddAgentModal.tsx`
  - `ui/src/components/AgentModelBadge.tsx`
  - `ui/src/components/SettingsModal.tsx`
  - `ui/src/components/SwarmMap.tsx`
  - `ui/src/components/ConnectorsManager.tsx`
  - `ui/src/components/AutomationsModal.tsx`
  - `ui/src/components/AutomationsView.tsx`
  - `ui/src/components/CenterView.tsx`

- **M2 Worker Exclusive Ownership**:
  - `core/src/execution/model_gateway.ts`
  - `core/test/nvidia_nim_provider.test.ts`
  - `.env.example`
  - `.gitignore`

- **M3 Worker Exclusive Ownership**:
  - Worktree cleanup, branch pruning, cache directories removal (`core/.kin/worktrees`, `.kin/worktrees`, `core/binaries`, `src-tauri/target/`)
  - Secret verification and git optimization scripts

- **M4 Worker Exclusive Ownership**:
  - `.github/workflows/ci.yml`
  - `.github/workflows/release.yml`
  - `scripts/install.ps1`, `scripts/install.sh`, `scripts/install-mac.sh`
  - `README.md`
  - Git remote fetch, rebase/merge, commit, and push
