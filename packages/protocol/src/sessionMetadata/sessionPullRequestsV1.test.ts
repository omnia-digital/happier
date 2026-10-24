import { describe, expect, it } from 'vitest';

import {
  appendSessionPullRequestLink,
  readSessionPullRequestLinks,
  removeSessionPullRequestLink,
  sessionPullRequestLinkFromUrl,
} from './sessionPullRequestsV1.js';

describe('session pull request links', () => {
  it('keeps same-number requests in different repositories distinct and preserves unrelated metadata', () => {
    const first = sessionPullRequestLinkFromUrl('https://github.com/team/first/pull/52');
    const second = sessionPullRequestLinkFromUrl('https://github.com/team/second/pull/52');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const metadata = { name: 'saved', futureField: { value: 7 } };
    const withFirst = appendSessionPullRequestLink(metadata, first!);
    const withBoth = appendSessionPullRequestLink(withFirst, second!);
    expect(readSessionPullRequestLinks(withBoth)).toEqual([first, second]);
    expect(readSessionPullRequestLinks(appendSessionPullRequestLink(withBoth, first!))).toEqual([first, second]);
    expect(removeSessionPullRequestLink(withBoth, first!)).toMatchObject({
      name: 'saved', futureField: { value: 7 }, sessionPullRequestsV1: { links: [second] },
    });
  });

  it('accepts a configured GitLab host but rejects an unrelated host and malformed URL', () => {
    expect(sessionPullRequestLinkFromUrl('https://gitlab.example.com/group/repo/-/merge_requests/9', {
      kind: 'gitlab', baseUrl: 'https://gitlab.example.com',
    })).toMatchObject({ providerKind: 'gitlab', repository: 'group/repo', number: 9 });
    expect(sessionPullRequestLinkFromUrl('https://another.example.com/group/repo/-/merge_requests/9', {
      kind: 'gitlab', baseUrl: 'https://gitlab.example.com',
    })).toBeNull();
    expect(sessionPullRequestLinkFromUrl('https://github.com/team/repo/pull/0')).toBeNull();
    expect(sessionPullRequestLinkFromUrl('https://github.com.evil.test/team/repo/pull/4')).toBeNull();
  });
});
