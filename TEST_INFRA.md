# E2E Test Infra: KIN Multi-Agent AI Engineering Harness

## Test Philosophy
- Requirement-driven, adversarial, and opaque-box validation.
- Methodology: High-concurrency race condition simulation, Category-Partition, Boundary Value Analysis, and Cryptographic Invariant Testing.
- Target: 100% deterministic test execution under SQLite WAL mode with zero flaky tests and sequential suite execution (`fileParallelism: false`).

## Feature Inventory & Test Coverage
| # | Feature Under Test | Source Requirement | Tier 1 (Feature) | Tier 2 (Boundary & Race) | Tier 3 (Cross-Feature) |
|---|--------------------|--------------------|:----------------:|:------------------------:|:----------------------:|
| 1 | Task Lease Contention & Expiry | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 2 | Rapid Parallel Message Ingestion | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 3 | Concurrent Approval Resolutions | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 4 | EventLedger Cryptographic Hash Chain | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 5 | Skill Engine Sandbox VM Isolation | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 6 | Filesystem Jail & Symlink Boundary | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 7 | Secret Redaction & Origin Verification | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 8 | Task DAG Dependency Cycle & Starvation | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runner**: Vitest v3.0.7 running via `npm test` (`npm run test --workspace=core`).
- **Invocation**: `npm test` runs all suites sequentially (`fileParallelism: false`).
- **Pass/Fail Semantics**: 100% pass rate required. Zero failed tests, zero skipped tests, zero unhandled errors.
- **Suite Location**:
  - Existing: `core/test/` (39 suites, 585 tests).
  - New Adversarial Suite: `core/test/adversarial_r1_concurrency_stress.test.ts`.
- **Database Pattern**: Pure memory `new KinDatabase(':memory:')` for repository stress tests; ephemeral directory with WAL and loopback port 0 for server tests.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | 50-Worker Parallel Task Claim Burst | Task lease contention, atomic SQLite updates, agent runs | High |
| 2 | Concurrent Approval Gate Double-Resolution | Approval token consumption, ToolGateway execution, agent resume | High |
| 3 | High-Throughput Parallel DM Message Ingestion | Workspace channel creation, message persistence, event broadcast | High |
| 4 | 50-Event Parallel Cryptographic Hash Journaling | EventLedger, secret redaction, SHA-256 chain verification | High |
| 5 | VM Sandbox Host Process Escape Exploit | Skill engine timeout mapping, prototype pollution attack | Critical |

## Coverage Thresholds
- Baseline: 585 tests across 39 suites.
- Target: 600+ tests across 40+ suites, 100% pass rate.
