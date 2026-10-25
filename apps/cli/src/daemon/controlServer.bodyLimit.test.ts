import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';
import { SPAWN_SESSION_ERROR_CODES } from '@/rpc/handlers/registerSessionHandlers';
import { logger } from '@/ui/logger';
import { createDaemonControlApp } from './controlServer';
import { createOnHappySessionWebhook } from './sessions/onHappySessionWebhook';
import type { TrackedSession } from './types';

describe('createDaemonControlApp /session-started body limit', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('accepts large session-started metadata payloads', async () => {
        const onHappySessionWebhook = vi.fn();
        const app = createDaemonControlApp({
            getChildren: () => [],
            machineId: 'machine-1',
            stopSession: vi.fn(async () => ({ status: 'stopped' as const })),
            spawnSession: vi.fn(async () => ({
                type: 'error' as const,
                errorCode: SPAWN_SESSION_ERROR_CODES.UNEXPECTED,
                errorMessage: 'unused',
            })),
            requestShutdown: vi.fn(),
            onHappySessionWebhook,
            controlToken: 'control-token',
        });

        try {
            const metadata: Metadata = {
                path: '/test/large-path',
                host: 'test-host',
                homeDir: '/test/home',
                happyHomeDir: '/test/happy-home',
                happyLibDir: '/test/happy-lib',
                happyToolsDir: '/test/happy-tools',
                hostPid: 99998,
                startedBy: 'terminal',
                machineId: 'test-machine-large',
                summary: {
                    text: 'x'.repeat(2 * 1024 * 1024),
                    updatedAt: Date.now(),
                },
            };

            const response = await app.inject({
                method: 'POST',
                url: '/session-started',
                headers: {
                    'x-happier-daemon-token': 'control-token',
                },
                payload: {
                    sessionId: 'test-session-large',
                    metadata,
                },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ status: 'ok' });
            expect(onHappySessionWebhook.mock.calls[0]?.slice(0, 2)).toEqual(['test-session-large', metadata]);
        } finally {
            await app.close();
        }
    });

    it('waits for post-registration readiness and returns a retryable response when reconciliation fails', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
        let rejectReadiness!: (error: Error) => void;
        const readiness = new Promise<void>((_resolve, reject) => {
            rejectReadiness = reject;
        });
        const onHappySessionWebhook = vi.fn(async () => await readiness);
        const app = createDaemonControlApp({
            getChildren: () => [],
            machineId: 'machine-1',
            stopSession: vi.fn(async () => ({ status: 'stopped' as const })),
            spawnSession: vi.fn(async () => ({
                type: 'error' as const,
                errorCode: SPAWN_SESSION_ERROR_CODES.UNEXPECTED,
                errorMessage: 'unused',
            })),
            requestShutdown: vi.fn(),
            onHappySessionWebhook,
            controlToken: 'control-token',
        });

        try {
            let responseSettled = false;
            const responsePromise = app.inject({
                method: 'POST',
                url: '/session-started',
                headers: { 'x-happier-daemon-token': 'control-token' },
                payload: {
                    sessionId: 'session-readiness-failure',
                    metadata: {
                        path: '/test/path',
                        host: 'test-host',
                        homeDir: '/test/home',
                        happyHomeDir: '',
                        happyLibDir: '/test/happy-lib',
                        happyToolsDir: '/test/happy-tools',
                        hostPid: 99996,
                        startedBy: 'daemon',
                        machineId: 'machine-1',
                    } satisfies Metadata,
                },
            }).then((response) => {
                responseSettled = true;
                return response;
            });

            await vi.waitFor(() => expect(onHappySessionWebhook).toHaveBeenCalledOnce());
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(responseSettled).toBe(false);

            rejectReadiness(new Error('runtime reconciliation failed'));
            const response = await responsePromise;
            expect(response.statusCode).toBe(503);
            expect(response.json()).toEqual({
                status: 'error',
                errorCode: 'session_startup_reconciliation_failed',
            });
        } finally {
            await app.close();
        }
    });

    it('tracks the session before acknowledging readiness without waiting for best-effort observers or markers', async () => {
        const tracked: TrackedSession = { pid: 99997, startedBy: 'daemon' };
        const awaiter = vi.fn();
        let resolveReadiness!: () => void;
        const readiness = new Promise<void>((resolve) => {
            resolveReadiness = resolve;
        });
        let resolveMarker!: () => void;
        const marker = new Promise<void>((resolve) => {
            resolveMarker = resolve;
        });
        const writeSessionMarkerFn = vi.fn(async () => await marker);
        const onTrackedSessionReady = vi.fn(async () => await readiness);
        const onHappySessionWebhook = createOnHappySessionWebhook({
            pidToTrackedSession: new Map([[tracked.pid, tracked]]),
            pidToAwaiter: new Map([[tracked.pid, awaiter]]),
            findHappyProcessByPidFn: async () => null,
            writeSessionMarkerFn,
            onTrackedSessionReady,
            onTrackedSessionReported: () => {
                throw new ReferenceError('optional observer is unavailable');
            },
        });
        const app = createDaemonControlApp({
            getChildren: () => [tracked],
            machineId: 'machine-1',
            stopSession: vi.fn(async () => ({ status: 'stopped' as const })),
            spawnSession: vi.fn(async () => ({
                type: 'error' as const,
                errorCode: SPAWN_SESSION_ERROR_CODES.UNEXPECTED,
                errorMessage: 'unused',
            })),
            requestShutdown: vi.fn(),
            onHappySessionWebhook,
            controlToken: 'control-token',
        });

        try {
            let responseSettled = false;
            const responsePromise = app.inject({
                method: 'POST',
                url: '/session-started',
                headers: { 'x-happier-daemon-token': 'control-token' },
                payload: {
                    sessionId: 'session-observer-failure',
                    metadata: {
                        path: '/test/path',
                        host: 'test-host',
                        homeDir: '/test/home',
                        happyHomeDir: '',
                        happyLibDir: '/test/happy-lib',
                        happyToolsDir: '/test/happy-tools',
                        hostPid: tracked.pid,
                        startedBy: 'daemon',
                        machineId: 'machine-1',
                    } satisfies Metadata,
                },
            }).then((response) => {
                responseSettled = true;
                return response;
            });

            await vi.waitFor(() => expect(onTrackedSessionReady).toHaveBeenCalledOnce());
            expect(tracked.happySessionId).toBe('session-observer-failure');
            expect(awaiter).toHaveBeenCalledWith(tracked);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(responseSettled).toBe(false);

            resolveReadiness();
            const response = await responsePromise;
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ status: 'ok' });
            await vi.waitFor(() => expect(writeSessionMarkerFn).toHaveBeenCalledOnce());
            expect(responseSettled).toBe(true);
        } finally {
            resolveReadiness();
            resolveMarker();
            await app.close();
        }
    });

});
