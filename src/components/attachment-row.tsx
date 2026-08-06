import { Directory, File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, Text, View } from 'react-native';

import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch, authorizedSource } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import type { Attachment, Message } from '@/lib/types';

/** The worker returns `contentId` on both thread endpoints; `Attachment` omits it. */


const pathFor = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;

/** One message's attachments as tappable chips; renders nothing when it has none. */
export function AttachmentRow({ message, serverId }: { message: Message; serverId: string }) {
  // A `contentId` means the file is a cid: source for the body, not a document.
  const files = (message.attachments ?? []).filter(
    (a: Attachment) => a.contentId == null,
  );
  if (files.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
      {files.map((attachment) => (
        <AttachmentChip key={attachment.id} attachment={attachment} serverId={serverId} />
      ))}
    </View>
  );
}

function AttachmentChip({
  attachment,
  serverId,
}: {
  attachment: Attachment;
  serverId: string;
}) {
  const c = useTheme();
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;

  const onPress = async () => {
    if (process.env.EXPO_OS === 'ios') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setProgress(0);
    const file = await download(serverId, attachment, setProgress).catch(() => null);
    setProgress(null);

    if (!file) {
      if (process.env.EXPO_OS === 'ios') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert(attachment.filename, await explain(serverId, attachment.id));
      return;
    }

    await Share.share({ url: file.uri }).catch(() => {});
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${attachment.filename}, ${formatBytes(attachment.size)}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.two,
        maxWidth: '100%',
        paddingHorizontal: Spacing.three,
        paddingVertical: Spacing.two,
        borderRadius: Radius.lg,
        borderCurve: 'continuous',
        borderWidth: HAIRLINE,
        borderColor: c.border,
        backgroundColor: pressed ? c.backgroundSelected : c.backgroundSubtle,
      })}>
      {/* Fixed gutter so swapping the glyph for the spinner does not reflow. */}
      <View style={{ width: 20, alignItems: 'center' }}>
        {busy ? (
          <ActivityIndicator size="small" />
        ) : (
          <Image
            source={symbolFor(attachment.contentType)}
            tintColor={c.textSecondary}
            style={{ width: 16, height: 16 }}
          />
        )}
      </View>

      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ ...Type.footnote, color: c.text }}>
          {attachment.filename}
        </Text>
        <Text
          style={{
            ...Type.caption,
            color: c.textTertiary,
            fontVariant: ['tabular-nums'],
          }}>
          {progress !== null
            ? `${Math.round(progress * 100)}%`
            : formatBytes(attachment.size)}
        </Text>
      </View>
    </Pressable>
  );
}

async function download(
  serverId: string,
  attachment: Attachment,
  onProgress: (fraction: number) => void,
): Promise<File> {
  const source = await authorizedSource(serverId, pathFor(attachment.id));
  if (!source) throw new ApiError('Signed out', 'unauthorized', 401);

  // The filename is whatever the sender put in the part header; a separator in
  // one would write outside the cache directory.
  const name = attachment.filename.split(/[\\/]/).pop()?.trim() || 'attachment';

  // Kept under the attachment id so two messages carrying "invoice.pdf" do not
  // collide — the share sheet shows this file's own name.
  const folder = new Directory(Paths.cache, 'attachments', attachment.id);
  folder.create({ intermediates: true, idempotent: true });

  return File.downloadFileAsync(source.uri, new File(folder, name), {
    headers: source.headers,
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) =>
      onProgress(totalBytes > 0 ? bytesWritten / totalBytes : 0),
  });
}

// `downloadFileAsync` reports only a status code. Replaying through `apiFetch`
// recovers the server's message and renews the token `authorizedSource` cannot.
async function explain(serverId: string, id: string): Promise<string> {
  const error = await apiFetch(serverId, pathFor(id)).then(
    () => null,
    (e: unknown) => e,
  );
  return error instanceof ApiError ? error.message : 'The file could not be downloaded.';
}

function symbolFor(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.startsWith('image/')) return 'sf:photo';
  if (type.startsWith('video/')) return 'sf:film';
  if (type.startsWith('audio/')) return 'sf:waveform';
  if (type === 'application/pdf') return 'sf:doc.richtext';
  if (type === 'text/calendar') return 'sf:calendar';
  if (/zip|compressed|tar|gzip|rar|7z/.test(type)) return 'sf:doc.zipper';
  // Before the generic document test: every OOXML type contains "officedocument".
  if (/sheet|excel|csv/.test(type)) return 'sf:tablecells';
  if (/presentation|powerpoint/.test(type)) return 'sf:rectangle.on.rectangle';
  if (type.startsWith('text/') || /word|document|rtf/.test(type)) return 'sf:doc.text';
  return 'sf:doc';
}
