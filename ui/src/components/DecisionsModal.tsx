import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  X,
  Scale,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Trash2,
  Search,
  Filter,
  AlertCircle,
  FileText,
  RotateCcw,
} from 'lucide-react';

export const DecisionsModal: React.FC = () => {
  const {
    activeProject,
    decisions,
    isDecisionsModalOpen,
    setDecisionsModalOpen,
    createDecision,
    resolveDecision,
    deleteDecision,
  } = useKinStore();

  const [statusFilter, setStatusFilter] = useState<'all' | 'authoritative' | 'proposed' | 'rejected' | 'superseded'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showProposeForm, setShowProposeForm] = useState(false);

  // New Decision Form State
  const [newTitle, setNewTitle] = useState('');
  const [newRationale, setNewRationale] = useState('');
  const [newAlternatives, setNewAlternatives] = useState('');
  const [newInitialStatus, setNewInitialStatus] = useState<'proposed' | 'authoritative'>('proposed');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!isDecisionsModalOpen) return null;

  const filteredDecisions = decisions.filter((d) => {
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !query ||
      (d.title || '').toLowerCase().includes(query) ||
      (d.rationale || '').toLowerCase().includes(query) ||
      (d.decidedById || '').toLowerCase().includes(query) ||
      (Array.isArray(d.alternativesConsidered) && d.alternativesConsidered.some((alt) => (alt || '').toLowerCase().includes(query)));
    return matchesStatus && matchesSearch;
  });

  const countByStatus = {
    all: decisions.length,
    authoritative: decisions.filter((d) => d.status === 'authoritative').length,
    proposed: decisions.filter((d) => d.status === 'proposed').length,
    rejected: decisions.filter((d) => d.status === 'rejected').length,
    superseded: decisions.filter((d) => d.status === 'superseded').length,
  };

  const handleProposeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newRationale.trim()) {
      setFeedback({ type: 'error', message: 'Title and rationale are required.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const alts = newAlternatives
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await createDecision({
      title: newTitle.trim(),
      rationale: newRationale.trim(),
      alternativesConsidered: alts,
      status: newInitialStatus,
    });

    setIsSubmitting(false);

    if (res.success) {
      setNewTitle('');
      setNewRationale('');
      setNewAlternatives('');
      setShowProposeForm(false);
      setFeedback({ type: 'success', message: 'Decision successfully recorded in SQLite ADR ledger.' });
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to create decision' });
    }
  };

  const handleStatusChange = async (decisionId: string, status: 'proposed' | 'authoritative' | 'superseded' | 'rejected') => {
    const res = await resolveDecision(decisionId, status);
    if (res.success) {
      setFeedback({ type: 'success', message: `Decision status updated to ${status}.` });
      setTimeout(() => setFeedback(null), 2500);
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to update status' });
    }
  };

  const handleDelete = async (decisionId: string) => {
    if (!confirm('Are you sure you want to permanently delete this architecture decision record?')) {
      return;
    }
    const res = await deleteDecision(decisionId);
    if (res.success) {
      setFeedback({ type: 'success', message: 'Decision record deleted.' });
      setTimeout(() => setFeedback(null), 2500);
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to delete decision' });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'authoritative':
        return (
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold uppercase tracking-wider">
            <ShieldCheck className="w-3 h-3" />
            <span>Authoritative</span>
          </span>
        );
      case 'proposed':
        return (
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-semibold uppercase tracking-wider">
            <Clock className="w-3 h-3" />
            <span>Proposed</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 text-[10px] font-semibold uppercase tracking-wider">
            <XCircle className="w-3 h-3" />
            <span>Rejected</span>
          </span>
        );
      case 'superseded':
        return (
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-400 border border-slate-500/30 text-[10px] font-semibold uppercase tracking-wider">
            <RotateCcw className="w-3 h-3" />
            <span>Superseded</span>
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full bg-[#1e293b] text-[#94a3b8] text-[10px] font-semibold uppercase">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0b101d] border border-[#1e293b] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e293b] flex items-center justify-between bg-[#0e1424]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-kin-text">Architecture Decision Records (ADR)</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-300">
                  {activeProject?.name || 'Project'}
                </span>
              </div>
              <p className="text-xs text-[#64748b] mt-0.5">
                Authoritative architectural consensus and invariants compiled into LLM context Block 3.
              </p>
            </div>
          </div>
          <button
            onClick={() => setDecisionsModalOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[#1e293b] text-[#64748b] hover:text-kin-text transition"
            title="Close ADR Modal (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`px-6 py-2 text-xs flex items-center justify-between border-b ${
              feedback.type === 'success'
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
                : 'bg-red-950/40 text-red-300 border-red-500/30'
            }`}
          >
            <div className="flex items-center space-x-2">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button onClick={() => setFeedback(null)} className="text-[10px] opacity-70 hover:opacity-100">
              Dismiss
            </button>
          </div>
        )}

        {/* Control Toolbar */}
        <div className="px-6 py-3 border-b border-[#1e293b] bg-[#090d18] flex flex-wrap items-center justify-between gap-3">
          {/* Status Filter Tabs */}
          <div className="flex items-center space-x-1 bg-[#060a12] p-1 rounded-xl border border-[#1e293b]">
            <Filter className="w-3.5 h-3.5 text-[#64748b] ml-1.5 mr-0.5" />
            {(['all', 'authoritative', 'proposed', 'rejected', 'superseded'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition ${
                  statusFilter === tab
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[#64748b] hover:text-kin-text hover:bg-[#1e293b]/50'
                }`}
              >
                <span>{tab}</span>
                <span className="ml-1 text-[10px] opacity-75 font-mono">({countByStatus[tab]})</span>
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#64748b] absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search ADRs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-lg bg-[#0e1424] border border-[#1e293b] text-xs text-kin-text placeholder-[#64748b] focus:outline-none focus:border-blue-500/50 w-44"
              />
            </div>

            {/* Propose ADR Button */}
            <button
              onClick={() => setShowProposeForm(!showProposeForm)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showProposeForm ? 'Cancel Proposal' : 'Propose ADR'}</span>
            </button>
          </div>
        </div>

        {/* Propose Form Drawer */}
        {showProposeForm && (
          <form onSubmit={handleProposeSubmit} className="p-5 border-b border-[#1e293b] bg-[#0c1222] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>Propose New Architecture Decision Record</span>
              </h3>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] text-[#64748b]">Initial Status:</span>
                <select
                  value={newInitialStatus}
                  onChange={(e) => setNewInitialStatus(e.target.value as any)}
                  className="bg-[#090d18] border border-[#1e293b] rounded px-2 py-0.5 text-xs text-kin-text focus:outline-none"
                >
                  <option value="proposed">Proposed (Under Review)</option>
                  <option value="authoritative">Authoritative (Active Law)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[#94a3b8] mb-1 font-medium">Decision Title / Invariant:</label>
              <input
                type="text"
                placeholder="e.g., Use SQLite WAL mode with 15000ms busyTimeout for IPC state persistence"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-[#090d18] border border-[#1e293b] text-xs text-kin-text placeholder-[#64748b] focus:outline-none focus:border-amber-500/50"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#94a3b8] mb-1 font-medium">Rationale & Context:</label>
              <textarea
                placeholder="Explain why this decision is necessary, trade-offs accepted, and how agents must obey it..."
                value={newRationale}
                onChange={(e) => setNewRationale(e.target.value)}
                rows={3}
                className="w-full px-3 py-1.5 rounded-lg bg-[#090d18] border border-[#1e293b] text-xs text-kin-text placeholder-[#64748b] focus:outline-none focus:border-amber-500/50"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#94a3b8] mb-1 font-medium">
                Alternatives Considered (one per line):
              </label>
              <textarea
                placeholder="e.g. JSON file storage (rejected: prone to race conditions under multi-agent writes)&#10;PostgreSQL daemon (rejected: heavy dependency footprint)"
                value={newAlternatives}
                onChange={(e) => setNewAlternatives(e.target.value)}
                rows={2}
                className="w-full px-3 py-1.5 rounded-lg bg-[#090d18] border border-[#1e293b] text-xs text-kin-text placeholder-[#64748b] focus:outline-none focus:border-amber-500/50"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setShowProposeForm(false)}
                className="px-3 py-1.5 rounded-lg bg-[#1e293b] text-xs text-[#94a3b8] hover:text-kin-text transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !newTitle.trim() || !newRationale.trim()}
                className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-40"
              >
                {isSubmitting ? 'Recording...' : 'Commit Decision to SQLite'}
              </button>
            </div>
          </form>
        )}

        {/* Decisions Stream */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {filteredDecisions.map((dec) => {
            const dateStr = new Date(dec.createdAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={dec.id}
                className={`p-4 rounded-xl border transition ${
                  dec.status === 'authoritative'
                    ? 'bg-[#0d1627] border-emerald-500/30 shadow-md shadow-emerald-950/20'
                    : dec.status === 'proposed'
                    ? 'bg-[#121626] border-amber-500/30'
                    : dec.status === 'rejected'
                    ? 'bg-[#150f14] border-red-500/20 opacity-80'
                    : 'bg-[#0e1322] border-slate-700/30 opacity-70'
                }`}
              >
                {/* Top Row: Title, Status Badge, and Date */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      {getStatusBadge(dec.status)}
                      <h3 className="font-bold text-kin-text text-sm">{dec.title}</h3>
                    </div>
                    <div className="flex items-center space-x-2 text-[11px] text-[#64748b]">
                      <span>Decided by: <strong className="text-blue-400">{dec.decidedById || 'System / Operator'}</strong></span>
                      <span>•</span>
                      <span>Recorded on: {dateStr}</span>
                      <span>•</span>
                      <span className="font-mono text-[10px] text-[#475569]">{dec.id}</span>
                    </div>
                  </div>

                  {/* Quick Action Delete */}
                  <button
                    onClick={() => handleDelete(dec.id)}
                    className="p-1.5 rounded hover:bg-red-500/20 text-[#64748b] hover:text-red-400 transition"
                    title="Delete Decision Record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Rationale Content */}
                <div className="mt-3 p-3 rounded-lg bg-[#060a12] border border-[#1e293b]/70 text-xs text-[#cbd5e1] leading-relaxed whitespace-pre-wrap">
                  {dec.rationale}
                </div>

                {/* Alternatives Considered */}
                {Array.isArray(dec.alternativesConsidered) && dec.alternativesConsidered.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
                      Alternatives Considered & Trade-offs:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {dec.alternativesConsidered.map((alt, idx) => (
                        <div
                          key={idx}
                          className="px-2.5 py-1 rounded-md bg-[#0a0f1d] border border-[#1e293b] text-[11px] text-[#94a3b8]"
                        >
                          {alt}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Status Resolution Actions */}
                <div className="mt-3 pt-3 border-t border-[#1e293b]/60 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-[#64748b]">Change Resolution:</span>
                  <div className="flex items-center space-x-1.5">
                    {dec.status !== 'authoritative' && (
                      <button
                        onClick={() => handleStatusChange(dec.id, 'authoritative')}
                        className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold transition flex items-center space-x-1"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        <span>Accept Authoritative</span>
                      </button>
                    )}
                    {dec.status !== 'proposed' && (
                      <button
                        onClick={() => handleStatusChange(dec.id, 'proposed')}
                        className="px-2.5 py-1 rounded bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-[11px] font-semibold transition flex items-center space-x-1"
                      >
                        <Clock className="w-3 h-3" />
                        <span>Revert to Proposed</span>
                      </button>
                    )}
                    {dec.status !== 'rejected' && (
                      <button
                        onClick={() => handleStatusChange(dec.id, 'rejected')}
                        className="px-2.5 py-1 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 text-[11px] font-semibold transition flex items-center space-x-1"
                      >
                        <XCircle className="w-3 h-3" />
                        <span>Reject</span>
                      </button>
                    )}
                    {dec.status !== 'superseded' && (
                      <button
                        onClick={() => handleStatusChange(dec.id, 'superseded')}
                        className="px-2.5 py-1 rounded bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 border border-slate-600/40 text-[11px] font-semibold transition flex items-center space-x-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Supersede</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {filteredDecisions.length === 0 && (
            <div className="h-48 flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#1e293b] rounded-xl bg-[#0c1222]/30 space-y-2">
              <Scale className="w-8 h-8 text-[#64748b]" />
              <div className="text-xs font-semibold text-kin-text">No architecture decisions found</div>
              <p className="text-[11px] text-[#64748b] max-w-sm">
                {searchQuery || statusFilter !== 'all'
                  ? 'No records match your active search or filter.'
                  : 'Architecture Decision Records allow agents and engineers to codify immutable invariants into SQLite.'}
              </p>
              {!showProposeForm && (
                <button
                  onClick={() => setShowProposeForm(true)}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition"
                >
                  Propose First Decision
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
