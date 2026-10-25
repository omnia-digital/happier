import { lstat, mkdir, readFile, readdir, realpath, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConnectedServiceCredentialRecordV1 } from '@happier-dev/protocol';
import { AGY_OAUTH_CLIENT_ID, AGY_OAUTH_CLIENT_SECRET, AGY_OAUTH_TOKEN_URL } from '@happier-dev/agents';
import { materializeConnectedServicesForSpawn } from '@/daemon/connectedServices/materialize/materializeConnectedServicesForSpawn';
import { resolveConnectedServiceHomeDir } from '@/daemon/connectedServices/homes/resolveConnectedServiceHomeDir';
import { withTempDir } from '@/testkit/fs/tempDir';
import type { ApiClient } from '@/api/api';
import { createConnectedServiceGroupMutationCurrentnessValidator } from '@/daemon/connectedServices/credentials/createConnectedServiceGroupMutationCurrentnessValidator';

const record = {
  v: 1, serviceId: 'antigravity', profileId: 'a', kind: 'oauth', createdAt: 1, updatedAt: 1, expiresAt: 2_000_000_000_000, token: null,
  oauth: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', idToken: null, scope: null,
    tokenType: 'Bearer', providerAccountId: 'fixture-account', providerEmail: 'a@example.test', raw: null },
} satisfies ConnectedServiceCredentialRecordV1;

