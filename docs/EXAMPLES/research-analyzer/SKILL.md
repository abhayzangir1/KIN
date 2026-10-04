---
name: research-analyzer
version: 1.0.0
description: >
  Investigates technical documentation, extracts structured API contracts, and synthesizes architectural trade-offs.
skill_type: tool_extension
enabled: true
required_tools:
  - browserNavigate
  - browserInspect
  - readFile
trigger_patterns:
  - research
  - analyze
  - paper
  - investigate
  - documentation
  - architecture
---

# Research Analyzer Skill

This skill guides specialist agents through systematic web research, specification extraction, and executive synthesis.

## When to Use
Activate this skill whenever:
- Researching API specifications or library documentation.
- Extracting technical contracts, schemas, or protocols from web pages.
- Investigating system behavior, latency trade-offs, or concurrency models.

## Step-by-Step Procedure

1. **Target Navigation & Inspection**:
   - Use `browserNavigate` with the authoritative target URL.
   - Execute `browserInspect` with `detailed: true` to map page headings, code samples, and technical tables.

2. **Technical Extraction**:
   - Extract primary interfaces, parameter structures, and return types.
   - Identify failure modes, resource limits, and error return codes.

3. **Synthesis & Trade-Off Analysis**:
   - Compare proposed architectures against baseline solutions.
   - Document concurrency boundaries, memory usage implications, and performance bottlenecks.

4. **Output Format**:
   - Deliver findings formatted as an executive brief:
     - **Objective & Scope**: Summary of what was investigated.
     - **Core Architecture & Contracts**: Concrete data shapes and flow diagrams.
     - **Trade-Off Matrix**: Comparison of alternative approaches.
     - **Actionable Recommendations**: Next steps for implementation.
