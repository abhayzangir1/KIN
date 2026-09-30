import React from 'react';
import { GitPullRequest, ArrowRight, ShieldCheck } from 'lucide-react';

export interface DecisionCardProps {
  title: string;
  topic: string;
  optionA: { label: string; pros: string; cons: string };
  optionB: { label: string; pros: string; cons: string };
  onSelect: (option: 'A' | 'B' | 'compromise') => void;
}

export const DecisionCard: React.FC<DecisionCardProps> = ({ title, topic, optionA, optionB, onSelect }) => {
  return (
    <div className="my-4 p-4 rounded-xl bg-kin-card border border-amber-500/30 shadow-lg space-y-3">
      <div className="flex items-center space-x-2 text-amber-400">
        <GitPullRequest className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">Tie-Breaker Escalation Card</span>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-kin-text">{title}</h3>
        <p className="text-xs text-kin-muted mt-0.5">{topic}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        {/* Option A */}
        <div className="p-3 rounded-lg bg-kin-bg border border-kin-border space-y-1.5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-blue-400">{optionA.label}</div>
            <div className="text-[11px] text-emerald-400">✓ {optionA.pros}</div>
            <div className="text-[11px] text-red-400">✗ {optionA.cons}</div>
          </div>
          <button
            onClick={() => onSelect('A')}
            className="w-full mt-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition"
          >
            Choose Option A
          </button>
        </div>

        {/* Option B */}
        <div className="p-3 rounded-lg bg-kin-bg border border-kin-border space-y-1.5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-purple-400">{optionB.label}</div>
            <div className="text-[11px] text-emerald-400">✓ {optionB.pros}</div>
            <div className="text-[11px] text-red-400">✗ {optionB.cons}</div>
          </div>
          <button
            onClick={() => onSelect('B')}
            className="w-full mt-2 py-1 text-xs rounded bg-purple-600 hover:bg-purple-500 text-white font-medium transition"
          >
            Choose Option B
          </button>
        </div>
      </div>

      {/* Recommended Compromise */}
      <div className="pt-1 flex items-center justify-between border-t border-kin-border/50 text-xs">
        <div className="flex items-center space-x-1.5 text-kin-muted text-[11px]">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
          <span>Orchestrator Recommendation: Normalized payload with client selector</span>
        </div>
        <button
          onClick={() => onSelect('compromise')}
          className="text-blue-400 hover:text-blue-300 font-medium flex items-center space-x-1"
        >
          <span>Apply Compromise</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
