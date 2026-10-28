import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import type { MessageReplyTarget } from '@/sync/domains/messages/messageReply';

import { useSessionComposerReply } from './useSessionComposerReply';
import { createComposerTextStore } from './composerTextStore';
import { clearComposerAfterOutboundHandoff, restoreComposerAfterFailedOutboundHandoff } from '@/hooks/session/sessionComposerSendCoordinator';

const first: MessageReplyTarget = { sessionId: 's1', messageId: 'earlier', role: 'assistant', seq: 2 };
const second: MessageReplyTarget = { ...first, messageId: 'similar', seq: 3 };

describe('session composer contextual reply lifecycle', () => {
    afterEach(standardCleanup);

    it.each(['replace', 'select-during-ordinary-send', 'select-then-cancel'] as const)('preserves the entire drafted message when reply intent changes before handoff: %s', async (change) => {
        const hook = await renderHook(() => useSessionComposerReply('scope', 's1'));
        const text = createComposerTextStore('Keep this text');
        let attachmentIds = ['draft-attachment'];
        if (change === 'replace') await act(async () => hook.getCurrent().select(first));
        const submittedIntent = hook.getCurrent().captureIntent();
        await act(async () => hook.getCurrent().select(second));
        if (change === 'select-then-cancel') await act(async () => hook.getCurrent().cancel());
        const didClear = clearComposerAfterOutboundHandoff({
            snapshot: { sessionId: 's1', text: 'Keep this text' },
            isSemanticSnapshotCurrent: () => hook.getCurrent().isCurrentIntent(submittedIntent),
            clearDraftForSessionIfCurrentValueMatches: (snapshot) => {
                if (text.getPrompt() !== snapshot.text) return false;
                text.setPrompt('');
                return true;
            },
            clearSemanticDraftValues: () => { attachmentIds = []; },
            clearTransientInputState: () => {},
        });
        expect(didClear).toBe(false);
        expect(text.getPrompt()).toBe('Keep this text');
        expect(attachmentIds).toEqual(['draft-attachment']);
    });

    it('does not restore cleared text or attachments over a newer reply intent after a failed handoff', async () => {
        const hook = await renderHook(() => useSessionComposerReply('scope', 's1'));
        const text = createComposerTextStore('');
        let attachmentIds: string[] = [];
        const afterClearIntent = hook.getCurrent().captureIntent();
        await act(async () => hook.getCurrent().select(second));
        const restored = restoreComposerAfterFailedOutboundHandoff({
            snapshot: { sessionId: 's1', text: 'Previously submitted' },
            wasClearedAtHandoff: true,
            isCanonicalOutboundHandoffPresent: () => false,
            isSemanticRestoreSafe: () => hook.getCurrent().isCurrentIntent(afterClearIntent),
            restoreDraftForSessionIfCurrentValueMatches: (snapshot, expected) => {
                if (text.getPrompt() !== expected) return false;
                text.setPrompt(snapshot.text);
                return true;
            },
            restoreSemanticDraftValues: () => { attachmentIds = ['old-attachment']; },
        });
        expect(restored).toBe(false);
        expect(text.getPrompt()).toBe('');
        expect(attachmentIds).toEqual([]);
        expect(hook.getCurrent().target).toBe(second);
    });

    it('replaces/cancels only the target and scopes targets to session and account', async () => {
        const hook = await renderHook(({ scope, session }) => useSessionComposerReply(scope, session), {
            initialProps: { scope: 'server/account', session: 's1' },
        });
        await act(async () => hook.getCurrent().select(first));
        expect(hook.getCurrent().target).toBe(first);
        await act(async () => hook.getCurrent().select(second));
        expect(hook.getCurrent().target).toBe(second);
        await hook.rerender({ scope: 'server/account', session: 's2' });
        expect(hook.getCurrent().target).toBeNull();
        await act(async () => hook.getCurrent().select(first));
        expect(hook.getCurrent().target).toBeNull();
        await hook.rerender({ scope: 'other/account', session: 's1' });
        expect(hook.getCurrent().target).toBeNull();
        await hook.rerender({ scope: 'server/account', session: 's1' });
        expect(hook.getCurrent().target).toBe(second);
        await act(async () => hook.getCurrent().cancel());
        expect(hook.getCurrent().target).toBeNull();
    });

    it('clears only the submitted snapshot and restores a failed handoff without overwriting a newer target', async () => {
        const hook = await renderHook(() => useSessionComposerReply('scope', 's1'));
        await act(async () => hook.getCurrent().select(first));
        const submission = hook.getCurrent();
        await act(async () => hook.getCurrent().select(second));
        await act(async () => { expect(submission.clearIfCurrent(first)).toBe(false); });
        expect(hook.getCurrent().target).toBe(second);
        await act(async () => { expect(hook.getCurrent().clearIfCurrent(second)).toBe(true); });
        expect(hook.getCurrent().target).toBeNull();
        await act(async () => hook.getCurrent().restoreIfEmpty(second));
        expect(hook.getCurrent().target).toBe(second);
        await act(async () => { hook.getCurrent().clearIfCurrent(second); });
        await act(async () => hook.getCurrent().select(first));
        await act(async () => hook.getCurrent().restoreIfEmpty(second));
        expect(hook.getCurrent().target).toBe(first);
    });

    it('does not restore a failed submission over an explicit cancel while the handoff was pending', async () => {
        const hook = await renderHook(() => useSessionComposerReply('scope', 's1'));
        await act(async () => hook.getCurrent().select(first));
        const submission = hook.getCurrent();
        await act(async () => { submission.clearIfCurrent(first); });
        await act(async () => hook.getCurrent().cancel());
        await act(async () => submission.restoreIfEmpty(first));
        expect(hook.getCurrent().target).toBeNull();
    });
});
