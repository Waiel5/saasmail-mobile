import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
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
 * Email HTML is attacker-authored, and the CSP in the composed document is the
 * whole defence. Do not go back to `originWhitelist` and
 * `onShouldStartLoadWithRequest`: they govern navigation only, never
 * subresources, so remote images and inline `<script>` both got through.
 * `default-src 'none'` covers connect-src too, which is what stops a script
 * posting the body out.
 */
export function MessageBody({ message, tint }: { message: Message; tint: string }) {
  const c = useTheme();
  const [height, setHeight] = useState(0);
  const [loadRemote, setLoadRemote] = useState(false);

  // Only has to be unguessable to whoever wrote the message HTML, and they
  // wrote it before this existed.
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

  // Text wins only when the HTML adds nothing. Nearly every real message is
  // multipart/alternative, so preferring text whenever it exists renders
  // newsletters as their stripped skeleton.
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

  const html = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${imgSrc};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* Light even in dark mode: mail HTML assumes a white page and states colours
     only where it disagrees, so unstyled runs go black on black. */
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 0;
    font: -apple-system-body, system-ui, sans-serif;
    font-size: 17px; line-height: 1.45;
    color: #101418; background: #FFFFFF;
    word-wrap: break-word; overflow-wrap: anywhere;
  }
  img, table { max-width: 100% !important; height: auto !important; }
  /* Legacy mail is a fixed 600px table whose nested width="600" attributes
     max-width cannot reach, so the document is scaled to fit, not clipped. */
  body { transform-origin: 0 0; }
  a { color: ${c.unread}; }
  blockquote {
    margin: 0 0 0 8px; padding-left: 10px;
    border-left: 2px solid ${c.border}; color: ${c.textSecondary};
  }
</style>
<script nonce="${nonce}">
  // The WebView has no intrinsic height, so the document reports its own.
  var scale = 1;
  function fit() {
    // Undo the previous scale before measuring or each pass compounds the last
    // and the message shrinks away over successive reports.
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
  function start() {
    report();
    // Images and web fonts settle after load and change the height again.
    if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
  }
  document.addEventListener('DOMContentLoaded', start);
  window.addEventListener('load', report);
</script>
</head><body>${bodyHtml}

</body></html>`;

  return (
    <View style={{ minHeight: 24 }}>
      {hasRemoteContent && !loadRemote ? (
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
        // Keyed on the policy: the CSP is applied at document load, so the
        // WebView has to be rebuilt for a toggle to take effect.
        key={imgSrc}
        // Must be '*'. react-native-webview only consults
        // onShouldStartLoadWithRequest for URLs that PASS the whitelist —
        // everything else it hands straight to Linking.openURL, which fires
        // any scheme the device can open, including this app's own
        // saasmail://. Narrowing the whitelist widened the hole.
        originWhitelist={['*']}
        source={{ html, baseUrl: '' }}
        javaScriptEnabled
        onMessage={(e) => setHeight(Number(e.nativeEvent.data) || 0)}
        onShouldStartLoadWithRequest={(req) => {
          if (req.url === 'about:blank') return true;
          // A tapped web link goes to the system browser, as Mail does.
          // Every other scheme is refused, and a navigation the user did not
          // tap is refused too, so a redirect cannot launch anything.
          if (req.navigationType === 'click' && /^https?:\/\//i.test(req.url)) {
            Linking.openURL(req.url).catch(() => {});
          }
          return false;
        }}
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
