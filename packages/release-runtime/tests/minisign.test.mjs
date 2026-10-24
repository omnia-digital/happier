import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyMinisign, DEFAULT_MINISIGN_PUBLIC_KEY, FIRST_PARTY_RELEASE_REPOSITORY, getMinisignPublicKeyIdentity, resolveFirstPartyReleasePublicKey } from '../dist/minisign.js';

const forkKey = `untrusted comment: minisign public key for test only\n${Buffer.concat([
  Buffer.from('Ed'), Buffer.alloc(8, 1), Buffer.alloc(32, 2),
]).toString('base64')}\n`;

test('fork release trust requires an explicit key distinct from upstream', () => {
  assert.equal(FIRST_PARTY_RELEASE_REPOSITORY, 'omnia-digital/happier');
  assert.throws(() => resolveFirstPartyReleasePublicKey({ githubRepo: FIRST_PARTY_RELEASE_REPOSITORY }), /public key is required/i);
  assert.throws(() => resolveFirstPartyReleasePublicKey({ githubRepo: FIRST_PARTY_RELEASE_REPOSITORY, configuredPublicKey: DEFAULT_MINISIGN_PUBLIC_KEY }), /upstream minisign/i);
  const changedComment = DEFAULT_MINISIGN_PUBLIC_KEY.replace('untrusted comment:', 'untrusted comment: fork ');
  assert.throws(() => resolveFirstPartyReleasePublicKey({ githubRepo: FIRST_PARTY_RELEASE_REPOSITORY, configuredPublicKey: changedComment }), /upstream minisign/i);
  assert.throws(() => resolveFirstPartyReleasePublicKey({ githubRepo: 'Omnia-Digital/Happier', configuredPublicKey: changedComment }), /upstream minisign/i);
  assert.equal(resolveFirstPartyReleasePublicKey({ githubRepo: FIRST_PARTY_RELEASE_REPOSITORY, configuredPublicKey: forkKey }), forkKey.trim());
  assert.equal(resolveFirstPartyReleasePublicKey({ githubRepo: 'happier-dev/happier' }), DEFAULT_MINISIGN_PUBLIC_KEY);
  assert.notEqual(getMinisignPublicKeyIdentity(forkKey), getMinisignPublicKeyIdentity(DEFAULT_MINISIGN_PUBLIC_KEY));
  assert.throws(() => getMinisignPublicKeyIdentity('untrusted comment: minisign public key\nRW' + 'A'.repeat(54)), /algorithm/i);
});

test('verifyMinisign validates bundled minisign public key format', () => {
  assert.match(DEFAULT_MINISIGN_PUBLIC_KEY, /minisign public key/i);
  assert.match(DEFAULT_MINISIGN_PUBLIC_KEY, /^RW/m);
});

test('verifyMinisign returns false for invalid signature payload', () => {
  assert.equal(
    verifyMinisign({
      message: Buffer.from('hello'),
      pubkeyFile: DEFAULT_MINISIGN_PUBLIC_KEY,
      sigFile: 'bad\nsig\nfile\n',
    }),
    false,
  );
});

