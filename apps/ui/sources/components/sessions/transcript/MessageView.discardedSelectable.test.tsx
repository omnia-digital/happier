import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installMessageViewCommonModuleMocks } from './messageViewTestHelpers';
import { SessionMessageReplyActionContext } from '@/components/sessions/agentInput/useSessionComposerReply';
import { act } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installMessageViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'ios' },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string) => key,
        });
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useSetting: () => null,
            useSession: () => null,
        });
    },
});

vi.mock('@/components/markdown/MarkdownView', () => ({
  MarkdownView: (props: any) => React.createElement('MarkdownView', props),
}));

vi.mock('@/components/tools/shell/views/ToolView', () => ({
  ToolView: (props: any) => React.createElement('ToolView', props),
}));

vi.mock('@/components/tools/shell/views/ToolTimelineRow', () => ({
  ToolTimelineRow: (props: any) => React.createElement('ToolTimelineRow', props),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
    TextInput: (props: any) => React.createElement('TextInput', props, props.children),
}));

vi.mock('@/components/sessions/linkedFiles/extractWorkspaceFileMentions', () => ({
  extractWorkspaceFileMentions: () => [],
}));

vi.mock('@/components/sessions/transcript/references/StructuredReferencesRow', () => ({
  StructuredReferencesRow: () => null,
}));

vi.mock('@/utils/sessions/discardedCommittedMessages', () => ({
  isCommittedMessageDiscarded: () => true,
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(),
}));

vi.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
  Octicons: 'Octicons',
}));

vi.mock('@/sync/sync', () => ({
  sync: { submitMessage: vi.fn(), sendMessage: vi.fn() },
}));

describe('MessageView (discarded label)', () => {
  afterEach(() => {
    standardCleanup();
  });

  it('renders the discarded label as selectable', async () => {
    const { MessageView } = await import('./MessageView');

    const message: any = {
      kind: 'user-text',
      localId: 'local-1',
      id: 'm1',
      text: 'hello',
    };

    const screen = await renderScreen(<MessageView message={message} metadata={{} as any} sessionId="s1" />);

    const discarded = screen.findAll(
      (n: any) => n.type === 'Text' && n.props?.children === 'message.discarded',
    )[0]!;
    expect(discarded.props.selectable).toBe(true);
  });

  it.each(['user-text', 'agent-text'] as const)('offers an accessible reply beside existing message actions for %s', async (kind) => {
    const { MessageView } = await import('./MessageView');
    const selectReply = vi.fn();
    const message = { kind, id: 'source', seq: 7, transcriptBlockIndex: 2, localId: null, createdAt: 1, text: 'Earlier message' };
    const screen = await renderScreen(
      <SessionMessageReplyActionContext.Provider value={selectReply}>
        <MessageView message={message} metadata={null} sessionId="s1" interaction={{ canSendMessages: true } as any} />
      </SessionMessageReplyActionContext.Provider>,
    );
    const action = screen.findByTestId('transcript-message-reply:source');
    expect(action?.props.accessibilityRole).toBe('button');
    expect(action?.props.accessibilityLabel).toBe('session.messageReply.action');
    await act(async () => action?.props.onPress());
    expect(selectReply).toHaveBeenCalledWith({ sessionId: 's1', messageId: 'source', role: kind === 'user-text' ? 'user' : 'assistant', seq: 7, transcriptBlockIndex: 2 });
    expect(screen.findByTestId('transcript-message-copy:source')).toBeTruthy();
  });
});
