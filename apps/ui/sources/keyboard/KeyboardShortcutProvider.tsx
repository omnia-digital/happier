import * as React from 'react';
import { Platform } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { Modal, useOptionalModal } from '@/modal';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import {
    buildKeyboardShortcutLabels,
    buildNativeHardwareKeyboardAllowlist,
    createKeyboardShortcutDispatcher,
    normalizeKeyboardEvent,
    normalizeNativeHardwareKeyboardEvent,
    readKeyboardContextFromEventTarget,
    resolveKeyboardPlatform,
    type NativeHardwareKeyboardAllowlist,
    type KeyboardShortcutHandlers,
} from './runtime';
import type { KeyboardCommandId, KeybindingRule } from './types';
import { FocusReturnProvider } from './focusReturn';
import { ESCAPE_LAYER_PRIORITIES, getMaxEscapeKeyBlockerPriority, subscribeEscapeLayerChanges } from './escape';
import { subscribeToNativeHardwareKeyboardEvents } from '@/components/sessions/agentInput/subscribeToIosHardwareShiftEnter';

function isPopoverOrHigherEscapeLayerActive(): boolean {
    return getMaxEscapeKeyBlockerPriority() >= ESCAPE_LAYER_PRIORITIES.popover;
}

type KeyboardShortcutRegistrationContextValue = Readonly<{
    registerHandlers: (
        handlers: KeyboardShortcutHandlers,
        onCommandHeldChange?: (held: boolean) => void,
        isOwnedSessionRowMenuActive?: () => boolean,
    ) => () => void;
    executeCommand: (commandId: KeyboardCommandId) => boolean;
}>;

type ScopedHandlerEntry = Readonly<{
    handlers: KeyboardShortcutHandlers;
    onCommandHeldChange?: (held: boolean) => void;
    isOwnedSessionRowMenuActive?: () => boolean;
}>;

const KeyboardShortcutRegistrationContext = React.createContext<KeyboardShortcutRegistrationContextValue | null>(null);
const KeyboardShortcutLabelsContext = React.createContext<Partial<Record<KeyboardCommandId, string>>>({});
const HANDLER_KEY_SIGNATURE_SEPARATOR = '\u0000';

function buildHandlerKeySignature(handlers: KeyboardShortcutHandlers): string {
    return Object.keys(handlers).sort().join(HANDLER_KEY_SIGNATURE_SEPARATOR);
}

function buildNativeHardwareAllowlistSignature(allowlist: NativeHardwareKeyboardAllowlist | null): string {
    if (!allowlist) return '';
    return allowlist.allowedEvents
        .map((event) => [
            event.key,
            event.modifiers.shift ? 'shift' : '',
            event.modifiers.ctrl ? 'ctrl' : '',
            event.modifiers.meta ? 'meta' : '',
            event.modifiers.alt ? 'alt' : '',
        ].join(HANDLER_KEY_SIGNATURE_SEPARATOR))
        .sort()
        .join(HANDLER_KEY_SIGNATURE_SEPARATOR);
}

export function useKeyboardShortcutHandlers(
    handlers: KeyboardShortcutHandlers,
    options?: Readonly<{
        onCommandHeldChange?: (held: boolean) => void;
        isOwnedSessionRowMenuActive?: () => boolean;
    }>,
): boolean {
    const registration = React.useContext(KeyboardShortcutRegistrationContext);
    const latestHandlersRef = React.useRef(handlers);
    latestHandlersRef.current = handlers;
    const latestCommandHeldChangeRef = React.useRef(options?.onCommandHeldChange);
    latestCommandHeldChangeRef.current = options?.onCommandHeldChange;
    const latestOwnedSessionRowMenuRef = React.useRef(options?.isOwnedSessionRowMenuActive);
    latestOwnedSessionRowMenuRef.current = options?.isOwnedSessionRowMenuActive;
    const wantsCommandHeldChange = options?.onCommandHeldChange != null;
    const handlerKeySignature = buildHandlerKeySignature(handlers);
    const registeredHandlers = React.useMemo<KeyboardShortcutHandlers>(() => {
        if (!handlerKeySignature) return {};
        const next: KeyboardShortcutHandlers = {};
        const keys = handlerKeySignature.split(HANDLER_KEY_SIGNATURE_SEPARATOR) as KeyboardCommandId[];
        for (const key of keys) {
            next[key] = () => {
                return latestHandlersRef.current[key]?.();
            };
        }
        return next;
    }, [handlerKeySignature]);

    React.useEffect(() => {
        if (!registration) return;
        if (!handlerKeySignature && !wantsCommandHeldChange) return;
        return registration.registerHandlers(
            registeredHandlers,
            wantsCommandHeldChange ? (held) => latestCommandHeldChangeRef.current?.(held) : undefined,
            () => latestOwnedSessionRowMenuRef.current?.() === true,
        );
    }, [handlerKeySignature, registeredHandlers, registration, wantsCommandHeldChange]);

    return registration != null;
}

