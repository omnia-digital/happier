import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    describeHappierCliOrigin,
    readHappierCliChoiceSync,
    resolveForeignHappierCli,
    resolveHappierCliChoiceStatePath,
    resolveTerminalHappierCli,
    writeHappierCliChoice,
} from './index.js';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;
const tempDirs: string[] = [];

async function createHome(): Promise<string> {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-cli-choice-'));
    tempDirs.push(homeDir);
    return homeDir;
}

async function writeExecutable(path: string): Promise<void> {
    await writeFile(path, '#!/bin/sh\n', 'utf8');
    await chmod(path, 0o755);
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
    }));
});

describe('the computer-scoped CLI choice (R12)', () => {
    it('is absent until one is recorded, then reads back exactly what was recorded beside the managed layout', async () => {
        const homeDir = await createHome();
        const processEnv = { HOME: homeDir };

        expect(readHappierCliChoiceSync({ processEnv })).toBeNull();

        await writeHappierCliChoice({ choice: { mode: 'own', command: '/usr/local/bin/happier' }, processEnv });
        expect(resolveHappierCliChoiceStatePath({ processEnv })).toBe(join(homeDir, '.happier', 'cli-choice.json'));
        expect(readHappierCliChoiceSync({ processEnv })).toEqual({ mode: 'own', command: '/usr/local/bin/happier' });

        await writeHappierCliChoice({ choice: { mode: 'managed' }, processEnv });
        expect(readHappierCliChoiceSync({ processEnv })).toEqual({ mode: 'managed' });
        expect(JSON.parse(await readFile(join(homeDir, '.happier', 'cli-choice.json'), 'utf8'))).toEqual({ mode: 'managed' });
    });

    it('reads an unreadable or incomplete record as no choice, never as a mode', async () => {
        const homeDir = await createHome();
        const processEnv = { HOME: homeDir };
        await mkdir(join(homeDir, '.happier'), { recursive: true });

        await writeFile(join(homeDir, '.happier', 'cli-choice.json'), '{ not json', 'utf8');
        expect(readHappierCliChoiceSync({ processEnv })).toBeNull();

        await writeFile(join(homeDir, '.happier', 'cli-choice.json'), JSON.stringify({ mode: 'own' }), 'utf8');
        expect(readHappierCliChoiceSync({ processEnv })).toBeNull();

        await writeFile(join(homeDir, '.happier', 'cli-choice.json'), JSON.stringify({ mode: 'something' }), 'utf8');
        expect(readHappierCliChoiceSync({ processEnv })).toBeNull();
    });
});

