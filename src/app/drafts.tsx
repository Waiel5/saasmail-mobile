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

/**
 * Height reserved below the last row for the floating compose capsule, which
 * otherwise sits on top of it rather than below it.
 */
const TOOLBAR_CLEARANCE = 72;

/**
 * Unsent messages.
 *
 * The one screen built from SwiftUI rather than React Native views, and not by
 * preference: swipe-to-delete belongs to a list row, and UIKit offers it to
 * nothing else. Drawn in JavaScript instead — a pan responder sliding a red
 * rectangle out from behind a row — it would be the same kind of imitation
 * control this app took out of the inbox when the compose button stopped being
 * a Pressable with a box shadow and became a real bar button.
 *
 * Sizes come from SwiftUI's own text styles rather than from `Type`, so the
 * rows track Dynamic Type the way the system list they sit in does. Colours
 * still come from the theme, so the list matches the inbox it was opened from.
 */
export default function DraftsScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();
  const drafts = useDrafts(server?.id);

  const remove = (indices: number[]) => {
    // SwiftUI reports positions, not ids, and they index the list as it was
    // rendered. Resolving all of them before deleting anything keeps a
    // multi-row delete from shifting rows out from under the later indices.
    const doomed = indices.map((i) => drafts[i]?.id);
    for (const id of doomed) if (id) deleteDraft(id);
  };

  return (
    <>
      {/*
        The same grammar as the inbox and the thread: nothing contextual on the
        left — a list of drafts has no action that applies to all of them, and
        deleting them wholesale is not one Mail offers — with compose detached
        in the right corner, where the thumb has already learned to find it.
      */}
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
                    // Plain, so the row keeps its own colours instead of being
                    // painted tint-on-tint as a button label.
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

/**
 * One row: who it is to, what it is about, how it starts, when it was touched.
 *
 * All four are needed because a draft is defined by what it is missing. A row
 * showing only the subject cannot be told apart from the three other unfinished
 * replies with no subject either, so each field says plainly when it is empty
 * rather than collapsing into a blank line.
 */
function DraftRow({ draft }: { draft: Draft }) {
  const c = useTheme();
  const recipient = draft.to.trim() || draft.replyToLabel || '(no recipient)';
  // The body as one line: a preview that honoured newlines would push the rows
  // below it off the screen.
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