/** Explicit UI actions share command handlers without depending on keyboard binding preferences. */
export function useKeyboardCommand(): (commandId: KeyboardCommandId) => boolean {
    const registration = React.useContext(KeyboardShortcutRegistrationContext);
    return React.useCallback((commandId: KeyboardCommandId) => registration?.executeCommand(commandId) ?? false, [registration]);
}

export function useKeyboardShortcutLabel(commandId: KeyboardCommandId): string | undefined {
    return React.useContext(KeyboardShortcutLabelsContext)[commandId];
}

export function useKeyboardShortcutLabels(): Partial<Record<KeyboardCommandId, string>> {
    return React.useContext(KeyboardShortcutLabelsContext);
}

function buildHelpBody(shortcutLabels: Partial<Record<string, string>>): string {
    const numberedLabels = Array.from({ length: 9 }, (_, index) => shortcutLabels[`session.number.${index + 1}`])
        .filter((label): label is string => label != null);
    const lines = [
        shortcutLabels['commandPalette.open']
            ? `${t('commandPalette.shortcutsHelpCommandPalette')}: ${shortcutLabels['commandPalette.open']}`
            : null,
        shortcutLabels['shortcutsHelp.open']
            ? `${t('commandPalette.shortcutsHelpHelp')}: ${shortcutLabels['shortcutsHelp.open']}`
            : null,
        shortcutLabels['session.new']
            ? `${t('commandPalette.shortcutsHelpNewSession')}: ${shortcutLabels['session.new']}`
            : null,
        numberedLabels.length > 0
            ? `${t('commandPalette.shortcutsHelpVisibleSessions')}: ${numberedLabels.join(', ')}`
            : null,
        shortcutLabels['session.hovered.archive']
            ? `${t('sessionInfo.archiveSession')}: ${shortcutLabels['session.hovered.archive']}`
            : null,
    ].filter((line): line is string => Boolean(line));
    if (lines.length === 0) return t('commandPalette.shortcutsHelpEmpty');
    return t('commandPalette.shortcutsHelpBody', { shortcuts: lines.join('\n') });
}

