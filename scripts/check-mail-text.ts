/**
 * Self-check for the outbound text handling. `yarn check:mail-text`.
 *
 * No test framework, because the app has none and adding one for four pure
 * functions is a larger change than the thing it would check. Node runs the
 * TypeScript directly.
 *
 * The escaping is the reason this exists: it is the boundary between what a
 * user typed and a document rendered in someone else's mail client.
 */
import assert from 'node:assert/strict';

import {
  isEmail,
  parseAddressList,
  textToHtml,
  withSignature,
} from '../src/lib/mail-text.ts';

// --- escaping -------------------------------------------------------------

assert.equal(
  textToHtml('<script>alert(1)</script>'),
  '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  'markup must not survive into the sent body',
);

assert.equal(
  textToHtml('a & b'),
  '<p>a &amp; b</p>',
  'bare ampersands must be escaped',
);

// The ordering trap: escape `<` before `&` and this reads `&amp;lt;`.
assert.equal(
  textToHtml('5 < 6 & 7 > 6'),
  '<p>5 &lt; 6 &amp; 7 &gt; 6</p>',
  'entities must not be double-escaped',
);

assert.equal(
  textToHtml('say "hi"'),
  '<p>say &quot;hi&quot;</p>',
  'quotes must be escaped',
);

// --- structure ------------------------------------------------------------

assert.equal(
  textToHtml('one\ntwo'),
  '<p>one<br>two</p>',
  'a single newline is a line break inside one paragraph',
);

assert.equal(
  textToHtml('one\n\ntwo'),
  '<p>one</p>\n<p>two</p>',
  'a blank line starts a new paragraph',
);

assert.equal(textToHtml(''), '', 'an empty body produces no markup');
assert.equal(textToHtml('   \n\n  '), '', 'whitespace alone produces no markup');

// --- signature ------------------------------------------------------------

assert.equal(
  withSignature('<p>hi</p>', '<p>— Acme</p>'),
  '<p>hi</p>\n<br>\n<p>— Acme</p>',
  'the signature is appended after the body',
);
assert.equal(
  withSignature('<p>hi</p>', null),
  '<p>hi</p>',
  'no signature configured leaves the body alone',
);
assert.equal(
  withSignature('<p>hi</p>', '   '),
  '<p>hi</p>',
  'a whitespace-only signature is not a signature',
);
assert.equal(
  withSignature('', '<p>— Acme</p>'),
  '<p>— Acme</p>',
  'an empty body must not emit a leading separator',
);

// --- addresses ------------------------------------------------------------

assert.deepEqual(parseAddressList('a@x.com, b@y.com'), ['a@x.com', 'b@y.com']);
assert.deepEqual(parseAddressList('a@x.com;b@y.com'), ['a@x.com', 'b@y.com']);
assert.deepEqual(parseAddressList('  a@x.com ,  '), ['a@x.com']);
assert.deepEqual(parseAddressList(''), [], 'an empty field is no addresses');

assert.ok(isEmail('a@x.com'));
assert.ok(isEmail('  a@x.com  '), 'surrounding whitespace is tolerated');
assert.ok(!isEmail('a@x'), 'a bare hostname is rejected');
assert.ok(!isEmail('a b@x.com'), 'internal whitespace is rejected');
assert.ok(!isEmail(''));

console.log('mail-text: all checks passed');
