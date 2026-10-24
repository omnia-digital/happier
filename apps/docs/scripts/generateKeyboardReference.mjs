/**
 * Renders the keyboard shortcut reference from the client's command registry.
 *
 * Two reasons this is generated rather than written. Bindings drift with every
 * platform tweak, and a shortcut list that is wrong is worse than none — you
 * press the key, nothing happens, and you stop trusting the page. And the
 * August 2026 release notes state the command palette opens with `/`, which is
 * not what the registry says on any platform; a generated page cannot repeat
 * that mistake.
 *
 * Read the registry's literal entries and literal-array maps without executing UI
 * code. Unsupported source shapes fail generation rather than omit commands.
 * TypeScript is used only for its syntax tree, not compilation or transpilation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readTranslationString } from './readTranslationString.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const COMMANDS = join(REPO, 'apps', 'ui', 'sources', 'keyboard', 'commands.ts');
const TRANSLATIONS = join(REPO, 'apps', 'ui', 'sources', 'text', 'translations', 'en.ts');
const SETTINGS = join(
  REPO, 'apps', 'ui', 'sources', 'sync', 'domains', 'settings', 'registry', 'account',
  'accountKeyboardShortcutSettingDefinitions.ts',
);
export const OUTPUT_PATH = join(HERE, '..', 'content', 'docs', 'apps', 'keyboard-shortcuts.mdx');

/**
 * Group commands by task. Labels come from the command's settings title; the
 * descriptions below only cover internal commands without a UI title.
 */
const GROUPS = [
  {
    title: 'Moving between sessions',
    commands: [
      'session.new',
      ...Array.from({ length: 9 }, (_, index) => `session.number.${index + 1}`),
      'session.mru.next',
      'session.mru.previous',
      'session.visible.next',
      'session.visible.previous',
    ],
  },
  {
    title: 'The session list',
    commands: [
      'session.hovered.archive',
      'sessions.row.moveUp',
      'sessions.row.moveDown',
      'sessions.row.moveToFolder',
      'sessions.row.moveToWorkspaceRoot',
      'sessions.selection.toggleFocused',
      'sessions.selection.extendUp',
      'sessions.selection.extendDown',
      'sessions.selection.selectAll',
      'sessions.selection.clear',
    ],
  },
  {
    title: 'Writing and sending',
    commands: [
      'composer.focus',
      'composer.sendImmediate',
      'composer.sendPending',
      'composer.abortConfirm',
      'mode.cycle',
      'permission.cycle',
    ],
  },
  {
    title: 'Reading the transcript',
    commands: [
      'transcript.message.next',
      'transcript.message.previous',
      'transcript.scroll.top',
      'transcript.scroll.bottom',
      'transcript.scroll.pageUp',
      'transcript.scroll.pageDown',
      'transcript.selection.selectAll',
      'transcript.selection.copy',
      'transcript.selection.sendToSession',
      'transcript.selection.cancel',
    ],
  },
  {
    title: 'Everything else',
    commands: [
      'commandPalette.open',
      'shortcutsHelp.open',
      'settings.open',
    ],
  },
];

const COMMAND_DESCRIPTIONS = {
  'permission.cycle': 'Cycle permission mode',
  'transcript.message.next': 'Next message',
  'transcript.message.previous': 'Previous message',
  'transcript.selection.selectAll': 'Select every message',
  'transcript.selection.copy': 'Copy the selected messages',
  'transcript.selection.sendToSession': 'Send the selection to another session',
  'transcript.selection.cancel': 'Cancel the selection',
};

function unsupported(node) {
  throw new Error(`Unsupported keyboard registry syntax: ${node?.getText() ?? 'missing value'}`);
}

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) {
    node = node.expression;
  }
  return node;
}

function properties(node) {
  node = unwrap(node);
  if (!node || !ts.isObjectLiteralExpression(node)) return unsupported(node);
  const result = new Map();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)
      || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      || result.has(property.name.text)) return unsupported(property);
    result.set(property.name.text, property.initializer);
  }
  return result;
}

// Only literal data and interpolation of the literal-array map parameter are
// supported. Predicates and other command behavior are never evaluated.
function literal(node, parameter) {
  node = unwrap(node);
  if (node && (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))) return node.text;
  if (node && ts.isTemplateExpression(node) && parameter) {
    return node.head.text + node.templateSpans.map((span) => {
      if (!ts.isIdentifier(span.expression) || span.expression.text !== parameter.name) return unsupported(span.expression);
      return parameter.value + span.literal.text;
    }).join('');
  }
  return unsupported(node);
}

