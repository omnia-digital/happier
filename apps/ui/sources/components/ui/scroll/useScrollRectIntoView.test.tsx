import { act } from 'react-test-renderer';
import type { ScrollView } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { useScrollRectIntoViewRegistry } from './useScrollRectIntoView';

describe('useScrollRectIntoViewRegistry', () => {
    it('preserves a manual scroll when content changes without a new selection', async () => {
        const scrollTo = vi.fn();
        const hook = await renderHook(() => useScrollRectIntoViewRegistry({ activeKey: 'first' }));
        // The RN scroll host is the platform boundary; only scrollTo is used by this owner.
        hook.getCurrent().scrollRef.current = { scrollTo } as unknown as ScrollView;

        await act(async () => {
            hook.getCurrent().onViewportLayout({ nativeEvent: { layout: { height: 120 } } });
            hook.getCurrent().onContentSizeChange(0, 500);
            hook.getCurrent().registerItemLayout('first')({ nativeEvent: { layout: { y: 0, height: 32 } } });
        });
        scrollTo.mockClear();

        await act(async () => {
            hook.getCurrent().onScroll({ nativeEvent: {
                contentOffset: { y: 240 },
                layoutMeasurement: { height: 120 },
                contentSize: { height: 500 },
            } });
            hook.getCurrent().onContentSizeChange(0, 540);
        });

        expect(scrollTo).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('scrolls a newly selected keyboard target into view after manual scrolling', async () => {
        const scrollTo = vi.fn();
        const hook = await renderHook(
            (activeKey: string) => useScrollRectIntoViewRegistry({ activeKey }),
            { initialProps: 'first' },
        );
        hook.getCurrent().scrollRef.current = { scrollTo } as unknown as ScrollView;

        await act(async () => {
            hook.getCurrent().onViewportLayout({ nativeEvent: { layout: { height: 120 } } });
            hook.getCurrent().onContentSizeChange(0, 500);
            hook.getCurrent().registerItemLayout('first')({ nativeEvent: { layout: { y: 0, height: 32 } } });
            hook.getCurrent().registerItemLayout('last')({ nativeEvent: { layout: { y: 440, height: 32 } } });
            hook.getCurrent().onScroll({ nativeEvent: {
                contentOffset: { y: 180 },
                layoutMeasurement: { height: 120 },
                contentSize: { height: 500 },
            } });
        });
        scrollTo.mockClear();

        await hook.rerender('last');
        expect(scrollTo).toHaveBeenCalledWith({ y: 360, animated: true });
        await hook.unmount();
    });

    it('waits for content metrics before revealing an initially selected lower item', async () => {
        const scrollTo = vi.fn();
        const hook = await renderHook(() => useScrollRectIntoViewRegistry({ activeKey: 'last' }));
        hook.getCurrent().scrollRef.current = { scrollTo } as unknown as ScrollView;

        await act(async () => {
            hook.getCurrent().registerItemLayout('last')({ nativeEvent: { layout: { y: 440, height: 32 } } });
            hook.getCurrent().onViewportLayout({ nativeEvent: { layout: { height: 120 } } });
            hook.getCurrent().onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
        });
        expect(scrollTo).not.toHaveBeenCalled();

        await act(async () => hook.getCurrent().onContentSizeChange(0, 500));
        expect(scrollTo).toHaveBeenCalledWith({ y: 360, animated: true });
        await hook.unmount();
    });
});
