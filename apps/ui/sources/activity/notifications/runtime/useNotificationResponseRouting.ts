import { router } from 'expo-router';
import * as React from 'react';
import { Platform } from 'react-native';

import { normalizeServerUrl, setActiveServerAndSwitch, upsertActivateAndSwitchServer } from '@/sync/domains/server/activeServerSwitch';
import { getActiveServerUrl, listServerProfiles } from '@/sync/domains/server/serverProfiles';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { clearPendingNotificationNav, getPendingNotificationNav, setPendingNotificationNav } from '@/sync/domains/pending/pendingNotificationNav';
import {
    clearPendingNotificationAction,
    getPendingNotificationAction,
} from '@/sync/domains/pending/pendingNotificationAction';
import { loadExpoNotifications, type ExpoNotificationsModule } from '@/utils/platform/loadExpoNotifications';
import { navigateToSessionRoute } from '@/hooks/session/navigateToSessionRoute';

import { isUnsafeNotificationServerUrl, parseNotificationTap } from '../notificationRouting';
import { resolveNotificationPermissionTarget } from './resolveNotificationPermissionTarget';
import { isSessionPermissionDecisionAccepted, sessionPermissionDecisionWithServerAccountScope } from '@/sync/ops/sessionPermissionDecision';

type ExpoNotificationsWithClear = ExpoNotificationsModule & Readonly<{
    clearLastNotificationResponseAsync?: () => Promise<void>;
}>;

function findSavedServerProfileForUrl(serverUrl: string): { id: string; serverUrl: string } | null {
    const targetKey = createServerUrlComparableKey(serverUrl);
    if (!targetKey) return null;
    for (const profile of listServerProfiles()) {
        if (createServerUrlComparableKey(profile.serverUrl) === targetKey) {
            return { id: profile.id, serverUrl: profile.serverUrl };
        }
    }
    return null;
}

