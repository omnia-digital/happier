import * as React from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installMcpServersCommonModuleMocks,
    mcpServersModuleState,
    resetMcpServersCommonModuleMockState,
} from './mcpServersTestHelpers';


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pathSelectionListPropsRef: { current: Record<string, unknown> | null } = { current: null };
const pathSettings = vi.hoisted(() => ({
  preferences: {} as Record<string, { favorites: string[]; recentPaths: string[] }>,
  legacy: [] as string[],
  apply: vi.fn(),
}));

const installPathMocks = () => installMcpServersCommonModuleMocks({
  storage: async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
      useAllMachines: () => [],
      useActiveServerAccountScope: () => ({ serverId: 'home-a', accountId: 'viewer' }),
      useSetting: (key: string) => key === 'favoriteDirectories' ? pathSettings.legacy : pathSettings.preferences,
      storage: { getState: () => ({ settingsScope: { serverId: 'home-a', accountId: 'viewer' }, settings: {
        machinePathPreferencesByTargetV1: pathSettings.preferences,
        favoriteDirectories: pathSettings.legacy,
      } }) },
    });
  },
});
installPathMocks();

vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
  getActiveServerAccountScope: () => ({ serverId: 'home-a', accountId: 'viewer' }),
}));
vi.mock('@/sync/store/settingsWriters', () => ({ useApplySettings: () => pathSettings.apply }));

vi.mock('@/components/sessions/new/components/PathSelectionList', () => ({
  PathSelectionList: (props: Record<string, unknown>) => {
    pathSelectionListPropsRef.current = props;
    return React.createElement('PathSelectionList', props);
  },
}));

describe('McpWorkspaceRootPickerModal', () => {
  beforeEach(() => {
    resetMcpServersCommonModuleMockState();
    installPathMocks();
    pathSelectionListPropsRef.current = null;
    pathSettings.preferences = {};
    pathSettings.legacy = [];
    pathSettings.apply.mockClear();
  });

  it('passes the machine id and home dir into PathSelectionList when machine information is provided', async () => {
    const { McpWorkspaceRootPickerModal } = await import('./McpWorkspaceRootPickerModal');

    await renderScreen(<McpWorkspaceRootPickerModal
          machineId="machine-1"
          machineHomeDir="/Users/test"
          selectedPath="/repo"
          onSelectPath={() => {}}
          onClose={() => {}}
        />);

    expect(pathSelectionListPropsRef.current).toMatchObject({
      machineId: 'machine-1',
      machineHomeDir: '/Users/test',
      initialValue: '/repo',
    });
    expect(mcpServersModuleState.openMachinePathBrowserModalSpy).not.toHaveBeenCalled();
  });

  it('forwards home-aware favorite toggles to PathSelectionList', async () => {
    pathSettings.preferences = {
      '["home-a","viewer","machine-1"]': { favorites: ['~/repo'], recentPaths: [] },
    };
    const { McpWorkspaceRootPickerModal } = await import('./McpWorkspaceRootPickerModal');

    await renderScreen(<McpWorkspaceRootPickerModal
          machineId="machine-1"
          machineHomeDir="/Users/test"
          selectedPath="/repo"
          onSelectPath={() => {}}
          onClose={() => {}}
        />);

    const isFavorite = pathSelectionListPropsRef.current?.isFavorite;
    const onToggleFavorite = pathSelectionListPropsRef.current?.onToggleFavorite;
    expect(typeof isFavorite).toBe('function');
    expect(typeof onToggleFavorite).toBe('function');
    expect((isFavorite as (path: string) => boolean)('/Users/test/repo')).toBe(true);

    await (onToggleFavorite as (path: string) => Promise<void>)('/Users/test/repo');

    expect(pathSettings.apply).toHaveBeenCalledWith({
      machinePathPreferencesByTargetV1: {
        '["home-a","viewer","machine-1"]': { favorites: [], recentPaths: [] },
      },
    });
  });
});
