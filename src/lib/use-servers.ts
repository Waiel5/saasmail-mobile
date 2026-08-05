/**
 * React bindings over the server store.
 *
 * The store is deliberately plain module state rather than a context: push
 * notification handlers, the API layer and the WebSocket all need to read it,
 * and none of them are inside the React tree.
 */
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