function literalArray(node, parameter) {
  node = unwrap(node);
  if (!node || !ts.isArrayLiteralExpression(node)) return unsupported(node);
  return node.elements.map((element) => literal(element, parameter));
}

function parseBindings(command, parameter) {
  const multiple = command.get('defaultBindings');
  const single = command.get('defaultBinding');
  let rules = [];
  if (multiple) {
    const array = unwrap(multiple);
    if (!ts.isArrayLiteralExpression(array)) return unsupported(array);
    rules = [...array.elements];
  }
  if (!rules.length && single) rules = [single];
  return rules.map((rule) => {
    const fields = properties(rule);
    const platforms = fields.has('platforms') ? literalArray(fields.get('platforms'), parameter) : [];
    const blocked = fields.has('blockedSurfaces') ? literalArray(fields.get('blockedSurfaces'), parameter) : [];
    const labels = { macos: 'macOS', ios: 'iOS', windows: 'Windows', linux: 'Linux', android: 'Android', web: 'web', native: 'native' };
    const label = (value) => labels[value] ?? unsupported(rule);
    const scope = [
      platforms.length ? platforms.map(label).join(', ') : null,
      blocked.length ? `everywhere except ${blocked.map(label).join(', ')}` : null,
    ].filter(Boolean).join('; ') || null;
    return { key: literal(fields.get('binding'), parameter), scope };
  });
}

export function parseKeyboardCommands(source) {
  const file = ts.createSourceFile('commands.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) throw new Error('Invalid keyboard registry syntax');
  const declaration = file.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((entry) => ts.isIdentifier(entry.name) && entry.name.text === 'defaultKeyboardCommands');
  const array = unwrap(declaration?.initializer);
  if (!array || !ts.isArrayLiteralExpression(array)) return unsupported(array);
  const commands = new Map();
  const add = (node, parameter) => {
    const command = properties(node);
    const id = literal(command.get('id'), parameter);
    if (commands.has(id)) throw new Error(`Duplicate keyboard registry command: ${id}`);
    commands.set(id, {
      bindings: parseBindings(command, parameter),
      settingsTitleKey: command.has('settingsTitleKey') ? literal(command.get('settingsTitleKey'), parameter) : null,
    });
  };
  for (const entry of array.elements) {
    if (!ts.isSpreadElement(entry)) {
      add(entry);
      continue;
    }
    // The registry uses [...literalValues].map(value => ({ ...command })).
    // Deliberately reject other calls/spreads rather than interpreting programs.
    const call = unwrap(entry.expression);
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)
      || call.expression.name.text !== 'map' || call.arguments.length !== 1) return unsupported(entry);
    const callback = call.arguments[0];
    if (!ts.isArrowFunction(callback) || callback.parameters.length !== 1
      || !ts.isIdentifier(callback.parameters[0].name)
      || callback.parameters[0].initializer || callback.parameters[0].dotDotDotToken) return unsupported(callback);
    for (const value of literalArray(call.expression.expression)) {
      add(callback.body, { name: callback.parameters[0].name.text, value });
    }
  }
  if (commands.size === 0) throw new Error('keyboard commands.ts parsed to zero commands');
  return commands;
}

function readDefault(source, name) {
  const match = new RegExp(`${name}:\\s*\\{[^}]*?default:\\s*(true|false)`, 's').exec(source);
  if (!match) throw new Error(`Could not read the default for ${name}`);
  return match[1] === 'true';
}

function formatBindings(bindings) {
  if (!bindings || bindings.length === 0) return '_Unbound by default_';
  return bindings
    .map((b) => (b.scope ? `\`${b.key}\` (${b.scope})` : `\`${b.key}\``))
    .join(' · ');
}

