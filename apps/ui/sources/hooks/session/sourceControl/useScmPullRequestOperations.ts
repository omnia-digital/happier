import * as React from 'react';

import { Modal } from '@/modal';
import { scmStatusSync } from '@/scm/scmStatusSync';
import {
    sessionScmBranchCreate,
    sessionScmPullRequestOpenOrReuse,
    sessionScmPullRequestRunStacked,
} from '@/sync/ops';
import { t } from '@/text';
import { useMountedRef } from '@/hooks/ui/useMountedRef';
import { openExternalUrl } from '@/utils/url/openExternalUrl';
import { captureSessionPullRequestActionScope, captureSessionPullRequestFromSummary, type SessionPullRequestActionScope } from '@/sync/ops/sessionPullRequestLinks';
import type { PullRequestUiModel } from '@/components/sessions/sourceControl/pullRequests/pullRequestUiModel';
import { sessionPullRequestLinkFromSummary, sessionPullRequestRepositoriesMatch, type ScmHostingProvider, type ScmPullRequestRunStackedResponse, type ScmPullRequestSummary } from '@happier-dev/protocol';

type ExistingPullRequestModel = Extract<PullRequestUiModel, { kind: 'existing_pull_request' }>;
type ReadyPullRequestModel = Extract<PullRequestUiModel, { kind: 'ready_to_create' }>;

