import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { sessionPullRequestLinkFromUrl } from '@happier-dev/protocol';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const readMock = vi.hoisted(() => vi.fn());
const addMock = vi.hoisted(() => vi.fn(async () => {}));
const changeMock = vi.hoisted(() => vi.fn(async () => {}));
const removeMock = vi.hoisted(() => vi.fn(async () => {}));
const openMock = vi.hoisted(() => vi.fn(async () => true));
const promptMock = vi.hoisted(() => vi.fn());
const alertMock = vi.hoisted(() => vi.fn());
const captureScopeMock = vi.hoisted(() => vi.fn(() => ({ serverId: 'home-a', accountId: 'account-a', shouldContinue: () => true })));

vi.mock('@/sync/ops/sessionPullRequestLinks', async () => {
    const protocol = await import('@happier-dev/protocol');
    return {
        addSessionPullRequestLink: addMock,
        replaceSessionPullRequestLink: changeMock,
        removeLinkedPullRequest: removeMock,
        readLinkedPullRequest: readMock,
        parseSessionPullRequestUrl: protocol.sessionPullRequestLinkFromUrl,
        captureSessionPullRequestActionScope: captureScopeMock,
    };
});
vi.mock('@/utils/url/openExternalUrl', () => ({ openExternalUrl: openMock }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { prompt: promptMock, alert: alertMock } }).module;
});

const first = sessionPullRequestLinkFromUrl('https://github.com/owner/one/pull/7')!;
const second = sessionPullRequestLinkFromUrl('https://github.com/owner/two/pull/7')!;

describe('SessionPullRequests', () => {
    beforeEach(() => {
        readMock.mockReset(); addMock.mockClear(); changeMock.mockClear(); removeMock.mockClear();
        openMock.mockClear(); promptMock.mockReset(); alertMock.mockClear(); captureScopeMock.mockClear();
    });

    it('shows distinct same-number repositories and unknown status when the host is unavailable', async () => {
        readMock.mockRejectedValue(new Error('offline'));
        const { SessionPullRequests } = await import('./SessionPullRequests');
        const screen = await renderScreen(<SessionPullRequests sessionId="s1" canEdit metadata={{ sessionPullRequestsV1: { v: 1, links: [first, second] } }} />);
        expect(JSON.stringify(screen.tree.toJSON())).toContain('owner/one #7');
        expect(JSON.stringify(screen.tree.toJSON())).toContain('owner/two #7');
        expect(JSON.stringify(screen.tree.toJSON())).toContain('Unknown');
        expect(JSON.stringify(screen.tree.toJSON())).not.toContain('Unknown · Unknown');
        expect(screen.findByTestId('session-pr-link-github-github.com-owner/one-7')).not.toBeNull();
        expect(screen.findByTestId('session-pr-link-github-github.com-owner/two-7')).not.toBeNull();
        expect(readMock).toHaveBeenCalledTimes(2);
    });

    it('adds a canonical URL and changes one link without touching the other', async () => {
        readMock.mockResolvedValue(null);
        const { SessionPullRequests } = await import('./SessionPullRequests');
        const screen = await renderScreen(<SessionPullRequests sessionId="s1" canEdit metadata={{ sessionPullRequestsV1: { v: 1, links: [first, second] } }} />);
        promptMock.mockResolvedValueOnce('https://gitlab.com/group/other/-/merge_requests/9');
        await act(async () => { await screen.findByTestId('session-pr-add')!.props.onPress(); });
        expect(addMock).toHaveBeenCalledWith('s1', expect.objectContaining({ providerKind: 'gitlab', repository: 'group/other', number: 9 }), expect.objectContaining({ serverId: 'home-a', accountId: 'account-a' }));
        promptMock.mockResolvedValueOnce('https://github.com/owner/replacement/pull/7');
        await act(async () => { await screen.findByTestId('session-pr-change-github-github.com-owner/one-7')!.props.onPress(); });
        expect(changeMock).toHaveBeenCalledWith('s1', first, expect.objectContaining({ repository: 'owner/replacement' }), expect.objectContaining({ serverId: 'home-a', accountId: 'account-a' }));
        expect(removeMock).not.toHaveBeenCalled();
        await act(async () => { await screen.findByTestId('session-pr-remove-github-github.com-owner/two-7')!.props.onPress(); });
        const removeAction = alertMock.mock.lastCall?.[2]?.[1];
        await act(async () => { await removeAction?.onPress(); });
        expect(removeMock).toHaveBeenCalledWith('s1', second, expect.objectContaining({ serverId: 'home-a', accountId: 'account-a' }));
    });

    it('captures the edit scope before a delayed prompt returns', async () => {
        readMock.mockResolvedValue(null);
        let answer!: (value: string) => void;
        promptMock.mockReturnValue(new Promise<string>((resolve) => { answer = resolve; }));
        const { SessionPullRequests } = await import('./SessionPullRequests');
        const screen = await renderScreen(<SessionPullRequests sessionId="s1" canEdit metadata={{}} />);
        await act(async () => { screen.findByTestId('session-pr-add')!.props.onPress(); });
        expect(captureScopeMock.mock.invocationCallOrder[0]).toBeLessThan(promptMock.mock.invocationCallOrder[0]);
        await act(async () => { answer('https://github.com/owner/one/pull/7'); });
        expect(addMock).toHaveBeenCalledWith('s1', first, expect.objectContaining({ serverId: 'home-a', accountId: 'account-a' }));
    });

    it('shows and opens distinct hosts for the same repository and request number', async () => {
        readMock.mockResolvedValue(null);
        const publicLink = sessionPullRequestLinkFromUrl('https://gitlab.com/group/one/-/merge_requests/7')!;
        const customLink = sessionPullRequestLinkFromUrl('https://gitlab.corp.example/group/one/-/merge_requests/7', {
            kind: 'gitlab', baseUrl: 'https://gitlab.corp.example',
        })!;
        const { SessionPullRequests } = await import('./SessionPullRequests');
        const screen = await renderScreen(<SessionPullRequests sessionId="s1" canEdit metadata={{ sessionPullRequestsV1: { v: 1, links: [publicLink, customLink] } }} />);
        const publicRow = screen.findByTestId('session-pr-link-gitlab-gitlab.com-group/one-7');
        const customRow = screen.findByTestId('session-pr-link-gitlab-gitlab.corp.example-group/one-7');
        expect(publicRow).not.toBeNull();
        expect(customRow).not.toBeNull();
        expect(JSON.stringify(screen.tree.toJSON())).toContain('gitlab.corp.example');
        await act(async () => { await customRow!.props.onPress(); });
        expect(openMock).toHaveBeenCalledWith(customLink.url);
    });

    it('shows links without mutation controls to a shared-session reader', async () => {
        readMock.mockResolvedValue(null);
        const { SessionPullRequests } = await import('./SessionPullRequests');
        const screen = await renderScreen(<SessionPullRequests sessionId="s1" canEdit={false} metadata={{ sessionPullRequestsV1: { v: 1, links: [first] } }} />);
        expect(screen.findByTestId('session-pr-link-github-github.com-owner/one-7')).not.toBeNull();
        expect(screen.findByTestId('session-pr-add')).toBeNull();
        expect(screen.findByTestId('session-pr-change-github-github.com-owner/one-7')).toBeNull();
        expect(screen.findByTestId('session-pr-remove-github-github.com-owner/one-7')).toBeNull();
    });
});