export async function renderKeyboardReferenceMarkdown({
  commandsPath = COMMANDS,
  settingsPath = SETTINGS,
  translationsPath = TRANSLATIONS,
} = {}) {
  const commands = parseKeyboardCommands(readFileSync(commandsPath, 'utf8'));
  const translations = readFileSync(translationsPath, 'utf8');
  const settings = readFileSync(settingsPath, 'utf8');
  const paletteOn = readDefault(settings, 'commandPaletteEnabled');
  const shortcutsOn = readDefault(settings, 'keyboardShortcutsV2Enabled');

  const labelFor = (id) => {
    const key = commands.get(id).settingsTitleKey;
    if (!key) return COMMAND_DESCRIPTIONS[id] ?? `\`${id}\``;
    const label = readTranslationString(translations, key);
    if (!label) throw new Error(`Missing keyboard command translation: ${key}`);
    return label.replaceAll('|', '\\|').replaceAll('\n', ' ');
  };
  const rowFor = (id) => `| ${labelFor(id)} | ${formatBindings(commands.get(id).bindings)} |`;
  const groups = [...GROUPS];
  groups.splice(2, 0, {
    title: 'Session menu actions',
    commands: [...commands.keys()].filter((id) => id.startsWith('session.menu.')),
  });
  const grouped = groups.map((group) => {
    const rows = group.commands
      .filter((id) => commands.has(id))
      .map(rowFor);
    return rows.length ? `### ${group.title}\n\n| Action | Default |\n| --- | --- |\n${rows.join('\n')}` : null;
  }).filter(Boolean);

  const off = [
    shortcutsOn ? null : 'the shortcut registry',
    paletteOn ? null : 'the command palette',
  ].filter(Boolean);
  const gateNotice = off.length
    ? `${off.length === 2 ? 'Both' : 'This'} ${off.length === 2 ? 'features are' : 'feature is'} **off by default**: turn on ${off.join(' and ')} under **Settings → Keyboard shortcuts** to use those features.`
    : 'Shortcuts are on by default.';

  const covered = new Set(groups.flatMap((g) => g.commands));
  const uncovered = [...commands.keys()].filter((id) => !covered.has(id));

  const extras = uncovered.length
    ? `\n### Not yet grouped\n\n| Command | Default |\n| --- | --- |\n${uncovered
        .map(rowFor)
        .join('\n')}\n`
    : '';

  return `---
title: Keyboard shortcuts
description: Every rebindable shortcut and the command palette, with the defaults for web and native.
---

Find the default bindings for ${commands.size} keyboard commands below. Defaults
differ between the web client and the native apps where the platform already
claims a key.

<Callout>
  This reference follows the current development source. Numbered session navigation
  and session menu shortcuts are development additions;
  their availability in a stable release has not been verified.
</Callout>

<Callout type="warn">
  ${gateNotice}
</Callout>

\`Mod\` means Command on macOS and iOS, and Control everywhere else. Where a
binding is written literally as \`Ctrl\`, it is Control on every platform
including macOS — that is deliberate, because the key is standing in for a
platform convention rather than for "the modifier key".

## The command palette

The fastest way to reach anything without remembering a binding. It searches
built-in commands, your custom prompts and Happier actions in one list.

In the current development source, you can also type part of a session title to
find a session beyond the recent suggestions. Results show its path, machine and
server so similarly named sessions are easier to tell apart. Use the arrow keys
and Enter to open a result, or Escape to close the palette. Title search covers
unarchived sessions on your selected servers and loads older titles while you
search. Conversation text search is available
through Search Memory when that feature is enabled on a machine.

${formatBindings(commands.get('commandPalette.open')?.bindings)}

## Shortcuts

${grouped.join('\n\n')}
${extras}
Shortcuts respect focus. Most do nothing while you are typing in the composer,
which is why sending has its own explicitly editable-safe binding rather than
relying on you leaving the field first.

Session menu shortcuts target the open menu's session first, then the hovered row,
then the focused row. Other than Archive, they can also fall back to the selected
session. Only actions available in that session's menu run; state-dependent actions
use the current option, such as Pin or Unpin. Shortcuts do nothing in text inputs
or unrelated overlays. Archive's \`A\` binding remains available when single-key
shortcuts are disabled; disabling or rebinding Archive itself still applies.
On native iOS and Android, the hardware keyboard integration currently supports
only Enter and Escape bindings, so these session menu chords are available on
desktop and web.

## Changing them

**Settings → Keyboard shortcuts** lists the configurable commands with their current
bindings and lets you disable, rebind, or reset them. Numbered session shortcuts
appear individually as Open session 1 through Open session 9. Conflicts are detected
as you assign them, and your choices are saved to your account settings.

## Related

- [Session settings](/sessions/session-settings)
- [Prompts, skills, templates, and registries](/extending/prompts-and-skills) — what else the palette can reach.
`;
}

const isEntrypoint = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isEntrypoint) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUTPUT_PATH, await renderKeyboardReferenceMarkdown(), 'utf8');
  console.log(`wrote ${OUTPUT_PATH}`);
}
