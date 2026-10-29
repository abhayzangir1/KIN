// ui/src/utils/automationCadence.ts
// Visual Cadence Engine: English Cron Translator & Autonomous Blueprints

export interface DirectiveBlueprint {
  id: string;
  title: string;
  category: 'code' | 'review' | 'testing' | 'reporting';
  icon: string;
  cadenceType: 'cron' | 'one_shot';
  cronExpression?: string;
  durationSeconds?: number;
  humanCadence: string;
  prompt: string;
  description: string;
}

export const DIRECTIVE_BLUEPRINTS: DirectiveBlueprint[] = [
  {
    id: 'code-quality-guard',
    title: 'Code Quality & Lint Guard',
    category: 'code',
    icon: 'ShieldCheck',
    cadenceType: 'cron',
    cronExpression: '0 */4 * * *',
    humanCadence: 'Every 4 hours',
    description: 'Inspects project files, runs syntax & lint checks, and flags broken imports or type errors.',
    prompt: 'Inspect active project files for syntax errors or lint warnings, verify compiler health, and post an organized actionable summary of issues.',
  },
  {
    id: 'git-diff-pr-review',
    title: 'Git Diff & PR Sanity Review',
    category: 'review',
    icon: 'GitPullRequest',
    cadenceType: 'cron',
    cronExpression: '*/30 * * * *',
    humanCadence: 'Every 30 minutes',
    description: 'Scans uncommitted git changes, analyzes risks, and ensures clean diffs before merging.',
    prompt: 'Check git status and diff for uncommitted changes or recent commits, analyze risk profile of modified files, and recommend safety improvements.',
  },
  {
    id: 'adr-architecture-sync',
    title: 'Architecture & ADR Sync',
    category: 'reporting',
    icon: 'FileText',
    cadenceType: 'cron',
    cronExpression: '0 9 * * 1-5',
    humanCadence: 'Every Weekday at 9:00 AM',
    description: 'Validates that recent code additions align with active Architecture Decision Records (ADRs).',
    prompt: 'Review recent project changes against active Architecture Decision Records (ADRs), identify any architectural drift, and document updates.',
  },
  {
    id: 'nightly-regression-suite',
    title: 'Nightly Test Suite Execution',
    category: 'testing',
    icon: 'PlayCircle',
    cadenceType: 'cron',
    cronExpression: '0 1 * * *',
    humanCadence: 'Daily at 1:00 AM',
    description: 'Executes the automated test suite overnight and logs any regressions or flaky suites.',
    prompt: 'Run automated project test suites, capture test results and error traces, and report any failing suites or regression warnings.',
  },
  {
    id: 'daily-standup-digest',
    title: 'Daily Standup & Progress Summary',
    category: 'reporting',
    icon: 'Sparkles',
    cadenceType: 'cron',
    cronExpression: '0 9 * * *',
    humanCadence: 'Daily at 9:00 AM',
    description: 'Aggregates multi-agent tasks, completed deliverables, and sets daily goals.',
    prompt: 'Summarize work completed across channels and goals over the past 24 hours, identify pending blockers, and formulate top priorities for today.',
  },
];

export const QUICK_INTERVALS = [
  { label: '5m', expr: '*/5 * * * *', desc: 'Every 5 minutes' },
  { label: '15m', expr: '*/15 * * * *', desc: 'Every 15 minutes' },
  { label: '30m', expr: '*/30 * * * *', desc: 'Every 30 minutes' },
  { label: '1h', expr: '0 * * * *', desc: 'Hourly (at :00)' },
  { label: '4h', expr: '0 */4 * * *', desc: 'Every 4 hours' },
  { label: '12h', expr: '0 */12 * * *', desc: 'Every 12 hours' },
  { label: '24h', expr: '0 0 * * *', desc: 'Every 24 hours' },
];

export const QUICK_TIMERS = [
  { label: '10s', seconds: 10, desc: 'Wake up in 10 seconds' },
  { label: '30s', seconds: 30, desc: 'Wake up in 30 seconds' },
  { label: '1m', seconds: 60, desc: 'Wake up in 1 minute' },
  { label: '5m', seconds: 300, desc: 'Wake up in 5 minutes' },
  { label: '15m', seconds: 900, desc: 'Wake up in 15 minutes' },
  { label: '1h', seconds: 3600, desc: 'Wake up in 1 hour' },
];

export const NATURAL_DAILY_TIMES = [
  { label: '9:00 AM Daily', expr: '0 9 * * *', desc: 'Every morning at 9:00 AM' },
  { label: '9:00 AM Weekdays', expr: '0 9 * * 1-5', desc: 'Monday through Friday at 9:00 AM' },
  { label: '12:00 PM Daily', expr: '0 12 * * *', desc: 'Every noon at 12:00 PM' },
  { label: '6:00 PM Daily', expr: '0 18 * * *', desc: 'Every evening at 6:00 PM' },
  { label: 'Midnight Daily', expr: '0 0 * * *', desc: 'Every night at 00:00' },
];

export function translateCronToEnglish(cron: string): string {
  if (!cron) return 'Never';
  const clean = cron.trim();

  // Exact lookups
  const known = [...QUICK_INTERVALS, ...NATURAL_DAILY_TIMES].find((p) => p.expr === clean);
  if (known) return known.desc;

  const parts = clean.split(/\s+/);
  if (parts.length !== 5) {
    return clean;
  }

  const [min, hour, dom, mon, dow] = parts;

  // Interval */N * * * *
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = min.replace('*/', '');
    return `Every ${n} minutes`;
  }

  // Hourly interval 0 */N * * *
  if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    const n = hour.replace('*/', '');
    return `Every ${n} hours on the hour`;
  }

  // Once every hour at specific minute
  if (min !== '*' && !min.includes('/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Hourly at minute :${min.padStart(2, '0')}`;
  }

  // Daily at fixed hour and minute
  if (!min.includes('*') && !min.includes('/') && !hour.includes('*') && !hour.includes('/')) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    const timeStr = `${displayHour}:${m.toString().padStart(2, '0')} ${ampm}`;

    if (dom === '*' && mon === '*') {
      if (dow === '*') return `Daily at ${timeStr}`;
      if (dow === '1-5') return `Weekdays (Mon-Fri) at ${timeStr}`;
      if (dow === '0' || dow === '7') return `Sundays at ${timeStr}`;
      if (dow === '6') return `Saturdays at ${timeStr}`;
    }
  }

  return `Cron: ${clean}`;
}
