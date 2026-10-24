import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('retains root and UI dependencies when checkout ancestors resemble workspace paths', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'happier-metro-root-')));
    const relocatedRepo = join(fixture, 'apps', 'happier[dev]+(fork)');
    mkdirSync(dirname(relocatedRepo), { recursive: true });
    symlinkSync(repoRoot, relocatedRepo, process.platform === 'win32' ? 'junction' : 'dir');

    try {
        // A real relocated checkout makes the regression independent of the CI checkout path.
        // Preserve symlinks so the production config observes that location without copying dependencies.
        const probe = spawnSync(process.execPath, ['--preserve-symlinks', '-e', `
            const path = require('node:path');
            const configPath = process.argv[1];
            const root = path.resolve(path.dirname(configPath), '../..');
            const config = require(configPath);
            const blockList = [config.resolver.blockList].flat().filter(Boolean);
            const cases = [
                'node_modules/metro-runtime/src/modules/empty-module.js',
                'node_modules/expo-constants/build/Constants.js',
                'node_modules/vendor/packages/nested/node_modules/index.js',
                'apps/ui/node_modules/react/index.js',
                'apps/cli/node_modules/dependency/index.js',
                'apps/ui-kit/node_modules/dependency/index.js',
                'apps/tool+(old)/node_modules/dependency/index.js',
                'packages/lib[legacy]/node_modules/dependency/index.js',
            ];
            const blocked = candidate => blockList.some(pattern => pattern.test(candidate));
            process.stdout.write(JSON.stringify(cases.map(relativePath => {
                const native = path.join(root, ...relativePath.split('/'));
                const alternate = native.split(path.sep).join(path.sep === '/' ? '\\\\' : '/');
                return [relativePath, blocked(native), blocked(alternate)];
            })));
        `, join(relocatedRepo, 'apps/ui/metro.config.js')], {
            encoding: 'utf8',
            timeout: 30_000,
        });

        expect(probe.error).toBeUndefined();
        expect(probe.status, probe.stderr).toBe(0);
        expect(JSON.parse(probe.stdout)).toEqual([
            ['node_modules/metro-runtime/src/modules/empty-module.js', false, false],
            ['node_modules/expo-constants/build/Constants.js', false, false],
            ['node_modules/vendor/packages/nested/node_modules/index.js', false, false],
            ['apps/ui/node_modules/react/index.js', false, false],
            ['apps/cli/node_modules/dependency/index.js', true, true],
            ['apps/ui-kit/node_modules/dependency/index.js', true, true],
            ['apps/tool+(old)/node_modules/dependency/index.js', true, true],
            ['packages/lib[legacy]/node_modules/dependency/index.js', true, true],
        ]);
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});
