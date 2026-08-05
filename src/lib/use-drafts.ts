import { useCallback, useSyncExternalStore } from 'react';

import { listDrafts, subscribeDrafts, type Draft } from './drafts';

export function useDrafts(serverId: string | null | undefined): Draft[] {
  const snapshot = useCallback(() => listDrafts(serverId), [serverId]);
  return useSyncExternalStore(
    useCallback((cb) => subscribeDrafts(cb), []),
    snapshot,
    snapshot,
  );
}