export function useScmPullRequestOperations(input: Readonly<{
    sessionId: string;
}>) {
    const mountedRef = useMountedRef();
    const [busy, setBusy] = React.useState(false);
    const [status, setStatus] = React.useState<string | null>(null);

    const setBusySafe = React.useCallback((value: boolean) => {
        if (mountedRef.current) {
            setBusy(value);
        }
    }, [mountedRef]);

    const setStatusSafe = React.useCallback((value: string | null) => {
        if (mountedRef.current) {
            setStatus(value);
        }
    }, [mountedRef]);

    const openProviderUrl = React.useCallback(async (params: Readonly<{
        providerBaseUrl: string;
        url: string;
        errorMessage: string;
    }>): Promise<boolean> => {
        if (!isProviderOriginUrl(params.url, params.providerBaseUrl)) {
            Modal.alert(t('common.error'), params.errorMessage);
            return false;
        }

        return openExternalUrl(params.url);
    }, []);

    const viewPullRequest = React.useCallback(async (model: ExistingPullRequestModel) => {
        await openProviderUrl({
            providerBaseUrl: model.pullRequest.provider.baseUrl,
            url: model.pullRequest.url,
            errorMessage: t('files.sourceControlOperations.update.pullRequests.errors.openFailed'),
        });
    }, [openProviderUrl]);

    const beginLinkCapture = React.useCallback((): SessionPullRequestActionScope | null => {
        try { return captureSessionPullRequestActionScope(input.sessionId, () => mountedRef.current); }
        catch { return null; }
    }, [input.sessionId, mountedRef]);

    const captureOpenedPullRequest = React.useCallback(async (pullRequest: ScmPullRequestSummary, expectedProvider: ScmHostingProvider, scope: SessionPullRequestActionScope | null) => {
        if (!mountedRef.current) return;
        if (!scope?.shouldContinue()) {
            Modal.alert(t('common.error'), t('sessionPullRequests.saveFailed'));
            return;
        }
        const link = sessionPullRequestLinkFromSummary(pullRequest);
        let expectedOrigin: string | null = null;
        try { expectedOrigin = new URL(expectedProvider.baseUrl).origin; } catch { /* handled as an invalid provider below */ }
        if (!link || !expectedProvider.nameWithOwner || link.providerKind !== expectedProvider.kind || link.providerBaseUrl !== expectedOrigin
            || !sessionPullRequestRepositoriesMatch(link.providerKind, link.repository, expectedProvider.nameWithOwner)) {
            Modal.alert(t('common.error'), t('sessionPullRequests.invalidUrl'));
            return;
        }
        try {
            await captureSessionPullRequestFromSummary(input.sessionId, pullRequest, scope);
        } catch {
            Modal.alert(t('common.error'), t('sessionPullRequests.saveFailed'));
        }
    }, [input.sessionId, mountedRef]);

    const openStackedPullRequestResult = React.useCallback(async (
        response: ScmPullRequestRunStackedResponse,
        expectedProvider: ScmHostingProvider,
        captureScope: SessionPullRequestActionScope | null,
    ) => {
        if (!response.success) {
            Modal.alert(
                t('common.error'),
                response.error || t('files.sourceControlOperations.update.pullRequests.errors.stackedFailed'),
            );
            return;
        }

        const nextActionUrl =
            response.nextAction?.kind === 'openPullRequest' || response.nextAction?.kind === 'openCompose'
                ? response.nextAction.url
                : null;
        const url = nextActionUrl ?? response.pullRequest?.url ?? response.composeUrl;
        if (response.pullRequest) await captureOpenedPullRequest(response.pullRequest, expectedProvider, captureScope);
        if (url) {
            await openProviderUrl({
                providerBaseUrl: response.pullRequest?.provider.baseUrl ?? expectedProvider.baseUrl,
                url,
                errorMessage: t('files.sourceControlOperations.update.pullRequests.errors.stackedFailed'),
            });
        }
        await scmStatusSync.invalidateFromMutationAndAwait(input.sessionId);
    }, [input.sessionId, openProviderUrl, captureOpenedPullRequest]);

    const openOrReusePullRequest = React.useCallback(async (model: ReadyPullRequestModel) => {
        const captureScope = beginLinkCapture();
        if (!model.canCreatePullRequest) {
            Modal.alert(
                t('common.error'),
                t('files.sourceControlOperations.update.pullRequests.errors.openFailed'),
            );
            return;
        }
        if (model.createBlockedReason) {
            Modal.alert(
                t('common.error'),
                t('files.sourceControlOperations.update.pullRequests.errors.featureBranchRequired'),
            );
            return;
        }

        setBusySafe(true);
        setStatusSafe(model.createStrategy.kind === 'run_stacked_create_pr'
            ? t('files.sourceControlOperations.update.pullRequests.status.pushingAndCreating')
            : t('files.sourceControlOperations.update.pullRequests.status.creating'));
        try {
            if (model.createStrategy.kind === 'run_stacked_create_pr') {
                const response = await sessionScmPullRequestRunStacked(input.sessionId, {
                    action: 'createPr',
                    base: model.baseBranch,
                    title: model.headBranch,
                    body: '',
                });
                await openStackedPullRequestResult(response, model.provider, captureScope);
                return;
            }

            const response = await sessionScmPullRequestOpenOrReuse(input.sessionId, {
                base: model.baseBranch,
                head: model.headBranch,
                title: model.headBranch,
                body: '',
            });
            if (!response.success) {
                Modal.alert(
                    t('common.error'),
                    response.error || t('files.sourceControlOperations.update.pullRequests.errors.openFailed'),
                );
                return;
            }

            if (response.kind === 'no-auth') {
                await openProviderUrl({
                    providerBaseUrl: model.provider.baseUrl,
                    url: response.composeUrl,
                    errorMessage: t('files.sourceControlOperations.update.pullRequests.errors.openFailed'),
                });
                return;
            }

            await captureOpenedPullRequest(response.pullRequest, model.provider, captureScope);
            await openProviderUrl({
                providerBaseUrl: response.pullRequest.provider.baseUrl,
                url: response.pullRequest.url,
                errorMessage: t('files.sourceControlOperations.update.pullRequests.errors.openFailed'),
            });
            await scmStatusSync.invalidateFromMutationAndAwait(input.sessionId);
        } finally {
            setBusySafe(false);
            setStatusSafe(null);
        }
    }, [input.sessionId, openProviderUrl, openStackedPullRequestResult, captureOpenedPullRequest, beginLinkCapture, setBusySafe, setStatusSafe]);

    const promptForFeatureBranchName = React.useCallback(async (model: ReadyPullRequestModel): Promise<string | null> => {
        const suggestedBranchName = model.defaultBranchAction?.suggestedBranchName ?? 'feature/changes-update';
        const raw = await Modal.prompt(
            t('files.sourceControlOperations.update.pullRequests.featureBranchPromptTitle'),
            t('files.sourceControlOperations.update.pullRequests.featureBranchPromptBody'),
            {
                defaultValue: suggestedBranchName,
                placeholder: suggestedBranchName,
                confirmText: t('common.continue'),
                cancelText: t('common.cancel'),
            },
        );
        if (raw == null) {
            return null;
        }
        const branchName = raw.trim();
        if (!branchName) {
            Modal.alert(
                t('common.error'),
                t('files.sourceControlOperations.update.pullRequests.errors.branchNameRequired'),
            );
            return null;
        }
        return branchName;
    }, []);

    const createFeatureBranch = React.useCallback(async (model: ReadyPullRequestModel) => {
        if (model.defaultBranchAction?.kind !== 'create_feature_branch') {
            Modal.alert(
                t('common.error'),
                t('files.sourceControlOperations.update.pullRequests.errors.featureBranchRequired'),
            );
            return;
        }
        const branchName = await promptForFeatureBranchName(model);
        if (!branchName) return;

        setBusySafe(true);
        setStatusSafe(t('files.sourceControlOperations.update.pullRequests.status.creatingFeatureBranch'));
        try {
            const response = await sessionScmBranchCreate(input.sessionId, {
                name: branchName,
                checkout: true,
                startPoint: model.headBranch,
            });
            if (!response.success) {
                Modal.alert(
                    t('common.error'),
                    response.error || t('files.sourceControlOperations.update.pullRequests.errors.createBranchFailed'),
                );
                return;
            }
            await scmStatusSync.invalidateFromMutationAndAwait(input.sessionId);
        } finally {
            setBusySafe(false);
            setStatusSafe(null);
        }
    }, [input.sessionId, promptForFeatureBranchName, setBusySafe, setStatusSafe]);

    const createFeatureBranchAndOpenPullRequest = React.useCallback(async (model: ReadyPullRequestModel) => {
        const captureScope = beginLinkCapture();
        if (model.defaultBranchAction?.kind !== 'create_feature_branch_and_open_pr') {
            Modal.alert(
                t('common.error'),
                t('files.sourceControlOperations.update.pullRequests.errors.featureBranchRequired'),
            );
            return;
        }
        const branchName = await promptForFeatureBranchName(model);
        if (!branchName) return;

        setBusySafe(true);
        setStatusSafe(t('files.sourceControlOperations.update.pullRequests.status.creatingFeatureBranchPullRequest'));
        try {
            const response = await sessionScmPullRequestRunStacked(input.sessionId, {
                action: model.defaultBranchAction.action,
                base: model.baseBranch,
                featureBranch: branchName,
                title: branchName,
                body: '',
            });
            await openStackedPullRequestResult(response, model.provider, captureScope);
        } finally {
            setBusySafe(false);
            setStatusSafe(null);
        }
    }, [input.sessionId, openStackedPullRequestResult, beginLinkCapture, promptForFeatureBranchName, setBusySafe, setStatusSafe]);

    return {
        busy,
        status,
        viewPullRequest,
        openOrReusePullRequest,
        createFeatureBranch,
        createFeatureBranchAndOpenPullRequest,
    };
}

function isProviderOriginUrl(url: string, providerBaseUrl: string): boolean {
    try {
        return new URL(url).origin === new URL(providerBaseUrl).origin;
    } catch {
        return false;
    }
}
