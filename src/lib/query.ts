/**
 * Every key must begin with the server id: without it a background refetch for
 * `['people']` resolves into whichever server is active when it lands. The
 * cache stays memory-only; persisting it writes message bodies to plaintext
 * application storage.
 */
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
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

/** Always build keys through this, never as a literal array. */
export function key(serverId: string, ...parts: (string | number | undefined)[]) {
  // Hold the slot rather than dropping it: an absent trailing filter must not
  // collapse onto the unfiltered query's cache entry.
  return [serverId, ...parts.map((p) => p ?? null)] as const;
}

/**
 * Cancel before removing: an in-flight request resolving after removal
 * repopulates the cache for a server that no longer exists.
 */
export async function forgetServer(serverId: string): Promise<void> {
  await queryClient.cancelQueries({ queryKey: [serverId] });
  queryClient.removeQueries({ queryKey: [serverId] });
}
