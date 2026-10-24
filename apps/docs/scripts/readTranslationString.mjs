/**
 * Resolve one dotted key out of the client's `en.ts`.
 *
 * `checkContent.mjs` reads that file line by line because it only needs the set
 * of shipped values; a key lookup needs the structure, since the same leaf name
 * lives under a dozen parents. So this walks the object, skipping comments,
 * strings and template expressions — a brace or an apostrophe inside copy must
 * not desynchronise the walk, which is exactly how the naive version of this
 * loses the rest of the file.
 */
export function readTranslationString(source, dottedKey) {
  // The locale file is one root object plus a handful of `const …Extension` objects spread into
  // it, so a key can live in either. Try each root and take the first that resolves the whole path.
  for (const root of rootObjectBodies(source)) {
    const value = resolveTranslationInRange(source, root, dottedKey);
    if (value !== null) return value;
  }
  return null;
}

function* rootObjectBodies(source) {
  const declaration = /(?:^|\n)(?:export\s+)?const\s+[A-Za-z0-9_$]+\s*(?::[^=\n]*)?=\s*\{/g;
  let match = declaration.exec(source);
  while (match !== null) {
    const body = objectBody(source, source.indexOf('{', match.index + match[0].length - 1));
    if (body !== null) yield body;
    match = declaration.exec(source);
  }
}

function resolveTranslationInRange(source, range, dottedKey) {
  const segments = dottedKey.split('.');
  let from = range.start;
  let to = range.end;
  for (let i = 0; i < segments.length; i += 1) {
    const valueAt = findPropertyValue(source, from, to, segments[i]);
    if (valueAt === null) return null;
    if (i === segments.length - 1) return readStringLiteral(source, valueAt);
    if (source[valueAt] !== '{') return null;
    const body = objectBody(source, valueAt);
    if (body === null) return null;
    from = body.start;
    to = body.end;
  }
  return null;
}

const IDENTIFIER = /[A-Za-z0-9_$]/;

function endOfString(source, at) {
  const quote = source[at];
  let i = at + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === quote) return i + 1;
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      i = endOfBraces(source, i + 1);
      continue;
    }
    i += 1;
  }
  return source.length;
}

/** Index just past the `}` that closes the `{` at `at`, strings and nesting aware. */
function endOfBraces(source, at) {
  let depth = 0;
  let i = at;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = endOfString(source, i); continue; }
    if (ch === '{') { depth += 1; i += 1; continue; }
    if (ch === '}') { depth -= 1; i += 1; if (depth === 0) return i; continue; }
    i += 1;
  }
  return source.length;
}

function objectBody(source, at) {
  const end = endOfBraces(source, at);
  if (end > source.length) return null;
  return { start: at + 1, end: end - 1 };
}

/** Index of the value of `name` declared directly (not nested) inside `[from, to)`. */
function findPropertyValue(source, from, to, name) {
  let depth = 0;
  let i = from;
  while (i < to) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i);
      i = newline === -1 ? to : newline + 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i);
      i = close === -1 ? to : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { i = endOfString(source, i); continue; }
    if (ch === '{' || ch === '(' || ch === '[') { depth += 1; i += 1; continue; }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1;
      i += 1;
      if (depth < 0) return null;
      continue;
    }
    if (IDENTIFIER.test(ch)) {
      let end = i;
      while (end < to && IDENTIFIER.test(source[end])) end += 1;
      if (depth === 0 && source.slice(i, end) === name) {
        let colon = end;
        while (colon < to && /\s/.test(source[colon])) colon += 1;
        if (source[colon] === ':') {
          let value = colon + 1;
          while (value < to && /\s/.test(source[value])) value += 1;
          return value;
        }
      }
      i = end;
      continue;
    }
    i += 1;
  }
  return null;
}

function readStringLiteral(source, at) {
  const quote = source[at];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  const raw = source.slice(at + 1, endOfString(source, at) - 1);
  if (quote === '`' && raw.includes('${')) return null;
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (match, escape) => {
    if (escape[0] === 'u') return String.fromCharCode(parseInt(escape.slice(1), 16));
    if (escape === 'n') return '\n';
    if (escape === 't') return '\t';
    return escape;
  });
}
