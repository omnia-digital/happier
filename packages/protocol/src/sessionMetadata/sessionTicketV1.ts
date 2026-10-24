import { z } from 'zod';

export const TICKET_READER_CAPABILITY_ID = 'tool.ticketReader' as const;
export const SessionTicketProviderSchema = z.enum(['linear', 'clickup', 'jira']);
export type SessionTicketProvider = z.infer<typeof SessionTicketProviderSchema>;

export type ParsedSessionTicketUrl = Readonly<{
  provider: SessionTicketProvider;
  ticketKey: string;
  url: string;
  workspaceSlug?: string;
  workspaceId?: string;
  siteUrl?: string;
}>;

/** Accept only ticket routes. This is identification, never an instruction to fetch a pasted host. */
export function parseSessionTicketUrl(raw: string): ParsedSessionTicketUrl | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const path = url.pathname.replace(/\/+$/, '');
    const canonical = `${url.origin}${path}`;
    if (url.hostname === 'linear.app') {
      const match = path.match(/^\/(?:([a-zA-Z0-9_-]+)\/)?issue\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/[^/]+)?$/);
      return match ? { provider: 'linear', ticketKey: match[2], url: canonical, ...(match[1] ? { workspaceSlug: match[1] } : {}) } : null;
    }
    if (url.hostname === 'app.clickup.com') {
      const match = path.match(/^\/t\/(?:(\d+)\/)?([a-zA-Z0-9_-]+)$/);
      return match ? { provider: 'clickup', ticketKey: match[2], url: canonical, ...(match[1] ? { workspaceId: match[1] } : {}) } : null;
    }
    if (/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(url.hostname)) {
      const match = path.match(/^\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)$/);
      return match ? { provider: 'jira', ticketKey: match[1], url: canonical, siteUrl: url.origin } : null;
    }
  } catch { /* An invalid pasted link is an expected user input. */ }
  return null;
}

export const SessionTicketIdentityV1Schema = z.object({
  v: z.literal(1),
  provider: SessionTicketProviderSchema,
  workspaceId: z.string().min(1),
  ticketId: z.string().min(1),
  key: z.string().min(1),
  title: z.string().min(1),
  url: z.string().refine((url) => parseSessionTicketUrl(url) !== null, 'Unsupported ticket URL'),
}).strict().superRefine((ticket, ctx) => {
  const link = parseSessionTicketUrl(ticket.url);
  if (link?.provider !== ticket.provider
    || (ticket.provider === 'linear' && (!link.workspaceSlug || link.workspaceSlug !== ticket.workspaceId || link.ticketKey !== ticket.key))
    || (ticket.provider === 'clickup' && (link.ticketKey !== ticket.ticketId || (link.workspaceId && link.workspaceId !== ticket.workspaceId)))
    || (ticket.provider === 'jira' && link.ticketKey !== ticket.key)) {
    ctx.addIssue({ code: 'custom', message: 'Ticket URL must identify the provider and workspace', path: ['url'] });
  }
});
export type SessionTicketIdentityV1 = z.infer<typeof SessionTicketIdentityV1Schema>;

export const SessionTicketReaderV1Schema = z.object({
  machineId: z.string().min(1),
  mcpServerId: z.string().min(1),
  directory: z.string().min(1),
}).strict();
export const SessionTicketAssociationV1Schema = z.object({
  v: z.literal(1),
  ticket: SessionTicketIdentityV1Schema,
  reader: SessionTicketReaderV1Schema,
}).strict();
export type SessionTicketAssociationV1 = z.infer<typeof SessionTicketAssociationV1Schema>;

export const SessionTicketSnapshotV1Schema = z.object({
  ticket: SessionTicketIdentityV1Schema,
  status: z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    /** Retained only when supplied by the provider; never derived from names or runtime status. */
    order: z.number().finite().optional(),
    workflowId: z.string().min(1).optional(),
  }).strict(),
  fetchedAt: z.number().int().nonnegative(),
}).strict();
export type SessionTicketSnapshotV1 = z.infer<typeof SessionTicketSnapshotV1Schema>;

export const TicketReaderSourcesRequestSchema = z.object({ directory: z.string().min(1) }).strict();
export const TicketReaderReadRequestSchema = TicketReaderSourcesRequestSchema.extend({
  mcpServerId: z.string().min(1),
  url: z.string().refine((url) => parseSessionTicketUrl(url) !== null),
}).strict();
export const TicketReaderSourcesResponseSchema = z.object({
  sources: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) }).strict()),
}).strict();
export const TicketReaderErrorCodeSchema = z.enum([
  'disabled', 'unconfigured', 'unsupported', 'invalid_request', 'access_revoked',
  'ticket_missing', 'identity_mismatch', 'offline', 'provider_error', 'cancelled',
]);
export type TicketReaderErrorCode = z.infer<typeof TicketReaderErrorCodeSchema>;

export function readSessionTicketAssociation(metadata: unknown): SessionTicketAssociationV1 | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const parsed = SessionTicketAssociationV1Schema.safeParse((metadata as Record<string, unknown>).sessionTicketV1);
  return parsed.success ? parsed.data : null;
}

export function withSessionTicketAssociation<T extends Record<string, unknown>>(
  metadata: T,
  association: SessionTicketAssociationV1 | null,
): T {
  if (association) return { ...metadata, sessionTicketV1: SessionTicketAssociationV1Schema.parse(association) };
  const { sessionTicketV1: _removed, ...rest } = metadata;
  return rest as T;
}
