import { z } from 'zod';
import { SessionPullRequestLinkV1Schema } from './sessionPullRequestsV1.js';

export const SessionAutoArchiveHistoryEventV1Schema = z.object({
  trigger: z.literal('all_linked_pull_requests_merged'),
  archivedAt: z.number().int().positive(),
  links: z.array(SessionPullRequestLinkV1Schema).min(1),
}).strict();
export type SessionAutoArchiveHistoryEventV1 = z.infer<typeof SessionAutoArchiveHistoryEventV1Schema>;

export const SessionAutoArchiveHistoryV1Schema = z.object({
  v: z.literal(1),
  events: z.array(SessionAutoArchiveHistoryEventV1Schema),
}).strict();
export type SessionAutoArchiveHistoryV1 = z.infer<typeof SessionAutoArchiveHistoryV1Schema>;

export function readSessionAutoArchiveHistory(metadata: unknown): readonly SessionAutoArchiveHistoryEventV1[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const parsed = SessionAutoArchiveHistoryV1Schema.safeParse((metadata as Record<string, unknown>).sessionAutoArchiveHistoryV1);
  return parsed.success ? parsed.data.events : [];
}

export function appendSessionAutoArchiveHistory<T extends Record<string, unknown>>(
  metadata: T,
  rawEvent: SessionAutoArchiveHistoryEventV1,
): T {
  const event = SessionAutoArchiveHistoryEventV1Schema.parse(rawEvent);
  const existing = Object.prototype.hasOwnProperty.call(metadata, 'sessionAutoArchiveHistoryV1')
    ? SessionAutoArchiveHistoryV1Schema.parse(metadata.sessionAutoArchiveHistoryV1).events
    : [];
  if (existing.some((entry) => entry.archivedAt === event.archivedAt)) return metadata;
  return { ...metadata, sessionAutoArchiveHistoryV1: { v: 1, events: [...existing, event] } };
}
