# Tutorial 1: Orchestrating an Autonomous Research Swarm

This tutorial walks through configuring and running an autonomous, multi-agent research swarm in KIN. You will learn how to convene specialist agents, execute parallel web and document investigations, synthesize findings into durable artifacts, and verify source citations.

---

## Architecture of a Research Swarm

A research swarm in KIN leverages role specialization and Tiered Memory:
1. **`@Boss` (Orchestrator)**: Deconstructs the research query into sub-topics, delegates queries to specialists, and verifies completeness against acceptance criteria.
2. **`@Researcher` (Investigator)**: Uses browser tools, web search, or document readers to gather primary sources, extracting key facts, data tables, and direct quotes.
3. **`@Synthesizer` or `@Reviewer` (Analyst)**: Cross-references findings across sources, flags contradictory claims, computes summaries, and authors markdown artifacts.

```
Operator Query (Channel: #research)
       │
       ▼
   [@Boss] (Deconstructs topic & establishes Goal)
       │
       ├──► [@Researcher] (Navigates web, inspects DOM, reads docs)
       │         │
       │         ▼
       │   Raw Findings & Citations
       │         │
       └──► [@Reviewer] (Fact-checks & synthesizes report)
                 │
                 ▼
     Durable Research Artifact (.md) & Executive Summary
```

---

## Step-by-Step Walkthrough

### Step 1: Create a Dedicated Research Channel
1. Open KIN in your desktop or browser UI (`http://127.0.0.1:5173`).
2. In the left sidebar under **Channels**, click the **+** button to create a new channel:
   - **Name**: `market-research`
   - **Topic**: `Competitive analysis of local-first agent runtimes`
3. Notice that `@Boss` is automatically enrolled to coordinate channel activities.

### Step 2: Hire or Assign Specialists
Ensure your workforce includes agents tailored for research. In the `#market-research` channel, type:
```text
/hire @Researcher Academic and industry technical research specialist
/hire @Synthesizer Technical writer and analytical synthesizer
```
Both agents are enrolled into the channel with tailored system instructions and tool capabilities.

### Step 3: Launch the Research Directive
Issue a compound command establishing the research goal and execution plan:
```text
/plan /boost /goal Autonomous Agent Runtime Market Survey | Comprehensive analysis of SQLite-backed local agent platforms | Comparison table of 5 runtimes, source citations included, zero hallucinated links
```

**What Happens Under the Hood:**
- **Goal Registration**: KIN persists the goal in SQLite (`kin_storage.sqlite`) under the active project.
- **DAG Generation**: `@Boss` breaks down the survey into milestone tasks:
  1. *Source Gathering*: Query architectural papers, GitHub repositories, and release notes.
  2. *Feature Matrix*: Extract data on memory tiering, IPC mechanisms, and persistence.
  3. *Synthesis & Fact-Check*: Author a structured report with verified URLs.
- **SSE Broadcasting**: The UI reflects live task creation and updates the Swarm Map in real time.

### Step 4: Autonomous Investigation & Browser Use
`@Researcher` begins executing Task 1:
- Uses `browser_navigate` and `browser_screenshot` to inspect technical landing pages.
- Uses `readFile` to review local benchmark summaries or documentation files.
- Communicates milestone progress directly in `#market-research`.

### Step 5: Reviewing the Synthesized Artifact
Once the investigation tasks complete, `@Synthesizer` compiles the findings into a markdown artifact:
- Opens an artifact in the chat view: `# Competitive Analysis: Local-First Agent Runtimes`.
- Lists key architectural trade-offs:
  - SQLite WAL mode concurrency vs client-server databases.
  - Multi-tier memory isolation vs single prompt dumps.
  - BYOK cloud routing vs local Ollama inference.
- Provides clickable source citations for every technical claim.

### Step 6: Compacting Context
After reviewing the findings, compact the conversation turns into Tier 2 Channel Memory to keep context windows clean for follow-up investigations:
```text
/compact
```
The channel history is neatly archived into a structured memory snapshot, ready for the next research phase.

---

## Best Practices
- **Explicit Constraints**: Always specify acceptance criteria in your `/goal` or `/plan` directives (e.g. `Must include pricing data and latency benchmarks`).
- **Citation Requirement**: Use `/boost` to enforce that agents cite primary sources and avoid unsupported generalizations.
- **Model Selection**: For research tasks requiring deep reasoning, assign high-tier models (e.g. Claude 3.7 Sonnet, GPT-4o, or DeepSeek R1) in the **Agent Inspector**.
