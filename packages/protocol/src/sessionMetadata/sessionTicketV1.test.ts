import { describe, expect, it } from 'vitest';
import * as protocol from '../index.js';

describe('session ticket association', () => {
  it('recognizes exact provider ticket links and rejects unrelated hosts, chat messages and credentials', () => {
    const parse = (protocol as Record<string, unknown>).parseSessionTicketUrl as (url: string) => unknown;
    expect(parse).toBeTypeOf('function');
    expect(parse('https://linear.app/alpha/issue/ENG-1/title')).toMatchObject({ provider: 'linear', workspaceSlug: 'alpha', ticketKey: 'ENG-1' });
    expect(parse('https://app.clickup.com/t/123/abc')).toMatchObject({ provider: 'clickup', workspaceId: '123', ticketKey: 'abc' });
    expect(parse('https://alpha.atlassian.net/browse/ENG-1')).toMatchObject({ provider: 'jira', siteUrl: 'https://alpha.atlassian.net', ticketKey: 'ENG-1' });
    for (const url of ['https://linear.app.evil.test/alpha/issue/ENG-1', 'https://app.clickup.com/v/cn/chat/t/abc', 'https://user:pass@linear.app/alpha/issue/ENG-1', 'http://alpha.atlassian.net/browse/ENG-1', 'javascript:alert(1)', 'https://jira.internal/browse/ENG-1']) {
      expect(parse(url)).toBeNull();
    }
  });

  it('changes and removes the association without dropping other metadata', () => {
    const patch = (protocol as Record<string, unknown>).withSessionTicketAssociation as (metadata: Record<string, unknown>, association: unknown) => Record<string, unknown>;
    const read = (protocol as Record<string, unknown>).readSessionTicketAssociation as (metadata: unknown) => unknown;
    expect(patch).toBeTypeOf('function');
    expect(read).toBeTypeOf('function');
    const association = { v: 1, ticket: { v: 1, provider: 'linear', workspaceId: 'alpha', ticketId: 'uuid-1', key: 'ENG-1', title: 'Fix it', url: 'https://linear.app/alpha/issue/ENG-1/fix-it' }, reader: { machineId: 'reader', mcpServerId: 'linear-source', directory: '/work' } };
    const metadata = { path: '/project', unknownOldClientField: { nested: true } };
    const linked = patch(metadata, association);
    expect(read(linked)).toEqual(association);
    expect(linked.unknownOldClientField).toBe(metadata.unknownOldClientField);
    const unlinked = patch(linked, null);
    expect(read(unlinked)).toBeNull();
    expect(unlinked).toEqual(metadata);
    expect(read({ sessionTicketV1: { v: 9, token: 'never trusted' } })).toBeNull();
  });
});
