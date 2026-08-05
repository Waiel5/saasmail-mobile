// The store stays module state, not context: push handlers, the API layer and
// the socket all read it from outside the React tree.
import { useCallback, useSyncExternalStore } from 'react';

import {
  getActiveServerId,
  listServers,
  subscribe,
  type ServerRecord,
} from './servers';

export function useServers(): ServerRecord[] {
  return useSyncExternalStore(
    useCallback((cb) => subscribe(cb), []),
    listServers,
    listServers,
  );
}

export function useActiveServerId(): string | null {
  return useSyncExternalStore(
    useCallback((cb) => subscribe(cb), []),
    getActiveServerId,
    getActiveServerId,
  );
}

export function useActiveServer(): ServerRecord | null {
  const id = useActiveServerId();
  const servers = useServers();
  if (!id) return null;
  return servers.find((s) => s.id === id) ?? null;
}