posixOnly('a happier this app did not install (R12)', () => {
    it('is found on PATH, and the managed shim or an installer link to it is not foreign', async () => {
        const homeDir = await createHome();
        const binDir = join(homeDir, '.happier', 'bin');
        const npmBin = join(homeDir, 'npm-global', 'bin');
        await mkdir(npmBin, { recursive: true });
        await writeExecutable(join(npmBin, 'happier'));

        expect(resolveForeignHappierCli({ binDir, processEnv: { HOME: homeDir, PATH: `/usr/bin:${npmBin}` } }))
            .toBe(join(npmBin, 'happier'));

        const versionDir = join(homeDir, '.happier', 'cli', 'versions', '1.0.0');
        await mkdir(versionDir, { recursive: true });
        await mkdir(binDir, { recursive: true });
        await writeExecutable(join(versionDir, 'happier'));
        await symlink(join(versionDir, 'happier'), join(binDir, 'happier'));
        const localBin = join(homeDir, '.local', 'bin');
        await mkdir(localBin, { recursive: true });
        await symlink(join(binDir, 'happier'), join(localBin, 'happier'));

        expect(resolveForeignHappierCli({ binDir, processEnv: { HOME: homeDir, PATH: localBin } })).toBeNull();
        expect(resolveForeignHappierCli({ binDir, processEnv: { HOME: homeDir, PATH: '/nonexistent' } })).toBeNull();
        // R13(b): after "Let Happier manage it" the managed shim (or the installer link to it) answers
        // first; the copy the person may remove is still found behind it.
        expect(resolveForeignHappierCli({ binDir, processEnv: { HOME: homeDir, PATH: `${binDir}:${npmBin}` } }))
            .toBe(join(npmBin, 'happier'));
        expect(resolveForeignHappierCli({ binDir, processEnv: { HOME: homeDir, PATH: `${localBin}:${binDir}:${npmBin}` } }))
            .toBe(join(npmBin, 'happier'));
    });

    it('on Windows finds the npm command shim behind the managed happier.exe, through PATHEXT (R13)', async () => {
        const homeDir = await createHome();
        const binDir = join(homeDir, '.happier', 'bin');
        const npmDir = join(homeDir, 'AppData', 'Roaming', 'npm');
        await mkdir(binDir, { recursive: true });
        await mkdir(npmDir, { recursive: true });
        await writeExecutable(join(binDir, 'happier.exe'));
        await writeFile(join(npmDir, 'happier.cmd'), '@ECHO off\r\n', 'utf8');
        const realPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            // `Path` spelled the Windows way; the delimiter is this host's, as node:path reports it.
            expect(resolveForeignHappierCli({ binDir, processEnv: { Path: `${binDir}${delimiter}${npmDir}`, PATHEXT: '.EXE;.CMD' } })?.toLowerCase())
                .toBe(join(npmDir, 'happier.cmd').toLowerCase());
            expect(resolveForeignHappierCli({ binDir, processEnv: { Path: binDir, PATHEXT: '.EXE;.CMD' } })).toBeNull();
        } finally {
            Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
        }
    });

    it('says which happier a new terminal runs first, and whether a managed one got there through what Desktop can take back (RV3-1)', async () => {
        const homeDir = await createHome();
        const binDir = join(homeDir, '.happier', 'bin');
        const npmBin = join(homeDir, 'npm-global', 'bin');
        const localBin = join(homeDir, '.local', 'bin');
        await mkdir(npmBin, { recursive: true });
        await writeExecutable(join(npmBin, 'happier'));
        await mkdir(binDir, { recursive: true });
        await writeExecutable(join(binDir, 'happier'));
        await mkdir(localBin, { recursive: true });
        await symlink(join(binDir, 'happier'), join(localBin, 'happier'));
        const terminal = (PATH: string) => resolveTerminalHappierCli({ binDir, processEnv: { HOME: homeDir, PATH } });

        expect(terminal(`${npmBin}:${localBin}`)).toEqual({ command: join(npmBin, 'happier'), managed: false, desktopExposed: false });
        // Desktop's own line exposes the managed bin dir itself; "Keep my own" takes that line back.
        expect(terminal(`${binDir}:${npmBin}`)).toEqual({ command: join(binDir, 'happier'), managed: true, desktopExposed: true });
        // The installer's link is not Desktop's to remove.
        expect(terminal(`${localBin}:${npmBin}`)).toEqual({ command: join(localBin, 'happier'), managed: true, desktopExposed: false });
        // A Dock-launched macOS app also searches the user's home bins, even with an empty process PATH.
        expect(terminal('/nonexistent')).toEqual(process.platform === 'darwin'
            ? { command: join(localBin, 'happier'), managed: true, desktopExposed: false }
            : null);
    });

    it('on Windows counts the managed bin dir as Desktop\'s only when Desktop recorded adding or moving it (RV3-1)', async () => {
        const homeDir = await createHome();
        const binDir = join(homeDir, '.happier', 'bin');
        await mkdir(binDir, { recursive: true });
        await writeExecutable(join(binDir, 'happier.exe'));
        const realPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            const terminal = (extra: Record<string, string>) => resolveTerminalHappierCli({ binDir, processEnv: { Path: binDir, PATHEXT: '.EXE', ...extra } });
            // The PowerShell installer's own entry.
            expect(terminal({})).toMatchObject({ managed: true, desktopExposed: false });
            expect(terminal({ HAPPIER_DESKTOP_PATH_ENTRIES: binDir.toUpperCase() })).toMatchObject({ managed: true, desktopExposed: true });
            expect(terminal({ HAPPIER_DESKTOP_PATH_MOVES: `${binDir}|C:\\npm` })).toMatchObject({ managed: true, desktopExposed: true });
        } finally {
            Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
        }
    });

    it('names an npm global install by its real package name, with the commands that remove and update it', async () => {
        const homeDir = await createHome();
        const prefix = join(homeDir, 'npm-global');
        const packageRoot = join(prefix, 'lib', 'node_modules', '@happier-dev', 'cli');
        await mkdir(join(packageRoot, 'bin'), { recursive: true });
        await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@happier-dev/cli', version: '0.2.13' }), 'utf8');
        await writeExecutable(join(packageRoot, 'bin', 'happier.mjs'));
        await mkdir(join(prefix, 'bin'), { recursive: true });
        await symlink(join(packageRoot, 'bin', 'happier.mjs'), join(prefix, 'bin', 'happier'));

        expect(describeHappierCliOrigin(join(prefix, 'bin', 'happier'))).toEqual({
            kind: 'npm',
            packageName: '@happier-dev/cli',
            removalCommand: 'npm uninstall -g @happier-dev/cli',
            updateCommand: 'npm install -g @happier-dev/cli@latest',
        });
    });

    it('names an npm-generated Windows command shim by the package it launches', async () => {
        const homeDir = await createHome();
        const npmDir = join(homeDir, 'AppData', 'Roaming', 'npm');
        const packageRoot = join(npmDir, 'node_modules', '@happier-dev', 'cli');
        await mkdir(join(packageRoot, 'bin'), { recursive: true });
        await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@happier-dev/cli' }), 'utf8');
        await writeFile(
            join(npmDir, 'happier.cmd'),
            '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@happier-dev\\cli\\bin\\happier.mjs" %*\r\n',
            'utf8',
        );

        expect(describeHappierCliOrigin(join(npmDir, 'happier.cmd'))).toMatchObject({
            kind: 'npm',
            packageName: '@happier-dev/cli',
            removalCommand: 'npm uninstall -g @happier-dev/cli',
        });
    });

    it('names a Homebrew install by its formula', async () => {
        const homeDir = await createHome();
        const cellarBin = join(homeDir, 'homebrew', 'Cellar', 'happier', '0.2.13', 'bin');
        await mkdir(cellarBin, { recursive: true });
        await writeExecutable(join(cellarBin, 'happier'));
        const brewBin = join(homeDir, 'homebrew', 'bin');
        await mkdir(brewBin, { recursive: true });
        await symlink(join(cellarBin, 'happier'), join(brewBin, 'happier'));

        expect(describeHappierCliOrigin(join(brewBin, 'happier'))).toEqual({
            kind: 'brew',
            formula: 'happier',
            removalCommand: 'brew uninstall happier',
            updateCommand: 'brew upgrade happier',
            // The origin reads the resolved path, so macOS temp dirs appear under /private.
            optPath: join(realpathSync(homeDir), 'homebrew', 'opt', 'happier', 'bin', 'happier'),
        });
    });

    it('names anything else by its path only, offering no command it cannot vouch for', async () => {
        const homeDir = await createHome();
        const manual = join(homeDir, 'bin', 'happier');
        await mkdir(join(homeDir, 'bin'), { recursive: true });
        await writeExecutable(manual);

        expect(describeHappierCliOrigin(manual)).toEqual({ kind: 'unknown', removalCommand: null, updateCommand: null });
    });
});
