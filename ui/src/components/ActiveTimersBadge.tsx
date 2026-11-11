import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { Clock, X } from 'lucide-react';

interface ActiveTimersPillProps {
  channelId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const ActiveTimersPill: React.FC<ActiveTimersPillProps> = ({
  channelId,
  isExpanded,
  onToggleExpand,
}) => {
  const schedules = useKinStore((s) => s.schedules);
  const [now, setNow] = useState(Date.now());

  const activeSchedules = (schedules || []).filter(
    (s) => s.status === 'active' && (s.channelId === channelId || !s.channelId) && s.nextRunAt > now
  );

  useEffect(() => {
    if (activeSchedules.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeSchedules.length]);

  if (activeSchedules.length === 0) return null;

  const nextTimerSec = Math.max(0, Math.ceil((Math.min(...activeSchedules.map((s) => s.nextRunAt)) - now) / 1000));

  return (
    <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-[11px] font-mono">
      <Clock className="w-3 h-3 text-emerald-500 shrink-0" />
      <span>{activeSchedules.length} Timer{activeSchedules.length > 1 ? 's' : ''} ({nextTimerSec}s)</span>
      <button
        type="button"
        onClick={onToggleExpand}
        className="ml-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
      >
        {isExpanded ? 'Hide' : 'View'}
      </button>
    </div>
  );
};

interface ActiveTimersDrawerProps {
  channelId: string;
  onCancelSchedule: (id: string) => void;
}

export const ActiveTimersDrawer: React.FC<ActiveTimersDrawerProps> = ({
  channelId,
  onCancelSchedule,
}) => {
  const schedules = useKinStore((s) => s.schedules);
  const [now, setNow] = useState(Date.now());

  const activeSchedules = (schedules || []).filter(
    (s) => s.status === 'active' && (s.channelId === channelId || !s.channelId) && s.nextRunAt > now
  );

  useEffect(() => {
    if (activeSchedules.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeSchedules.length]);

  if (activeSchedules.length === 0) return null;

  return (
    <div className="space-y-1 max-h-32 overflow-y-auto pr-1 pt-1 border-t border-kin-border">
      {activeSchedules.map((s) => {
        const remainingSec = Math.max(0, Math.ceil((s.nextRunAt - now) / 1000));
        return (
          <div
            key={s.id}
            className="flex items-center justify-between p-1.5 bg-kin-surface border border-kin-border rounded-lg text-xs"
          >
            <div className="flex items-center space-x-2 min-w-0 pr-2">
              <span className="flex items-center space-x-1 text-emerald-500 font-mono font-bold shrink-0 text-[10px] bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                <Clock className="w-2.5 h-2.5" />
                <span>{remainingSec}s</span>
              </span>
              <span className="text-kin-text text-[11px] truncate font-sans">{s.prompt}</span>
              <span className="text-kin-muted text-[9px] font-mono shrink-0 uppercase">[{s.type}]</span>
            </div>
            <button
              type="button"
              onClick={() => onCancelSchedule(s.id)}
              className="p-1 hover:text-red-500 text-kin-muted transition shrink-0 cursor-pointer"
              title="Cancel timer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

interface ActiveTimersNewButtonProps {
  channelId: string;
  onClick: () => void;
}

export const ActiveTimersNewButton: React.FC<ActiveTimersNewButtonProps> = ({
  channelId,
  onClick,
}) => {
  const schedules = useKinStore((s) => s.schedules);
  const hasActive = (schedules || []).some(
    (s) => s.status === 'active' && (s.channelId === channelId || !s.channelId) && s.nextRunAt > Date.now()
  );

  if (!hasActive) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] text-kin-muted hover:text-kin-text font-mono hover:underline cursor-pointer"
    >
      + New Timer
    </button>
  );
};
