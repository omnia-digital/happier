import { describe, expect, it } from 'vitest';
import { appendSessionAutoArchiveHistory, readSessionAutoArchiveHistory } from './sessionArchiveHistoryV1.js';

const link = { providerKind: 'github' as const, providerBaseUrl: 'https://github.com', repository: 'owner/repo', number: 7, url: 'https://github.com/owner/repo/pull/7' };

describe('automatic archive history', () => {
    it('retains qualified links and unrelated encrypted metadata across reload and later unarchive', () => {
        const event = { trigger: 'all_linked_pull_requests_merged' as const, archivedAt: 1234, links: [link] };
        const withHistory = appendSessionAutoArchiveHistory({ path: '/work', future: { kept: true }, sessionPullRequestsV1: { v: 1, links: [link] } }, event);
        expect(withHistory.future).toEqual({ kept: true });
        expect(readSessionAutoArchiveHistory(JSON.parse(JSON.stringify(withHistory)))).toEqual([event]);
        expect(appendSessionAutoArchiveHistory(withHistory, event)).toBe(withHistory);
        expect(readSessionAutoArchiveHistory(withHistory)).toEqual([event]);
    });
});
