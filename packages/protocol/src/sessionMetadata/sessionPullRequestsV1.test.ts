import { describe, expect, it } from 'vitest';

import {
  appendSessionPullRequestLink,
  readSessionPullRequestLinks,
  removeSessionPullRequestLink,
  sessionPullRequestLinkFromSummary,
  sessionPullRequestLinkFromUrl,
  sessionPullRequestLinkKey,
  SessionPullRequestLinkV1Schema,
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

  it('rejects noncanonical provider base URLs that would create a second identity key', () => {
    const canonical = sessionPullRequestLinkFromUrl('https://github.com/team/repo/pull/7')!;
    expect(SessionPullRequestLinkV1Schema.safeParse({ ...canonical, providerBaseUrl: 'https://github.com/' }).success).toBe(false);
    expect(SessionPullRequestLinkV1Schema.safeParse({ ...canonical, providerBaseUrl: 'https://github.com/other' }).success).toBe(false);
  });

  it('treats GitHub repository case aliases as one identity while retaining GitLab case', () => {
    const lower = sessionPullRequestLinkFromUrl('https://github.com/team/repo/pull/7')!;
    const upper = sessionPullRequestLinkFromUrl('https://github.com/Team/Repo/pull/7')!;
    expect(sessionPullRequestLinkKey(upper)).toBe(sessionPullRequestLinkKey(lower));
    expect(readSessionPullRequestLinks(appendSessionPullRequestLink(appendSessionPullRequestLink({}, lower), upper))).toEqual([lower]);
    expect(readSessionPullRequestLinks(removeSessionPullRequestLink(appendSessionPullRequestLink({}, lower), upper))).toEqual([]);
    expect(SessionPullRequestLinkV1Schema.safeParse({ ...upper, repository: 'team/repo' }).success).toBe(true);
    expect(sessionPullRequestLinkFromSummary({
      provider: { kind: 'github', name: 'GitHub', baseUrl: 'https://github.com', nameWithOwner: 'team/repo', remoteName: null },
      number: 7, title: 'Alias', url: upper.url, baseBranch: 'main', headBranch: 'feature', state: 'merged',
    })).toEqual(upper);

    const gitlabLower = sessionPullRequestLinkFromUrl('https://gitlab.com/team/repo/-/merge_requests/7')!;
    const gitlabUpper = sessionPullRequestLinkFromUrl('https://gitlab.com/Team/Repo/-/merge_requests/7')!;
    expect(sessionPullRequestLinkKey(gitlabUpper)).not.toBe(sessionPullRequestLinkKey(gitlabLower));
  });
});
