import { describe, expect, it, vi } from 'vitest';

import { accountSettingsParse } from '@happier-dev/protocol';
import { PushNotificationClient } from '@/api/pushNotifications';

import type { Session } from '../session';
import { createPermissionHandlerSessionStubWithMetadata } from './permissionHandler.testkit';
import { PermissionHandler } from './permissionHandler';

function createSessionStub(sendToAllDevicesAsync: ReturnType<typeof vi.fn>): Session {
  const { session } = createPermissionHandlerSessionStubWithMetadata({
    sessionId: 's1', metadata: { flavor: 'claude', summary: { text: 'Refactor auth flow' } },
  });
  const pushSender = new PushNotificationClient('test-token');
  vi.spyOn(pushSender, 'sendToAllDevicesAsync').mockImplementation(sendToAllDevicesAsync);
  session.pushSender = pushSender;
  return session;
}

describe('Claude PermissionHandler push policy', () => {
  it('suppresses permission-request pushes when disabled in account settings', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const session = createSessionStub(sendToAllDevicesAsync);
    session.accountSettings = accountSettingsParse({
      notificationsSettingsV1: { v: 1, pushEnabled: true, ready: true, permissionRequest: false },
    });
    const handler = new PermissionHandler(session);

    const controller = new AbortController();
    handler.onMessage({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tool1', name: 'Read', input: { path: 'a' } }],
      },
    } as any);

    const promise = handler.handleToolCall('Read', { path: 'a' }, { permissionMode: 'default' } as any, { signal: controller.signal });
    await vi.waitFor(() => expect(session.client.getAgentStateSnapshot?.()?.requests?.tool1).toBeDefined());
    await Promise.resolve();
    await Promise.resolve();
    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
    controller.abort();
    await expect(promise).rejects.toBeTruthy();
  });

  it('sends permission-request pushes when enabled in account settings', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const session = createSessionStub(sendToAllDevicesAsync);
    session.accountSettings = accountSettingsParse({
      notificationsSettingsV1: { v: 1, pushEnabled: true, ready: true, permissionRequest: true },
    });
    const handler = new PermissionHandler(session);

    const controller = new AbortController();
    handler.onMessage({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tool1', name: 'Read', input: { path: 'a' } }],
      },
    } as any);

    const promise = handler.handleToolCall('Read', { path: 'a' }, { permissionMode: 'default' } as any, { signal: controller.signal });
    await vi.waitFor(() => expect(sendToAllDevicesAsync).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(promise).rejects.toBeTruthy();
    expect(sendToAllDevicesAsync).toHaveBeenCalledWith(
      'Refactor auth flow',
      expect.stringContaining('Claude Code CLI asks permission to use Read'),
      expect.objectContaining({ sessionId: 's1', requestId: 'tool1' }),
    );
  });

  it('sends one permission-request push for duplicate same-id waiters', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const session = createSessionStub(sendToAllDevicesAsync);
    session.accountSettings = accountSettingsParse({
      notificationsSettingsV1: { v: 1, pushEnabled: true, ready: true, permissionRequest: true },
    });
    const handler = new PermissionHandler(session);

    const firstController = new AbortController();
    const secondController = new AbortController();
    const input = { path: 'a' };

    const first = handler.handleToolCall('Read', input, { permissionMode: 'default' } as any, {
      signal: firstController.signal,
      toolUseId: 'tool1',
    });
    const second = handler.handleToolCall('Read', input, { permissionMode: 'default' } as any, {
      signal: secondController.signal,
      toolUseId: 'tool1',
    });

    await vi.waitFor(() => expect(sendToAllDevicesAsync).toHaveBeenCalledTimes(1));
    firstController.abort();
    secondController.abort();
    await expect(first).rejects.toBeTruthy();
    await expect(second).rejects.toBeTruthy();
    expect(sendToAllDevicesAsync).toHaveBeenCalledTimes(1);
  });
});
