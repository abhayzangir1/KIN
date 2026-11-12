import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { X, Hash } from 'lucide-react';

export const CreateChannelModal: React.FC = () => {
  const { isCreateChannelModalOpen, setCreateChannelModalOpen, createChannel, activeProject } = useKinStore();
  const [channelName, setChannelName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isCreateChannelModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelName.trim()) {
      setError('Channel name is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const res = await createChannel(channelName.trim(), channelTopic.trim() || undefined);
      if (res && !res.success) {
        setError(res.error || 'Failed to create channel');
        return;
      }
      setChannelName('');
      setChannelTopic('');
      setCreateChannelModalOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to create channel');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-kin-surface border border-kin-border rounded-xl w-full max-w-md shadow-2xl p-5 space-y-4 backdrop-blur-xl text-kin-text">
        <div className="flex items-center justify-between pb-3 border-b border-kin-border">
          <div className="flex items-center space-x-2">
            <Hash className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-kin-text">Create Channel</h2>
          </div>
          <button
            onClick={() => setCreateChannelModalOpen(false)}
            className="text-kin-muted hover:text-kin-text transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {error && (
            <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-kin-muted font-medium">Channel Name</label>
            <div className="flex items-center bg-kin-card border border-kin-border rounded-lg px-3 py-1.5 focus-within:border-emerald-500">
              <span className="text-kin-muted mr-1">#</span>
              <input
                type="text"
                autoFocus
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="e.g. backend-api, marketing, research"
                className="w-full bg-transparent text-kin-text focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-kin-muted font-medium">Topic (Optional)</label>
            <input
              type="text"
              value={channelTopic}
              onChange={(e) => setChannelTopic(e.target.value)}
              placeholder="What is this channel about?"
              className="w-full bg-kin-card border border-kin-border rounded-lg px-3 py-1.5 text-kin-text focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="p-3 rounded-lg bg-kin-card/80 border border-kin-border text-[11px] text-kin-muted space-y-1">
            <div className="text-emerald-400 font-semibold">Channel Invariant:</div>
            <div>
              By default, this new channel in project <span className="text-kin-text font-bold">{activeProject?.name || 'KIN'}</span> will contain the default orchestrator (<span className="text-amber-300">@Boss</span>). You or @Boss can add specialists later.
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-kin-border">
            <button
              type="button"
              onClick={() => setCreateChannelModalOpen(false)}
              className="px-3.5 py-1.5 rounded-lg bg-kin-card text-kin-muted hover:text-kin-text hover:bg-kin-cardHover border border-kin-border transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !channelName.trim()}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold transition cursor-pointer shadow-sm"
            >
              {isSubmitting ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
