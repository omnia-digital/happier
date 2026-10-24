import {
    SESSION_LIST_ROW_HEIGHT_COMPACT,
    SESSION_LIST_ROW_HEIGHT_DEFAULT,
    SESSION_LIST_ROW_HEIGHT_MINIMAL,
    SESSION_LIST_ROW_HEIGHT_MINIMAL_NATIVE_PHONE,
} from './sessionListRowHeights';
import { ITEM_ROW_MIN_HEIGHT } from '@/components/ui/lists/itemDensityMetrics';

export type SessionListRowPlatform = 'ios' | 'android' | 'web' | 'windows' | 'macos';
export type SessionListRowDensity = 'default' | 'compact' | 'minimal';

export const SESSION_LIST_ROW_CORNER_RADIUS = 12;

export const SESSION_LIST_ROW_TITLE_TEXT_METRICS = {
    default: { fontSize: 14, lineHeight: 18 },
    compact: { fontSize: 14, lineHeight: 18 },
    minimal: { fontSize: 12, lineHeight: 16 },
    minimalNativePhone: { fontSize: 14, lineHeight: 18 },
} as const;

export const SESSION_LIST_ROW_STATUS_TEXT_METRICS = {
    default: { fontSize: 12, lineHeight: 16 },
    compact: { fontSize: 11, lineHeight: 11 },
    minimal: { fontSize: 10, lineHeight: 12 },
} as const;

export const SESSION_LIST_ROW_IDENTITY_METRICS = {
    default: { slotSize: 48, agentLogoSize: 37, trailingAgentLogoSize: 17 },
    compact: { slotSize: 30, agentLogoSize: 23, trailingAgentLogoSize: 15 },
    minimal: { slotSize: 18, agentLogoSize: 14, trailingAgentLogoSize: 14 },
    minimalNativePhone: { slotSize: 20, agentLogoSize: 16, trailingAgentLogoSize: 14 },
} as const;

export function resolveSessionListRowTitleTextMetrics(params: Readonly<{
    density: SessionListRowDensity;
    readableNativePhoneMinimal: boolean;
}>): Readonly<{ fontSize: number; lineHeight: number }> {
    if (params.density === 'minimal' && params.readableNativePhoneMinimal) {
        return SESSION_LIST_ROW_TITLE_TEXT_METRICS.minimalNativePhone;
    }
    return SESSION_LIST_ROW_TITLE_TEXT_METRICS[params.density];
}

export function resolveSessionListRowIdentityMetrics(params: Readonly<{
    density: SessionListRowDensity;
    readableNativePhoneMinimal: boolean;
}>): Readonly<{ slotSize: number; agentLogoSize: number; trailingAgentLogoSize: number }> {
    if (params.density === 'minimal' && params.readableNativePhoneMinimal) {
        return SESSION_LIST_ROW_IDENTITY_METRICS.minimalNativePhone;
    }
    return SESSION_LIST_ROW_IDENTITY_METRICS[params.density];
}

export function shouldUseReadableNativePhoneMinimalSessionRow(params: Readonly<{
    compact: boolean;
    compactMinimal: boolean;
    isTablet: boolean;
    platform: SessionListRowPlatform | string;
}>): boolean {
    return params.compact
        && params.compactMinimal
        && !params.isTablet
        && (params.platform === 'ios' || params.platform === 'android');
}

export function resolveSessionListRowHeight(params: Readonly<{
    compact: boolean;
    compactMinimal: boolean;
    isTablet: boolean;
    platform: SessionListRowPlatform | string;
    itemDensity?: 'comfortable' | 'cozy' | 'compact';
    fontScale?: number;
}>): number {
    const baseHeight = shouldUseReadableNativePhoneMinimalSessionRow(params)
        ? SESSION_LIST_ROW_HEIGHT_MINIMAL_NATIVE_PHONE
        : params.compactMinimal
            ? SESSION_LIST_ROW_HEIGHT_MINIMAL
            : params.compact
                ? SESSION_LIST_ROW_HEIGHT_COMPACT
                : SESSION_LIST_ROW_HEIGHT_DEFAULT;
    const density = params.itemDensity ?? 'cozy';
    // Keep the account-level detail modes while applying the app-level density as spacing only.
    const densityAdjustment = ITEM_ROW_MIN_HEIGHT[density] - ITEM_ROW_MIN_HEIGHT.cozy;
    const fontScale = typeof params.fontScale === 'number' && Number.isFinite(params.fontScale)
        ? Math.max(1, params.fontScale)
        : 1;
    const touchFloor = shouldUseReadableNativePhoneMinimalSessionRow(params)
        ? SESSION_LIST_ROW_HEIGHT_MINIMAL_NATIVE_PHONE
        : ITEM_ROW_MIN_HEIGHT[density];
    const minimalTextFloor = params.compactMinimal
        ? Math.round(SESSION_LIST_ROW_HEIGHT_MINIMAL * fontScale)
        : touchFloor;

    // Text itself scales in the shared Text primitive; reserve matching row space so its fixed
    // sidebar containers do not clip or crowd the larger type.
    return Math.max(touchFloor, minimalTextFloor, Math.round(baseHeight * fontScale) + densityAdjustment);
}
