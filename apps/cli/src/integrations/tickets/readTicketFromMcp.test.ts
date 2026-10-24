import { describe, expect, it, vi } from 'vitest';
import { readTicketFromMcp } from './readTicketFromMcp';

const tool = (name: string, properties: Record<string, unknown>, required = Object.keys(properties)) => ({ source: 'configured', name, inputSchema: { type: 'object', properties, required } });
const string = { type: 'string' };
const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

describe('ticket MCP reader provider boundary', () => {
  it('resolves Linear identity from the returned workspace URL and retains a custom workflow label', async () => {
    const call = vi.fn(async () => text({ id: 'ENG-1', uuid: 'linear-uuid', title: 'Fix', url: 'https://linear.app/alpha/issue/ENG-1/fix', status: 'Q/A - Dev' }));
    const snapshot = await readTicketFromMcp({ url: 'https://linear.app/alpha/issue/ENG-1/fix', tools: [tool('get_issue', { id: string })], call, now: () => 123 });
    expect(snapshot).toEqual({ ticket: { v: 1, provider: 'linear', workspaceId: 'alpha', ticketId: 'linear-uuid', key: 'ENG-1', title: 'Fix', url: 'https://linear.app/alpha/issue/ENG-1/fix' }, status: { name: 'Q/A - Dev' }, fetchedAt: 123 });
    expect(call).toHaveBeenCalledWith('get_issue', { id: 'ENG-1' });
  });

  it('resolves ClickUp custom IDs into the actual task and workspace identity', async () => {
    const call = vi.fn(async () => ({ structuredContent: { id: 'abc', custom_id: 'DEV-1', name: 'Fix', workspace_id: '123', url: 'https://app.clickup.com/t/abc', status: { id: 's1', status: 'Ready for Prod', orderindex: 7 } } }));
    const snapshot = await readTicketFromMcp({ url: 'https://app.clickup.com/t/123/DEV-1', tools: [tool('clickup_get_task', { task_id: string, workspace_id: string }, ['task_id'])], call, now: () => 123 });
    expect(snapshot.ticket).toMatchObject({ provider: 'clickup', workspaceId: '123', ticketId: 'abc', key: 'DEV-1', url: 'https://app.clickup.com/t/abc' });
    expect(snapshot.status).toEqual({ id: 's1', name: 'Ready for Prod', order: 7 });
    expect(call).toHaveBeenCalledWith('clickup_get_task', { task_id: 'DEV-1', workspace_id: '123' });
  });

  it('requires the exact authorized Jira Cloud site before reading the issue and disables view-history writes', async () => {
    const call = vi.fn(async (name: string) => name === 'getAccessibleAtlassianResources'
      ? text([{ id: 'other', url: 'https://other.atlassian.net' }, { id: 'cloud-alpha', url: 'https://alpha.atlassian.net' }])
      : text({ id: '10001', key: 'DEV-1', self: 'https://alpha.atlassian.net/rest/api/3/issue/10001', fields: { summary: 'Fix', status: { id: 's1', name: 'Q/A - Testing' } } }));
    const snapshot = await readTicketFromMcp({ url: 'https://alpha.atlassian.net/browse/DEV-1', tools: [tool('getAccessibleAtlassianResources', {}, []), tool('getJiraIssue', { cloudId: string, issueIdOrKey: string, updateHistory: { type: 'boolean' }, fields: { type: 'array', items: string } }, ['cloudId', 'issueIdOrKey'])], call, now: () => 123 });
    expect(snapshot.ticket).toMatchObject({ provider: 'jira', workspaceId: 'cloud-alpha', ticketId: '10001', key: 'DEV-1', url: 'https://alpha.atlassian.net/browse/DEV-1' });
    expect(snapshot.status.name).toBe('Q/A - Testing');
    expect(call.mock.calls[1]).toEqual(['getJiraIssue', { cloudId: 'cloud-alpha', issueIdOrKey: 'DEV-1', fields: ['summary', 'status'], updateHistory: false }]);
  });

  it('rejects same issue keys from another workspace and never invokes arbitrary tools or unknown schemas', async () => {
    const call = vi.fn(async () => text({ id: 'ENG-1', uuid: 'uuid', title: 'Wrong workspace', status: 'Done', url: 'https://linear.app/beta/issue/ENG-1' }));
    await expect(readTicketFromMcp({ url: 'https://linear.app/alpha/issue/ENG-1', tools: [tool('get_issue', { id: string })], call, now: Date.now })).rejects.toThrow('identity_mismatch');
    call.mockClear();
    for (const tools of [[tool('save_issue', { id: string })], [tool('get_issue', { id: string, mutation: string })]]) {
      await expect(readTicketFromMcp({ url: 'https://linear.app/alpha/issue/ENG-1', tools, call, now: Date.now })).rejects.toThrow('unsupported');
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('does not treat provider error content or missing status as a successful refresh', async () => {
    const tools = [tool('get_issue', { id: string })];
    await expect(readTicketFromMcp({ url: 'https://linear.app/alpha/issue/ENG-1', tools, call: async () => ({ isError: true, content: [{ type: 'text', text: '401 token revoked' }] }), now: Date.now })).rejects.toThrow('access_revoked');
    await expect(readTicketFromMcp({ url: 'https://linear.app/alpha/issue/ENG-1', tools, call: async () => text({ id: 'ENG-1', uuid: 'uuid', title: 'Fix', url: 'https://linear.app/alpha/issue/ENG-1' }), now: Date.now })).rejects.toThrow('provider_error');
  });
});
