import { z } from 'zod';

import type { ScmPullRequestSummary } from '../scmPullRequests.js';

const ProviderKindSchema = z.enum(['github', 'gitlab']);

export const SessionPullRequestLinkV1Schema = z.object({
  providerKind: ProviderKindSchema,
  providerBaseUrl: z.string().url(),
  repository: z.string().min(3),
  number: z.number().int().positive(),
  url: z.string().url(),
}).strict().superRefine((link, ctx) => {
  const parsed = sessionPullRequestLinkFromUrl(link.url, { kind: link.providerKind, baseUrl: link.providerBaseUrl });
  if (!parsed || parsed.providerKind !== link.providerKind || parsed.providerBaseUrl !== link.providerBaseUrl
    || parsed.repository !== link.repository || parsed.number !== link.number || parsed.url !== link.url) {
    ctx.addIssue({ code: 'custom', message: 'Pull request URL must match its provider, repository and number', path: ['url'] });
  }
});
export type SessionPullRequestLinkV1 = z.infer<typeof SessionPullRequestLinkV1Schema>;

export const SessionPullRequestsV1Schema = z.object({
  v: z.literal(1),
  links: z.array(SessionPullRequestLinkV1Schema),
}).strict();
export type SessionPullRequestsV1 = z.infer<typeof SessionPullRequestsV1Schema>;

type AllowedProvider = Readonly<{ kind: 'github' | 'gitlab'; baseUrl: string }>;

function normalizeProviderBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Parses identity only. A provider read still has to verify the live response. */
export function sessionPullRequestLinkFromUrl(raw: string, allowedProvider?: AllowedProvider): SessionPullRequestLinkV1 | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return null;
    const providerBaseUrl = allowedProvider ? normalizeProviderBaseUrl(allowedProvider.baseUrl) : null;
    const providerKind = url.hostname === 'github.com' ? 'github'
      : url.hostname === 'gitlab.com' ? 'gitlab'
        : providerBaseUrl === url.origin ? allowedProvider?.kind : null;
    if (!providerKind || (allowedProvider && (allowedProvider.kind !== providerKind || providerBaseUrl !== url.origin))) return null;
    const path = url.pathname.replace(/\/+$/, '');
    const match = providerKind === 'github'
      ? /^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/.exec(path)
      : /^\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\/-\/merge_requests\/([1-9][0-9]*)$/.exec(path);
    if (!match) return null;
    const number = Number(match[2]);
    if (!Number.isSafeInteger(number)) return null;
    return {
      providerKind,
      providerBaseUrl: url.origin,
      repository: match[1],
      number,
      url: `${url.origin}${path}`,
    };
  } catch {
    return null;
  }
}

export function sessionPullRequestLinkFromSummary(summary: ScmPullRequestSummary): SessionPullRequestLinkV1 | null {
  if (summary.provider.kind !== 'github' && summary.provider.kind !== 'gitlab') return null;
  const link = sessionPullRequestLinkFromUrl(summary.url, {
    kind: summary.provider.kind,
    baseUrl: summary.provider.baseUrl,
  });
  if (!link || link.number !== summary.number || link.repository !== summary.provider.nameWithOwner) return null;
  return link;
}

export function sessionPullRequestLinkKey(link: SessionPullRequestLinkV1): string {
  return `${link.providerKind}\u0000${link.providerBaseUrl}\u0000${link.repository}\u0000${link.number}`;
}

export function readSessionPullRequestLinks(metadata: unknown): readonly SessionPullRequestLinkV1[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const parsed = SessionPullRequestsV1Schema.safeParse((metadata as Record<string, unknown>).sessionPullRequestsV1);
  return parsed.success ? parsed.data.links : [];
}

function readLinksForMutation(metadata: Record<string, unknown>): readonly SessionPullRequestLinkV1[] {
  if (!Object.prototype.hasOwnProperty.call(metadata, 'sessionPullRequestsV1')) return [];
  return SessionPullRequestsV1Schema.parse(metadata.sessionPullRequestsV1).links;
}

export function appendSessionPullRequestLink<T extends Record<string, unknown>>(metadata: T, rawLink: SessionPullRequestLinkV1): T {
  const link = SessionPullRequestLinkV1Schema.parse(rawLink);
  const links = readLinksForMutation(metadata);
  if (links.some((existing) => sessionPullRequestLinkKey(existing) === sessionPullRequestLinkKey(link))) return metadata;
  return { ...metadata, sessionPullRequestsV1: { v: 1, links: [...links, link] } };
}

export function removeSessionPullRequestLink<T extends Record<string, unknown>>(metadata: T, rawLink: SessionPullRequestLinkV1): T {
  const link = SessionPullRequestLinkV1Schema.parse(rawLink);
  const links = readLinksForMutation(metadata);
  return { ...metadata, sessionPullRequestsV1: { v: 1, links: links.filter((existing) => sessionPullRequestLinkKey(existing) !== sessionPullRequestLinkKey(link)) } };
}
