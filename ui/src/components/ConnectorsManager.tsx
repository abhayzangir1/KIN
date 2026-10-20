import React, { useState, useEffect } from 'react';
import {
  useKinStore,
  McpConnectorItem,
  McpTestResult,
} from '../store/kinStore.js';
import {
  Server,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  Terminal,
  Globe,
  Database,
  Folder,
  Copy,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Check,
  CheckCircle2,
  AlertCircle,
  Zap,
  Code,
  Sparkles,
  X,
  MessageSquare,
  FileText,
  Mail,
  Sliders,
  Shield,
  Loader2,
} from 'lucide-react';

interface PresetItem {
  id: string;
  name: string;
  scope: 'global' | 'project';
  title: string;
  desc: string;
  category: 'api' | 'data' | 'system' | 'custom';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  icon: React.ReactNode;
}

const CONNECTOR_PRESETS: PresetItem[] = [
  {
    id: 'kin-standard',
    name: 'system',
    scope: 'global',
    title: 'Standard MCP (Zero-Dep)',
    desc: 'Zero-dependency native MCP server with system diagnostics, safe math evaluator, timezone clocks, and SQLite querying',
    category: 'system',
    command: 'node',
    args: ['~/.kin/servers/kin_standard_connectors.js'],
    env: {},
    icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
  },
  {
    id: 'github',
    name: 'github',
    scope: 'global',
    title: 'GitHub',
    desc: 'Manage repositories, pull requests, issues, commits, and code search',
    category: 'api',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    icon: <Code className="w-4 h-4 text-purple-400" />,
  },
  {
    id: 'slack',
    name: 'slack',
    scope: 'global',
    title: 'Slack',
    desc: 'Workspace channels, messaging, user mentions, and thread replies',
    category: 'api',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    icon: <MessageSquare className="w-4 h-4 text-emerald-400" />,
  },
  {
    id: 'notion',
    name: 'notion',
    scope: 'global',
    title: 'Notion',
    desc: 'Query pages, databases, document blocks, and collaborative workspaces',
    category: 'api',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-notion'],
    env: { NOTION_API_KEY: '' },
    icon: <FileText className="w-4 h-4 text-blue-400" />,
  },
  {
    id: 'filesystem',
    name: 'filesystem',
    scope: 'project',
    title: 'Local Filesystem',
    desc: 'Scoped workspace file access, directory listings, and file modification',
    category: 'system',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    env: {},
    icon: <Folder className="w-4 h-4 text-amber-400" />,
  },
  {
    id: 'sqlite',
    name: 'sqlite',
    scope: 'project',
    title: 'SQLite Database',
    desc: 'Execute SQL queries, introspect schema, and query application databases',
    category: 'data',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', './data.db'],
    env: {},
    icon: <Database className="w-4 h-4 text-cyan-400" />,
  },
  {
    id: 'postgres',
    name: 'postgres',
    scope: 'project',
    title: 'PostgreSQL',
    desc: 'Query relational tables, views, and schemas on PostgreSQL servers',
    category: 'data',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://user:password@localhost:5432/dbname'],
    env: {},
    icon: <Database className="w-4 h-4 text-blue-400" />,
  },
  {
    id: 'gmail',
    name: 'google-workspace',
    scope: 'global',
    title: 'Google Workspace',
    desc: 'Gmail, Google Calendar, and Drive document search and drafting',
    category: 'api',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-workspace'],
    env: {},
    icon: <Mail className="w-4 h-4 text-red-400" />,
  },
  {
    id: 'custom-stdio',
    name: 'custom-tool',
    scope: 'project',
    title: 'Custom stdio Process',
    desc: 'Spawn any custom CLI tool, Python script, Node.js binary, or Docker container',
    category: 'custom',
    command: 'node',
    args: ['scripts/mcp-server.js'],
    env: {},
    icon: <Terminal className="w-4 h-4 text-emerald-400" />,
  },
  {
    id: 'custom-sse',
    name: 'custom-remote',
    scope: 'project',
    title: 'Custom Remote (HTTP-SSE)',
    desc: 'Connect to remote cloud or local MCP server listening via HTTP Server-Sent Events',
    category: 'custom',
    url: 'http://127.0.0.1:8000/sse',
    icon: <Globe className="w-4 h-4 text-cyan-400" />,
  },
];

