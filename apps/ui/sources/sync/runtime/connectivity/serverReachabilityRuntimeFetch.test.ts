import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectedServiceIdSchema } from '@happier-dev/protocol';

afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_WAIT_TIMEOUT_MS;
    try {
        const { resetServerReachabilitySupervisors } = await import('./serverReachabilitySupervisorPool');
        await resetServerReachabilitySupervisors();
    } catch {
        // ignore
    }
    vi.resetModules();
    vi.clearAllMocks();
});

describe('runtimeFetchWithServerReachability', () => {
    it('refuses authenticated cross-origin requests (prevents token leakage)', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_WAIT_TIMEOUT_MS = '5';

        const runtimeFetchMock = vi.fn(async () => {
            throw new Error('Unexpected runtimeFetch call');
        });
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock,
            resetRuntimeFetch: () => {},
            setRuntimeFetch: () => {},
        }));

        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        await expect(
            runtimeFetchWithServerReachability({
                serverUrl: 'https://api.example.test',
                token: 'token-a',
                url: 'https://other.example.test/v1/account/profile',
                init: {
                    method: 'GET',
                    headers: {
                        Authorization: 'Bearer token-a',
                    },
                },
            }),
        ).rejects.toThrow('Refused authenticated request');

        expect(runtimeFetchMock).not.toHaveBeenCalled();
    });

    it('redacts URLs in authenticated request errors (prevents query-string leakage)', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_WAIT_TIMEOUT_MS = '5';

        const runtimeFetchMock = vi.fn(async () => {
            throw new Error('Unexpected runtimeFetch call');
        });
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock,
            resetRuntimeFetch: () => {},
            setRuntimeFetch: () => {},
        }));

        const secret = 'super-secret-token';

        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        let thrown: unknown = null;
        try {
            await runtimeFetchWithServerReachability({
                serverUrl: `file:///tmp/server?token=${secret}`,
                token: 'token-a',
                url: `file:///tmp/target?token=${secret}`,
                init: { method: 'GET' },
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('Refused authenticated request');
        expect((thrown as Error).message).not.toContain(secret);

        expect(runtimeFetchMock).not.toHaveBeenCalled();
    });

    it('returns the response once reachability is online', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_WAIT_TIMEOUT_MS = '50';

        const runtimeFetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
            const url = typeof input === 'string' ? input : String(input);
            if (url.endsWith('/health')) {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            if (new URL(url).pathname === '/v1/account/profile') {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            return new Response(null, { status: 200, headers: new Headers() });
        });
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock,
            resetRuntimeFetch: () => {},
            setRuntimeFetch: () => {},
        }));

        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        const response = await runtimeFetchWithServerReachability({
            serverUrl: 'https://api.example.test',
            token: 'token-a',
            url: 'https://api.example.test/v1/account/profile',
            init: {
                method: 'GET',
                headers: {
                    Authorization: 'Bearer token-a',
                },
            },
        });

        expect(response.ok).toBe(true);
        expect(runtimeFetchMock.mock.calls.some(([input]) => String(input).endsWith('/v1/auth/ping'))).toBe(true);
        const profileCall = runtimeFetchMock.mock.calls.find(([input]) => new URL(String(input)).pathname === '/v1/account/profile');
        expect(profileCall).toBeDefined();
        expect(JSON.parse(new URL(String(profileCall?.[0])).searchParams.get('happierConnectedServices') ?? 'null')).toEqual(ConnectedServiceIdSchema.options);
        const profileHeaders = new Headers(profileCall?.[1]?.headers);
        expect(profileHeaders.get('x-happier-session-sync-protocol')).toBeNull();
    });

    it('does not send a remote archive after its admission is revoked during reachability preparation', async () => {
        const runtimeFetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(null, { status: 200 }));
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock, resetRuntimeFetch: () => {}, setRuntimeFetch: () => {},
        }));
        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        const assertion = vi.fn(() => { throw new Error('Archive admission is no longer current'); });
        await expect(runtimeFetchWithServerReachability({
            serverUrl: 'https://api.example.test', token: 'token-a',
            url: 'https://api.example.test/v2/sessions/s1/archive',
            init: { method: 'POST', headers: { Authorization: 'Bearer token-a' } },
            assertCurrent: assertion,
        })).rejects.toThrow('Archive admission is no longer current');
        expect(assertion).toHaveBeenCalledTimes(1);
        expect(runtimeFetchMock.mock.calls.filter(([url]) => String(url).includes('/v2/sessions/s1/archive'))).toHaveLength(0);
    });

    it('uses the Bearer token from Authorization header for reachability probing when token param is null', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_WAIT_TIMEOUT_MS = '50';

        const runtimeFetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : String(input);
            if (url.endsWith('/health')) {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            if (url.endsWith('/v1/auth/ping')) {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            if (new URL(url).pathname === '/v1/account/profile') {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            return new Response(null, { status: 200, headers: new Headers() });
        });
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock,
            resetRuntimeFetch: () => {},
            setRuntimeFetch: () => {},
        }));

        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        const response = await runtimeFetchWithServerReachability({
            serverUrl: 'https://api.example.test',
            token: null,
            url: 'https://api.example.test/v1/account/profile',
            init: {
                method: 'GET',
                headers: {
                    Authorization: 'Bearer token-a',
                },
            },
        });

        expect(response.ok).toBe(true);
        // The probe only reaches the authenticated route when a token was resolved — here from the
        // Authorization header — and the unauthenticated health check is skipped once one exists.
        expect(runtimeFetchMock.mock.calls.some(([input]) => String(input).endsWith('/v1/auth/ping'))).toBe(true);
        expect(runtimeFetchMock.mock.calls.some(([input]) => String(input).endsWith('/health'))).toBe(false);
    });

    it('marks the server offline when the main request fails', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_WAIT_TIMEOUT_MS = '50';

        const runtimeFetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : String(input);
            if (url.endsWith('/health')) {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            if (new URL(url).pathname === '/v1/account/profile') {
                throw new TypeError('Network request failed');
            }
            return new Response(null, { status: 200, headers: new Headers() });
        });
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock,
            resetRuntimeFetch: () => {},
            setRuntimeFetch: () => {},
        }));

        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        await expect(
            runtimeFetchWithServerReachability({
                serverUrl: 'https://api.example.test',
                token: 'token-a',
                url: 'https://api.example.test/v1/account/profile',
                init: {
                    method: 'GET',
                    headers: {
                        Authorization: 'Bearer token-a',
                    },
                },
            }),
        ).rejects.toThrow('Network request failed');

        const { subscribeServerReachabilityState } = await import('./serverReachabilitySupervisorPool');
        let latestPhase: string | null = null;
        const unsubscribe = subscribeServerReachabilityState('https://api.example.test', (state) => {
            latestPhase = state.phase;
        });
        unsubscribe();

        expect(latestPhase).toBe('offline');
    });

    it('marks the server auth_failed when an authenticated main request returns 401', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_WAIT_TIMEOUT_MS = '50';

        const runtimeFetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : String(input);
            if (url.endsWith('/health')) {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            if (url.endsWith('/v1/auth/ping')) {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            if (new URL(url).pathname === '/v1/account/profile') {
                return new Response(null, { status: 401, headers: new Headers() });
            }
            return new Response(null, { status: 200, headers: new Headers() });
        });
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock,
            resetRuntimeFetch: () => {},
            setRuntimeFetch: () => {},
        }));

        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        const response = await runtimeFetchWithServerReachability({
            serverUrl: 'https://api.example.test',
            token: 'token-a',
            url: 'https://api.example.test/v1/account/profile',
            init: {
                method: 'GET',
                headers: {
                    Authorization: 'Bearer token-a',
                },
            },
        });

        expect(response.status).toBe(401);

        const { subscribeServerReachabilityState } = await import('./serverReachabilitySupervisorPool');
        let latestPhase: string | null = null;
        const unsubscribe = subscribeServerReachabilityState('https://api.example.test', (state) => {
            latestPhase = state.phase;
        });
        unsubscribe();

        expect(latestPhase).toBe('auth_failed');
    });

    it('rejects authenticated requests when the request URL origin differs from the serverUrl origin', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_WAIT_TIMEOUT_MS = '50';

        const runtimeFetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : String(input);
            if (url.endsWith('/health')) {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            if (url.endsWith('/v1/auth/ping')) {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            if (new URL(url).pathname === '/v1/account/profile') {
                return new Response(null, { status: 200, headers: new Headers() });
            }
            return new Response(null, { status: 200, headers: new Headers() });
        });
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock,
            resetRuntimeFetch: () => {},
            setRuntimeFetch: () => {},
        }));

        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        await expect(
            runtimeFetchWithServerReachability({
                serverUrl: 'https://api.example.test',
                token: 'token-a',
                url: 'https://other.example.test/v1/account/profile',
                init: {
                    method: 'GET',
                    headers: {
                        Authorization: 'Bearer token-a',
                    },
                },
            }),
        ).rejects.toThrow(/refused authenticated request/i);
    });

    it('rejects authenticated requests when the request URL is not a valid absolute URL', async () => {
        const runtimeFetchMock = vi.fn(async () => {
            throw new Error('runtimeFetch should not be called');
        });
        vi.doMock('@/utils/system/runtimeFetch', () => ({
            runtimeFetch: runtimeFetchMock,
            resetRuntimeFetch: () => {},
            setRuntimeFetch: () => {},
        }));

        const { runtimeFetchWithServerReachability } = await import('./serverReachabilityRuntimeFetch');
        const thrown = await runtimeFetchWithServerReachability({
            serverUrl: 'https://admin:secret@example.com:8443/path?token=abc#frag',
            token: 'token-a',
            url: 'https://[::1',
            init: {
                method: 'GET',
                headers: {
                    Authorization: 'Bearer token-a',
                },
            },
        }).catch((error) => error);

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toMatch(/refused authenticated request/i);
        expect((thrown as Error).message).not.toContain('admin:secret');
        expect((thrown as Error).message).not.toContain('token=abc');

        expect(runtimeFetchMock).not.toHaveBeenCalled();
    });
});
