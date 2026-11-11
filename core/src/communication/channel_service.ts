// ============================================================================
// KIN COMMUNICATION ENGINE — CHANNEL SERVICE
// Message persistence, mention extraction, and productivity scoring.
// ============================================================================

import { KinDatabase, safeJsonParseArray } from '../storage/db.js';
import { Message, SenderType } from '../domain/types.js';
import { EventLedger } from '../security/event_ledger.js';
import { SecretBroker } from '../security/secret_broker.js';
import { v4 as uuidv4 } from 'uuid';

export interface SendMessageParams {
  channelId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  parentMessageId?: string;
  productivityScore?: number;
  isBackground?: boolean;
  is_background?: boolean;
}

export class ChannelService {
  private db: KinDatabase;
  private threadLeases: Map<string, { agentId: string; expiresAt: number }> = new Map();

  constructor(db: KinDatabase) {
    this.db = db;
  }

  public postMessage(params: SendMessageParams): Message {
    return this.sendMessage(params);
  }

  public getChannel(channelId: string): { id: string; name: string; type: string; is_private: boolean } | undefined {
    if (channelId.startsWith('dm-')) {
      return { id: channelId, name: channelId, type: 'dm', is_private: true };
    }
    const row = this.db.queryOne<{ id: string; name: string; channel_type: string; is_private: number }>(
      'SELECT id, name, channel_type, is_private FROM channels WHERE id = ?',
      channelId
    );
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      type: row.channel_type === 'direct_message' ? 'dm' : row.channel_type,
      is_private: Boolean(row.is_private),
    };
  }

  public listMembers(channelId: string): Array<{ id: string; displayName: string }> {
    const rows = this.db.query<{ id: string; display_name: string }>(
      `SELECT i.id, i.display_name
       FROM channel_members cm
       JOIN agent_identities i ON cm.agent_id = i.id
       WHERE cm.channel_id = ?`,
      channelId
    );
    return rows.map((r) => ({ id: r.id, displayName: r.display_name }));
  }

  public sendMessage(params: SendMessageParams): Message {
    if (!params.content || typeof params.content !== 'string' || params.content.length > 100000) {
      throw new Error(`Message content must be a non-empty string and cannot exceed 100,000 characters.`);
    }

    // Verify membership for private channels and direct messages (including ad-hoc dm- channels)
    const chan = this.db.queryOne<{ is_private: number; channel_type: string }>(
      'SELECT is_private, channel_type FROM channels WHERE id = ?',
      params.channelId
    );
    const isPrivateOrDm =
      (chan && (chan.is_private === 1 || chan.channel_type === 'dm' || chan.channel_type === 'direct_message')) ||
      params.channelId.startsWith('dm-');
    if (isPrivateOrDm) {
      if (params.senderType === 'agent') {
        const isMember = this.db.queryOne<{ agent_id: string }>(
          'SELECT agent_id FROM channel_members WHERE channel_id = ? AND agent_id = ?',
          params.channelId,
          params.senderId
        );
        if (!isMember) {
          throw new Error(`Agent '${params.senderId}' is not an authorized member of private channel '${params.channelId}'`);
        }
      }
    }

    const id = uuidv4();
    const cleanContent = SecretBroker.getInstance(this.db).redactSecrets(params.content);
    const mentions = this.extractMentions(cleanContent);
    const score = params.productivityScore ?? this.calculateInitialProductivity(cleanContent);
    const isBackground = Boolean(params.isBackground || params.is_background);
    const now = Date.now();

    const message: Message = {
      id,
      channelId: params.channelId,
      senderId: params.senderId,
      senderType: params.senderType,
      content: cleanContent,
      parentMessageId: params.parentMessageId,
      mentions,
      productivityScore: score,
      isBackground,
      is_background: isBackground,
      createdAt: now,
    };

    this.db.execute(
      `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, parent_message_id, mentions_json, productivity_score, is_background, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.channelId,
      message.senderId,
      message.senderType,
      message.content,
      message.parentMessageId ?? null,
      JSON.stringify(message.mentions),
      message.productivityScore,
      isBackground ? 1 : 0,
      message.createdAt
    );

    // Record event in append-only journal through authoritative EventLedger
    try {
      const ledger = EventLedger.ensureInitialized(this.db);
      ledger.record({
        eventType: 'message.created',
        entityType: 'message',
        entityId: message.id,
        payload: {
          channelId: message.channelId,
          senderId: message.senderId,
          mentions,
          isBackground,
          is_background: isBackground,
        },
      });
    } catch (err) {
      console.warn('[CHANNEL SERVICE] EventLedger recording failure:', err);
    }

    return message;
  }

  public getMessages(channelId: string, limit: number = 50): Message[] {
    const rows = this.db.query<{
      id: string;
      channel_id: string;
      sender_id: string;
      sender_type: string;
      content: string;
      parent_message_id: string | null;
      mentions_json: string;
      productivity_score: number;
      is_background?: number;
      created_at: number;
    }>(
      `SELECT * FROM (
        SELECT rowid, * FROM messages WHERE channel_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
      ) sub ORDER BY created_at ASC, rowid ASC`,
      channelId,
      limit
    );

    return rows.map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      senderId: r.sender_id,
      senderType: r.sender_type as SenderType,
      content: r.content,
      parentMessageId: r.parent_message_id ?? undefined,
      mentions: safeJsonParseArray<string>(r.mentions_json, []),
      productivityScore: r.productivity_score,
      isBackground: Boolean(r.is_background),
      is_background: Boolean(r.is_background),
      createdAt: r.created_at,
    }));
  }

  public getThreadReplies(arg1: string, arg2?: string): Message[] {
    const parentMessageId = arg2 !== undefined ? arg2 : arg1;
    const channelId = arg2 !== undefined ? arg1 : undefined;

    const rows = channelId
      ? this.db.query<{
          id: string;
          channel_id: string;
          sender_id: string;
          sender_type: string;
          content: string;
          parent_message_id: string | null;
          mentions_json: string;
          productivity_score: number;
          is_background?: number;
          created_at: number;
        }>(
          'SELECT * FROM messages WHERE channel_id = ? AND parent_message_id = ? ORDER BY created_at ASC, rowid ASC',
          channelId,
          parentMessageId
        )
      : this.db.query<{
          id: string;
          channel_id: string;
          sender_id: string;
          sender_type: string;
          content: string;
          parent_message_id: string | null;
          mentions_json: string;
          productivity_score: number;
          is_background?: number;
          created_at: number;
        }>(
          'SELECT * FROM messages WHERE parent_message_id = ? ORDER BY created_at ASC, rowid ASC',
          parentMessageId
        );

    return rows.map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      senderId: r.sender_id,
      senderType: r.sender_type as SenderType,
      content: r.content,
      parentMessageId: r.parent_message_id ?? undefined,
      mentions: safeJsonParseArray<string>(r.mentions_json, []),
      productivityScore: r.productivity_score,
      isBackground: Boolean(r.is_background),
      is_background: Boolean(r.is_background),
      createdAt: r.created_at,
    }));
  }

  public acquireThreadLease(
    arg1: string,
    arg2: string,
    arg3?: string | number,
    arg4?: number
  ): boolean {
    const now = Date.now();
    let threadKey: string;
    let agentId: string;
    let ttlMs: number = 30000;

    if (typeof arg3 === 'string') {
      threadKey = `${arg1}:${arg2}`;
      agentId = arg3;
      if (typeof arg4 === 'number') ttlMs = arg4;
    } else {
      threadKey = arg1;
      agentId = arg2;
      if (typeof arg3 === 'number') ttlMs = arg3;
    }

    const existing = this.threadLeases.get(threadKey);
    if (!existing || existing.expiresAt <= now || existing.agentId === agentId) {
      this.threadLeases.set(threadKey, {
        agentId,
        expiresAt: now + ttlMs,
      });
      return true;
    }
    return false;
  }

  public releaseThreadLease(
    arg1: string,
    arg2: string,
    arg3?: string
  ): void {
    let threadKey: string;
    let agentId: string;

    if (arg3 !== undefined) {
      threadKey = `${arg1}:${arg2}`;
      agentId = arg3;
    } else {
      threadKey = arg1;
      agentId = arg2;
    }

    const existing = this.threadLeases.get(threadKey);
    if (existing && existing.agentId === agentId) {
      this.threadLeases.delete(threadKey);
    }
  }

  public getMessage(messageId: string): Message | undefined {
    const r = this.db.queryOne<{
      id: string;
      channel_id: string;
      sender_id: string;
      sender_type: string;
      content: string;
      parent_message_id: string | null;
      mentions_json: string;
      productivity_score: number;
      is_background?: number;
      created_at: number;
    }>('SELECT * FROM messages WHERE id = ?', messageId);

    if (!r) return undefined;

    return {
      id: r.id,
      channelId: r.channel_id,
      senderId: r.sender_id,
      senderType: r.sender_type as SenderType,
      content: r.content,
      parentMessageId: r.parent_message_id ?? undefined,
      mentions: safeJsonParseArray<string>(r.mentions_json, []),
      productivityScore: r.productivity_score,
      isBackground: Boolean(r.is_background),
      is_background: Boolean(r.is_background),
      createdAt: r.created_at,
    };
  }

  public extractMentions(content: string): string[] {
    if (!content || typeof content !== 'string') return [];
    // Strip multi-line code blocks
    let clean = content.replace(/```[\s\S]*?```/g, '');
    // Strip inline code
    clean = clean.replace(/`[^`]*`/g, '');
    // Strip blockquotes
    clean = clean.replace(/^\s*>.*$/gm, '');

    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const matches = clean.match(mentionRegex);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(1)))];
  }

  private calculateInitialProductivity(content: string): number {
    // If message contains command outputs, tool calls, or diff indicators, it has a positive score
    let score = 0;
    if (content.includes('[Tool Output]') || content.includes('[Command:')) score += 30;
    if (content.includes('```diff') || content.includes('diff --git')) score += 40;
    if (content.includes('Tests passed') || content.includes('exit code 0')) score += 30;
    return score;
  }
}
