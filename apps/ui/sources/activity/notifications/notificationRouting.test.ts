import { describe, expect, it } from 'vitest';
import { PUSH_NOTIFICATION_ACTION_IDS } from '@happier-dev/protocol';

import { isUnsafeNotificationServerUrl, parseNotificationTap } from './notificationRouting';

describe('notification server URL safety', () => {
    it('rejects every loopback form that another device cannot reach', () => {
        expect(isUnsafeNotificationServerUrl('http://127.0.0.2:3005')).toBe(true);
        expect(isUnsafeNotificationServerUrl('http://relay.localhost:3005')).toBe(true);
        expect(isUnsafeNotificationServerUrl('https://machine.tailnet.ts.net')).toBe(false);
    });
});

describe('permission notification identity', () => {
    it('retains the original account and request occurrence for a permission button', () => {
        const parsed = parseNotificationTap({
            defaultActionIdentifier: 'default',
            response: {
                actionIdentifier: PUSH_NOTIFICATION_ACTION_IDS.permissionAllowV1,
                notification: {
                    request: {
                        identifier: 'notification-1',
                        content: { data: {
                            sessionId: 'session-1', requestId: 'request-1', occurrenceId: 'occurrence-1',
                            accountId: 'account-a', serverUrl: 'https://relay.example.test',
                        } },
                    },
                },
            },
        });
        expect(parsed?.permissionAction).toMatchObject({ requestId: 'request-1', occurrenceId: 'occurrence-1' });
        expect(parsed?.accountId).toBe('account-a');
    });
});
