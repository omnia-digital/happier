import { describe, expect, it } from 'vitest';
import type { ScmHostingProvider } from '@happier-dev/protocol';

import { mapGithubPullRequest } from './githubPullRequestMapping';
import { mapGitlabMergeRequest } from './gitlabMergeRequestMapping';

const sha = 'a'.repeat(40);
const github: ScmHostingProvider = { kind: 'github', name: 'GitHub', baseUrl: 'https://github.com', nameWithOwner: 'owner/repo', remoteName: null };
const gitlab: ScmHostingProvider = { kind: 'gitlab', name: 'GitLab', baseUrl: 'https://gitlab.com', nameWithOwner: 'group/repo', remoteName: null };

describe('pull request provider field mapping', () => {
    it('preserves GitHub REST and gh draft and head SHA, without inventing absent proof', () => {
        const rest = { number: 3, title: 'PR', html_url: 'https://github.com/owner/repo/pull/3', state: 'closed', merged_at: '2026-01-01', base: { ref: 'main' }, head: { ref: 'topic', sha, repo: { full_name: 'fork/repo' } }, draft: true };
        expect(mapGithubPullRequest(github, rest)).toMatchObject({ state: 'merged', draft: true, headSha: sha, headRepository: 'fork/repo' });
        const gh = { number: 3, title: 'PR', url: rest.html_url, state: 'OPEN', baseRefName: 'main', headRefName: 'topic', isDraft: false, headRefOid: sha, headRepository: { nameWithOwner: 'owner/repo' } };
        expect(mapGithubPullRequest(github, gh)).toMatchObject({ state: 'open', draft: false, headSha: sha, headRepository: 'owner/repo' });
        const absentFields = mapGithubPullRequest(github, { ...gh, isDraft: undefined, headRefOid: undefined, headRepository: null });
        expect(absentFields).not.toHaveProperty('draft');
        expect(absentFields).not.toHaveProperty('headSha');
        expect(absentFields).not.toHaveProperty('headRepository');
    });

    it('preserves GitLab MR draft and head SHA only when supplied by glab', () => {
        const raw = { iid: 9, title: 'MR', web_url: 'https://gitlab.com/group/repo/-/merge_requests/9', state: 'merged', target_branch: 'main', source_branch: 'topic', draft: true, sha };
        expect(mapGitlabMergeRequest(gitlab, raw)).toMatchObject({ state: 'merged', draft: true, headSha: sha });
        const oldPayload = { ...raw, draft: undefined, sha: undefined };
        expect(mapGitlabMergeRequest(gitlab, oldPayload)).not.toHaveProperty('headSha');
    });
});
