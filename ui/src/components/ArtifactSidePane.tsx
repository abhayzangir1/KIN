import React, { useEffect, useState } from 'react';
import { FileText, CheckCircle2, MessageSquarePlus, RefreshCw, X } from 'lucide-react';
import { useKinStore } from '../store/kinStore.js';
import { MarkdownPreview } from './files/MarkdownPreview.js';
import { UnifiedDiffViewer } from './code/UnifiedDiffViewer.js';

interface ArtifactEntry {
  id: string;
  project_id: string;
  run_id?: string | null;
  kind: string;
  uri: string;
  sha256?: string | null;
  metadata_json?: string | null;
  created_at: number;
}

interface ArtifactSidePaneProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArtifactSidePane: React.FC<ArtifactSidePaneProps> = ({ isOpen, onClose }) => {
  const activeProjectId = useKinStore((s) => s.activeProjectId);
  const activeChannelId = useKinStore((s) => s.activeChannelId);
  const sendMessage = useKinStore((s) => s.sendMessage);
  const addToast = useKinStore((s) => s.addToast);

  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [selected, setSelected] = useState<ArtifactEntry | null>(null);
  const [content, setContent] = useState<string>('');
  const [lineRange, setLineRange] = useState<string>('');
  const [commentText, setCommentText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loadArtifacts = async () => {
    if (!activeProjectId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/artifacts?projectId=${encodeURIComponent(activeProjectId)}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data?.artifacts) ? data.artifacts : [];
        setArtifacts(list);
        setSelected((prev) => {
          if (prev && list.some((a: ArtifactEntry) => a.id === prev.id)) return prev;
          return list[0] || null;
        });
      } else {
        addToast(`Failed to load artifacts (HTTP ${res.status})`, 'error');
      }
    } catch {
      addToast('Failed to load project artifacts', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    setContent('');
    if (isOpen) {
      loadArtifacts();
    }
  }, [isOpen, activeProjectId]);

  useEffect(() => {
    if (!selected || !activeProjectId) {
      setContent('');
      return;
    }
    let meta: any = {};
    try {
      meta = selected.metadata_json ? JSON.parse(selected.metadata_json) : {};
    } catch {}
    const relPath = meta?.filePath || selected.uri.replace(/^file:\/\//i, '');
    if (!relPath) return;

    fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/artifacts?path=${encodeURIComponent(relPath)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (typeof d?.content === 'string') setContent(d.content);
        else setContent(JSON.stringify(meta, null, 2));
      })
      .catch(() => {
        setContent(Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '');
      });
  }, [selected, activeProjectId]);

  if (!isOpen) return null;

  const handleDecision = async (decision: 'proceed' | 'revise') => {
    if (!activeChannelId) return;
    const label = selected?.uri || 'artifact';
    const rangeTag = lineRange.trim() ? ` @ ${lineRange.trim()}` : '';
    const note = commentText.trim();
    const message =
      decision === 'proceed'
        ? `[Artifact Approved] Proceed with ${label}${rangeTag}${note ? `: ${note}` : ''}`
        : `[Revision Requested] ${label}${rangeTag}: ${note || 'Please revise and re-verify.'}`;
    await sendMessage(activeChannelId, message);
    setLineRange('');
    setCommentText('');
    addToast(decision === 'proceed' ? 'Artifact approved' : 'Revision requested', 'success');
  };

  const isDiff = selected?.kind?.includes('diff') || content.startsWith('diff --git') || content.startsWith('@@ ');

  return (
    <aside className="w-[380px] shrink-0 h-full bg-kin-surface border-l border-kin-border flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-kin-border">
        <div className="flex items-center space-x-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-kin-text">Artifacts &amp; Review</span>
        </div>
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={loadArtifacts}
            className="p-1 text-kin-muted hover:text-kin-text cursor-pointer"
            title="Refresh artifacts"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-kin-muted hover:text-kin-text cursor-pointer"
            title="Close artifacts pane"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-40 overflow-y-auto border-b border-kin-border divide-y divide-kin-border/50">
        {artifacts.length === 0 ? (
          <div className="p-4 text-xs text-kin-muted">No recorded artifacts yet.</div>
        ) : (
          artifacts.map((art) => {
            let fileLabel = art.uri;
            try {
              const m = art.metadata_json ? JSON.parse(art.metadata_json) : {};
              if (m?.filePath) fileLabel = m.filePath;
            } catch {}
            return (
              <button
                key={art.id}
                type="button"
                onClick={() => setSelected(art)}
                className={`w-full text-left px-3 py-2 text-xs transition cursor-pointer ${
                  selected?.id === art.id ? 'bg-kin-card text-cyan-400 font-semibold' : 'text-kin-text hover:bg-kin-cardHover'
                }`}
              >
                <div className="truncate">{fileLabel}</div>
                <div className="text-[10px] text-kin-muted font-mono">{art.kind}</div>
              </button>
            );
          })
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {selected && content ? (
          isDiff ? <UnifiedDiffViewer diff={content} /> : <MarkdownPreview content={content} />
        ) : (
          <div className="text-xs text-kin-muted">Select an artifact to inspect.</div>
        )}
      </div>

      <div className="p-3 border-t border-kin-border space-y-2">
        <input
          type="text"
          value={lineRange}
          onChange={(e) => setLineRange(e.target.value)}
          placeholder="Optional line/range (e.g. L12-L24)"
          className="w-full bg-kin-card border border-kin-border rounded-lg px-2 py-1 text-xs text-kin-text font-mono focus:outline-none focus:border-cyan-500"
        />
        <textarea
          rows={2}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Add inline review feedback..."
          className="w-full bg-kin-card border border-kin-border rounded-lg p-2 text-xs text-kin-text focus:outline-none focus:border-cyan-500 resize-none"
        />
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => handleDecision('revise')}
            className="flex-1 flex items-center justify-center space-x-1 px-2.5 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-xs font-semibold cursor-pointer"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Request Revision</span>
          </button>
          <button
            type="button"
            onClick={() => handleDecision('proceed')}
            className="flex-1 flex items-center justify-center space-x-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Proceed</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