export function useNotificationResponseRouting(params: Readonly<{
    enabled: boolean;
    refreshAuth: () => Promise<void>;
}>): void {
    const handledNotificationResponseKeysRef = React.useRef<Set<string>>(new Set());
    const refreshAuthRef = React.useRef(params.refreshAuth);

    React.useEffect(() => {
        refreshAuthRef.current = params.refreshAuth;
    }, [params.refreshAuth]);

    React.useEffect(() => {
        if (!params.enabled) {
            handledNotificationResponseKeysRef.current.clear();
            return;
        }

        if (Platform.OS === 'web') return;

        const pendingAction = getPendingNotificationAction();
        if (pendingAction) {
            // Historical persisted records have no occurrence or account identity.
            clearPendingNotificationAction();
            const saved = findSavedServerProfileForUrl(pendingAction.serverUrl);
            if (saved) {
                try {
                    navigateToSessionRoute({ router, sessionId: pendingAction.sessionId, serverId: saved.id, refreshAuth: refreshAuthRef.current });
                } catch {
                    console.warn('[notifications] Saved permission request could not open for review');
                }
                return;
            }
        }

        const pending = getPendingNotificationNav();
        if (pending) {
            const active = normalizeServerUrl(getActiveServerUrl());
            if (normalizeServerUrl(pending.serverUrl) === active) {
                clearPendingNotificationNav();
                router.push(pending.route);
                return;
            }
        }

        const maybeRedirectFromResponse = (response: unknown, defaultActionIdentifier: string) => {
            const parsed = parseNotificationTap({
                response,
                defaultActionIdentifier,
            });
            if (!parsed) return;

            if (parsed.dedupeKey) {
                const handled = handledNotificationResponseKeysRef.current;
                if (handled.size > 512) {
                    handled.clear();
                }
                if (handled.has(parsed.dedupeKey)) return;
                handled.add(parsed.dedupeKey);
            }

            if (!parsed.route) return;

            const route = parsed.route;
            const serverUrl = parsed.serverUrl;
            const savedServer = serverUrl ? findSavedServerProfileForUrl(serverUrl) : null;
            const routeToServerSettingsForUrl = (url: string) => {
                router.push(`/settings/server?url=${encodeURIComponent(url)}&source=notification`);
            };

            if (parsed.permissionAction) {
                const action = parsed.permissionAction;
                if (parsed.routeSessionId && serverUrl && savedServer) {
                    fireAndForget((async () => {
                        try {
                            if (!action.occurrenceId) {
                                console.warn('[notifications] Permission action has no occurrence; open request for review');
                            } else {
                                const scope = await resolveNotificationPermissionTarget(serverUrl, parsed.accountId);
                                if (!scope) {
                                    console.warn('[notifications] Permission action target unavailable; open request for review');
                                } else {
                                    const result = await sessionPermissionDecisionWithServerAccountScope({
                                        scope, sessionId: action.sessionId, requestId: action.requestId,
                                        occurrenceId: action.occurrenceId, action: action.action,
                                    });
                                    if (!isSessionPermissionDecisionAccepted(result)) {
                                        console.warn('[notifications] Permission action unconfirmed; open request for review');
                                    }
                                }
                            }
                        } catch {
                            console.warn('[notifications] Permission action failed; open request for review');
                        }
                        try {
                            navigateToSessionRoute({ router, sessionId: action.sessionId, serverId: savedServer.id, refreshAuth: refreshAuthRef.current });
                        } catch {
                            console.warn('[notifications] Permission request could not open for review');
                        }
                    })(), { tag: 'RootLayout.notificationAction.session' });
                    return;
                }
            }

            if (serverUrl) {
                const active = normalizeServerUrl(getActiveServerUrl());
                if (serverUrl !== active) {
                    const saved = findSavedServerProfileForUrl(serverUrl);
                    if (saved) {
                        setPendingNotificationNav({ serverUrl: saved.serverUrl, route });
                        fireAndForget((async () => {
                            try {
                                await setActiveServerAndSwitch({
                                    serverId: saved.id,
                                    scope: 'device',
                                    refreshAuth: refreshAuthRef.current,
                                });
                                clearPendingNotificationNav();
                                router.push(route);
                            } catch {
                                // keep pending notification nav as fallback
                            }
                        })(), { tag: 'RootLayout.notificationNav.savedServer' });
                        return;
                    }

                    if (isUnsafeNotificationServerUrl(serverUrl)) {
                        // Unsafe/mismatched server url: fail closed for actions; navigate only.
                        router.push(route);
                        return;
                    }

                    if (listServerProfiles().length === 0) {
                        setPendingNotificationNav({ serverUrl, route });
                        fireAndForget((async () => {
                            try {
                                await upsertActivateAndSwitchServer({
                                    serverUrl,
                                    source: 'notification',
                                    scope: 'device',
                                    refreshAuth: refreshAuthRef.current,
                                });
                                clearPendingNotificationNav();
                                router.push(route);
                            } catch {
                                // keep pending notification nav as fallback
                            }
                        })(), { tag: 'RootLayout.notificationNav.autoAddServer' });
                        return;
                    }
                    // Servers exist but the target isn't saved: redirect to server settings with a prefilled url.
                    setPendingNotificationNav({ serverUrl, route });
                    routeToServerSettingsForUrl(serverUrl);
                    return;
                }
            }

            if (parsed.isOpenAction || parsed.permissionAction) {
                router.push(route);
            }
        };

        let disposed = false;
        let subscription: { remove: () => void } | null = null;
        void loadExpoNotifications()
            .then((Notifications) => {
                if (disposed) return;
                const defaultActionIdentifier = Notifications.DEFAULT_ACTION_IDENTIFIER;
                void Notifications.getLastNotificationResponseAsync()
                    .then(async (response) => {
                        if (!response) return;
                        maybeRedirectFromResponse(response, defaultActionIdentifier);
                        const clearLastNotificationResponseAsync = (Notifications as ExpoNotificationsWithClear).clearLastNotificationResponseAsync;
                        if (typeof clearLastNotificationResponseAsync === 'function') {
                            await clearLastNotificationResponseAsync();
                        }
                    })
                    .catch(() => {});

                subscription = Notifications.addNotificationResponseReceivedListener((response) => {
                    maybeRedirectFromResponse(response, defaultActionIdentifier);
                });
            })
            .catch(() => {});

        return () => {
            disposed = true;
            subscription?.remove();
        };
    }, [params.enabled]);
}
