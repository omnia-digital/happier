import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { readSessionAutoArchiveHistory, readSessionPullRequestLinks, type ScmPullRequestSummary, type SessionPullRequestLinkV1 } from '@happier-dev/protocol';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useActiveServerAccountScope, useSession, useSessionListRenderable, useSessionProjectScmSnapshot, useSetting } from '@/sync/domains/state/storage';
import { assessSessionAutoArchiveCandidate } from '@/sync/domains/session/archive/sessionAutoArchiveEligibility';
import { useSessionArchivePending } from '@/hooks/session/useSessionArchivePending';
import { addSessionPullRequestLink, captureSessionPullRequestActionScope, parseSessionPullRequestUrl, readLinkedPullRequest, removeLinkedPullRequest, replaceSessionPullRequestLink, type SessionPullRequestActionScope } from '@/sync/ops/sessionPullRequestLinks';
import { Modal } from '@/modal';
import { t } from '@/text';
import { openExternalUrl } from '@/utils/url/openExternalUrl';
import { useMountedRef } from '@/hooks/ui/useMountedRef';

function LinkedPullRequest(props: Readonly<{
    sessionId: string;
    link: SessionPullRequestLinkV1;
    canEdit: boolean;
    onChange: (link: SessionPullRequestLinkV1) => Promise<void>;
    onRemove: (link: SessionPullRequestLinkV1) => Promise<void>;
}>) {
    const { theme } = useUnistyles();
    const [lastKnown, setLastKnown] = React.useState<{ summary: ScmPullRequestSummary; at: number } | null>(null);
    const [fresh, setFresh] = React.useState(false);
    const [checking, setChecking] = React.useState(false);
    const [refresh, setRefresh] = React.useState(0);
    React.useEffect(() => {
        let cancelled = false;
        setChecking(true);
        setFresh(false);
        void readLinkedPullRequest(props.sessionId, props.link).then((summary) => {
            if (cancelled) return;
            if (summary) {
                setLastKnown({ summary, at: Date.now() });
                setFresh(true);
            }
        }).catch(() => {
            if (!cancelled) setFresh(false);
        }).finally(() => {
            if (!cancelled) setChecking(false);
        });
        return () => { cancelled = true; };
    }, [props.sessionId, props.link.url, refresh]);

    const state = lastKnown?.summary.draft === true && lastKnown.summary.state === 'open'
        ? t('sessionPullRequests.draft')
        : lastKnown?.summary.state === 'merged' ? t('files.sourceControlOperations.update.pullRequests.states.merged')
            : lastKnown?.summary.state === 'open' ? t('files.sourceControlOperations.update.pullRequests.states.open')
                : lastKnown?.summary.state === 'closed' ? t('files.sourceControlOperations.update.pullRequests.states.closed')
                    : t('sessionPullRequests.unknown');
    const freshness = checking ? t('sessionPullRequests.checking') : fresh && lastKnown ? `${t('sessionPullRequests.checked')} ${new Date(lastKnown.at).toLocaleString()}`
        : lastKnown ? t('sessionPullRequests.stale') : null;
    const label = `${props.link.repository} #${props.link.number}`;
    const host = new URL(props.link.providerBaseUrl).hostname;
    const testIdentity = `${props.link.providerKind}-${host}-${props.link.repository}-${props.link.number}`;
    const providerLabel = props.link.providerKind === 'github' ? 'GitHub' : 'GitLab';
    const hostLabel = host === 'github.com' || host === 'gitlab.com' ? null : host;
    return <>
        <Item
            testID={`session-pr-link-${testIdentity}`}
            title={label}
            subtitle={[providerLabel, hostLabel, state, freshness].filter(Boolean).join(' · ')}
            icon={<Icon name="link" size={29} color={theme.colors.accent.blue} />}
            onPress={() => { void openExternalUrl(props.link.url); }}
        />
        <Item testID={`session-pr-refresh-${testIdentity}`} title={t('sessionPullRequests.refresh')} onPress={() => setRefresh((value) => value + 1)} />
        {props.canEdit && <Item testID={`session-pr-change-${testIdentity}`} title={t('sessionPullRequests.change')} onPress={() => { void props.onChange(props.link); }} />}
        {props.canEdit && <Item testID={`session-pr-remove-${testIdentity}`} title={t('sessionPullRequests.remove')} onPress={() => { void props.onRemove(props.link); }} />}
    </>;
}

