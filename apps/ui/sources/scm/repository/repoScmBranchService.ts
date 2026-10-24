import type { ScmBranchListEntry } from '@happier-dev/protocol';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

import { machineScmBranchList } from '@/sync/ops/scm/machineScm';
import { sessionScmBranchList } from '@/sync/ops';
import { resolveRepoScmMachinePathRequest } from './resolveRepoScmMachinePathRequest';
import { resolveRepoScmSessionRequest } from './resolveRepoScmSessionRequest';

export class RepoScmBranchService {
    private branchCache = new Map<string, ReadonlyArray<ScmBranchListEntry>>();
    private branchRequests = new Map<string, Promise<ReadonlyArray<ScmBranchListEntry>>>();
    private branchRequestGenerations = new Map<string, number>();

    private createRequestKey(repoIdentityKey: string, includeRemotes: boolean, scope?: ServerAccountScope): string {
        return JSON.stringify(['repoScmBranches', scope?.serverId, scope?.accountId, repoIdentityKey, includeRemotes]);
    }

    private readRequestGeneration(requestKey: string): number {
        return this.branchRequestGenerations.get(requestKey) ?? 0;
    }

    private async fetchBranchesForRepoIdentity(
        requestKey: string,
        loader: () => Promise<ReadonlyArray<ScmBranchListEntry>>,
    ): Promise<ReadonlyArray<ScmBranchListEntry>> {
        const existingRequest = this.branchRequests.get(requestKey);
        if (existingRequest) {
            return await existingRequest;
        }

        const requestGeneration = this.readRequestGeneration(requestKey);
        const requestPromise = (async () => {
            const branches = await loader();
            if (this.readRequestGeneration(requestKey) === requestGeneration) {
                this.branchCache.set(requestKey, branches);
            }
            return branches;
        })();

        this.branchRequests.set(requestKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            if (this.branchRequests.get(requestKey) === requestPromise) {
                this.branchRequests.delete(requestKey);
            }
        }
    }

    async fetchBranchesForMachinePath(input: Readonly<{
        scope?: ServerAccountScope;
        machineId: string;
        path: string;
        includeRemotes?: boolean;
    }>): Promise<ReadonlyArray<ScmBranchListEntry>> {
        const request = resolveRepoScmMachinePathRequest(input);
        if (!request) {
            return [];
        }

        const includeRemotes = input.includeRemotes === true;
        const requestKey = this.createRequestKey(request.repoIdentityKey, includeRemotes, input.scope);
        return await this.fetchBranchesForRepoIdentity(requestKey, async () => {
            const branchRequest = {
                cwd: request.resolvedPath,
                includeRemotes,
            };
            const response = input.scope
                ? await machineScmBranchList(request.machineId, branchRequest, input.scope)
                : await machineScmBranchList(request.machineId, branchRequest);
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch source-control branches');
            }

            return response.branches ?? [];
        });
    }

    async fetchBranchesForSession(input: Readonly<{
        sessionId: string;
        includeRemotes?: boolean;
    }>): Promise<ReadonlyArray<ScmBranchListEntry>> {
        const request = resolveRepoScmSessionRequest({ sessionId: input.sessionId });
        if (!request) {
            return [];
        }

        const includeRemotes = input.includeRemotes === true;
        const requestKey = this.createRequestKey(request.repoIdentityKey, includeRemotes);
        return await this.fetchBranchesForRepoIdentity(requestKey, async () => {
            if (request.machineId) {
                const response = await machineScmBranchList(request.machineId, {
                    cwd: request.resolvedPath,
                    includeRemotes,
                });
                if (response.success) {
                    return response.branches ?? [];
                }
            }

            const response = await sessionScmBranchList(input.sessionId, { includeRemotes });
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch source-control branches');
            }
            return response.branches ?? [];
        });
    }

    readCachedBranchesForMachinePath(input: Readonly<{
        scope?: ServerAccountScope;
        machineId: string;
        path: string;
        includeRemotes?: boolean;
    }>): ReadonlyArray<ScmBranchListEntry> {
        const request = resolveRepoScmMachinePathRequest(input);
        if (!request) {
            return [];
        }

        return this.branchCache.get(
            this.createRequestKey(request.repoIdentityKey, input.includeRemotes === true, input.scope),
        ) ?? [];
    }

    readCachedBranchesForSession(input: Readonly<{
        sessionId: string;
        includeRemotes?: boolean;
    }>): ReadonlyArray<ScmBranchListEntry> {
        const request = resolveRepoScmSessionRequest({ sessionId: input.sessionId });
        if (!request) {
            return [];
        }

        return this.branchCache.get(
            this.createRequestKey(request.repoIdentityKey, input.includeRemotes === true),
        ) ?? [];
    }

    invalidateBranchesForSession(input: Readonly<{
        sessionId: string;
    }>): void {
        const request = resolveRepoScmSessionRequest({ sessionId: input.sessionId });
        if (!request) {
            return;
        }

        for (const includeRemotes of [false, true]) {
            const requestKey = this.createRequestKey(request.repoIdentityKey, includeRemotes);
            this.branchRequests.delete(requestKey);
            this.branchRequestGenerations.set(requestKey, this.readRequestGeneration(requestKey) + 1);
        }
    }
}

export const repoScmBranchService = new RepoScmBranchService();
