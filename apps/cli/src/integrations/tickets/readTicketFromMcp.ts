import { parseSessionTicketUrl, SessionTicketSnapshotV1Schema, type SessionTicketSnapshotV1, type TicketReaderErrorCode } from '@happier-dev/protocol';
import type { ResolvedCustomHappierTool } from '@/agent/tools/happierTools/customMcp/listResolvedCustomHappierTools';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** Only normalized codes cross the ticket boundary, never token-bearing MCP error messages. */
export function ticketReaderErrorCode(error: unknown): TicketReaderErrorCode {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/^(disabled|unconfigured|unsupported|invalid_request|access_revoked|ticket_missing|identity_mismatch|offline|provider_error|cancelled)$/.test(message)) return message as TicketReaderErrorCode;
  if (/abort|cancel/i.test(message)) return 'cancelled';
  if (/401|403|unauthori[sz]ed|forbidden|revoked|invalid.?grant|OAUTH_0(?:19|21|25|77)/i.test(message)) return 'access_revoked';
  if (/404|not.found|does not exist|deleted/i.test(message)) return 'ticket_missing';
  if (/network|ECONN|ENOTFOUND|offline|fetch failed|connection|timed? ?out/i.test(message)) return 'offline';
  return 'provider_error';
}

function unwrapResult(raw: unknown): unknown {
  const envelope = record(raw);
  if (envelope.isError === true) {
    const text = Array.isArray(envelope.content) ? envelope.content.map((entry) => string(record(entry).text)).join(' ') : '';
    throw new Error(ticketReaderErrorCode(text));
  }
  if (envelope.structuredContent !== undefined) return envelope.structuredContent;
  if (Array.isArray(envelope.content)) {
    for (const entry of envelope.content) {
      if (record(entry).type !== 'text') continue;
      try { return JSON.parse(string(record(entry).text)); } catch { /* Try the next structured text block. */ }
    }
    throw new Error('provider_error');
  }
  throw new Error('provider_error');
}

function accepts(schema: unknown, value: unknown): boolean {
  const shape = record(schema);
  if (Array.isArray(shape.anyOf)) return shape.anyOf.some((child) => accepts(child, value));
  if (Array.isArray(shape.enum) && !shape.enum.includes(value)) return false;
  if (Array.isArray(shape.type)) return shape.type.some((type) => accepts({ ...shape, type }, value));
  if (shape.type === 'string') return typeof value === 'string';
  if (shape.type === 'boolean') return typeof value === 'boolean';
  if (shape.type === 'array') return Array.isArray(value) && value.every((item) => accepts(shape.items, item));
  return false;
}

function verifyReadTool(tools: readonly ResolvedCustomHappierTool[], name: string, args: Record<string, unknown>): void {
  const tool = tools.find((candidate) => candidate.name === name);
  const schema = record(tool?.inputSchema);
  const properties = record(schema.properties);
  if (!tool || tool.annotations?.readOnlyHint === false || schema.type !== 'object'
    || (Array.isArray(schema.required) && schema.required.some((key) => typeof key !== 'string' || !(key in args)))
    || Object.entries(args).some(([key, value]) => !accepts(properties[key], value))) {
    throw new Error('unsupported');
  }
}

function workflowStatus(value: unknown): SessionTicketSnapshotV1['status'] {
  const status = record(value);
  const name = string(value) || string(status.name) || string(status.status);
  if (!name) throw new Error('provider_error');
  return {
    name,
    ...(string(status.id) ? { id: string(status.id) } : {}),
    ...(typeof status.orderindex === 'number' && Number.isFinite(status.orderindex) ? { order: status.orderindex } : {}),
    ...(typeof status.position === 'number' && Number.isFinite(status.position) ? { order: status.position } : {}),
    ...(string(status.workflowId) ? { workflowId: string(status.workflowId) } : {}),
  };
}

