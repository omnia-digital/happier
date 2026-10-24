import { describe, expect, it, vi } from 'vitest';
import { createDaemonControlApp } from './controlServer';

describe('daemon session-created report contract', () => {
  it('carries the child server resolution only when supplied and validates its value', async () => {
    const onHappySessionWebhook = vi.fn(async () => {});
    const app = createDaemonControlApp({
      getChildren: () => [],
      machineId: 'machine-a',
      stopSession: async () => ({ status: 'not_found' as const }),
      spawnSession: async () => ({ type: 'success' as const, sessionId: 'session-a' }),
      requestShutdown: () => {},
      onHappySessionWebhook,
      controlToken: 'test-token',
    });
    const post = async (payload: Record<string, unknown>) => await app.inject({
      method: 'POST', url: '/session-started',
      headers: { 'Content-Type': 'application/json', 'x-happier-daemon-token': 'test-token' },
      payload: JSON.stringify({ sessionId: 'session-a', metadata: {}, ...payload }),
    });
    try {
      await app.ready();
      expect((await post({ creationResolution: 'created', creationAccountId: 'account-a' })).statusCode).toBe(200);
      expect(onHappySessionWebhook).toHaveBeenLastCalledWith('session-a', {}, 'created', 'account-a');
      expect((await post({})).statusCode).toBe(200);
      expect(onHappySessionWebhook).toHaveBeenLastCalledWith('session-a', {}, undefined, undefined);
      expect((await post({ creationResolution: 'maybe' })).statusCode).toBe(400);
      expect((await post({ creationResolution: 'created', creationAccountId: '' })).statusCode).toBe(400);
      expect(onHappySessionWebhook).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});