export function KeyboardShortcutProvider(props: React.PropsWithChildren<Readonly<{
    handlers: KeyboardShortcutHandlers;
    enabledWhenDisabledCommandIds?: readonly KeyboardCommandId[];
}>>) {
    const modal = useOptionalModal();
    const isModalActive = modal?.isKeyboardLiftSuppressedByModal === true;
    const nextScopedHandlerIdRef = React.useRef(1);
    const commandHeldRef = React.useRef(false);
    const [scopedHandlerEntries, setScopedHandlerEntries] = React.useState<ReadonlyMap<number, ScopedHandlerEntry>>(
        () => new Map(),
    );
    const commandHeldListenersRef = React.useRef<readonly ((held: boolean) => void)[]>([]);
    commandHeldListenersRef.current = Array.from(scopedHandlerEntries.values())
        .map((entry) => entry.onCommandHeldChange)
        .filter((listener): listener is (held: boolean) => void => listener != null);
    const hasCommandHeldListener = commandHeldListenersRef.current.length > 0;
    const setCommandHeld = React.useCallback((held: boolean) => {
        if (commandHeldRef.current === held) return;
        commandHeldRef.current = held;
        for (const listener of commandHeldListenersRef.current) listener(held);
    }, []);
    const registerHandlers = React.useCallback((
        handlers: KeyboardShortcutHandlers,
        onCommandHeldChange?: (held: boolean) => void,
        isOwnedSessionRowMenuActive?: () => boolean,
    ) => {
        const id = nextScopedHandlerIdRef.current;
        nextScopedHandlerIdRef.current += 1;
        setScopedHandlerEntries((current) => {
            const next = new Map(current);
            next.set(id, { handlers, onCommandHeldChange, isOwnedSessionRowMenuActive });
            return next;
        });
        if (commandHeldRef.current) onCommandHeldChange?.(true);
        return () => {
            setScopedHandlerEntries((current) => {
                if (!current.has(id)) return current;
                const next = new Map(current);
                next.delete(id);
                return next;
            });
        };
    }, []);
    const scopedHandlers = React.useMemo<KeyboardShortcutHandlers>(() => {
        const next: KeyboardShortcutHandlers = {};
        for (const entry of scopedHandlerEntries.values()) {
            Object.assign(next, entry.handlers);
        }
        return next;
    }, [scopedHandlerEntries]);
    const scopedEntriesRef = React.useRef(scopedHandlerEntries);
    scopedEntriesRef.current = scopedHandlerEntries;
    const rootHandlers = React.useMemo<KeyboardShortcutHandlers>(() => ({
        ...props.handlers,
        ...scopedHandlers,
    }), [props.handlers, scopedHandlers]);
    const platform = React.useMemo(resolveKeyboardPlatform, []);
    const surface = Platform.OS === 'web' ? 'web' : 'native';
    const {
        keyboardShortcutsV2Enabled,
        keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutOverridesV1,
        keyboardShortcutDisabledCommandIdsV1,
    } = storage(useShallow((state) => ({
        keyboardShortcutsV2Enabled: state.settings.keyboardShortcutsV2Enabled,
        keyboardSingleKeyShortcutsEnabled: state.settings.keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutOverridesV1: state.settings.keyboardShortcutOverridesV1,
        keyboardShortcutDisabledCommandIdsV1: state.settings.keyboardShortcutDisabledCommandIdsV1,
    })));
    const labelHandlers = React.useMemo<KeyboardShortcutHandlers>(() => ({
        ...rootHandlers,
        'shortcutsHelp.open': () => undefined,
    }), [rootHandlers]);

    const shortcutLabels = React.useMemo(
        () => buildKeyboardShortcutLabels(platform, surface, {
            disabledCommandIds: keyboardShortcutDisabledCommandIdsV1 ?? [],
            overrides: keyboardShortcutOverridesV1 ?? {},
            singleKeyShortcutsEnabled: keyboardSingleKeyShortcutsEnabled === true,
            handlers: labelHandlers,
            context: {
                isEditableTarget: false,
                isComposing: false,
            },
        }),
        [
            keyboardShortcutDisabledCommandIdsV1,
            keyboardShortcutOverridesV1,
            keyboardSingleKeyShortcutsEnabled,
            labelHandlers,
            platform,
            surface,
        ],
    );

    const handlers = React.useMemo<KeyboardShortcutHandlers>(() => ({
        ...rootHandlers,
        'shortcutsHelp.open': () => {
            void Modal.alertAsync(t('commandPalette.shortcutsHelpTitle'), buildHelpBody(shortcutLabels));
        },
    }), [rootHandlers, shortcutLabels]);
    const latestShortcutRuntimeRef = React.useRef<Readonly<{
        keyboardShortcutsV2Enabled: boolean | undefined;
        enabledWhenDisabledCommandIds: readonly KeyboardCommandId[] | undefined;
        keyboardSingleKeyShortcutsEnabled: boolean | undefined;
        keyboardShortcutDisabledCommandIdsV1: readonly string[] | undefined;
        keyboardShortcutOverridesV1: Readonly<Record<string, readonly KeybindingRule[]>> | undefined;
        handlers: KeyboardShortcutHandlers;
    }> | null>(null);
    latestShortcutRuntimeRef.current = {
        keyboardShortcutsV2Enabled,
        enabledWhenDisabledCommandIds: props.enabledWhenDisabledCommandIds,
        keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutDisabledCommandIdsV1,
        keyboardShortcutOverridesV1,
        handlers,
    };
    const isModalActiveRef = React.useRef(isModalActive);
    isModalActiveRef.current = isModalActive;
    React.useEffect(() => {
        if (isModalActive) setCommandHeld(false);
    }, [isModalActive, setCommandHeld]);
    React.useEffect(() => {
        if (keyboardShortcutsV2Enabled !== true) setCommandHeld(false);
    }, [keyboardShortcutsV2Enabled, setCommandHeld]);
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !hasCommandHeldListener) return;
        return subscribeEscapeLayerChanges(() => {
            if (isPopoverOrHigherEscapeLayerActive()) setCommandHeld(false);
        });
    }, [hasCommandHeldListener, setCommandHeld]);
    const executeCommand = React.useCallback((commandId: KeyboardCommandId): boolean => {
        const handler = latestShortcutRuntimeRef.current?.handlers[commandId];
        if (!handler) return false;
        return handler() !== false;
    }, []);
    const registrationContextValue = React.useMemo<KeyboardShortcutRegistrationContextValue>(
        () => ({ registerHandlers, executeCommand }),
        [registerHandlers, executeCommand],
    );
    const nativeHardwareAllowlist = React.useMemo(
        () => buildNativeHardwareKeyboardAllowlist({
            enabled: keyboardShortcutsV2Enabled === true,
            platform,
            surface,
            singleKeyShortcutsEnabled: keyboardSingleKeyShortcutsEnabled === true,
            disabledCommandIds: keyboardShortcutDisabledCommandIdsV1 ?? [],
            overrides: keyboardShortcutOverridesV1 ?? {},
            handlers,
            getContext: () => ({
                isEditableTarget: false,
                isComposing: false,
            }),
        }),
        [
            handlers,
            keyboardShortcutDisabledCommandIdsV1,
            keyboardShortcutOverridesV1,
            keyboardShortcutsV2Enabled,
            keyboardSingleKeyShortcutsEnabled,
            platform,
            surface,
        ],
    );
    const nativeHardwareAllowlistRef = React.useRef<NativeHardwareKeyboardAllowlist | null>(nativeHardwareAllowlist);
    nativeHardwareAllowlistRef.current = nativeHardwareAllowlist;
    const nativeHardwareAllowlistSignature = React.useMemo(
        () => buildNativeHardwareAllowlistSignature(nativeHardwareAllowlist),
        [nativeHardwareAllowlist],
    );

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented === true) return;
            if (platform === 'macos') {
                const context = readKeyboardContextFromEventTarget(event.target);
                const canShowHints = event.metaKey
                    && !event.altKey && !event.ctrlKey && !event.shiftKey
                    && !event.isComposing
                    && !context.isEditableTarget && !context.isOverlayActive
                    && !isPopoverOrHigherEscapeLayerActive()
                    && !isModalActiveRef.current
                    && latestShortcutRuntimeRef.current?.keyboardShortcutsV2Enabled === true;
                setCommandHeld(canShowHints);
            }
            const latestShortcutRuntime = latestShortcutRuntimeRef.current;
            if (!latestShortcutRuntime) return;
            const dispatcher = createKeyboardShortcutDispatcher({
                enabled: latestShortcutRuntime.keyboardShortcutsV2Enabled === true,
                enabledWhenDisabledCommandIds: latestShortcutRuntime.enabledWhenDisabledCommandIds,
                platform,
                surface,
                singleKeyShortcutsEnabled: latestShortcutRuntime.keyboardSingleKeyShortcutsEnabled === true,
                disabledCommandIds: latestShortcutRuntime.keyboardShortcutDisabledCommandIdsV1 ?? [],
                overrides: latestShortcutRuntime.keyboardShortcutOverridesV1 ?? {},
                handlers: latestShortcutRuntime.handlers,
                getContext: () => {
                    const context = readKeyboardContextFromEventTarget(event.target);
                    const highestEscapeLayer = getMaxEscapeKeyBlockerPriority();
                    const ownedSessionRowMenuActive = !isModalActiveRef.current
                        && highestEscapeLayer <= ESCAPE_LAYER_PRIORITIES.popover
                        && Array.from(scopedEntriesRef.current.values()).some((entry) => entry.isOwnedSessionRowMenuActive?.() === true);
                    return {
                        ...context,
                        isComposing: event.isComposing === true,
                        isOverlayActive: isModalActiveRef.current
                            || context.isOverlayActive
                            || highestEscapeLayer >= ESCAPE_LAYER_PRIORITIES.popover,
                        isOwnedSessionRowMenuActive: ownedSessionRowMenuActive,
                    };
                },
            });
            if (!dispatcher(normalizeKeyboardEvent(event))) return;
            event.preventDefault();
            event.stopPropagation();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            setCommandHeld(false);
        };
    }, [platform, setCommandHeld, surface]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || !hasCommandHeldListener) return;
        const handleKeyUp = (event: KeyboardEvent) => {
            if (!event.metaKey || event.key === 'Meta') setCommandHeld(false);
        };
        const clearCommandHeld = () => setCommandHeld(false);
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') clearCommandHeld();
        };
        const handleFocusIn = (event: FocusEvent) => {
            const context = readKeyboardContextFromEventTarget(event.target);
            if (context.isEditableTarget || context.isOverlayActive) clearCommandHeld();
        };
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', clearCommandHeld);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
            document.addEventListener('focusin', handleFocusIn);
        }
        return () => {
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', clearCommandHeld);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
                document.removeEventListener('focusin', handleFocusIn);
            }
            clearCommandHeld();
        };
    }, [hasCommandHeldListener, setCommandHeld]);

    React.useEffect(() => {
        if (Platform.OS === 'web') return;
        const allowlist = nativeHardwareAllowlistRef.current;
        if (!allowlist) return;

        const subscription = subscribeToNativeHardwareKeyboardEvents((nativeEvent) => {
            const event = normalizeNativeHardwareKeyboardEvent(nativeEvent);
            const latestShortcutRuntime = latestShortcutRuntimeRef.current;
            if (!latestShortcutRuntime) return;
            const dispatcher = createKeyboardShortcutDispatcher({
                enabled: latestShortcutRuntime.keyboardShortcutsV2Enabled === true,
                enabledWhenDisabledCommandIds: latestShortcutRuntime.enabledWhenDisabledCommandIds,
                platform,
                surface,
                singleKeyShortcutsEnabled: latestShortcutRuntime.keyboardSingleKeyShortcutsEnabled === true,
                disabledCommandIds: latestShortcutRuntime.keyboardShortcutDisabledCommandIdsV1 ?? [],
                overrides: latestShortcutRuntime.keyboardShortcutOverridesV1 ?? {},
                handlers: latestShortcutRuntime.handlers,
                getContext: () => ({
                    isEditableTarget: false,
                    isComposing: event.isComposing,
                }),
            });
            dispatcher(event);
        }, allowlist);

        return () => {
            subscription?.remove();
        };
    }, [
        nativeHardwareAllowlistSignature,
        platform,
        surface,
    ]);

    return (
        <KeyboardShortcutRegistrationContext.Provider value={registrationContextValue}>
            <KeyboardShortcutLabelsContext.Provider value={shortcutLabels}>
                <FocusReturnProvider>{props.children}</FocusReturnProvider>
            </KeyboardShortcutLabelsContext.Provider>
        </KeyboardShortcutRegistrationContext.Provider>
    );
}
