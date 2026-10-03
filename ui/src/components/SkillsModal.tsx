import React, { useState, useRef, useEffect } from 'react';
import { useKinStore, SkillItem, SkillVersionItem } from '../store/kinStore.js';
import {
  X,
  Sparkles,
  Download,
  UploadCloud,
  Plus,
  Trash2,
  Edit2,
  Search,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Tag,
  FileCode,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  History,
  Activity,
  Award,
  Zap,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

export const SkillsModal: React.FC = () => {
  const {
    isSkillsModalOpen,
    setSkillsModalOpen,
    skills,
    candidateSkills,
    skillExperiences,
    learningMetrics,
    createSkill,
    updateSkill,
    deleteSkill,
    exportSkill,
    exportAllSkills,
    importSkill,
    isLoadingSkills,
    fetchCandidates,
    harvestCandidates,
    validateCandidate,
    fetchSkillExperiences,
    fetchLearningMetrics,
    fetchSkillVersions,
    rollbackSkill,
  } = useKinStore();

  const [activeTab, setActiveTab] = useState<'active' | 'candidates' | 'experiences' | 'metrics'>('active');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'builtin' | 'custom'>('all');
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);

  // New Skill Form State
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [formFeedback, setFormFeedback] = useState<string | null>(null);

  // Edit Skill Form State
  const [editingSkill, setEditingSkill] = useState<SkillItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editFeedback, setEditFeedback] = useState<string | null>(null);

  // Version History & Rollback Modal State
  const [versionHistorySkill, setVersionHistorySkill] = useState<SkillItem | null>(null);
  const [versionsList, setVersionsList] = useState<SkillVersionItem[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  // Candidate Validation Modal State
  const [validatingCandidate, setValidatingCandidate] = useState<SkillItem | null>(null);
  const [reviewerName, setReviewerName] = useState('human-operator');
  const [validationRationale, setValidationRationale] = useState('');
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [harvestMessage, setHarvestMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSkillsModalOpen) {
      fetchCandidates();
      fetchSkillExperiences();
      fetchLearningMetrics();
    }
  }, [isSkillsModalOpen]);

  if (!isSkillsModalOpen) return null;

  const isBuiltIn = (skill: SkillItem) => {
    return Boolean(skill.isBuiltIn) || skill.tags?.includes('built-in');
  };

  const filteredSkills = skills.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase()) ||
      s.tags?.some((t) => t.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;
    if (filterType === 'builtin') return isBuiltIn(s);
    if (filterType === 'custom') return !isBuiltIn(s);
    return true;
  });

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newInstructions.trim()) {
      setFormFeedback('Name and instructions are required.');
      return;
    }

    const tags = newTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const res = await createSkill({
      name: newName.trim(),
      description: newDesc.trim() || undefined,
      instructions: newInstructions.trim(),
      tags: tags.length > 0 ? tags : ['custom'],
    });

    if (res.success) {
      setNewName('');
      setNewDesc('');
      setNewTags('');
      setNewInstructions('');
      setIsCreating(false);
      setFormFeedback(null);
    } else {
      setFormFeedback(res.error || 'Failed to create skill');
    }
  };

  const startEditing = (skill: SkillItem) => {
    setEditingSkill(skill);
    setEditName(skill.name);
    setEditDesc(skill.description || '');
    setEditTags(skill.tags?.join(', ') || '');
    setEditInstructions(skill.instructions || '');
    setEditFeedback(null);
    setIsCreating(false);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSkill) return;
    if (!editName.trim() || !editInstructions.trim()) {
      setEditFeedback('Name and instructions are required.');
      return;
    }

    const tags = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const res = await updateSkill(editingSkill.id, {
      name: editName.trim(),
      description: editDesc.trim() || undefined,
      instructions: editInstructions.trim(),
      tags: tags.length > 0 ? tags : ['custom'],
    });

    if (res.success) {
      setEditingSkill(null);
      setEditFeedback(null);
    } else {
      setEditFeedback(res.error || 'Failed to update skill');
    }
  };

  const handleExportSingle = async (skill: SkillItem) => {
    const bundle = await exportSkill(skill.id);
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kin-skill-${skill.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAll = async () => {
    const bundle = await exportAllSkills();
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kin-skills-bundle-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await importSkill(parsed);
      if (!res.success) {
        alert(res.error || 'Failed to import skill bundle');
      }
    } catch (err: any) {
      alert(`Invalid JSON file: ${err.message}`);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleOpenVersions = async (skill: SkillItem) => {
    setVersionHistorySkill(skill);
    setIsLoadingVersions(true);
    const versions = await fetchSkillVersions(skill.id);
    setVersionsList(versions);
    setIsLoadingVersions(false);
  };

  const handleRollback = async (versionId: string) => {
    if (!versionHistorySkill) return;
    if (window.confirm(`Roll back skill '${versionHistorySkill.name}' to selected version snapshot?`)) {
      const res = await rollbackSkill(versionHistorySkill.id, versionId);
      if (res.success) {
        alert(`Successfully rolled back skill '${versionHistorySkill.name}' to version snapshot.`);
        setVersionHistorySkill(null);
      } else {
        alert(res.error || 'Failed to rollback skill');
      }
    }
  };

  const handleHarvest = async () => {
    setIsHarvesting(true);
    setHarvestMessage(null);
    const res = await harvestCandidates();
    setIsHarvesting(false);
    if (res.success) {
      setHarvestMessage(`Harvest complete: ${res.createdCount} new candidate lesson(s) synthesized from run experiences.`);
      fetchCandidates();
    } else {
      setHarvestMessage('No new recurring error patterns found in recent experiences.');
    }
  };

  const handleValidateDecision = async (action: 'promote' | 'reject') => {
    if (!validatingCandidate) return;
    const res = await validateCandidate(
      validatingCandidate.id,
      action,
      reviewerName.trim() || 'human-operator',
      validationRationale.trim() || undefined
    );
    if (res.success) {
      setValidatingCandidate(null);
      setValidationRationale('');
      alert(res.message || `Candidate ${action === 'promote' ? 'promoted to active' : 'rejected'}`);
    } else {
      alert(res.error || 'Failed to submit validation decision');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none">
      <div className="bg-[#0b101e] border border-[#232f48] rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl text-xs overflow-hidden">
        {/* Header Bar */}
        <div className="h-14 px-6 border-b border-[#1e293b] flex items-center justify-between bg-[#0e1526]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                <span>Self-Improvement & Skills Engine</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                  {skills.length} Active
                </span>
                {candidateSkills.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[10px] animate-pulse">
                    {candidateSkills.length} Candidates
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-[#8b949e]">
                Autonomous candidate lesson harvesting, validation gates, version rollback, and outcome adaptation
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1f2d4a] border border-[#283858] text-white font-medium transition"
              title="Import Skill Bundle from JSON"
            >
              <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
              <span>Import (.json)</span>
            </button>

            <button
              onClick={handleExportAll}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1f2d4a] border border-[#283858] text-white font-medium transition"
              title="Export All Skills as unified JSON Bundle"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export All</span>
            </button>

            <button
              onClick={() => setIsCreating(!isCreating)}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Skill</span>
            </button>

            <button
              onClick={() => setSkillsModalOpen(false)}
              className="p-1.5 rounded-lg hover:bg-[#1e293b] text-[#8b949e] hover:text-white transition ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation Bar */}
        <div className="px-6 border-b border-[#1b263b] bg-[#070b16] flex items-center justify-between">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-4 py-2.5 font-semibold text-xs border-b-2 transition flex items-center space-x-1.5 ${
                activeTab === 'active'
                  ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Active Skills ({skills.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('candidates')}
              className={`px-4 py-2.5 font-semibold text-xs border-b-2 transition flex items-center space-x-1.5 ${
                activeTab === 'candidates'
                  ? 'border-amber-500 text-amber-400 bg-amber-500/5'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Candidate Lessons ({candidateSkills.length})</span>
              {candidateSkills.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block ml-1" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('experiences')}
              className={`px-4 py-2.5 font-semibold text-xs border-b-2 transition flex items-center space-x-1.5 ${
                activeTab === 'experiences'
                  ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Execution Experiences ({skillExperiences.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('metrics')}
              className={`px-4 py-2.5 font-semibold text-xs border-b-2 transition flex items-center space-x-1.5 ${
                activeTab === 'metrics'
                  ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Learning Telemetry & Adaptation</span>
            </button>
          </div>

          {activeTab === 'candidates' && (
            <button
              onClick={handleHarvest}
              disabled={isHarvesting}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/30 font-medium transition"
            >
              <RefreshCw className={`w-3 h-3 ${isHarvesting ? 'animate-spin' : ''}`} />
              <span>{isHarvesting ? 'Synthesizing...' : 'Harvest Recent Experiences'}</span>
            </button>
          )}
        </div>

        {/* Harvest Notice Banner */}
        {harvestMessage && activeTab === 'candidates' && (
          <div className="px-6 py-2 bg-amber-950/40 border-b border-amber-500/30 text-amber-300 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{harvestMessage}</span>
            </div>
            <button onClick={() => setHarvestMessage(null)} className="text-gray-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Sub-Header / Filters (Active tab only) */}
        {activeTab === 'active' && (
          <div className="p-3 border-b border-[#1e293b] bg-[#070b16] flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search skills by name, tag, or instruction..."
                className="w-full bg-[#101728] border border-[#212d45] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center space-x-1 bg-[#101728] p-0.5 rounded-lg border border-[#212d45]">
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1 rounded text-xs transition ${
                  filterType === 'all' ? 'bg-emerald-600/30 text-emerald-300 font-semibold' : 'text-gray-400 hover:text-white'
                }`}
              >
                All ({skills.length})
              </button>
              <button
                onClick={() => setFilterType('builtin')}
                className={`px-3 py-1 rounded text-xs transition ${
                  filterType === 'builtin' ? 'bg-emerald-600/30 text-emerald-300 font-semibold' : 'text-gray-400 hover:text-white'
                }`}
              >
                Built-In ({skills.filter(isBuiltIn).length})
              </button>
              <button
                onClick={() => setFilterType('custom')}
                className={`px-3 py-1 rounded text-xs transition ${
                  filterType === 'custom' ? 'bg-emerald-600/30 text-emerald-300 font-semibold' : 'text-gray-400 hover:text-white'
                }`}
              >
                Custom ({skills.filter((s) => !isBuiltIn(s)).length})
              </button>
            </div>
          </div>
        )}

        {/* Collapsible New Skill Form */}
        {isCreating && (
          <div className="p-4 border-b border-[#1e293b] bg-[#0f182c] space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Create New Procedural Skill</span>
              <button onClick={() => setIsCreating(false)} className="text-gray-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {formFeedback && (
              <div className="p-2 rounded bg-red-950/60 border border-red-500/40 text-red-300 flex items-center space-x-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                <span>{formFeedback}</span>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Skill Name *</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., github-pull-request-creator"
                    className="w-full bg-[#0a0f1d] border border-[#232f48] rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                    placeholder="e.g., git, pr, automation"
                    className="w-full bg-[#0a0f1d] border border-[#232f48] rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-gray-400 mb-1">Brief Description</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Summary of what this skill enables the autonomous agent to do"
                  className="w-full bg-[#0a0f1d] border border-[#232f48] rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-gray-400 mb-1">Procedural Instructions (Markdown) *</label>
                <textarea
                  rows={4}
                  value={newInstructions}
                  onChange={(e) => setNewInstructions(e.target.value)}
                  placeholder="Step-by-step guidance, recovery tips, and command trajectories..."
                  className="w-full bg-[#0a0f1d] border border-[#232f48] rounded p-2 text-white font-mono text-[11px] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 rounded bg-[#1e293b] text-gray-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  Save Skill
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Collapsible Edit Skill Form */}
        {editingSkill && (
          <div className="p-4 border-b border-[#1e293b] bg-[#0f182c] space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Edit Procedural Skill: {editingSkill.name}</span>
              <button onClick={() => setEditingSkill(null)} className="text-gray-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {editFeedback && (
              <div className="p-2 rounded bg-red-950/60 border border-red-500/40 text-red-300 flex items-center space-x-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                <span>{editFeedback}</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Skill Name *</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-[#232f48] rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-[#232f48] rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-gray-400 mb-1">Brief Description</label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full bg-[#0a0f1d] border border-[#232f48] rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-gray-400 mb-1">Procedural Instructions (Markdown) *</label>
                <textarea
                  rows={4}
                  value={editInstructions}
                  onChange={(e) => setEditInstructions(e.target.value)}
                  className="w-full bg-[#0a0f1d] border border-[#232f48] rounded p-2 text-white font-mono text-[11px] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingSkill(null)}
                  className="px-3 py-1.5 rounded bg-[#1e293b] text-gray-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  Update Skill (Auto-Versioned)
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 1: ACTIVE SKILLS */}
        {activeTab === 'active' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#080d1a]">
            {isLoadingSkills && skills.length === 0 ? (
              <div className="text-center py-12 text-gray-400">Loading skills registry...</div>
            ) : filteredSkills.length === 0 ? (
              <div className="text-center py-12 text-gray-500 italic">No active skills found matching filter.</div>
            ) : (
              filteredSkills.map((skill) => {
                const builtIn = isBuiltIn(skill);
                const isExpanded = expandedSkillId === skill.id;
                const totalRuns = (skill.successCount || 0) + (skill.failureCount || 0);
                const winRate = totalRuns > 0 ? Math.round(((skill.successCount || 0) / totalRuns) * 100) : null;

                return (
                  <div
                    key={skill.id}
                    className="rounded-xl bg-[#0d1426] border border-[#1e2a44] p-3.5 space-y-2 hover:border-[#2f4068] transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center space-x-2.5">
                        <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-white text-[13px]">{skill.name}</span>
                            <span className="font-mono text-[10px] text-gray-400">v{skill.version}</span>
                            {builtIn ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] uppercase font-bold tracking-wider">
                                Core Built-in
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[9px] uppercase font-bold tracking-wider">
                                Custom
                              </span>
                            )}
                            {winRate !== null && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                                  winRate >= 80
                                    ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-amber-950/60 text-amber-300 border border-amber-500/30'
                                }`}
                                title={`${skill.successCount} wins / ${totalRuns} total runs`}
                              >
                                {winRate}% win rate
                              </span>
                            )}
                          </div>
                          {skill.description && (
                            <p className="text-[11px] text-[#94a3b8] mt-0.5">{skill.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 shrink-0">
                        {/* Version History & Rollback Button */}
                        <button
                          onClick={() => handleOpenVersions(skill)}
                          className="flex items-center space-x-1 px-2 py-1 rounded bg-[#141d33] hover:bg-[#1e2a47] text-gray-300 hover:text-white border border-[#233150] transition text-[11px]"
                          title="View Version Snapshots & Rollback"
                        >
                          <History className="w-3 h-3 text-cyan-400" />
                          <span>History</span>
                        </button>

                        <button
                          onClick={() => handleExportSingle(skill)}
                          className="p-1.5 rounded hover:bg-[#1a233a] text-gray-400 hover:text-emerald-400 transition"
                          title="Export Single Skill (.json)"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>

                        {!builtIn && (
                          <>
                            <button
                              onClick={() => startEditing(skill)}
                              className="p-1.5 rounded hover:bg-[#1a233a] text-gray-400 hover:text-blue-400 transition"
                              title="Edit Custom Skill"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm(`Delete custom skill "${skill.name}"?`)) {
                                  deleteSkill(skill.id);
                                }
                              }}
                              className="p-1.5 rounded hover:bg-red-950/40 text-gray-400 hover:text-red-400 transition"
                              title="Delete Custom Skill"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => setExpandedSkillId(isExpanded ? null : skill.id)}
                          className="p-1.5 rounded hover:bg-[#1a233a] text-gray-400 hover:text-white transition"
                          title={isExpanded ? 'Collapse Instructions' : 'View Instructions'}
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Trigger Patterns & Tags */}
                    {skill.tags && skill.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {skill.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-[#151f35] border border-[#243354] text-[10px] text-gray-300 font-mono"
                          >
                            <Tag className="w-2.5 h-2.5 text-gray-500" />
                            <span>{tag}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Expandable Instructions View */}
                    {isExpanded && (
                      <div className="mt-2 p-3 rounded-lg bg-[#070b14] border border-[#1b263e] space-y-1.5">
                        <div className="flex items-center space-x-1 text-gray-400 text-[10px] uppercase font-bold tracking-wider">
                          <FileCode className="w-3 h-3 text-emerald-400" />
                          <span>Procedural Execution Instructions</span>
                        </div>
                        <pre className="text-[11px] font-mono text-gray-200 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                          {skill.instructions}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 2: CANDIDATE LESSONS (OPENDOTS PIPELINE) */}
        {activeTab === 'candidates' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#080d1a]">
            <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 text-amber-200 text-xs flex items-start space-x-3">
              <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-amber-300">Strict OpenDots Validation Barrier:</span>
                <p className="text-[11px] text-amber-200/80 mt-0.5 leading-relaxed">
                  Candidate lessons are harvested from real execution failures and self-healing events.
                  They are <span className="underline font-bold">strictly quarantined</span> and NEVER injected into active agent prompts until validated by a human operator or verification gate.
                </p>
              </div>
            </div>

            {candidateSkills.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <div className="p-3 rounded-full bg-[#131b2e] w-12 h-12 mx-auto flex items-center justify-center text-gray-400">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <p className="text-sm font-semibold text-white">No Unvalidated Candidate Lessons</p>
                <p className="text-xs text-gray-400 max-w-md mx-auto">
                  Click &quot;Harvest Recent Experiences&quot; to scan historical failure traces and synthesize empirical mitigation rules.
                </p>
                <button
                  onClick={handleHarvest}
                  disabled={isHarvesting}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold transition"
                >
                  {isHarvesting ? 'Harvesting...' : 'Harvest Candidate Lessons Now'}
                </button>
              </div>
            ) : (
              candidateSkills.map((candidate) => (
                <div
                  key={candidate.id}
                  className="rounded-xl bg-[#0e1628] border border-amber-500/30 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-[13px]">{candidate.name}</span>
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[9px] uppercase font-bold tracking-wider">
                          Candidate (v{candidate.version})
                        </span>
                        <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 font-mono text-[9px]">
                          {candidate.evidenceCount || 1} Evidence Trace(s)
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 mt-1">{candidate.description}</p>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={() => setValidatingCandidate(candidate)}
                        className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Validate & Promote</span>
                      </button>

                      <button
                        onClick={() => {
                          if (window.confirm(`Reject and deprecate candidate '${candidate.name}'?`)) {
                            validateCandidate(candidate.id, 'reject');
                          }
                        }}
                        className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/40 transition"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>

                  {/* Synthesized Instructions */}
                  <div className="p-3 rounded-lg bg-[#070b14] border border-[#1d273e]">
                    <div className="text-[10px] uppercase font-bold text-amber-400 tracking-wider mb-1 flex items-center space-x-1">
                      <FileCode className="w-3 h-3" />
                      <span>Proposed Procedural Rule:</span>
                    </div>
                    <pre className="text-xs font-mono text-gray-200 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                      {candidate.instructions}
                    </pre>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: EXECUTION EXPERIENCES */}
        {activeTab === 'experiences' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#080d1a]">
            {skillExperiences.length === 0 ? (
              <div className="text-center py-16 text-gray-500 italic">
                No execution or recovery experiences recorded yet. Run agent tasks to capture traces.
              </div>
            ) : (
              skillExperiences.map((exp) => (
                <div
                  key={exp.id}
                  className="rounded-xl bg-[#0d1426] border border-[#1e2a44] p-3.5 space-y-2 hover:border-[#2f4068] transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        {exp.outcome === 'success' ? (
                          <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[9px] uppercase font-bold">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>Success</span>
                          </span>
                        ) : (
                          <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-300 font-mono text-[9px] uppercase font-bold">
                            <XCircle className="w-3 h-3 text-red-400" />
                            <span>Failure</span>
                          </span>
                        )}
                        {exp.toolName && (
                          <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 font-mono text-[9px]">
                            {exp.toolName}
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-gray-400">Run: {exp.runId.slice(0, 8)}</span>
                        <span className="text-[10px] text-gray-500">
                          {new Date(exp.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-white">{exp.objective}</p>
                    </div>

                    {exp.repairStrategy && (
                      <span className="px-2 py-1 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 font-mono text-[10px] shrink-0">
                        Repair: {exp.repairStrategy}
                      </span>
                    )}
                  </div>

                  {exp.failureReason && (
                    <div className="p-2.5 rounded bg-red-950/30 border border-red-500/30 text-red-200 text-[11px] font-mono">
                      <span className="text-red-400 font-bold block mb-0.5">Failure Reason:</span>
                      {exp.failureReason}
                    </div>
                  )}

                  {exp.lessonsLearned && (
                    <div className="p-2.5 rounded bg-[#0b1222] border border-[#1c2944] text-gray-300 text-[11px]">
                      <span className="text-cyan-400 font-bold block mb-0.5">Lesson Extracted:</span>
                      {exp.lessonsLearned}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: LEARNING TELEMETRY & ADAPTATION */}
        {activeTab === 'metrics' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#080d1a]">
            {/* Top KPI row */}
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-[#0e1628] border border-[#1e2a44]">
                <div className="text-[10px] text-gray-400 uppercase font-semibold">Total Experiences</div>
                <div className="text-2xl font-bold text-white mt-1">
                  {learningMetrics?.totalExperiences ?? skillExperiences.length}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#0e1628] border border-[#1e2a44]">
                <div className="text-[10px] text-emerald-400 uppercase font-semibold">Active Validated Skills</div>
                <div className="text-2xl font-bold text-emerald-300 mt-1">
                  {learningMetrics?.activeSkillsCount ?? skills.length}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#0e1628] border border-[#1e2a44]">
                <div className="text-[10px] text-amber-400 uppercase font-semibold">Pending Candidates</div>
                <div className="text-2xl font-bold text-amber-300 mt-1">
                  {learningMetrics?.candidateSkillsCount ?? candidateSkills.length}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#0e1628] border border-[#1e2a44]">
                <div className="text-[10px] text-blue-400 uppercase font-semibold">Adaptive Heuristics</div>
                <div className="text-2xl font-bold text-blue-300 mt-1">
                  {learningMetrics?.recoveryStrategies?.length ?? 4} Active
                </div>
              </div>
            </div>

            {/* Tool Reliability Table */}
            <div className="p-4 rounded-xl bg-[#0d1426] border border-[#1e2a44] space-y-3">
              <h3 className="font-bold text-white text-xs flex items-center space-x-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>Empirical Tool Reliability Telemetry</span>
              </h3>
              {(!learningMetrics?.toolReliability || learningMetrics.toolReliability.length === 0) ? (
                <div className="text-xs text-gray-500 py-4 italic">No tool reliability data recorded yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#1f2b45] text-gray-400 font-semibold text-[10px] uppercase">
                        <th className="pb-2">Tool Name</th>
                        <th className="pb-2">Invocations</th>
                        <th className="pb-2">Passes</th>
                        <th className="pb-2">Failures</th>
                        <th className="pb-2">Success Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#17223b]">
                      {learningMetrics.toolReliability.map((t) => (
                        <tr key={t.toolName} className="hover:bg-[#131d33] transition">
                          <td className="py-2 font-mono text-cyan-300">{t.toolName}</td>
                          <td className="py-2 text-gray-300">{t.invocations}</td>
                          <td className="py-2 text-emerald-400">{t.successes}</td>
                          <td className="py-2 text-red-400">{t.failures}</td>
                          <td className="py-2">
                            <div className="flex items-center space-x-2">
                              <div className="w-24 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    t.successRate >= 80 ? 'bg-emerald-400' : t.successRate >= 50 ? 'bg-amber-400' : 'bg-red-400'
                                  }`}
                                  style={{ width: `${t.successRate}%` }}
                                />
                              </div>
                              <span className="font-mono text-[10px] text-gray-300">{t.successRate}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recovery Strategy Effectiveness */}
            <div className="p-4 rounded-xl bg-[#0d1426] border border-[#1e2a44] space-y-3">
              <h3 className="font-bold text-white text-xs flex items-center space-x-2">
                <Award className="w-4 h-4 text-purple-400" />
                <span>Self-Healing Recovery Strategy Win Rates</span>
              </h3>
              {(!learningMetrics?.recoveryStrategies || learningMetrics.recoveryStrategies.length === 0) ? (
                <div className="text-xs text-gray-500 py-4 italic">No recovery events recorded yet.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {learningMetrics.recoveryStrategies.map((s) => (
                    <div key={s.strategy} className="p-3 rounded-lg bg-[#080d18] border border-[#1a253e] flex items-center justify-between">
                      <div>
                        <div className="font-bold text-white font-mono text-xs">{s.strategy}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {s.successfulCount} resolved / {s.suggestedCount} suggested
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold text-emerald-400">{s.successRate}%</div>
                        <div className="text-[9px] text-gray-500 uppercase">Conversion</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODAL: Version History & Rollback Dialog */}
        {versionHistorySkill && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div className="bg-[#0b101e] border border-[#232f48] rounded-xl w-full max-w-xl max-h-[75vh] flex flex-col shadow-2xl text-xs overflow-hidden">
              <div className="p-4 border-b border-[#1e293b] flex items-center justify-between bg-[#0e1526]">
                <div className="flex items-center space-x-2">
                  <History className="w-4 h-4 text-cyan-400" />
                  <span className="font-bold text-white text-sm">
                    Version History: {versionHistorySkill.name} (Active: v{versionHistorySkill.version})
                  </span>
                </div>
                <button onClick={() => setVersionHistorySkill(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#080d18]">
                {isLoadingVersions ? (
                  <div className="text-center py-8 text-gray-400">Loading version snapshots...</div>
                ) : versionsList.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 italic">
                    No prior version snapshots recorded yet. When a skill is updated or imported, snapshots are captured automatically.
                  </div>
                ) : (
                  versionsList.map((ver) => (
                    <div
                      key={ver.id}
                      className="p-3.5 rounded-lg bg-[#0e1628] border border-[#1e2a44] space-y-2 hover:border-[#2f4068] transition"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-cyan-300 text-xs">v{ver.version}</span>
                          <span className="text-[10px] text-gray-400">
                            Archived by {ver.promotedBy} on {new Date(ver.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRollback(ver.id)}
                          className="flex items-center space-x-1 px-2.5 py-1 rounded bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/40 font-medium transition"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Roll Back to This Version</span>
                        </button>
                      </div>

                      {ver.changeSummary && (
                        <p className="text-[11px] text-gray-300 italic">{ver.changeSummary}</p>
                      )}

                      <pre className="text-[10px] font-mono text-gray-300 bg-[#060a12] p-2 rounded max-h-28 overflow-y-auto whitespace-pre-wrap">
                        {ver.instructions}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODAL: Candidate Validation Gate Dialog */}
        {validatingCandidate && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div className="bg-[#0b101e] border border-amber-500/40 rounded-xl w-full max-w-xl flex flex-col shadow-2xl text-xs overflow-hidden">
              <div className="p-4 border-b border-[#1e293b] flex items-center justify-between bg-[#0e1526]">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-white text-sm">
                    Validation Gate: Promote Candidate Lesson to Active
                  </span>
                </div>
                <button onClick={() => setValidatingCandidate(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 bg-[#080d18]">
                <div>
                  <label className="block text-gray-400 text-[11px] mb-1 font-semibold">Candidate Name</label>
                  <div className="text-white font-mono bg-[#0e1628] p-2 rounded border border-[#1e2a44]">
                    {validatingCandidate.name} (Candidate v{validatingCandidate.version})
                  </div>
                </div>

                <div>
                  <label className="block text-gray-400 text-[11px] mb-1 font-semibold">Validator / Reviewer ID *</label>
                  <input
                    type="text"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    className="w-full bg-[#0e1628] border border-[#232f48] rounded px-3 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-gray-400 text-[11px] mb-1 font-semibold">Verification Rationale / Test Reference</label>
                  <textarea
                    rows={2}
                    value={validationRationale}
                    onChange={(e) => setValidationRationale(e.target.value)}
                    placeholder="e.g. Verified across 3 automated checkout runs with 100% pass rate."
                    className="w-full bg-[#0e1628] border border-[#232f48] rounded p-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="p-3 rounded bg-amber-950/20 border border-amber-500/30 text-amber-300 text-[11px]">
                  <strong>Action Notice:</strong> Promoting this candidate will increment its version to <strong>v1.0.0</strong> and immediately register it for runtime active prompt injection.
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setValidatingCandidate(null)}
                    className="px-3 py-1.5 rounded bg-[#1e293b] text-gray-300 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleValidateDecision('reject')}
                    className="px-3 py-1.5 rounded bg-red-950/50 hover:bg-red-900/70 border border-red-500/40 text-red-200"
                  >
                    Reject & Deprecate
                  </button>
                  <button
                    onClick={() => handleValidateDecision('promote')}
                    className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                  >
                    Authorize & Promote to v1.0.0
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
