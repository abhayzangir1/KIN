// ============================================================================
// KIN COMMUNICATION ENGINE — CHANNEL SERVICE
// Message persistence, mention extraction, and productivity scoring.
// ============================================================================

import { KinDatabase } from '../storage/db.js';
import { Message, SenderType } from '../domain/types.js';
import { v4 as uuidv4 } from 'uuid';

export interface SendMessageParams {
  channelId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  parentMessageId?: string;
  productivityScore?: number;
}

export class ChannelService {
  private db: KinDatabase;

  constructor(db: KinDatabase) {
    this.db = db;
  }

  public sendMessage(params: SendMessageParams): Message {
    const id = uuidv4();
    const mentions = this.extractMentions(params.content);
    const score = params.productivityScore ?? this.calculateInitialProductivity(params.content);
    const now = Date.now();

    const message: Message = {
      id,
      channelId: params.channelId,
      senderId: params.senderId,
      senderType: params.senderType,
      content: params.content,
      parentMessageId: params.parentMessageId,
      mentions,
      productivityScore: score,
      createdAt: now,
    };

    this.db.execute(
      `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, parent_message_id, mentions_json, productivity_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.channelId,
      message.senderId,
      message.senderType,
      message.content,
      message.parentMessageId ?? null,
      JSON.stringify(message.mentions),
      message.productivityScore,
      message.createdAt
    );

    // Record event in append-only journal
    this.db.execute(
      `INSERT INTO event_journal (event_type, entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      'message.created',
      'message',
      message.id,
      JSON.stringify({ channelId: message.channelId, senderId: message.senderId, mentions }),
      now
    );

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
      created_at: number;
    }>(
      `SELECT * FROM (
        SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?
      ) sub ORDER BY created_at ASC`,
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
      mentions: JSON.parse(r.mentions_json),
      productivityScore: r.productivity_score,
      createdAt: r.created_at,
    }));
  }

  public extractMentions(content: string): string[] {
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const matches = content.match(mentionRegex);
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
