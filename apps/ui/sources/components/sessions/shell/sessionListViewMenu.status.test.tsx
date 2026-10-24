import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { SessionListViewMenuButton } from './sessionListViewMenu';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
afterEach(standardCleanup);

describe('independent status choices in existing view controls', () => {
    it('exposes all four choices and routes each without mutating the other selection', async () => {
        const grouping = vi.fn(); const sorting = vi.fn(); const machine = vi.fn(); const baseSort = vi.fn();
        const screen = await renderScreen(<SessionListViewMenuButton machineViewMode="repository" onMachineViewModeChange={machine} folderViewMode="tree" onFolderViewModeChange={() => {}} orderingMode="custom" onOrderingModeChange={baseSort} folderSortMode="mixed" onFolderSortModeChange={() => {}} hideInactiveSessions={false} onHideInactiveSessionsChange={() => {}} statusGrouping="ticket" statusSorting="agent" onStatusGroupingChange={grouping} onStatusSortingChange={sorting} />);
        const menu = screen.root.findByType(DropdownMenu);
        const items = menu.props.items;
        expect(items.filter((item: { id: string }) => item.id.startsWith('status-group:') || item.id.startsWith('status-sort:')).map((item: { id: string }) => item.id)).toEqual(['status-group:none', 'status-group:agent', 'status-group:ticket', 'status-sort:agent', 'status-sort:ticket']);
        expect(items.find((item: { id: string }) => item.id === 'status-group:ticket').subtitle).toContain('folders');
        expect(items.some((item: { id: string }) => item.id === 'session-repository-refresh')).toBe(false);
        menu.props.onSelect('status-group:agent'); expect(grouping).toHaveBeenLastCalledWith('agent'); expect(sorting).not.toHaveBeenCalled();
        menu.props.onSelect('status-group:ticket'); expect(grouping).toHaveBeenLastCalledWith('ticket');
        menu.props.onSelect('status-sort:agent'); expect(sorting).toHaveBeenLastCalledWith('agent');
        menu.props.onSelect('status-sort:ticket'); expect(sorting).toHaveBeenLastCalledWith('ticket');
        menu.props.onSelect('updated'); expect(sorting).toHaveBeenLastCalledWith('none'); expect(baseSort).toHaveBeenLastCalledWith('updated');
        menu.props.onSelect('session-view-machine'); expect(grouping).toHaveBeenLastCalledWith('none'); expect(machine).toHaveBeenLastCalledWith('machine');
    });
});
