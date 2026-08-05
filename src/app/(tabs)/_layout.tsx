import { NativeTabs } from 'expo-router/unstable-native-tabs';

/**
 * Two tabs, not three.
 *
 * Search used to be a tab with `role="search"`, which iOS 26 renders as a
 * detached floating capsule in the bottom-right — the most reachable spot on
 * the screen. That is right for Photos or Files, where searching is the main
 * verb. In a mail client it is not: people compose many times a day and search
 * occasionally, so that position belongs to compose and search belongs in the
 * list as a pull-down bar, which is where Apple Mail puts it.
 *
 * Dropping it removes a tab, a route, and a screen that had to guard against
 * having no server.
 */
export default function TabsLayout() {
  return (
    <NativeTabs minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'tray', selected: 'tray.fill' }} md="inbox" />
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
          md="settings"
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
