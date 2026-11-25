import React from 'react';
import {
  Sparkles,
  Zap,
  Brain,
  Activity,
  Layers,
  Terminal,
  Server,
  Cpu,
} from 'lucide-react';

export const ProviderIcon: React.FC<{ provider: string; className?: string }> = ({ provider, className = 'w-4 h-4' }) => {
  const norm = (provider || '').toLowerCase();
  if (norm.includes('openrouter')) {
    return <Layers className={`${className} text-indigo-400`} />;
  }
  if (norm.includes('openai')) {
    return <Sparkles className={`${className} text-emerald-400`} />;
  }
  if (norm.includes('anthropic') || norm.includes('claude')) {
    return <Brain className={`${className} text-amber-400`} />;
  }
  if (norm.includes('gemini') || norm.includes('google')) {
    return <Zap className={`${className} text-blue-400`} />;
  }
  if (norm.includes('deepseek')) {
    return <Activity className={`${className} text-cyan-400`} />;
  }
  if (norm.includes('groq')) {
    return <Zap className={`${className} text-orange-400`} />;
  }
  if (norm.includes('xai') || norm.includes('grok')) {
    return (
      <span className={`${className} font-bold font-mono text-purple-400 inline-flex items-center justify-center text-xs select-none`}>
        𝕏
      </span>
    );
  }
  if (norm.includes('azure')) {
    return <Server className={`${className} text-sky-400`} />;
  }
  if (norm.includes('nvidia')) {
    return <Cpu className={`${className} text-lime-400`} />;
  }
  if (norm.includes('copilot')) {
    return <Cpu className={`${className} text-cyan-400`} />;
  }
  if (norm.includes('ollama')) {
    return <Terminal className={`${className} text-emerald-300`} />;
  }
  return <Server className={`${className} text-slate-400`} />;
};

export function formatContextWindow(tokens?: number): string {
  if (!tokens || tokens <= 0) return '128K';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(tokens % 1000000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}
