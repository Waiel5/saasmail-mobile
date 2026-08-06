import {
  Button,
  ContentUnavailableView,
  Host,
  ProgressView,
  Spacer,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  controlSize,
  disabled,
  fixedSize,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { type UseQueryResult } from '@tanstack/react-query';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';

interface AdminGateProps {
  /** Why this screen in particular is admin-only. */
  reason: string;
  /** What is withheld, as a noun — "the blocklist". Omitted on the hub. */
  withheld?: string;
  /** The screen's own `me` query: the gate reads its state and retries it. */
  me: UseQueryResult<Me>;
  /** Resolved role, sign-in snapshot included. Null means "could not find out". */
  role: string | null;
}

/** Only some of these are worth asking again; the rest are the answer. */
function roleFailure(error: unknown): { message: string; retry: boolean } {
  if (!(error instanceof ApiError)) {
    return { message: 'Something went wrong asking who you are.', retry: true };
  }
  if (error.kind === 'network') {
    return {
      message: 'Cannot reach your server. This is not a refusal — nothing was asked.',
      retry: true,
    };
  }
  if (error.kind === 'passkey-required') {
    return {
      message:
        'This account needs a passkey before the app can use it. Open your server in a browser and register one.',
      retry: false,
    };
  }
  if (error.kind === 'insufficient-scope') {
    return {
      message:
        'This app was not granted permission to read your account on this server. Sign out and connect it again.',
      retry: false,
    };
  }
  return { message: error.message, retry: true };
}

export function AdminGate({ reason, withheld, me, role }: AdminGateProps) {
  const c = useTheme();
  // A failed ask with nothing stored is "could not find out", not "not an admin".
  const failure = role === null && me.isError ? roleFailure(me.error) : null;
  const offline = me.error instanceof ApiError && me.error.kind === 'network';

  return (
    <Host style={{ flex: 1, backgroundColor: c.background }}>
      <VStack spacing={Spacing.five}>
        <Spacer />
        {me.isLoading ? (
          <ProgressView />
        ) : (
          <ContentUnavailableView
            title={failure ? 'Could not check your role' : 'Admins only'}
            systemImage={
              failure ? (offline ? 'wifi.slash' : 'exclamationmark.triangle') : 'lock'
            }
            description={
              failure
                ? `${failure.message} Until this server answers, the app cannot tell whether this account is an admin${withheld ? `, and ${withheld} is not shown to accounts that are not` : ''}.`
                : reason
            }
            // Without this it swallows the slack and the retry lands on the screen's bottom edge.
            modifiers={[fixedSize({ vertical: true })]}
          />
        )}
        {failure?.retry ? (
          <Button
            label={me.isFetching ? 'Checking…' : 'Try again'}
            onPress={() => me.refetch()}
            modifiers={[
              buttonStyle('bordered'),
              controlSize('large'),
              tint(c.primary),
              disabled(me.isFetching),
            ]}
          />
        ) : null}
        <Spacer />
      </VStack>
    </Host>
  );
}