/**
 * Fixed read operations only. Contracts: linear.app/docs/mcp (get_issue, runtime schema),
 * developer.clickup.com/docs/mcp-tools (clickup_get_task, runtime schema), and
 * support.atlassian.com/atlassian-ai-gateway/docs/supported-tools/ (Cloud MCP).
 * The selected configured MCP server owns authentication. No pasted host is fetched here.
 */
export async function readTicketFromMcp(params: Readonly<{
  url: string;
  tools: readonly ResolvedCustomHappierTool[];
  call: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  now: () => number;
}>): Promise<SessionTicketSnapshotV1> {
  const requested = parseSessionTicketUrl(params.url);
  if (!requested) throw new Error('invalid_request');
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    verifyReadTool(params.tools, name, args);
    try { return unwrapResult(await params.call(name, args)); }
    catch (error) { throw new Error(ticketReaderErrorCode(error)); }
  };
  let ticket: SessionTicketSnapshotV1['ticket'];
  let status: SessionTicketSnapshotV1['status'];
  if (requested.provider === 'linear') {
    const response = record(await call('get_issue', { id: requested.ticketKey }));
    const issue = record(response.issue ?? response);
    const url = parseSessionTicketUrl(string(issue.url));
    const key = string(issue.identifier) || string(issue.id);
    if (!url || url.provider !== 'linear' || !url.workspaceSlug || url.ticketKey !== requested.ticketKey
      || key !== requested.ticketKey || (requested.workspaceSlug && requested.workspaceSlug !== url.workspaceSlug)) throw new Error('identity_mismatch');
    ticket = { v: 1, provider: 'linear', workspaceId: url.workspaceSlug, ticketId: string(issue.uuid) || string(issue.id), key, title: string(issue.title), url: url.url };
    status = workflowStatus(issue.status ?? issue.state);
  } else if (requested.provider === 'clickup') {
    const response = record(await call('clickup_get_task', { task_id: requested.ticketKey, ...(requested.workspaceId ? { workspace_id: requested.workspaceId } : {}) }));
    const task = record(response.task ?? response);
    const url = parseSessionTicketUrl(string(task.url));
    const id = string(task.id);
    const key = string(task.custom_id) || id;
    const workspaceId = string(task.workspace_id) || string(task.team_id) || url?.workspaceId || '';
    if (!url || url.provider !== 'clickup' || !workspaceId || url.ticketKey !== id
      || (requested.ticketKey !== id && requested.ticketKey !== key)
      || (requested.workspaceId && requested.workspaceId !== workspaceId)) throw new Error('identity_mismatch');
    ticket = { v: 1, provider: 'clickup', workspaceId, ticketId: id, key, title: string(task.name), url: url.url };
    status = workflowStatus(task.status);
  } else {
    const resources = await call('getAccessibleAtlassianResources', {});
    const sites = Array.isArray(resources) ? resources : record(resources).resources;
    const site = Array.isArray(sites) ? sites.map(record).find((entry) => string(entry.url).replace(/\/+$/, '') === requested.siteUrl) : undefined;
    if (!site || !string(site.id)) throw new Error('access_revoked');
    const issue = record(await call('getJiraIssue', { cloudId: string(site.id), issueIdOrKey: requested.ticketKey, fields: ['summary', 'status'], updateHistory: false }));
    const fields = record(issue.fields);
    const key = string(issue.key);
    if (key !== requested.ticketKey || !string(issue.id)) throw new Error('identity_mismatch');
    if (string(issue.self)) {
      try { if (new URL(string(issue.self)).origin !== requested.siteUrl) throw new Error('identity_mismatch'); }
      catch { throw new Error('identity_mismatch'); }
    }
    ticket = { v: 1, provider: 'jira', workspaceId: string(site.id), ticketId: string(issue.id), key, title: string(fields.summary), url: `${requested.siteUrl}/browse/${encodeURIComponent(key)}` };
    status = workflowStatus(fields.status);
  }
  const parsed = SessionTicketSnapshotV1Schema.safeParse({ ticket, status, fetchedAt: params.now() });
  if (!parsed.success) throw new Error('provider_error');
  return parsed.data;
}
