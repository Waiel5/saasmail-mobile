# saasmail for iOS and Android

A native client for [saasmail](https://github.com/choyiny/saasmail), a self-hosted
email server for SaaS teams that runs on Cloudflare Workers.

Because saasmail is self-hosted there is no central account and no "the" server.
You point the app at your own deployment, and if you run several — work, a
client, a side project — it holds all of them at once and switches between them.

## Status

Early. Sign-in, the inbox and conversation reading work end to end. Composing,
push registration and the admin surface are not wired up yet.

## How sign-in works

The app ships with no client id for any server, because there is no server to
ship one for. On first contact it registers itself with your deployment over
[RFC 7591](https://www.rfc-editor.org/rfc/rfc7591) dynamic client registration,
then runs an OAuth 2.1 authorization-code flow with PKCE.

Authorization happens in the **system browser**, never an embedded web view.
That is the [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) requirement, and
it is also why your **passkey keeps working**: the WebAuthn ceremony runs on your
own deployment's origin, where its RP ID already matches. The app never sees your
password.

## Server requirements

The app checks `GET /api/config` before asking you to authorize anything, and
refuses politely if the deployment cannot support it rather than failing halfway
through. It needs a saasmail build that reports:

| Capability | What it enables | Upstream |
| --- | --- | --- |
| `oauthApi` | `/api/*` accepts OAuth bearer tokens | [#238](https://github.com/choyiny/saasmail/pull/238) |
| `oauthStream` | Realtime updates without a browser `Origin` | [#239](https://github.com/choyiny/saasmail/pull/239) |

Native push additionally needs [#241](https://github.com/choyiny/saasmail/pull/241),
and signing in against a server that has not merged
[#237](https://github.com/choyiny/saasmail/pull/237) will hang at the login page,
because that build discards the pending authorization when you sign in.

## Running it

```bash
npm install
npx expo start
```

Expo Go covers everything except push notifications, which need a development
build because Expo Go cannot obtain a native push token.

## Design notes

**It is not a Gmail client.** The API stores exactly one mutable piece of state
per message — `is_read` — and delete is a hard, irreversible delete. There is no
archive, no labels, no snooze, no star, no drafts. The UI is built around what
the data can actually express, so no affordance quietly does nothing. Apple Mail
rather than Gmail, for that reason rather than taste.

**The list is person-centric.** `GET /api/people/grouped` returns people and
group conversations merged and sorted by recency, so a row is a correspondent
with an unread count — closer to Messages than to a folder of messages.

**Colour carries one signal.** Violet is spent entirely on unread and focus, lime
is the action colour, and nothing else competes. That is what makes an unread row
findable in a column of near-identical ones.

**Type is the platform's.** San Francisco on iOS, not the web app's Inter.
Substituting a webfont is the fastest way to make an app read as a website in a
wrapper, and Inter was drawn as an SF-alike, so almost nothing is lost.

**Every cache key is namespaced by server.** Not a convention — without it a
background refetch resolves into whichever server happens to be active when it
lands, and one account's mail renders under another's name.

## Licence

Apache-2.0, matching upstream saasmail.