interface ConnectorsManagerProps {
  initialScopeFilter?: 'all' | 'global' | 'project';
  embeddedInModal?: boolean;
}

export const ConnectorsManager: React.FC<ConnectorsManagerProps> = ({
  initialScopeFilter = 'all',
  embeddedInModal = false,
}) => {
  const {
    mcpConnectors,
    globalMcpConfigPath,
    projectMcpConfigPath,
    isLoadingConnectors,
    fetchMcpConnectors,
    saveMcpConnector,
    toggleMcpConnector,
    deleteMcpConnector,
    testMcpConnector,
    reloadMcpServers,
  } = useKinStore();

  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'project'>(initialScopeFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [testingConnectorId, setTestingConnectorId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, McpTestResult>>({});
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ scope: 'global' | 'project'; name: string } | null>(null);
  const [generalFeedback, setGeneralFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Add / Edit Modal Drawer State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<McpConnectorItem | null>(null);
  const [formScope, setFormScope] = useState<'global' | 'project'>('project');
  const [formType, setFormType] = useState<'stdio' | 'http'>('stdio');
  const [formName, setFormName] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEnvPairs, setFormEnvPairs] = useState<Array<{ key: string; value: string; masked: boolean }>>([]);
  const [formTesting, setFormTesting] = useState(false);
  const [formTestResult, setFormTestResult] = useState<McpTestResult | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchMcpConnectors();
  }, [fetchMcpConnectors]);

  const copyToClipboard = (text: string, label: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedPath(label);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch {}
  };

  const handleOpenAdd = (preset?: PresetItem) => {
    setEditingConnector(null);
    setFormError(null);
    setFormTestResult(null);

    if (preset) {
      setFormScope(preset.scope);
      setFormName(preset.name);
      if (preset.url) {
        setFormType('http');
        setFormUrl(preset.url);
        setFormCommand('');
        setFormArgs('');
        setFormEnvPairs([]);
      } else {
        setFormType('stdio');
        setFormCommand(preset.command || 'npx');
        let initialArgs = preset.args || [];
        if (preset.id === 'kin-standard' && globalMcpConfigPath) {
          const isWin = globalMcpConfigPath.includes('\\');
          const sep = isWin ? '\\' : '/';
          const kinDir = globalMcpConfigPath.replace(/[/\\]mcp\.json$/i, '');
          const realScript = `${kinDir}${sep}servers${sep}kin_standard_connectors.js`;
          initialArgs = [realScript];
        }
        setFormArgs(initialArgs.join(' '));
        setFormUrl('');
        const envs = Object.entries(preset.env || {}).map(([key, val]) => ({
          key,
          value: val,
          masked: true,
        }));
        setFormEnvPairs(envs.length > 0 ? envs : []);
      }
    } else {
      setFormScope(scopeFilter === 'global' ? 'global' : 'project');
      setFormType('stdio');
      setFormName('');
      setFormCommand('');
      setFormArgs('');
      setFormUrl('');
      setFormEnvPairs([]);
    }
    setIsEditorOpen(true);
  };

  const handleOpenEdit = (conn: McpConnectorItem) => {
    setEditingConnector(conn);
    setFormError(null);
    setFormTestResult(null);
    setFormScope(conn.scope);
    setFormName(conn.name);

    const envs = Object.entries(conn.env || {}).map(([key, val]) => ({
      key,
      value: val,
      masked: true,
    }));
    setFormEnvPairs(envs);

    if (conn.url) {
      setFormType('http');
      setFormUrl(conn.url);
      setFormCommand('');
      setFormArgs('');
    } else {
      setFormType('stdio');
      setFormCommand(conn.command || '');
      setFormArgs((conn.args || []).join(' '));
      setFormUrl('');
    }
    setIsEditorOpen(true);
  };

  const handleAddEnvPair = () => {
    setFormEnvPairs((prev) => [...prev, { key: '', value: '', masked: true }]);
  };

  const handleRemoveEnvPair = (index: number) => {
    setFormEnvPairs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateEnvKey = (index: number, key: string) => {
    setFormEnvPairs((prev) => {
      const next = [...prev];
      next[index].key = key;
      return next;
    });
  };

  const handleUpdateEnvValue = (index: number, value: string) => {
    setFormEnvPairs((prev) => {
      const next = [...prev];
      next[index].value = value;
      return next;
    });
  };

  const handleToggleMask = (index: number) => {
    setFormEnvPairs((prev) => {
      const next = [...prev];
      next[index].masked = !next[index].masked;
      return next;
    });
  };

  const buildConfigFromForm = () => {
    const env: Record<string, string> = {};
    formEnvPairs.forEach((p) => {
      const trimmedKey = p.key.trim();
      if (trimmedKey) {
        env[trimmedKey] = p.value;
      }
    });

    if (formType === 'http') {
      return {
        url: formUrl.trim(),
        transport: 'http' as const,
        env: Object.keys(env).length > 0 ? env : undefined,
      };
    } else {
      // Split args safely respecting space separation
      const parsedArgs = formArgs.trim()
        ? formArgs.trim().match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, '')) || []
        : [];
      return {
        command: formCommand.trim(),
        args: parsedArgs,
        transport: 'stdio' as const,
        env: Object.keys(env).length > 0 ? env : undefined,
      };
    }
  };

  const handleTestInEditor = async () => {
    setFormTesting(true);
    setFormTestResult(null);
    setFormError(null);
    try {
      const config = buildConfigFromForm();
      const res = await testMcpConnector({ config, timeoutMs: 15000 });
      setFormTestResult(res);
      if (!res.success) {
        setFormError(res.error || 'Connection failed');
      }
    } catch (err: any) {
      setFormError(err.message || 'Test connection error');
    } finally {
      setFormTesting(false);
    }
  };

  const handleSaveConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = formName.trim();
    if (!cleanName) {
      setFormError('Connector identifier name is required');
      return;
    }
    if (formType === 'stdio' && !formCommand.trim()) {
      setFormError('Executable command is required (e.g. npx, node, python)');
      return;
    }
    if (formType === 'http' && !formUrl.trim()) {
      setFormError('Remote HTTP/SSE endpoint URL is required');
      return;
    }

    setFormSaving(true);
    setFormError(null);
    try {
      const config = buildConfigFromForm();
      const res = await saveMcpConnector({
        scope: formScope,
        name: cleanName,
        config,
      });

      if (res.success) {
        setIsEditorOpen(false);
        setGeneralFeedback({
          type: 'success',
          message: `Connector '${cleanName}' saved successfully (${res.toolsCount ?? 0} tools discovered).`,
        });
        setTimeout(() => setGeneralFeedback(null), 4000);
      } else {
        setFormError(res.error || 'Failed to save connector');
      }
    } catch (err: any) {
      setFormError(err.message || 'Error saving connector');
    } finally {
      setFormSaving(false);
    }
  };

  const handleCardTest = async (conn: McpConnectorItem) => {
    const cardId = `${conn.scope}:${conn.name}`;
    setTestingConnectorId(cardId);
    try {
      const res = await testMcpConnector({
        config: {
          command: conn.command,
          args: conn.args,
          url: conn.url,
          env: conn.env,
        },
        timeoutMs: 12000,
      });
      setTestResults((prev) => ({ ...prev, [cardId]: res }));
    } finally {
      setTestingConnectorId(null);
    }
  };

  const handleToggle = async (conn: McpConnectorItem) => {
    const nextDisabled = !conn.disabled;
    const res = await toggleMcpConnector({
      scope: conn.scope,
      name: conn.name,
      disabled: nextDisabled,
    });
    if (!res.success) {
      setGeneralFeedback({
        type: 'error',
        message: res.error || `Failed to toggle connector '${conn.name}'`,
      });
      setTimeout(() => setGeneralFeedback(null), 4000);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const { scope, name } = deleteConfirm;
    setDeleteConfirm(null);
    const res = await deleteMcpConnector({ scope, name });
    if (res.success) {
      setGeneralFeedback({
        type: 'success',
        message: `Connector '${name}' removed from ${scope} scope.`,
      });
      setTimeout(() => setGeneralFeedback(null), 4000);
    } else {
      setGeneralFeedback({
        type: 'error',
        message: res.error || `Failed to delete connector '${name}'`,
      });
      setTimeout(() => setGeneralFeedback(null), 4000);
    }
  };

  const filteredConnectors = mcpConnectors.filter((c) => {
    if (scopeFilter !== 'all' && c.scope !== scopeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesName = c.name.toLowerCase().includes(q);
      const matchesCmd = (c.command || '').toLowerCase().includes(q);
      const matchesUrl = (c.url || '').toLowerCase().includes(q);
      const matchesTools = (c.tools || []).some((t: any) => {
        const toolName = typeof t === 'string' ? t : (t?.name || '');
        return toolName.toLowerCase().includes(q);
      });
      if (!matchesName && !matchesCmd && !matchesUrl && !matchesTools) return false;
    }
    return true;
  });

  const globalCount = mcpConnectors.filter((c) => c.scope === 'global').length;
  const projectCount = mcpConnectors.filter((c) => c.scope === 'project').length;

  return (
    <div className={`flex flex-col space-y-6 ${embeddedInModal ? '' : 'h-full overflow-y-auto p-6'}`}>
      {/* Top Banner & Quick Actions */}
      <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <span>Model Context Protocol (MCP) Connectors</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                JSON-RPC 2.0
              </span>
            </h3>
            <p className="text-xs text-[#8b949e] mt-1 max-w-2xl leading-relaxed">
              Connect external databases, cloud services, and developer tools to your autonomous workforce.
              Connectors are persisted cleanly in both <strong className="text-purple-300">Project</strong> (<code className="font-mono text-purple-300">.kin/mcp.json</code>) and <strong className="text-cyan-300">Global</strong> (<code className="font-mono text-cyan-300">~/.kin/mcp.json</code>) scopes.
            </p>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={async () => {
                await reloadMcpServers();
                setGeneralFeedback({ type: 'success', message: 'All MCP servers hot-reloaded.' });
                setTimeout(() => setGeneralFeedback(null), 3000);
              }}
              disabled={isLoadingConnectors}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-300 hover:text-white text-xs font-semibold border border-[#30363d] transition cursor-pointer disabled:opacity-50"
              title="Hot-reload and re-discover tools for all running MCP servers"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingConnectors ? 'animate-spin' : ''}`} />
              <span>Reload All</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenAdd()}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Connector</span>
            </button>
          </div>
        </div>

        {/* Persistence Paths Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-[#21262d] text-[11px] font-mono">
          <div className="flex items-center justify-between p-2 rounded-lg bg-[#0d1117] border border-[#21262d] text-gray-400">
            <div className="flex items-center space-x-2 truncate mr-2">
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                PROJECT
              </span>
              <span className="truncate text-gray-300" title={projectMcpConfigPath || '<project>/.kin/mcp.json'}>
                {projectMcpConfigPath || '<project>/.kin/mcp.json'}
              </span>
            </div>
            {projectMcpConfigPath && (
              <button
                type="button"
                onClick={() => copyToClipboard(projectMcpConfigPath, 'project')}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#21262d] transition"
                title="Copy Project Config Path"
              >
                {copiedPath === 'project' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between p-2 rounded-lg bg-[#0d1117] border border-[#21262d] text-gray-400">
            <div className="flex items-center space-x-2 truncate mr-2">
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                GLOBAL
              </span>
              <span className="truncate text-gray-300" title={globalMcpConfigPath || '~/.kin/mcp.json'}>
                {globalMcpConfigPath || '~/.kin/mcp.json'}
              </span>
            </div>
            {globalMcpConfigPath && (
              <button
                type="button"
                onClick={() => copyToClipboard(globalMcpConfigPath, 'global')}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#21262d] transition"
                title="Copy Global Config Path"
              >
                {copiedPath === 'global' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {generalFeedback && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center justify-between border ${
            generalFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            {generalFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400" />
            )}
            <span>{generalFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setGeneralFeedback(null)}
            className="text-gray-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Preset Templates Carousel */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Popular Connector Presets</span>
          </span>
          <span className="text-[11px] text-[#8b949e]">Click any preset to prefill and configure</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {CONNECTOR_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleOpenAdd(preset)}
              className="text-left p-3 rounded-xl bg-[#161b22] hover:bg-[#1c2129] border border-[#21262d] hover:border-[#38434f] transition group cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-lg bg-[#0d1117] border border-[#30363d] group-hover:border-emerald-500/40 transition">
                      {preset.icon}
                    </div>
                    <span className="font-bold text-white text-xs">{preset.title}</span>
                  </div>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase ${
                      preset.scope === 'global'
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    }`}
                  >
                    {preset.scope}
                  </span>
                </div>
                <p className="text-[11px] text-[#8b949e] line-clamp-2 leading-relaxed">
                  {preset.desc}
                </p>
              </div>

              <div className="pt-2 mt-2 border-t border-[#21262d] flex items-center justify-between text-[10px] font-mono text-gray-400">
                <span className="truncate">{preset.url ? 'HTTP-SSE' : (preset.command || 'stdio')}</span>
                <span className="text-emerald-400 group-hover:translate-x-0.5 transition-transform font-sans font-semibold">
                  + Use Template →
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Scope Filtering & Search Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#21262d]">
        <div className="flex items-center space-x-1.5 bg-[#0d1117] p-1 rounded-lg border border-[#21262d] w-fit">
          <button
            type="button"
            onClick={() => setScopeFilter('all')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
              scopeFilter === 'all'
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                : 'text-[#8b949e] hover:text-white'
            }`}
          >
            All ({mcpConnectors.length})
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter('project')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer flex items-center space-x-1.5 ${
              scopeFilter === 'project'
                ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                : 'text-[#8b949e] hover:text-white'
            }`}
          >
            <span>Project Scope</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-500/20 font-mono">
              {projectCount}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter('global')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer flex items-center space-x-1.5 ${
              scopeFilter === 'global'
                ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30'
                : 'text-[#8b949e] hover:text-white'
            }`}
          >
            <span>Global Scope</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-500/20 font-mono">
              {globalCount}
            </span>
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Search configured connectors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Connectors List */}
      <div className="space-y-3">
        {filteredConnectors.length === 0 ? (
          <div className="p-8 rounded-xl bg-[#161b22] border border-dashed border-[#30363d] text-center space-y-3">
            <Server className="w-8 h-8 text-gray-500 mx-auto opacity-60" />
            <div>
              <div className="text-xs font-bold text-white">No Connectors Configured in this Scope</div>
              <p className="text-[11px] text-[#8b949e] mt-1 max-w-md mx-auto">
                Add your first MCP connector using a pre-configured template above or register a custom command or HTTP-SSE server.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenAdd()}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Configure Connector</span>
            </button>
          </div>
        ) : (
          filteredConnectors.map((conn) => {
            const cardId = `${conn.scope}:${conn.name}`;
            const isTesting = testingConnectorId === cardId;
            const lastTest = testResults[cardId];
            const isExpanded = expandedToolId === cardId;
            const hasEnv = conn.env && Object.keys(conn.env).length > 0;

            return (
              <div
                key={cardId}
                className={`p-4 rounded-xl border transition ${
                  conn.disabled
                    ? 'bg-[#12161f]/60 border-[#21262d] opacity-75'
                    : 'bg-[#161b22] border-[#30363d] hover:border-[#484f58]'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Title & Status */}
                  <div className="flex items-start space-x-3 min-w-0">
                    <div className="p-2 rounded-lg bg-[#0d1117] border border-[#21262d] shrink-0 mt-0.5">
                      {conn.url ? (
                        <Globe className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <Terminal className="w-4 h-4 text-emerald-400" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-xs font-mono">{conn.name}</span>

                        {/* Scope Badge */}
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                            conn.scope === 'global'
                              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                              : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                          }`}
                        >
                          {conn.scope}
                        </span>

                        {conn.overridden && (
                          <span
                            className="px-2 py-0.5 rounded text-[9px] font-mono font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30"
                            title="A project-scoped connector with the same identifier overrides this global connector"
                          >
                            Overridden by project
                          </span>
                        )}

                        {/* Status Badge */}
                        {(() => {
                          const isRunning = !conn.disabled && (conn.status === 'running' || conn.status === 'active');
                          const isDisabled = conn.disabled || conn.status === 'disabled';
                          const isFailed = conn.status === 'failed' || conn.status === 'error';
                          const statusLabel = isDisabled ? 'disabled' : (isRunning ? 'running' : (isFailed ? 'failed' : 'stopped'));
                          return (
                            <span
                              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${
                                isRunning
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : isDisabled
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                  : isFailed
                                  ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                  : 'bg-gray-500/10 text-gray-400 border-gray-500/30'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isRunning
                                    ? 'bg-emerald-400 animate-pulse'
                                    : isDisabled
                                    ? 'bg-amber-400'
                                    : isFailed
                                    ? 'bg-red-400'
                                    : 'bg-gray-400'
                                }`}
                              />
                              <span>{statusLabel}</span>
                            </span>
                          );
                        })()}
                      </div>

                      {/* Command or URL String */}
                      <div className="font-mono text-[11px] text-gray-400 truncate max-w-xl">
                        {conn.url ? (
                          <span className="text-cyan-300">{conn.url}</span>
                        ) : (
                          <span>
                            <strong className="text-white">{conn.command}</strong>{' '}
                            {(conn.args || []).join(' ')}
                          </span>
                        )}
                      </div>

                      {/* Metadata row */}
                      <div className="flex items-center space-x-3 text-[10px] text-[#8b949e] font-mono pt-0.5">
                        <span className="flex items-center space-x-1">
                          <Sliders className="w-3 h-3 text-gray-400" />
                          <span>{conn.toolsCount} exposed tools</span>
                        </span>
                        {hasEnv && (
                          <span className="flex items-center space-x-1 text-amber-400/90">
                            <Shield className="w-3 h-3" />
                            <span>{Object.keys(conn.env || {}).length} env variables</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Toggles */}
                  <div className="flex items-center space-x-2 shrink-0 self-end md:self-center">
                    {/* Test Connection Button */}
                    <button
                      type="button"
                      onClick={() => handleCardTest(conn)}
                      disabled={isTesting}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-300 hover:text-white text-xs font-semibold border border-[#30363d] transition cursor-pointer disabled:opacity-50"
                      title="Probe server connectivity and test tool discovery"
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3 h-3 text-amber-400" />
                          <span>Test</span>
                        </>
                      )}
                    </button>

                    {/* Enable / Disable Hot Toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggle(conn)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer border ${
                        conn.disabled
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                      }`}
                      title={conn.disabled ? 'Click to enable connector' : 'Click to disable connector'}
                    >
                      {conn.disabled ? 'Enable' : 'Active'}
                    </button>

                    {/* Edit Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(conn)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#21262d] transition cursor-pointer"
                      title="Edit Connector Configuration"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete Button */}
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm({ scope: conn.scope, name: conn.name })}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                      title="Delete Connector"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Test Result Callout if available */}
                {lastTest && (
                  <div
                    className={`mt-3 p-2.5 rounded-lg text-[11px] font-mono flex items-center justify-between border ${
                      lastTest.success
                        ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                        : 'bg-red-950/40 border-red-500/30 text-red-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {lastTest.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      )}
                      <span>
                        {lastTest.success
                          ? `Connection verified in ${lastTest.durationMs}ms. Discovered ${lastTest.toolsCount} live tool(s)${lastTest.tools && lastTest.tools.length > 0 ? `: [${lastTest.tools.join(', ')}]` : '.'}`
                          : `Handshake failed: ${lastTest.error || lastTest.message || 'Probe failed'}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTestResults((prev) => {
                        const copy = { ...prev };
                        delete copy[cardId];
                        return copy;
                      })}
                      className="text-gray-400 hover:text-white p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Expandable Tools Drawer */}
                {conn.tools && conn.tools.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-[#21262d]">
                    <button
                      type="button"
                      onClick={() => setExpandedToolId(isExpanded ? null : cardId)}
                      className="flex items-center justify-between w-full text-left text-xs text-gray-400 hover:text-white transition cursor-pointer"
                    >
                      <span className="font-mono text-[11px] text-cyan-400 flex items-center space-x-1.5">
                        <Terminal className="w-3 h-3 text-cyan-400" />
                        <span>Inspect Discovered Tools ({conn.tools.length})</span>
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {conn.tools.map((rawTool: any, toolIdx: number) => {
                          const toolName = typeof rawTool === 'string' ? rawTool : (rawTool?.name || '');
                          const toolDesc = typeof rawTool === 'object' ? rawTool?.description : undefined;
                          const toolSchema = typeof rawTool === 'object' ? rawTool?.inputSchema : undefined;
                          return (
                            <div
                              key={`${toolName}-${toolIdx}`}
                              className="p-2 rounded-lg bg-[#0d1117] border border-[#21262d] space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-bold text-xs text-emerald-400">
                                  mcp__{conn.name}__{toolName}
                                </span>
                                <span className="text-[9px] font-mono text-gray-500 uppercase">
                                  MCP Tool
                                </span>
                              </div>
                              {toolDesc && (
                                <p className="text-[11px] text-gray-300 leading-snug">{toolDesc}</p>
                              )}
                              {toolSchema && (
                                <details className="text-[10px] text-gray-400 font-mono">
                                  <summary className="cursor-pointer hover:text-cyan-400 transition">
                                    View Input Schema
                                  </summary>
                                  <pre className="p-2 mt-1 rounded bg-[#090d16] text-[#cbd5e1] overflow-x-auto text-[10px] leading-tight">
                                    {JSON.stringify(toolSchema, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-[#161b22] border border-red-500/40 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-red-400 font-bold text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Confirm Connector Deletion</span>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Are you sure you want to remove connector <strong className="text-white font-mono">{deleteConfirm.name}</strong> from{' '}
              <strong className="text-purple-300 uppercase font-mono">{deleteConfirm.scope}</strong> scope?
              The running subprocess will be stopped and its tools unregistered immediately.
            </p>

            <div className="flex justify-end space-x-2 pt-2 border-t border-[#30363d]">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-300 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow cursor-pointer"
              >
                Delete Connector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Drawer Modal */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-kin-text font-sans">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#21262d] bg-[#161b22]">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {editingConnector ? `Edit Connector: ${editingConnector.name}` : 'Add New MCP Connector'}
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Configure executable subprocess or remote HTTP-SSE endpoint
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[#21262d] text-gray-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveConnector} className="flex-1 overflow-y-auto p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {formTestResult && (
                <div
                  className={`p-3 rounded-lg text-xs flex items-center justify-between border ${
                    formTestResult.success
                      ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                      : 'bg-red-950/60 border-red-500/40 text-red-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {formTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span>
                      {formTestResult.success
                        ? `Probe verified in ${formTestResult.durationMs}ms! ${formTestResult.toolsCount} tool(s) discovered${formTestResult.tools && formTestResult.tools.length > 0 ? `: [${formTestResult.tools.join(', ')}]` : '.'}`
                        : `Test failed: ${formTestResult.error || formTestResult.message || 'Probe failed'}`}
                    </span>
                  </div>
                </div>
              )}

              {/* Scope & Transport Type Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1.5">
                    Storage Scope *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!!editingConnector}
                      onClick={() => setFormScope('project')}
                      className={`p-2.5 rounded-lg text-left border transition cursor-pointer disabled:opacity-60 ${
                        formScope === 'project'
                          ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                          : 'bg-[#161b22] border-[#30363d] text-gray-400 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs">Project Scope</div>
                      <div className="text-[10px] font-mono text-[#8b949e] mt-0.5">.kin/mcp.json</div>
                    </button>

                    <button
                      type="button"
                      disabled={!!editingConnector}
                      onClick={() => setFormScope('global')}
                      className={`p-2.5 rounded-lg text-left border transition cursor-pointer disabled:opacity-60 ${
                        formScope === 'global'
                          ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300'
                          : 'bg-[#161b22] border-[#30363d] text-gray-400 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs">Global Scope</div>
                      <div className="text-[10px] font-mono text-[#8b949e] mt-0.5">~/.kin/mcp.json</div>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1.5">
                    Transport Type *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormType('stdio')}
                      className={`p-2.5 rounded-lg text-left border transition cursor-pointer ${
                        formType === 'stdio'
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                          : 'bg-[#161b22] border-[#30363d] text-gray-400 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs">Local stdio</div>
                      <div className="text-[10px] text-[#8b949e] mt-0.5">Subprocess execution</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormType('http')}
                      className={`p-2.5 rounded-lg text-left border transition cursor-pointer ${
                        formType === 'http'
                          ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                          : 'bg-[#161b22] border-[#30363d] text-gray-400 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs">HTTP-SSE</div>
                      <div className="text-[10px] text-[#8b949e] mt-0.5">Remote network URL</div>
                    </button>
                  </div>
                </div>
              </div>

              {/* Server Name Identifier */}
              <div>
                <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                  Server Identifier Name *
                </label>
                <input
                  type="text"
                  disabled={!!editingConnector}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder="e.g. github, sqlite-prod, slack-bot"
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                />
                <span className="text-[10px] text-[#8b949e] mt-0.5 block">
                  Exposed tool prefix will be <code className="text-cyan-400 font-mono">mcp__{formName || '<name>'}__&lt;tool&gt;</code>
                </span>
              </div>

              {/* Stdio Specific Fields */}
              {formType === 'stdio' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1">
                      <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                        Command Executable *
                      </label>
                      <input
                        type="text"
                        value={formCommand}
                        onChange={(e) => setFormCommand(e.target.value)}
                        placeholder="npx, node, python, uvx"
                        className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                        Arguments (space-separated)
                      </label>
                      <input
                        type="text"
                        value={formArgs}
                        onChange={(e) => setFormArgs(e.target.value)}
                        placeholder="-y @modelcontextprotocol/server-sqlite --db-path ./data.db"
                        className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </>
              ) : (
                /* HTTP Endpoint URL */
                <div>
                  <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                    HTTP/SSE Endpoint URL *
                  </label>
                  <input
                    type="url"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="http://127.0.0.1:8000/sse or https://mcp.domain.com/sse"
                    className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}

              {/* Environment Variables Key-Value Editor */}
              <div className="space-y-2 pt-2 border-t border-[#21262d]">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    <span>Environment Variables & Secrets</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddEnvPair}
                    className="flex items-center space-x-1 text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer font-medium"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Variable</span>
                  </button>
                </div>

                {formEnvPairs.length === 0 ? (
                  <div className="p-3 rounded-lg bg-[#161b22] border border-dashed border-[#30363d] text-center text-[11px] text-[#8b949e]">
                    No environment variables defined. Click "+ Add Variable" to add API tokens or database secrets.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formEnvPairs.map((pair, idx) => (
                      <div key={idx} className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={pair.key}
                          onChange={(e) => handleUpdateEnvKey(idx, e.target.value)}
                          placeholder="VARIABLE_NAME"
                          className="w-1/3 bg-[#161b22] border border-[#30363d] rounded-lg px-2.5 py-1.5 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                        />
                        <div className="relative flex-1">
                          <input
                            type={pair.masked ? 'password' : 'text'}
                            value={pair.value}
                            onChange={(e) => handleUpdateEnvValue(idx, e.target.value)}
                            placeholder="value or secret token"
                            className="w-full bg-[#161b22] border border-[#30363d] rounded-lg pl-2.5 pr-8 py-1.5 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleToggleMask(idx)}
                            className="absolute right-2 top-2 text-gray-400 hover:text-white"
                            title={pair.masked ? 'Reveal value' : 'Mask value'}
                          >
                            {pair.masked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveEnvPair(idx)}
                          className="p-1.5 text-gray-400 hover:text-red-400 transition"
                          title="Remove variable"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Drawer Modal Action Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-[#21262d]">
                <button
                  type="button"
                  onClick={handleTestInEditor}
                  disabled={formTesting || formSaving}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-amber-300 text-xs font-semibold border border-amber-500/30 transition cursor-pointer disabled:opacity-50"
                  title="Test connector handshake in isolated process before saving"
                >
                  {formTesting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Testing Handshake...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>Test Handshake</span>
                    </>
                  )}
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsEditorOpen(false)}
                    className="px-3.5 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-300 text-xs font-semibold transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSaving || formTesting}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
                  >
                    {formSaving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Connector</span>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
