import {
  Button,
  ContentUnavailableView,
  Host,
  HStack,
  List,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowSeparator,
  listStyle,
  scrollContentBackground,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteDraft, type Draft } from '@/lib/drafts';
import { formatListTime } from '@/lib/format';
import { useDrafts } from '@/lib/use-drafts';
import { useActiveServer } from '@/lib/use-servers';

/** Space below the last row, or the floating compose capsule covers it. */
const TOOLBAR_CLEARANCE = 72;

// SwiftUI rather than React Native views: swipe-to-delete exists only on a
// list row. Fonts come from SwiftUI text styles, not `Type`, so the rows track
// Dynamic Type like the system list around them.
export default function DraftsScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();
  const drafts = useDrafts(server?.id);

  const remove = (indices: number[]) => {
    // SwiftUI reports positions into the list as rendered, not ids. Resolve
    // them all first or a multi-row delete shifts later indices off target.
    const doomed = indices.map((i) => drafts[i]?.id);
    for (const id of doomed) if (id) deleteDraft(id);
  };

  return (
    <>
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          accessibilityLabel="New message"
          separateBackground
          onPress={async () => {
            if (process.env.EXPO_OS === 'ios') {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            router.push('/compose');
          }}
        />
      </Stack.Toolbar>

      <Host style={{ flex: 1, backgroundColor: c.background }}>
        {drafts.length === 0 ? (
          <ContentUnavailableView
            title="No drafts"
            systemImage="square.and.pencil"
            description="A message you start but do not send is kept here. saasmail has nowhere to store drafts, so they live on this device only: they do not sync to your other devices, and signing out of a server takes its drafts with it."
          />
        ) : (
          <List
            modifiers={[listStyle('plain'), scrollContentBackground('hidden')]}>
            <List.ForEach onDelete={remove}>
              {drafts.map((draft) => (
                <Button
                  key={draft.id}
                  onPress={() =>
                    router.push({
                      pathname: '/compose',
                      params: { draftId: draft.id },
                    })
                  }
                  modifiers={[
                    // Without `plain` the whole row is painted as a button
                    // label, tint on tint.
                    buttonStyle('plain'),
                    listRowBackground(c.background),
                  ]}>
                  <DraftRow draft={draft} />
                </Button>
              ))}
            </List.ForEach>

            <Spacer
              modifiers={[
                frame({ height: TOOLBAR_CLEARANCE }),
                listRowSeparator('hidden'),
                listRowBackground(c.background),
              ]}
            />
          </List>
        )}
      </Host>
    </>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const c = useTheme();
  const recipient = draft.to.trim() || draft.replyToLabel || '(no recipient)';
  const preview = draft.body.replace(/\s+/g, ' ').trim();

  return (
    <VStack alignment="leading" spacing={Spacing.half}>
      <HStack alignment="firstTextBaseline" spacing={Spacing.two}>
        <Text
          modifiers={[
            font({ textStyle: 'body', weight: 'semibold' }),
            foregroundStyle(c.text),
            lineLimit(1),
          ]}>
          {recipient}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ textStyle: 'caption' }),
            foregroundStyle(c.textTertiary),
          ]}>
          {formatListTime(draft.updatedAt)}
        </Text>
      </HStack>

      <Text
        modifiers={[
          font({ textStyle: 'subheadline' }),
          foregroundStyle(c.textSecondary),
          lineLimit(1),
        ]}>
        {draft.subject.trim() || '(no subject)'}
      </Text>

      {preview ? (
        <Text
          modifiers={[
            font({ textStyle: 'footnote' }),
            foregroundStyle(c.textTertiary),
            lineLimit(1),
          ]}>
          {preview}
        </Text>
      ) : null}
    </VStack>
  );
}
