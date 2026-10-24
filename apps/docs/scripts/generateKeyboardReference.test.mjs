import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseKeyboardCommands, renderKeyboardReferenceMarkdown } from './generateKeyboardReference.mjs';

const registry = readFileSync(new URL('../../ui/sources/keyboard/commands.ts', import.meta.url), 'utf8');

test('reads literal registry entries independent of layout and quote style', () => {
  const commands = parseKeyboardCommands(`export const defaultKeyboardCommands = [
    { id: "palette", defaultBindings: [
      { binding: "Alt+K", platforms: ["web"] },
      { binding: "Mod+K", blockedSurfaces: ["web"] }
    ] }, { id: 'unbound' }
  ];`);
  assert.deepEqual([...commands], [
    ['palette', { bindings: [{ key: 'Alt+K', scope: 'web' }, { key: 'Mod+K', scope: 'everywhere except web' }], settingsTitleKey: null }],
    ['unbound', { bindings: [], settingsTitleKey: null }],
  ]);
});

test('includes every real registry entry and preserves each binding platform scope', () => {
  const commands = parseKeyboardCommands(registry);
  assert.equal(commands.size, 62);
  for (let number = 1; number <= 9; number += 1) {
    assert.deepEqual(commands.get(`session.number.${number}`), {
      bindings: [{ key: `Mod+${number}`, scope: 'macOS' }],
      settingsTitleKey: `settingsKeyboard.commands.sessionNumber${number}`,
    });
  }
  assert.deepEqual(commands.get('session.hovered.archive').bindings, [{ key: 'A', scope: null }]);
  assert.deepEqual(commands.get('composer.sendImmediate').bindings, [{ key: 'Mod+Enter', scope: null }]);
  const menuCommands = [...commands].filter(([id]) => id.startsWith('session.menu.'));
  assert.equal(menuCommands.length, 19);
  for (const [, command] of menuCommands) {
    assert.equal(command.bindings.length, 1);
    assert.equal(command.bindings[0].scope, null);
    assert.ok(command.settingsTitleKey);
  }
});

test('renders mapped commands with their defaults and platform scope', async () => {
  const markdown = await renderKeyboardReferenceMarkdown();
  for (let number = 1; number <= 9; number += 1) {
    assert.ok(markdown.includes(`| Open session ${number} | \`Mod+${number}\` (macOS) |`));
  }
  assert.ok(markdown.includes('**off by default**'));
  assert.ok(markdown.includes('| Archive Session | `A` |'));
  assert.ok(markdown.includes('| Rename Session | `Alt+Shift+E` |'));
  assert.ok(markdown.includes('| Pin session | `Alt+Shift+P` |'));
  assert.ok(!markdown.includes('Not yet grouped'));
});

test('renders menu labels from the registry translation key and fails on missing labels', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'keyboard-reference-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commandsPath = join(directory, 'commands.ts');
  const translationsPath = join(directory, 'en.ts');
  writeFileSync(commandsPath, `export const defaultKeyboardCommands = [
    { id: 'session.menu.rename', settingsTitleKey: 'sessionInfo.renameSession', defaultBinding: { binding: 'Alt+R' } }
  ];`);
  writeFileSync(translationsPath, `export const en = { sessionInfo: { renameSession: 'Rename from the current UI' } };`);
  const markdown = await renderKeyboardReferenceMarkdown({ commandsPath, translationsPath });
  assert.ok(markdown.includes('| Rename from the current UI | `Alt+R` |'));
  writeFileSync(translationsPath, `export const en = { sessionInfo: {} };`);
  await assert.rejects(() => renderKeyboardReferenceMarkdown({ commandsPath, translationsPath }), /sessionInfo.renameSession/);
});

test('rejects unsupported registry shapes instead of publishing a partial reference', () => {
  for (const source of [
    `export const defaultKeyboardCommands = [{ id: 'known' }, ...moreCommands];`,
    `export const defaultKeyboardCommands = [{ id: 'known', defaultBinding: makeBinding() }];`,
    `export const defaultKeyboardCommands = [{ id: 'known', defaultBinding: { binding: 'K', platforms: supportedPlatforms } }];`,
    `export const defaultKeyboardCommands = [{ ...other, id: 'known' }];`,
    `export const defaultKeyboardCommands = [{ id: 'known' }, { id: 'known' }];`,
    `export const defaultKeyboardCommands = [];`,
  ]) {
    assert.throws(() => parseKeyboardCommands(source), /keyboard|registry|Unsupported/);
  }
});