export function SessionPullRequests(props: Readonly<{ sessionId: string; metadata: unknown; canEdit: boolean }>) {
    const { theme } = useUnistyles();
    const mountedRef = useMountedRef();
    const activeScope = useActiveServerAccountScope();
    const autoArchiveEnabled = useSetting('autoArchiveAfterLinkedPullRequestsMerge');
    const session = useSession(props.sessionId);
    const renderable = useSessionListRenderable(props.sessionId);
    const archivePending = useSessionArchivePending(props.sessionId, activeScope?.serverId);
    const snapshot = useSessionProjectScmSnapshot(props.sessionId);
    const links = readSessionPullRequestLinks(props.metadata);
    const autoArchiveDecision = autoArchiveEnabled && renderable
        ? assessSessionAutoArchiveCandidate({ session: renderable, enabled: true, archivePending, accountId: activeScope?.accountId,
            authenticatedOwnerAccountId: session?.authenticatedOwnerAccountId })
        : null;
    const autoArchiveSkip = autoArchiveDecision?.reason === 'work_unverified';
    const archivedAt = session ? session.archivedAt : renderable?.archivedAt;
    const archiveHistory = archivedAt == null ? null
        : readSessionAutoArchiveHistory(props.metadata).find((event) => event.archivedAt === archivedAt);
    const configuredProvider = snapshot?.hostingProvider?.kind === 'github' || snapshot?.hostingProvider?.kind === 'gitlab'
        ? { kind: snapshot.hostingProvider.kind, baseUrl: snapshot.hostingProvider.baseUrl }
        : undefined;

    const promptForLink = async (defaultValue?: string): Promise<SessionPullRequestLinkV1 | null> => {
        const raw = await Modal.prompt(t('sessionPullRequests.promptTitle'), t('sessionPullRequests.promptBody'), {
            defaultValue,
            placeholder: 'https://github.com/owner/repo/pull/123',
            confirmText: t('common.save'),
            cancelText: t('common.cancel'),
        });
        if (raw == null) return null;
        const publicLink = parseSessionPullRequestUrl(raw);
        const link = publicLink ?? (configuredProvider ? parseSessionPullRequestUrl(raw, configuredProvider) : null);
        if (!link) Modal.alert(t('common.error'), t('sessionPullRequests.invalidUrl'));
        return link;
    };
    const beginEdit = (): SessionPullRequestActionScope | null => {
        try { return captureSessionPullRequestActionScope(props.sessionId, () => mountedRef.current); }
        catch { Modal.alert(t('common.error'), t('sessionPullRequests.saveFailed')); return null; }
    };
    const add = async () => {
        const scope = beginEdit();
        if (!scope) return;
        const link = await promptForLink();
        if (!link) return;
        try { await addSessionPullRequestLink(props.sessionId, link, scope); }
        catch { if (mountedRef.current) Modal.alert(t('common.error'), t('sessionPullRequests.saveFailed')); }
    };
    const change = async (previous: SessionPullRequestLinkV1) => {
        const scope = beginEdit();
        if (!scope) return;
        const next = await promptForLink(previous.url);
        if (!next) return;
        try { await replaceSessionPullRequestLink(props.sessionId, previous, next, scope); }
        catch { if (mountedRef.current) Modal.alert(t('common.error'), t('sessionPullRequests.saveFailed')); }
    };
    const remove = async (link: SessionPullRequestLinkV1) => {
        const scope = beginEdit();
        if (!scope) return;
        Modal.alert(t('sessionPullRequests.remove'), t('sessionPullRequests.removeConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sessionPullRequests.remove'), style: 'destructive', onPress: () => {
                void removeLinkedPullRequest(props.sessionId, link, scope).catch(() => {
                    if (mountedRef.current) Modal.alert(t('common.error'), t('sessionPullRequests.saveFailed'));
                });
            } },
        ]);
    };
    return <ItemGroup title={t('sessionPullRequests.title')}>
        {autoArchiveSkip && <Item testID="session-pr-autoarchive-skipped" title={t('settingsSession.archiveAutomation.title')} subtitle={t('sessionPullRequests.autoArchiveWorkUnverified')} icon={<Icon name="info" size={29} color={theme.colors.text.secondary} />} />}
        {archiveHistory && <Item testID="session-pr-autoarchive-history" title={t('sessionPullRequests.autoArchived')} subtitle={`${t('sessionPullRequests.autoArchivedReason')} · ${archiveHistory.links.map((link) => `${link.repository} #${link.number}`).join(', ')}`} icon={<Icon name="archive" size={29} color={theme.colors.text.secondary} />} />}
        {links.map((link) => <LinkedPullRequest key={`${activeScope?.serverId ?? 'none'}:${activeScope?.accountId ?? 'none'}:${link.url}`} sessionId={props.sessionId} link={link} canEdit={props.canEdit} onChange={change} onRemove={remove} />)}
        {props.canEdit && <Item testID="session-pr-add" title={t('sessionPullRequests.add')} subtitle={t('sessionPullRequests.addSubtitle')} icon={<Icon name="link" size={29} color={theme.colors.accent.blue} />} onPress={() => { void add(); }} />}
    </ItemGroup>;
}
