import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  htmlAddsNothing,
  stripUnsubscribeFooter,
  stripUnsubscribeFooterHtml,
} from '@/lib/mail-text';
import type { Message } from '@/lib/types';

/**
 * Render a message body.
 *
 * Email HTML is attacker-authored by definition — anyone can send mail to an
 * inbox — so the containing document, not the WebView's defaults, is what has
 * to hold the line. A Content-Security-Policy in the head does that:
 *
 *   default-src 'none'   nothing loads unless named below. This is what stops
 *                        tracking pixels, remote fonts, iframes and — because
 *                        it also covers connect-src — a script's attempt to
 *                        `fetch()` the message body out to a server.
 *   script-src 'nonce-…' only the measuring script below runs. A `<script>` in
 *                        the message has no nonce and is refused.
 *   style-src            inline CSS is how email has always been styled, so it
 *                        is allowed; with default-src none, a `url()` inside it
 *                        still cannot fetch anything.
 *   img-src data:        inline images render; remote ones are the tracking
 *                        vector and are opt-in per message.
 *
 * This replaces an earlier arrangement that relied on `originWhitelist` and
 * `onShouldStartLoadWithRequest`. Both are real, but both govern *navigation* —
 * they never applied to subresources, so remote images loaded and reported the
 * read back to the sender, and an inline `<script>` shared a document with the
 * measuring script and ran with it.
 *
 * Plain text is preferred when the message carries it: it needs none of this
 * and lays out better on a phone.
 */
export function MessageBody({ message, tint }: { message: Message; tint: string }) {
  const c = useTheme();
  const [height, setHeight] = useState(0);
  const [loadRemote, setLoadRemote] = useState(false);

  // One nonce per mounted message. It only has to be unguessable to the person
  // who wrote the HTML, and they wrote it before this existed.
  const nonce = useMemo(() => randomUUID(), []);

  const bodyText = message.bodyText
    ? stripUnsubscribeFooter(message.bodyText).trim()
    : '';
  const bodyHtml = message.bodyHtml
    ? stripUnsubscribeFooterHtml(message.bodyHtml).trim()
    : '';
  const hasRemoteContent = useMemo(
    () => (bodyHtml ? /<img[^>]+src\s*=\s*["']?https?:/i.test(bodyHtml) : false),
    [bodyHtml],
  );

  // The text part wins only when the HTML part is not doing anything. Reaching
  // for text whenever it exists — which was the rule here — means a newsletter
  // renders as its stripped skeleton, because virtually every real message is
  // multipart/alternative and carries both.
  if (bodyText && (!bodyHtml || htmlAddsNothing(bodyHtml, bodyText))) {
    return (
      <Text selectable style={{ ...Type.body, color: tint }}>
        {bodyText}
      </Text>
    );
  }

  if (!bodyHtml) {
    return (
      <Text style={{ ...Type.body, color: c.textTertiary, fontStyle: 'italic' }}>
        (no content)
      </Text>
    );
  }

  const imgSrc = loadRemote ? 'data: https:' : 'data:';

  // The document is composed here rather than the message being injected into
  // one, so the colour scheme, the width and the policy all come from us.
  const html = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${imgSrc};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /*
    Light, always — even in dark mode.

    Mail HTML is written against an assumed white page and says so only where
    it disagrees: a table sets its own background, the text around it does not.
    Render that over a dark surface and every unstyled run stays black on
    black. Apple Mail makes the same call for exactly this reason. The
    surrounding card is still themed; it is the sender's document that is not.
  */
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 0;
    font: -apple-system-body, system-ui, sans-serif;
    font-size: 17px; line-height: 1.45;
    color: #101418; background: #FFFFFF;
    word-wrap: break-word; overflow-wrap: anywhere;
  }
  img, table { max-width: 100% !important; height: auto !important; }
  /*
    Legacy mail is a fixed 600px table and no amount of max-width reaches the
    width="600" attributes nested inside it. Rather than clip, the document
    is scaled down to fit — which is what a phone mail client has always done
    with desktop-width mail, and is why such mail is legible rather than
    cropped at the third column.
  */
  body { transform-origin: 0 0; }
  a { color: ${c.unread}; }
  blockquote {
    margin: 0 0 0 8px; padding-left: 10px;
    border-left: 2px solid ${c.border}; color: ${c.textSecondary};
  }
</style></head><body>${bodyHtml}
<script nonce="${nonce}">
  // Reports content height so the WebView can size to it — a fixed height
  // either clips the message or leaves dead space under short ones. Images
  // settle after load, so this reports again then.
  var scale = 1;
  function fit() {
    // Undo any previous scale before measuring, or each pass compounds the
    // last one and the message shrinks away over successive reports.
    document.body.style.transform = '';
    var natural = document.body.scrollWidth;
    scale = natural > window.innerWidth ? window.innerWidth / natural : 1;
    document.body.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
  }
  function report() {
    fit();
    window.ReactNativeWebView.postMessage(
      String(Math.ceil(document.body.scrollHeight * scale)),
    );
  }
  report();
  window.addEventListener('load', report);
  // Images and web fonts settle after load, and each one changes the height.
  // Without this the view keeps the height it measured before the pictures
  // arrived and clips the rest of the message.
  if (window.ResizeObserver) {
    new ResizeObserver(report).observe(document.body);
  }
</script>
</body></html>`;

  return (
    <View style={{ minHeight: 24 }}>
      {hasRemoteContent && !loadRemote ? (
        // Named, not silent. A message that renders with holes in it and no
        // explanation reads as a broken client rather than as a decision made
        // on the reader's behalf.
        <Pressable
          onPress={() => setLoadRemote(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.two,
            paddingHorizontal: Spacing.three,
            paddingVertical: Spacing.two,
            borderRadius: Radius.full,
            alignSelf: 'flex-start',
            backgroundColor: c.backgroundSubtle,
            opacity: pressed ? 0.7 : 1,
          })}>
          <Image
            source="sf:eye.slash"
            tintColor={c.textSecondary}
            style={{ width: 14, height: 14 }}
          />
          <Text style={{ ...Type.footnote, color: c.textSecondary }}>
            Remote images blocked · Load
          </Text>
        </Pressable>
      ) : null}

      <WebView
        // `key` on the policy so toggling images rebuilds the document rather
        // than relying on the WebView to re-evaluate a CSP it already applied.
        key={imgSrc}
        originWhitelist={['about:blank']}
        source={{ html, baseUrl: '' }}
        javaScriptEnabled
        onMessage={(e) => setHeight(Number(e.nativeEvent.data) || 0)}
        // Belt to the CSP's braces: nothing in a message may navigate the view
        // away from the message.
        onShouldStartLoadWithRequest={(req) => req.url === 'about:blank'}
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        scrollEnabled={false}
        style={{
          height: height || 24,
          backgroundColor: 'transparent',
          marginTop: Spacing.one,
        }}
      />
    </View>
  );
}
