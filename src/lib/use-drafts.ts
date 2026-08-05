/**
 * React bindings over the draft store.
 *
 * Same shape as `use-servers`: plain module state plus `useSyncExternalStore`,
 * because the store is also read from the compose screen's autosave, which
 * runs outside render.
 */
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
