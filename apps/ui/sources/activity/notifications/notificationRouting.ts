import { isLoopbackHostname, PUSH_NOTIFICATION_ACTION_IDS } from '@happier-dev/protocol';

import { normalizeServerUrl } from '@/sync/domains/server/activeServerSwitch';
import { coerceRelativeRoute } from '@/utils/path/routeUtils';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUnsafeNotificationServerUrl(serverUrl: string): boolean {
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized) return true;
    try {
        const url = new URL(normalized);
        const host = url.hostname.trim().toLowerCase();
        return isLoopbackHostname(host) || host === '0.0.0.0';
    } catch {
        return true;
    }
}

function extractServerUrlFromNotificationData(data: unknown): string | null {
    if (!isRecord(data)) return null;
    const serverUrl =
        typeof data.serverUrl === 'string'
            ? data.serverUrl
            : typeof data.server === 'string'
                ? data.server
                : '';
    const normalized = normalizeServerUrl(serverUrl);
    return normalized ? normalized : null;
}

function toRoute(data: unknown): Readonly<{ route: string | null; routeSessionId: string | null }> {
    if (!isRecord(data)) return { route: null, routeSessionId: null };
    if (typeof data.url === 'string' && data.url.trim()) {
        return { route: coerceRelativeRoute(data.url), routeSessionId: null };
    }
    if (typeof data.sessionId === 'string' && data.sessionId.trim()) {
        return { route: `/session/${encodeURIComponent(data.sessionId)}`, routeSessionId: data.sessionId };
    }
    return { route: null, routeSessionId: null };
}

function readSessionIdFromNotificationData(data: unknown): string {
    if (!isRecord(data)) return '';
    const raw = typeof data.sessionId === 'string' ? data.sessionId : '';
    return raw.trim();
}

function readRequestIdFromNotificationData(data: unknown): string {
    if (!isRecord(data)) return '';
    const raw =
        typeof data.requestId === 'string'
            ? data.requestId
            : typeof data.permissionId === 'string'
                ? data.permissionId
                : '';
    return raw.trim();
}

function readNotificationActionIdentifier(params: Readonly<{
    response: unknown;
    defaultActionIdentifier: string;
}>): string {
    if (!isRecord(params.response)) return params.defaultActionIdentifier;
    const raw = typeof params.response.actionIdentifier === 'string' ? params.response.actionIdentifier : '';
    return raw.trim() || params.defaultActionIdentifier;
}

function readNotificationId(params: Readonly<{ response: unknown }>): string | null {
    if (!isRecord(params.response)) return null;
    const notification = (params.response as any).notification;
    const identifier = notification?.request?.identifier;
    const raw = typeof identifier === 'string' ? identifier : '';
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
}

function readNotificationData(params: Readonly<{ response: unknown }>): unknown {
    if (!isRecord(params.response)) return null;
    const notification = params.response.notification;
    if (!isRecord(notification) || !isRecord(notification.request) || !isRecord(notification.request.content)) return null;
    const content = notification.request.content;
    if (typeof content.dataString === 'string') {
        try { return JSON.parse(content.dataString); } catch { return null; }
    }
    return content.data;
}

export type ParsedNotificationTap = Readonly<{
    dedupeKey: string | null;
    actionIdentifier: string;
    isDefaultTap: boolean;
    isOpenAction: boolean;
    route: string | null;
    routeSessionId: string | null;
    serverUrl: string | null;
    accountId: string | null;
    permissionAction: Readonly<{ action: 'allow' | 'deny'; sessionId: string; requestId: string; occurrenceId?: string }> | null;
}>;

export function parseNotificationTap(params: Readonly<{
    response: unknown;
    defaultActionIdentifier: string;
}>): ParsedNotificationTap | null {
    const actionIdentifier = readNotificationActionIdentifier(params);
    const isDefaultTap = actionIdentifier === params.defaultActionIdentifier;
    const permissionAction =
        actionIdentifier === PUSH_NOTIFICATION_ACTION_IDS.permissionAllowV1
            ? ('allow' as const)
            : actionIdentifier === PUSH_NOTIFICATION_ACTION_IDS.permissionDenyV1
                ? ('deny' as const)
                : null;

    const isOpenAction = isDefaultTap || actionIdentifier === PUSH_NOTIFICATION_ACTION_IDS.userActionOpenV1;
    const isKnownActionIdentifier = isOpenAction || permissionAction !== null;
    if (!isKnownActionIdentifier) return null;

    const data = readNotificationData({ response: params.response });
    const { route, routeSessionId } = toRoute(data);
    const serverUrl = extractServerUrlFromNotificationData(data);

    const sessionId = readSessionIdFromNotificationData(data);
    const requestId = readRequestIdFromNotificationData(data);
    const occurrenceId = isRecord(data) && typeof data.occurrenceId === 'string' ? data.occurrenceId.trim() : '';
    const resolvedPermissionAction =
        permissionAction && sessionId && requestId
            ? { action: permissionAction, sessionId, requestId, ...(occurrenceId ? { occurrenceId } : {}) }
            : null;

    const notificationId = readNotificationId({ response: params.response });
    const dedupeKey = notificationId ? `${notificationId}:${actionIdentifier}` : null;

    return {
        dedupeKey,
        actionIdentifier,
        isDefaultTap,
        isOpenAction,
        route,
        routeSessionId,
        serverUrl,
        accountId: isRecord(data) && typeof data.accountId === 'string' ? data.accountId.trim() : null,
        permissionAction: resolvedPermissionAction,
    };
}
