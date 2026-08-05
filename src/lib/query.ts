/**
 * React Query, scoped per server.
 *
 * Every key begins with the server id. Not a convention — a correctness
 * requirement: without it, a background refetch for `['people']` resolves into
 * whichever server happens to be active when it lands, and one account's mail
 * renders under another account's name. Namespacing makes that unrepresentable
 * rather than merely unlikely.
 *
 * The cache is memory-only. Persisting it would write subjects and message
 * bodies to plaintext application storage, which is a poor default for a
 * self-hosted mail product and buys little: the list refetches in well under a
 * second, and a stale offline copy of someone's mailbox is a liability rather
 * than a feature.
 */
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // Failures here are usually a wrong scope, a missing passkey or a server
      // that is simply down. None improve on retry, and each retry delays the
      // error the user needs to see.
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.isTerminal) return false;
          if (error.kind === 'unauthorized' || error.kind === 'forbidden') return false;
          if (error.kind === 'not-found') return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

/** Build a cache key rooted at a server. Always use this rather than a literal. */
export function key(serverId: string, ...parts: (string | number | undefined)[]) {
  return [serverId, ...parts.filter((p) => p !== undefined)] as const;
}

/**
 * Drop everything belonging to a server.
 *
 * Called on sign-out and on removal. Cancels first: an in-flight request that
 * resolves after removal would repopulate the cache for a server that no longer
 * exists, and its data would then be rendered for whoever is active next.
 */
export async function forgetServer(serverId: string): Promise<void> {
  await queryClient.cancelQueries({ queryKey: [serverId] });
  queryClient.removeQueries({ queryKey: [serverId] });
}
