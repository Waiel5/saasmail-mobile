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
  htmlAddsNothing,
  stripUnsubscribeFooter,
  stripUnsubscribeFooterHtml,
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

// --- unsubscribe footer ---------------------------------------------------

const UNSUB = 'https://x.dev/unsubscribe?token=eyJlIjoiYUB4LmNvbSJ9.abc_-DEF';

assert.equal(
  stripUnsubscribeFooter(`Hello there.\n\n---\nUnsubscribe: ${UNSUB}`),
  'Hello there.',
  'the appended footer is hidden from the sender’s own view',
);
assert.equal(
  stripUnsubscribeFooter('Hello there.'),
  'Hello there.',
  'a body without a footer is untouched',
);
// A received newsletter's own footer is the sender's content, not ours.
assert.equal(
  stripUnsubscribeFooter('Deal inside!\n\nUnsubscribe: https://them.example/u/9'),
  'Deal inside!\n\nUnsubscribe: https://them.example/u/9',
  'someone else’s unsubscribe line is left alone',
);
assert.equal(
  stripUnsubscribeFooter(`A\n\n---\nUnsubscribe: ${UNSUB}\n\nPS`),
  `A\n\n---\nUnsubscribe: ${UNSUB}\n\nPS`,
  'only a trailing footer is removed, never mid-body text',
);

assert.equal(
  stripUnsubscribeFooterHtml(
    `<p>Hi</p><hr/>\n<p style="font-size:12px;color:#666"><a href="${UNSUB}">Unsubscribe</a></p>`,
  ),
  '<p>Hi</p>',
  'the html footer is hidden too',
);
assert.equal(
  stripUnsubscribeFooterHtml('<p>Hi</p>'),
  '<p>Hi</p>',
  'html without a footer is untouched',
);



// --- which part of a multipart message to render ----------------------------

assert.ok(
  htmlAddsNothing('<p>Hello there.</p>', 'Hello there.'),
  'a paragraph wrapper adds nothing over the text part',
);
assert.ok(
  htmlAddsNothing(
    '<p>One</p>\n<p>Two<br>Three</p>',
    'One\n\nTwo\nThree',
  ),
  'our own textToHtml output round-trips back to its source',
);
assert.ok(
  htmlAddsNothing('<p>a &amp; b &lt;c&gt;</p>', 'a & b <c>'),
  'entities decode back to the text they escaped',
);
assert.ok(
  !htmlAddsNothing(
    '<table width="600"><tr><td><img src="https://x/p.gif">Sale!</td></tr></table>',
    'Sale!',
  ),
  'a laid-out newsletter is not equivalent to its text skeleton',
);
assert.ok(
  !htmlAddsNothing('<p>Full message here.</p>', 'View this email in your browser'),
  'a stub text part must not win over real HTML',
);
assert.ok(
  !htmlAddsNothing('<p>Anything</p>', '   '),
  'an empty text part is never equivalent',
);

console.log('mail-text: all checks passed');