describe('Antigravity connected-service materialization through the catalog', () => {
  it('reconciles previously managed copied config without repeated local backups', async () => {
    await withTempDir('agy-copied-restart-', async cwd => {
      const native = join(cwd, 'native');
      await mkdir(join(native, 'config', 'skills'), { recursive: true });
      await mkdir(join(native, 'antigravity-acp'), { recursive: true });
      await writeFile(join(native, 'config', 'skills', 'SKILL.md'), 'native skill');
      await writeFile(join(native, 'antigravity-acp', 'trusted_workspaces.json'), '{}');
      const materialize = (key: string) => materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: key, activeServerDir: cwd,
        baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd, GEMINI_HOME: native }, recordsByServiceId: new Map([['antigravity', record]]),
        accountSettings: { connectedServicesProviderStateSharingSettingsV1: {
          v: 1, defaults: { configMode: 'copied', stateMode: 'isolated' }, byAgentId: {},
        } },
      });
      const first = await materialize('first');
      const home = first!.env.GEMINI_HOME;
      const copiedSkill = join(home, 'config', 'skills', 'SKILL.md');
      await utimes(copiedSkill, 1234, 1234);
      const before = await lstat(copiedSkill);
      const second = await materialize('second');
      expect(second!.env.GEMINI_HOME).toBe(home);
      expect((await readdir(join(home, 'config'))).filter(name => name.includes('.local-'))).toEqual([]);
      expect((await readdir(join(home, 'antigravity-acp'))).filter(name => name.includes('.local-'))).toEqual([]);
      const after = await lstat(copiedSkill);
      expect(after.ino).toBe(before.ino);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      await writeFile(join(native, 'config', 'skills', 'SKILL.md'), 'updated native skill');
      await materialize('third');
      expect(await readFile(copiedSkill, 'utf8')).toBe('updated native skill');
      expect((await readdir(join(home, 'config'))).filter(name => name.includes('.local-'))).toEqual([]);
    });
  });

  it('imports private conversation sidecars and brain before switching isolated state to shared', async () => {
    await withTempDir('agy-isolated-shared-', async cwd => {
      const native = join(cwd, 'native');
      await mkdir(join(native, 'antigravity-acp'), { recursive: true });
      await writeFile(join(native, 'antigravity-acp', 'acp_token.json'), 'native credential');
      const materialize = (key: string, stateMode: 'isolated' | 'shared') => materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: key, activeServerDir: cwd,
        baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd, GEMINI_HOME: native }, recordsByServiceId: new Map([['antigravity', record]]),
        accountSettings: { connectedServicesProviderStateSharingSettingsV1: {
          v: 1, defaults: { configMode: 'isolated', stateMode }, byAgentId: {},
        } },
      });
      const first = await materialize('isolated', 'isolated');
      const home = first!.env.GEMINI_HOME;
      const privateFiles = [
        ['conversations/session-a.db', new Uint8Array([0, 255, 1, 2])],
        ['conversations/session-a.db-wal', new Uint8Array([128, 0, 64])],
        ['conversations/session-a.meta', new TextEncoder().encode('{"id":"session-a"}')],
        ['brain/session-a/artifact.md', new TextEncoder().encode('private artifact')],
      ] as const;
      await mkdir(join(home, 'antigravity-acp', 'conversations'), { recursive: true });
      await mkdir(join(home, 'antigravity-acp', 'brain', 'session-a'), { recursive: true });
      for (const [path, bytes] of privateFiles) await writeFile(join(home, 'antigravity-acp', path), bytes);
      await writeFile(join(home, 'antigravity-acp', 'unknown-private.json'), 'account-local');
      const shared = await materialize('shared', 'shared');
      expect(shared!.env.GEMINI_HOME).toBe(home);
      for (const [path, bytes] of privateFiles) {
        expect(new Uint8Array(await readFile(join(home, 'antigravity-acp', path)))).toEqual(bytes);
        expect(new Uint8Array(await readFile(join(native, 'antigravity-acp', path)))).toEqual(bytes);
      }
      expect(await realpath(join(home, 'antigravity-acp', 'conversations'))).toBe(await realpath(join(native, 'antigravity-acp', 'conversations')));
      expect(await realpath(join(home, 'antigravity-acp', 'brain'))).toBe(await realpath(join(native, 'antigravity-acp', 'brain')));
      expect(await readFile(join(native, 'antigravity-acp', 'acp_token.json'), 'utf8')).toBe('native credential');
      await expect(lstat(join(native, 'antigravity-acp', 'unknown-private.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.parse(await readFile(join(home, 'antigravity-acp', 'acp_token.json'), 'utf8'))).toMatchObject({ refresh_token: 'fixture-refresh' });
    });
  });
  it('leaves account credentials untouched when its selected group target is no longer current', async () => {
    await withTempDir('agy-group-currentness-', async cwd => {
      const home = resolveConnectedServiceHomeDir({ activeServerDir: cwd, serviceId: 'antigravity', profileId: record.profileId, agentId: 'agy' });
      const tokenPath = join(home, 'antigravity-acp', 'acp_token.json');
      const settingsPath = join(home, 'antigravity-acp', 'settings.json');
      await mkdir(join(home, 'antigravity-acp'), { recursive: true });
      const currentToken = JSON.stringify({ refresh_token: 'current-grant', project_id: 'current-project' });
      const currentSettings = JSON.stringify({ auth: { type: 'oauth-personal' } });
      await writeFile(tokenPath, currentToken);
      await writeFile(settingsPath, currentSettings);
      const selection = {
        kind: 'group', serviceId: 'antigravity', groupId: 'team', activeProfileId: record.profileId,
        fallbackProfileId: record.profileId, generation: 7, credentialRevision: null, record, policy: null,
      } as const;
      // Only the remote API boundary is replaced; the authoritative validator remains real.
      const api = { getConnectedServiceAuthGroup: async () => null } as unknown as ApiClient;
      const result = await materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: 'stale-group', activeServerDir: cwd,
        baseDir: join(cwd, 'materialized'), sessionDirectory: cwd, processEnv: { HOME: cwd },
        recordsByServiceId: new Map([['antigravity', record]]),
        selectionsByServiceId: new Map([['antigravity', selection]]),
        validateGroupMutationCurrentness: createConnectedServiceGroupMutationCurrentnessValidator({
          api, credentials: { token: 'fixture', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
        }),
      });
      expect(await readFile(tokenPath, 'utf8')).toBe(currentToken);
      expect(await readFile(settingsPath, 'utf8')).toBe(currentSettings);
      expect(result?.diagnostics).toContainEqual(expect.objectContaining({
        severity: 'blocking', reason: 'authoritative_group_target_changed_before_materialization',
      }));
    });
  });
  it('reuses the selected account home and preserves its private history and discovered project on restart', async () => {
    await withTempDir('agy-durable-account-', async cwd => {
      const materialize = (key: string) => materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: key, activeServerDir: cwd, baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd }, recordsByServiceId: new Map([['antigravity', record]]),
        accountSettings: { connectedServicesProviderStateSharingSettingsV1: { v: 1, defaults: { configMode: 'isolated', stateMode: 'isolated' }, byAgentId: {} } },
      });
      const first = await materialize('first-session');
      const home = resolveConnectedServiceHomeDir({ activeServerDir: cwd, serviceId: 'antigravity', profileId: 'a', agentId: 'agy' });
      expect(first!.env.GEMINI_HOME).toBe(home);
      await mkdir(join(home, 'antigravity-acp', 'conversations'), { recursive: true });
      await mkdir(join(home, 'antigravity-acp', 'brain', 'session-a'), { recursive: true });
      await writeFile(join(home, 'antigravity-acp', 'conversations', 'session-a.db'), 'private conversation');
      await writeFile(join(home, 'antigravity-acp', 'brain', 'session-a', 'artifact.md'), 'private artifact');
      const tokenPath = join(home, 'antigravity-acp', 'acp_token.json');
      const token: unknown = JSON.parse(await readFile(tokenPath, 'utf8'));
      await writeFile(tokenPath, JSON.stringify({ ...(token as Record<string, unknown>), project_id: 'runtime-discovered-project' }));
      const restarted = await materialize('second-session');
      expect(restarted!.env.GEMINI_HOME).toBe(home);
      expect(restarted!.cleanupOnFailure).toBeNull();
      expect(restarted!.cleanupOnExit).toBeNull();
      expect(await readFile(join(home, 'antigravity-acp', 'conversations', 'session-a.db'), 'utf8')).toBe('private conversation');
      expect(await readFile(join(home, 'antigravity-acp', 'brain', 'session-a', 'artifact.md'), 'utf8')).toBe('private artifact');
      expect(JSON.parse(await readFile(tokenPath, 'utf8'))).toMatchObject({ project_id: 'runtime-discovered-project' });
    });
  });
  it('keeps isolated account histories private across A to B and same-account refresh despite a prior home', async () => {
    await withTempDir('agy-isolated-accounts-', async cwd => {
      const native = join(cwd, 'native');
      await mkdir(join(native, 'antigravity-acp', 'conversations'), { recursive: true });
      await writeFile(join(native, 'antigravity-acp', 'conversations', 'native.db'), 'native conversation');
      const materialize = (key: string, selected: ConnectedServiceCredentialRecordV1, previousMaterializedRoot?: string) => materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: key, activeServerDir: cwd,
        baseDir: join(cwd, 'materialized'), sessionDirectory: cwd, previousMaterializedRoot,
        processEnv: { HOME: cwd, GEMINI_HOME: native }, recordsByServiceId: new Map([['antigravity', selected]]),
        accountSettings: { connectedServicesProviderStateSharingSettingsV1: {
          v: 1, defaults: { configMode: 'isolated', stateMode: 'isolated' }, byAgentId: {},
        } },
      });
      const a = await materialize('account-a', record);
      const aHome = a!.env.GEMINI_HOME;
      await mkdir(join(aHome, 'antigravity-acp', 'conversations'), { recursive: true });
      await mkdir(join(aHome, 'antigravity-acp', 'brain', 'private-a'), { recursive: true });
      await writeFile(join(aHome, 'antigravity-acp', 'conversations', 'private-a.db'), 'account-a conversation');
      await writeFile(join(aHome, 'antigravity-acp', 'brain', 'private-a', 'artifact.md'), 'account-a artifact');
      const selectedB: ConnectedServiceCredentialRecordV1 = {
        ...record, profileId: 'b', oauth: { ...record.oauth,
          refreshToken: 'account-b-refresh', accessToken: 'account-b-access', providerAccountId: 'account-b',
        },
      };
      const b = await materialize('account-b', selectedB, aHome);
      const bHome = b!.env.GEMINI_HOME;
      expect(bHome).not.toBe(aHome);
      for (const home of [bHome, native]) {
        await expect(lstat(join(home, 'antigravity-acp', 'conversations', 'private-a.db'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(join(home, 'antigravity-acp', 'brain', 'private-a', 'artifact.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
      const refreshed = await materialize('refresh-a', { ...record, oauth: { ...record.oauth, accessToken: 'refreshed-a' } }, aHome);
      expect(refreshed!.env.GEMINI_HOME).toBe(aHome);
      expect(await readFile(join(aHome, 'antigravity-acp', 'conversations', 'private-a.db'), 'utf8')).toBe('account-a conversation');
      expect(await readFile(join(aHome, 'antigravity-acp', 'brain', 'private-a', 'artifact.md'), 'utf8')).toBe('account-a artifact');
      for (const home of [aHome, bHome]) {
        await expect(lstat(join(home, 'antigravity-acp', 'conversations', 'native.db'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
      expect(await readFile(join(native, 'antigravity-acp', 'conversations', 'native.db'), 'utf8')).toBe('native conversation');
      expect(JSON.parse(await readFile(join(aHome, 'antigravity-acp', 'acp_token.json'), 'utf8'))).toMatchObject({ token: 'refreshed-a' });
      expect(JSON.parse(await readFile(join(bHome, 'antigravity-acp', 'acp_token.json'), 'utf8'))).toMatchObject({ token: 'account-b-access' });
    });
  });
  it('writes only known OAuth scopes and keeps temporary probes outside durable history', async () => {
    await withTempDir('agy-probe-account-', async cwd => {
      const durable = resolveConnectedServiceHomeDir({ activeServerDir: cwd, serviceId: 'antigravity', profileId: 'a', agentId: 'agy' });
      const selected: ConnectedServiceCredentialRecordV1 = { ...record, oauth: { ...record.oauth, scope: 'cloud-platform userinfo.email' } };
      const probe = await materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: 'probe', materializationPurpose: 'probe', activeServerDir: cwd,
        baseDir: join(cwd, 'probes'), sessionDirectory: cwd, processEnv: { HOME: cwd },
        recordsByServiceId: new Map([['antigravity', selected]]),
      });
      expect(probe!.env.GEMINI_HOME).not.toBe(durable);
      await mkdir(join(probe!.env.GEMINI_HOME, 'antigravity-acp', 'conversations'), { recursive: true });
      await writeFile(join(probe!.env.GEMINI_HOME, 'antigravity-acp', 'conversations', 'probe-session.db'), 'probe conversation');
      expect((await lstat(join(probe!.env.GEMINI_HOME, 'antigravity-acp', 'conversations'))).isSymbolicLink()).toBe(false);
      await expect(lstat(join(cwd, '.gemini', 'antigravity-acp', 'conversations'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.parse(await readFile(join(probe!.env.GEMINI_HOME, 'antigravity-acp', 'acp_token.json'), 'utf8'))).toMatchObject({ scopes: ['cloud-platform', 'userinfo.email'] });
      await expect(lstat(durable)).rejects.toMatchObject({ code: 'ENOENT' });
      const unknown = await materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: 'unknown', activeServerDir: cwd, baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd }, recordsByServiceId: new Map([['antigravity', record]]),
      });
      expect(JSON.parse(await readFile(join(unknown!.env.GEMINI_HOME, 'antigravity-acp', 'acp_token.json'), 'utf8'))).toMatchObject({ scopes: [] });
    });
  });
  it('does not carry a different grant project into a replacement account credential', async () => {
    await withTempDir('agy-replaced-grant-', async cwd => {
      const home = resolveConnectedServiceHomeDir({ activeServerDir: cwd, serviceId: 'antigravity', profileId: 'a', agentId: 'agy' });
      await mkdir(join(home, 'antigravity-acp'), { recursive: true });
      await writeFile(join(home, 'antigravity-acp', 'acp_token.json'), JSON.stringify({
        client_id: AGY_OAUTH_CLIENT_ID, token_uri: AGY_OAUTH_TOKEN_URL,
        refresh_token: 'previous-grant', project_id: 'previous-project',
      }));
      const result = await materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: 'replace', activeServerDir: cwd, baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd }, recordsByServiceId: new Map([['antigravity', record]]),
      });
      expect(JSON.parse(await readFile(join(result!.env.GEMINI_HOME, 'antigravity-acp', 'acp_token.json'), 'utf8'))).not.toHaveProperty('project_id');
    });
  });
  it('keeps the registered OAuth issuer despite unrelated machine environment overrides', async () => {
    await withTempDir('agy-configured-issuer-', async cwd => {
      const result = await materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: 'issuer', activeServerDir: cwd, baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd,
          HAPPIER_CONNECTED_SERVICES_ANTIGRAVITY_OAUTH_CLIENT_ID: 'fixture-client',
          HAPPIER_CONNECTED_SERVICES_ANTIGRAVITY_OAUTH_CLIENT_SECRET: 'fixture-client-secret',
          HAPPIER_CONNECTED_SERVICES_ANTIGRAVITY_OAUTH_TOKEN_URL: 'https://issuer.example.test/token',
        }, recordsByServiceId: new Map([['antigravity', record]]),
      });
      expect(JSON.parse(await readFile(join(result!.env.GEMINI_HOME, 'antigravity-acp', 'acp_token.json'), 'utf8'))).toMatchObject({
        client_id: AGY_OAUTH_CLIENT_ID, client_secret: AGY_OAUTH_CLIENT_SECRET, token_uri: AGY_OAUTH_TOKEN_URL,
      });
    });
  });
  it('preserves only the selected consumer project in the private token instead of GCP business settings', async () => {
    await withTempDir('agy-selected-project-', async cwd => {
      const selected: ConnectedServiceCredentialRecordV1 = { ...record, oauth: { ...record.oauth, raw: { project_id: 'selected-consumer-project' } } };
      const result = await materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: 'project', activeServerDir: cwd, baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd }, recordsByServiceId: new Map([['antigravity', selected]]),
        accountSettings: { connectedServicesProviderStateSharingSettingsV1: { v: 1, defaults: { configMode: 'isolated', stateMode: 'isolated' }, byAgentId: {} } },
      });
      expect(JSON.parse(await readFile(join(result!.env.GEMINI_HOME, 'antigravity-acp', 'acp_token.json'), 'utf8'))).toMatchObject({ project_id: 'selected-consumer-project' });
      expect(JSON.parse(await readFile(join(result!.env.GEMINI_HOME, 'antigravity-acp', 'settings.json'), 'utf8'))).toEqual({ auth: { type: 'oauth-personal' } });
    });
  });
  it('establishes declared shared child directories on the first connected launch', async () => {
    await withTempDir('agy-first-shared-', async cwd => {
      const native = join(cwd, 'native');
      const result = await materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: 'first', activeServerDir: cwd, baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd, GEMINI_HOME: native }, recordsByServiceId: new Map([['antigravity', record]]),
      });
      expect(result).not.toBeNull();
      await expect(realpath(join(result!.env.GEMINI_HOME, 'antigravity-acp', 'conversations'))).resolves.toBe(await realpath(join(native, 'antigravity-acp', 'conversations')));
      await expect(realpath(join(result!.env.GEMINI_HOME, 'antigravity-acp', 'brain'))).resolves.toBe(await realpath(join(native, 'antigravity-acp', 'brain')));
    });
  });
  it('keeps the auth parent private while inheriting config and sharing conversation sidecars and brain', async () => {
    await withTempDir('agy-materialized-', async (cwd) => {
      const native = join(cwd, 'native');
      await mkdir(join(native, 'antigravity-acp', 'conversations'), { recursive: true });
      await mkdir(join(native, 'antigravity-acp', 'brain', 'session-a'), { recursive: true });
      await mkdir(join(native, 'config', 'skills'), { recursive: true });
      await writeFile(join(native, 'config', 'skills', 'SKILL.md'), 'native skill');
      await writeFile(join(native, 'antigravity-acp', 'acp_token.json'), 'native credential');
      await writeFile(join(native, 'antigravity-acp', 'trusted_workspaces.json'), '{}');
      await writeFile(join(native, 'antigravity-acp', 'conversations', 'session-a.db-wal'), 'wal');
      const materialize = (key: string, profileId: string) => materializeConnectedServicesForSpawn({
        agentId: 'agy', materializationKey: key, activeServerDir: cwd, baseDir: join(cwd, 'materialized'), sessionDirectory: cwd,
        processEnv: { HOME: cwd, GEMINI_HOME: native }, recordsByServiceId: new Map([['antigravity', { ...record, profileId }]]),
      });
      const a = await materialize('a', 'a');
      const b = await materialize('b', 'b');
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      const aHome = a!.env.GEMINI_HOME;
      const bHome = b!.env.GEMINI_HOME;
      expect(a!.env).toMatchObject({ AGY_ACP_FORCE_FILE_STORAGE: '1' });
      expect(a!.env.HOME).toBeUndefined();
      expect(aHome).not.toBe(bHome);
      expect((await lstat(join(aHome, 'antigravity-acp'))).isSymbolicLink()).toBe(false);
      expect(await realpath(join(aHome, 'antigravity-acp', 'conversations'))).toBe(await realpath(join(native, 'antigravity-acp', 'conversations')));
      expect(await realpath(join(aHome, 'antigravity-acp', 'brain'))).toBe(await realpath(join(native, 'antigravity-acp', 'brain')));
      expect(await readFile(join(aHome, 'config', 'skills', 'SKILL.md'), 'utf8')).toBe('native skill');
      expect(await readFile(join(bHome, 'antigravity-acp', 'conversations', 'session-a.db-wal'), 'utf8')).toBe('wal');
      const token = JSON.parse(await readFile(join(aHome, 'antigravity-acp', 'acp_token.json'), 'utf8'));
      expect(token).toMatchObject({ refresh_token: 'fixture-refresh', token: 'fixture-access', expiry: '2033-05-18T03:33:20Z' });
      expect(JSON.parse(await readFile(join(aHome, 'antigravity-acp', 'settings.json'), 'utf8'))).toEqual({ auth: { type: 'oauth-personal' } });
      await writeFile(join(aHome, 'antigravity-acp', 'acp_token.json'), 'logged out');
      await writeFile(join(aHome, 'antigravity-acp', 'trusted_workspaces.json'), '{"a":true}');
      expect(await readFile(join(native, 'antigravity-acp', 'acp_token.json'), 'utf8')).toBe('native credential');
      expect(await readFile(join(bHome, 'antigravity-acp', 'acp_token.json'), 'utf8')).not.toBe('logged out');
      expect(await readFile(join(native, 'antigravity-acp', 'trusted_workspaces.json'), 'utf8')).toBe('{}');
    });
  });
});
