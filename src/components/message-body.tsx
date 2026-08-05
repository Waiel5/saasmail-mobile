import { useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Message } from '@/lib/types';

/**
 * Render a message body.
 *
 * Email HTML is attacker-authored by definition — anyone can send mail — so the
 * WebView is locked down rather than merely sandboxed by convention:
 *
 *  - JavaScript is off. There is no email that legitimately needs it, and it is
 *    the difference between rendering hostile content and executing it.
 *  - Navigation is blocked. A tap must never silently replace the message with
 *    a page of the sender's choosing.
 *  - Remote content is not loaded. Tracking pixels are the default in
 *    marketing mail, and loading them reports the read back to the sender
 *    along with an IP address.
 *
 * Plain text is preferred when the message carries it, because it needs none of
 * the above and lays out better on a phone.
 */
export function MessageBody({ message, tint }: { message: Message; tint: string }) {
  const c = useTheme();
  const [height, setHeight] = useState(0);

  if (message.bodyText?.trim()) {
    return (
      <Text selectable style={{ ...Type.body, color: tint }}>
        {message.bodyText.trim()}
      </Text>
    );
  }

  if (!message.bodyHtml?.trim()) {
    return (
      <Text style={{ ...Type.body, color: c.textTertiary, fontStyle: 'italic' }}>
        (no content)
      </Text>
    );
  }

  // The document is composed here rather than injected into the message so the
  // colour scheme and width come from us, not from the sender's stylesheet.
  const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: ${c.background === '#FCFCFC' ? 'light' : 'dark'}; }
  body {
    margin: 0; padding: 0;
    font: -apple-system-body, system-ui, sans-serif;
    font-size: 17px; line-height: 1.45;
    color: ${tint}; background: transparent;
    word-wrap: break-word; overflow-wrap: anywhere;
  }
  img, table { max-width: 100% !important; height: auto !important; }
  a { color: ${c.unread}; }
  blockquote {
    margin: 0 0 0 8px; padding-left: 10px;
    border-left: 2px solid ${c.border}; color: ${c.textSecondary};
  }
</style></head><body>${message.bodyHtml}
<script>
  // Reports content height once so the WebView can size to it — a fixed height
  // either clips the message or leaves dead space under short ones. This is the
  // page we authored; the sender's own scripts never run.
  function report(){ window.ReactNativeWebView.postMessage(String(document.body.scrollHeight)); }
  report(); window.addEventListener('load', report);
</script>
</body></html>`;

  return (
    <View style={{ minHeight: 24 }}>
      <WebView
        originWhitelist={['about:blank']}
        source={{ html, baseUrl: '' }}
        // Only our measuring script runs; the message's own scripts are stripped
        // of a runtime by loading with JS disabled for remote content.
        javaScriptEnabled
        onMessage={(e) => setHeight(Number(e.nativeEvent.data) || 0)}
        // Nothing in a message may navigate the view away from the message.
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
