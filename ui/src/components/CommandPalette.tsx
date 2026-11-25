import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  FolderKanban,
  Hash,
  Plus,
  CheckSquare,
  Settings,
  Plug,
  Sparkles,
  Clock,
  PanelLeft,
  PanelRight,
  CornerDownLeft,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useKinStore } from '../store/kinStore.js';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  category: 'Navigation' | 'Projects' | 'Channels' | 'Workspace';
  keywords?: string;
  badge?: string;
  icon: React.ReactNode;
  run: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const {
    projects,
    activeProjectId,
    setActiveProject,
    channels,
    activeChannelId,
    setActiveChannel,
    sidebarWidth,
    setSidebarWidth,
    isInspectorOpen,
    toggleInspector,
    openSettingsModal,
    setNewProjectModalOpen,
    setNewTaskModalOpen,
    setConnectorsModalOpen,
    setSkillsModalOpen,
    setAutomationsModalOpen,
  } = useKinStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      setActiveProject: s.setActiveProject,
      channels: s.channels,
      activeChannelId: s.activeChannelId,
      setActiveChannel: s.setActiveChannel,
      sidebarWidth: s.sidebarWidth,
      setSidebarWidth: s.setSidebarWidth,
      isInspectorOpen: s.isInspectorOpen,
      toggleInspector: s.toggleInspector,
      openSettingsModal: s.openSettingsModal,
      setNewProjectModalOpen: s.setNewProjectModalOpen,
      setNewTaskModalOpen: s.setNewTaskModalOpen,
      setConnectorsModalOpen: s.setConnectorsModalOpen,
      setSkillsModalOpen: s.setSkillsModalOpen,
      setAutomationsModalOpen: s.setAutomationsModalOpen,
    }))
  );

  const items = useMemo<CommandItem[]>(() => {
    const actions: CommandItem[] = [
      {
        id: 'action:new-project',
        label: 'New Project',
        category: 'Workspace',
        keywords: 'create project workspace repo',
        icon: <Plus className="w-4 h-4 text-emerald-400" />,
        run: () => setNewProjectModalOpen(true),
      },
      {
        id: 'action:new-task',
        label: 'New Task',
        category: 'Workspace',
        keywords: 'create task todo issue',
        icon: <CheckSquare className="w-4 h-4 text-cyan-400" />,
        run: () => setNewTaskModalOpen(true),
      },
      {
        id: 'action:settings',
        label: 'Open Settings',
        category: 'Workspace',
        keywords: 'preferences config models credentials theme',
        icon: <Settings className="w-4 h-4 text-kin-muted" />,
        run: () => openSettingsModal('general'),
      },
      {
        id: 'action:connectors',
        label: 'Open Connectors',
        category: 'Workspace',
        keywords: 'mcp tools servers integrations',
        icon: <Plug className="w-4 h-4 text-blue-400" />,
        run: () => setConnectorsModalOpen(true),
      },
      {
        id: 'action:skills',
        label: 'Open Skills',
        category: 'Workspace',
        keywords: 'skills capabilities prompts',
        icon: <Sparkles className="w-4 h-4 text-amber-400" />,
        run: () => setSkillsModalOpen(true),
      },
      {
        id: 'action:automations',
        label: 'Open Automations',
        category: 'Workspace',
        keywords: 'cron schedule recurring jobs',
        icon: <Clock className="w-4 h-4 text-purple-400" />,
        run: () => setAutomationsModalOpen(true),
      },
      {
        id: 'action:toggle-sidebar',
        label: sidebarWidth > 0 ? 'Hide Sidebar' : 'Show Sidebar',
        category: 'Navigation',
        keywords: 'toggle sidebar panel left nav',
        badge: 'Ctrl+B',
        icon: <PanelLeft className="w-4 h-4 text-kin-muted" />,
        run: () => setSidebarWidth(sidebarWidth > 0 ? 0 : 260),
      },
      {
        id: 'action:toggle-inspector',
        label: isInspectorOpen ? 'Hide Inspector' : 'Show Inspector',
        category: 'Navigation',
        keywords: 'toggle inspector right panel diagnostics',
        badge: 'Ctrl+I',
        icon: <PanelRight className="w-4 h-4 text-kin-muted" />,
        run: () => toggleInspector(),
      },
    ];

    for (const proj of projects) {
      actions.push({
        id: `project:${proj.id}`,
        label: `Switch Project: ${proj.name}`,
        category: 'Projects',
        keywords: `project switch ${proj.name} ${proj.repoPath || ''}`,
        badge: proj.id === activeProjectId ? 'Active' : undefined,
        icon: <FolderKanban className="w-4 h-4 text-emerald-400" />,
        run: () => {
          void setActiveProject(proj.id);
        },
      });
    }

    for (const ch of channels) {
      actions.push({
        id: `channel:${ch.id}`,
        label: `Switch Channel: #${ch.name}`,
        category: 'Channels',
        keywords: `channel switch ${ch.name} ${ch.topic || ''}`,
        badge: ch.id === activeChannelId ? 'Active' : undefined,
        icon: <Hash className="w-4 h-4 text-cyan-400" />,
        run: () => {
          void setActiveChannel(ch.id);
        },
      });
    }

    return actions;
  }, [
    projects,
    activeProjectId,
    setActiveProject,
    channels,
    activeChannelId,
    setActiveChannel,
    sidebarWidth,
    setSidebarWidth,
    isInspectorOpen,
    toggleInspector,
    openSettingsModal,
    setNewProjectModalOpen,
    setNewTaskModalOpen,
    setConnectorsModalOpen,
    setSkillsModalOpen,
    setAutomationsModalOpen,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.keywords && item.keywords.toLowerCase().includes(q))
    );
  }, [items, query]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  if (!isOpen) return null;

  const executeItem = (item: CommandItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      executeItem(filtered[activeIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[14vh] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl rounded-2xl bg-kin-surface border border-kin-border shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Search Input */}
        <div className="flex items-center px-4 py-3 border-b border-kin-border bg-kin-card/50 space-x-3">
          <Search className="w-4 h-4 text-kin-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, project, or channel..."
            aria-label="Search commands"
            className="flex-1 bg-transparent text-sm text-kin-text placeholder:text-kin-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-kin-muted hover:text-kin-text hover:bg-kin-card transition"
            aria-label="Close command palette"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-kin-muted">
              No matching commands for "{query}"
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isActive = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-cmd-index={idx}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => executeItem(item)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition cursor-pointer ${
                    isActive
                      ? 'bg-emerald-500/15 text-kin-text border border-emerald-500/40'
                      : 'text-kin-text/90 hover:bg-kin-card border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <span className="shrink-0">{item.icon}</span>
                    <span className="truncate font-medium">{item.label}</span>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0 ml-2">
                    {item.badge && (
                      <span className="px-1.5 py-0.5 rounded bg-kin-card border border-kin-border text-[10px] font-mono text-kin-muted">
                        {item.badge}
                      </span>
                    )}
                    <span className="text-[10px] text-kin-muted/70">{item.category}</span>
                    {isActive && <CornerDownLeft className="w-3 h-3 text-emerald-400" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="px-4 py-2 border-t border-kin-border bg-kin-card/40 flex items-center justify-between text-[10px] text-kin-muted font-mono">
          <span>↑↓ Navigate · ↵ Run · Esc Close</span>
          <span>Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
};
