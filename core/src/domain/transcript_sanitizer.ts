// ============================================================================
// KIN DOMAIN: CHAT TRANSCRIPT SANITIZER & PURE PROSE FILTER
// Enforces PRD § 7 contract: timeline displays clean human/agent prose.
// Suppresses thinking tags, reasoning buffers, and raw tool syntax.
// ============================================================================

/**
 * Strips internal chain-of-thought (<think>, <thought>, <reasoning>),
 * raw tool syntax (<tool_call>, <tool_result>, <tool_output>),
 * and incomplete trailing reasoning buffers.
 */
export function stripThoughtsAndToolSyntax(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw;
  // Strip closed reasoning blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  // Strip raw tool execution call markup
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  text = text.replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '');
  text = text.replace(/<tool_output>[\s\S]*?<\/tool_output>/gi, '');
  // Strip unclosed <think> or <reasoning> tags
  text = text.replace(/<(?:think|thought|reasoning)>[\s\S]*$/gi, '');
  // Strip leading "Thinking Process: ... \n\n"
  text = text.replace(/^Thinking Process:[\s\S]*?\n\n/i, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Detects whether a message turn represents an autonomous background execution
 * (e.g. scheduled alarm, proactive routine, cron trigger).
 */
export function isBackgroundTurnMessage(msg: {
  content: string;
  is_background?: boolean | number | string;
  isBackground?: boolean | number | string;
  metadata?: any;
}): boolean {
  if (Boolean(msg.is_background) || Boolean(msg.isBackground)) return true;
  if (msg.metadata) {
    if (typeof msg.metadata === 'object') {
      if (Boolean(msg.metadata.is_background) || Boolean(msg.metadata.isBackground)) return true;
    } else if (typeof msg.metadata === 'string') {
      try {
        const parsed = JSON.parse(msg.metadata);
        if (Boolean(parsed.is_background) || Boolean(parsed.isBackground)) return true;
      } catch {}
    }
  }
  return (
    msg.content.includes('[Automated Turn]') ||
    msg.content.includes('[Scheduled Wakeup]') ||
    msg.content.includes('[Background Task]') ||
    msg.content.includes('⏰ Wakeup Timer Fired') ||
    msg.content.includes('Timer / Scheduled Alarm') ||
    msg.content.includes('⏰ **Timer') ||
    msg.content.includes('🔄 Proactive Routine') ||
    msg.content.includes('🤖 [Automated Wakeup]')
  );
}
