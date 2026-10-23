import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    ['palette', [{ key: 'Alt+K', scope: 'web' }, { key: 'Mod+K', scope: 'everywhere except web' }]],
    ['unbound', []],
  ]);
});

test('includes the real mapped registry entries and retains macOS scope', () => {
  const commands = parseKeyboardCommands(registry);
  assert.equal(commands.size, 43);
  for (let number = 1; number <= 9; number += 1) {
    assert.deepEqual(commands.get(`session.number.${number}`), [{ key: `Mod+${number}`, scope: 'macOS' }]);
  }
  assert.deepEqual(commands.get('session.hovered.archive'), [{ key: 'A', scope: 'macOS' }]);
  assert.deepEqual(commands.get('composer.sendImmediate'), [{ key: 'Mod+Enter', scope: null }]);
});

test('renders mapped commands with their defaults and platform scope', async () => {
  const markdown = await renderKeyboardReferenceMarkdown();
  for (let number = 1; number <= 9; number += 1) {
    assert.ok(markdown.includes(`| Open session ${number} | \`Mod+${number}\` (macOS) |`));
  }
  assert.ok(markdown.includes('**off by default**'));
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
