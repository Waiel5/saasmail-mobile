import { Host, Image as SymbolImage, ShareLink } from '@expo/ui/swift-ui';
import { accessibilityLabel } from '@expo/ui/swift-ui/modifiers';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { AdminGate } from '@/components/admin-gate';
import { HAIRLINE, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { key } from '@/lib/query';
import type { Me } from '@/lib/types';
import { useActiveServer } from '@/lib/use-servers';

/** "unknown" is "the lookup did not finish", never a verdict about the zone. */
type DnsState = 'cloudflare' | 'elsewhere' | 'none' | 'unknown';

interface DnsRecord {
  name: string;
  type: 'MX' | 'TXT';
  /** Null for DKIM: the key is generated per zone, so the worker will not guess it. */
  value: string | null;
  action: 'add' | 'replace';
  note: string | null;
}

/** A row of `GET /api/domains`, sorted by `domain`. */
interface Domain {
  domain: string;
  inboxCount: number;
  messageCount: number;
  dns: {
    routing: DnsState;
    /** Hosts observed, in resolver order. Priority is deliberately not returned. */
    mx: string[];
    spf: DnsState;
    spfRecord: string | null;
    dkim: DnsState;
    missingRecords: DnsRecord[];
  };
}

// Cloudflare resolves `:account` and `:zone` for whoever is signed in, so no ids of ours are needed.
const CLOUDFLARE_EMAIL_ROUTING =
  'https://dash.cloudflare.com/?to=/:account/email-service/routing';
const CLOUDFLARE_DNS_RECORDS =
  'https://dash.cloudflare.com/?to=/:account/:zone/dns/records';

const CLOUDFLARE_SPF_INCLUDE = 'include:_spf.mx.cloudflare.net';

export default function DomainsScreen() {
  const c = useTheme();
  const router = useRouter();
  const server = useActiveServer();

  // server.role is a sign-in snapshot and may be missing entirely, and this
  // route is deep-linkable, so it cannot lean on the hub having gated it.
  const me = useQuery({
    queryKey: key(server?.id ?? 'none', 'me'),
    enabled: !!server,
    queryFn: () => apiFetch<Me>(server!.id, '/api/user/me'),
  });
  const role = me.data?.role ?? server?.role ?? null;

  const domains = useQuery({
    queryKey: key(server?.id ?? 'none', 'domains'),
    enabled: !!server && role === 'admin',
    queryFn: () => apiFetch<Domain[]>(server!.id, '/api/domains'),
  });

  // Reachable by signing out of the last account with this screen open.
  if (!server) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.six,
        }}>
        <Text style={{ ...Type.callout, color: c.textSecondary, textAlign: 'center' }}>
          No server is selected.
        </Text>
      </View>
    );
  }

  const rows = domains.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Domains', headerLargeTitle: true }} />

      <Stack.Toolbar placement="bottom">
        {role === 'admin' ? (
          <Stack.Toolbar.Button
            icon="arrow.clockwise"
            accessibilityLabel="Check DNS again"
            disabled={domains.isFetching}
            onPress={() => domains.refetch()}
          />
        ) : null}
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

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={
          role === 'admin'
            ? {
                padding: Spacing.four,
                gap: Spacing.five,
                // Clears the floating toolbar, which otherwise sits on the last row.
                paddingBottom: Spacing.four + 72,
              }
            : // The gate is a SwiftUI host, and a host given no height renders nothing.
              { flexGrow: 1 }
        }
        refreshControl={
          <RefreshControl
            refreshing={me.isRefetching || domains.isRefetching}
            onRefresh={() => {
              // Refreshing only the domains would leave someone just made an
              // admin still reading "Admins only".
              me.refetch();
              if (role === 'admin') domains.refetch();
            }}
          />
        }>
        {role !== 'admin' ? (
          <AdminGate
            me={me}
            role={role}
            withheld="the domains this deployment handles mail for"
            reason="This screen reads every address this deployment has ever received mail at and the DNS behind it, so this server lets only accounts with the admin role open it."
          />
        ) : (
          <>
            {domains.isLoading ? <ActivityIndicator /> : null}
            {domains.isError ? <Note>{failureMessage(domains.error)}</Note> : null}

            {rows.map((row) => (
              <DomainCard key={row.domain} domain={row} />
            ))}

            {!domains.isLoading && !domains.isError ? (
              <Note>
                {rows.length === 0
                  ? 'No domains yet. One appears here as soon as an address under it receives mail or is set up as a sender.'
                  : 'Every domain an address here belongs to is listed, with its MX and SPF read live over DNS. Answers are cached for a minute, so a record you have just fixed can take that long to show up.'}
              </Note>
            ) : null}

            <Section title="Cloudflare">
              <Card>
                <LinkRow
                  icon="sf:envelope"
                  label="Open Email Routing in Cloudflare"
                  detail="Pick this deployment’s domain, then Routing Rules"
                  url={CLOUDFLARE_EMAIL_ROUTING}
                />
              </Card>
              <Note>
                DNS only gets mail as far as Cloudflare. Email Routing then needs
                its catch-all rule Active with the action Send to a Worker,
                pointed at this deployment’s Worker — until it is, every message
                bounces with 550 5.1.1 however correct the records above look.
              </Note>
              <Note>
                That last step is the one that gets missed: wrangler will not set
                a Worker as the catch-all action, so it can only be done in the
                dashboard.
              </Note>
            </Section>
          </>
        )}
      </ScrollView>
    </>
  );
}

function DomainCard({ domain }: { domain: Domain }) {
  const c = useTheme();
  const { dns } = domain;

  const status = routingStatus(dns.routing);
  const tint = { success: c.success, warning: c.warning, danger: c.danger, muted: c.textSecondary }[
    status.tone
  ];

  // The worker already merged SPF and decided add-vs-replace per record; it also
  // sends a null value for DKIM, whose key it cannot know. Rewriting values here
  // put the merged SPF string into the DKIM row.
  const records = dns.missingRecords;

  // An empty `missingRecords` is not "all good" while any lookup is unknown.
  const unchecked =
    dns.routing === 'unknown' || dns.spf === 'unknown' || dns.dkim === 'unknown';

  return (
    <View style={{ gap: Spacing.two }}>
      <Card>
        <View style={{ padding: Spacing.three, gap: Spacing.two }}>
          <Text style={{ ...Type.headline, color: c.text }}>{domain.domain}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Image source={status.icon} tintColor={tint} style={{ width: 15, height: 15 }} />
            <Text style={{ ...Type.subhead, fontWeight: '600', color: tint }}>
              {status.label}
            </Text>
          </View>

          <Text style={{ ...Type.footnote, color: c.textSecondary }}>
            {routingDetail(dns.routing, dns.mx)}
          </Text>
          <Text style={{ ...Type.caption, color: c.textTertiary }}>{spfDetail(dns.spf)}</Text>
          <Text style={{ ...Type.caption, color: c.textTertiary }}>
            {domain.inboxCount === 1 ? '1 inbox' : `${domain.inboxCount} inboxes`} ·{' '}
            {domain.messageCount === 0
              ? 'nothing received yet'
              : `${domain.messageCount} received`}
          </Text>
        </View>

        {records.length > 0 ? (
          <>
            <Divider />
            <Block label="Records still to add">
              {records.map((record) => (
                <RecordRow key={`${record.type}:${record.name}:${record.value ?? "?"}`} record={record} />
              ))}
              {dns.routing === 'elsewhere' ? (
                <Text style={{ ...Type.caption, color: c.warning }}>
                  This domain already has MX records pointing at {dns.mx.join(', ')}.
                  Adding these alongside them splits delivery between the two, so
                  remove the old ones once Cloudflare is receiving.
                </Text>
              ) : null}
              {dns.spf === 'elsewhere' && dns.spfRecord ? (
                <Text style={{ ...Type.caption, color: c.warning }}>
                  Edit the TXT record this domain already has to read as above —
                  the value shown already merges it. Adding a second breaks both:
                  SPF allows only one record per name. The current one is{' '}
                  {dns.spfRecord}.
                </Text>
              ) : null}
              {records.some((record) => record.type === 'MX') ? (
                <Text style={{ ...Type.caption, color: c.textTertiary }}>
                  MX priorities are left to Cloudflare, which assigns them per
                  zone, so there is nothing to enter for them.
                </Text>
              ) : null}
            </Block>
            <Divider />
            <LinkRow
              icon="sf:list.bullet.rectangle"
              label="Open DNS records in Cloudflare"
              detail={`Switch to ${domain.domain} if another zone opens`}
              url={CLOUDFLARE_DNS_RECORDS}
            />
          </>
        ) : null}
      </Card>

      {records.length === 0 && unchecked ? (
        <Note>
          Nothing to add from what was read, but part of this lookup did not
          finish, so this is not an all-clear. Check again in a moment.
        </Note>
      ) : null}
    </View>
  );
}

function RecordRow({ record }: { record: DnsRecord }) {
  const c = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two }}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ ...Type.caption, color: c.textSecondary }}>
          {record.action === 'replace' ? 'Replace' : 'Add'} {record.type} ·{' '}
          {record.name}
          {record.type === 'MX' ? ' · priority auto' : ''}
        </Text>
        {/* Selectable for iOS's own Copy: no clipboard module here. */}
        <Text selectable style={{ ...Type.footnote, color: c.text }}>
          {record.value ?? record.note ?? 'Value provided by Cloudflare'}
        </Text>
      </View>
      {/* No share affordance without a value: DKIM's key is generated per zone
          and the worker sends null rather than guessing it. */}
      {record.value ? (
        // `matchContents` or the host takes no space in the row and nothing renders.
        <Host matchContents style={{ marginTop: Spacing.half }}>
          <ShareLink
            item={record.value}
            subject={`${record.type} record for ${record.name}`}
            modifiers={[
              accessibilityLabel(`Share the ${record.type} value ${record.value}`),
            ]}>
            <SymbolImage systemName="square.and.arrow.up" size={18} color={c.primary} />
          </ShareLink>
        </Host>
      ) : null}
    </View>
  );
}

function LinkRow({
  icon,
  label,
  detail,
  url,
}: {
  /** `expo-image` renders SF Symbols only from an `sf:`-prefixed source. */
  icon: string;
  label: string;
  detail: string;
  url: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={() => Linking.openURL(url).catch(() => {})}
      accessibilityRole="link"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.three,
        padding: Spacing.three,
        backgroundColor: pressed ? c.backgroundSelected : 'transparent',
      })}>
      <Image source={icon} tintColor={c.primary} style={{ width: 22, height: 22 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...Type.body, color: c.text }}>{label}</Text>
        <Text style={{ ...Type.footnote, color: c.textSecondary }}>{detail}</Text>
      </View>
      <Image
        source="sf:arrow.up.forward"
        tintColor={c.textTertiary}
        style={{ width: 12, height: 12 }}
      />
    </Pressable>
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'muted';

/** "unknown" is muted, never red: a resolver that did not answer accuses nobody. */
function routingStatus(routing: DnsState): { label: string; tone: Tone; icon: string } {
  if (routing === 'cloudflare') {
    return { label: 'Receiving mail', tone: 'success', icon: 'sf:checkmark.circle.fill' };
  }
  if (routing === 'elsewhere') {
    return {
      label: 'MX points elsewhere',
      tone: 'warning',
      icon: 'sf:exclamationmark.triangle.fill',
    };
  }
  if (routing === 'none') {
    return { label: 'No MX record', tone: 'danger', icon: 'sf:xmark.circle.fill' };
  }
  return { label: 'Couldn’t check', tone: 'muted', icon: 'sf:questionmark.circle' };
}

function routingDetail(routing: DnsState, mx: string[]): string {
  if (routing === 'cloudflare') {
    return `Cloudflare accepts mail for this domain at ${mx.join(', ')}. Whether it then reaches this deployment is the Email Routing rule below, which DNS cannot show.`;
  }
  if (routing === 'elsewhere') {
    return `Mail for this domain is delivered to ${mx.join(', ')}, not here, so nothing sent to it reaches this deployment.`;
  }
  if (routing === 'none') {
    return 'Nothing accepts mail for this domain, so every message sent to it bounces.';
  }
  return 'The DNS lookup did not finish, so this says nothing about the domain either way.';
}

function spfDetail(spf: DnsState): string {
  if (spf === 'cloudflare') return 'SPF authorises Cloudflare to send for this domain.';
  if (spf === 'elsewhere') return 'SPF exists but does not include Cloudflare.';
  if (spf === 'none') return 'No SPF record, so mail sent from here is likelier to be filtered.';
  return 'The SPF lookup did not finish.';
}

/** Before the `all` mechanism, which is terminal: anything after it is ignored. */

/**
 * Code before kind: `parseError` collapses both OAuth refusals into
 * `insufficient-scope`, but only `OAUTH_INSUFFICIENT_SCOPE` is fixed by
 * consenting again.
 */
function failureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong.';
  if (error.code === 'OAUTH_SCOPE_DENIED') return error.message;
  if (error.kind === 'insufficient-scope') {
    return 'This app was not granted admin permission on this server. Sign out and connect it again.';
  }
  if (error.kind === 'forbidden') return 'Your account is not an admin on this server.';
  if (error.kind === 'network') return 'Cannot reach your server.';
  return error.message;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ gap: Spacing.two }}>
      <Text
        style={{
          ...Type.caption,
          fontWeight: '600',
          color: c.textTertiary,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          paddingHorizontal: Spacing.one,
        }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: Radius.xl,
        borderCurve: 'continuous',
        overflow: 'hidden',
      }}>
      {children}
    </View>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ padding: Spacing.three, gap: Spacing.two }}>
      <Text style={{ ...Type.footnote, fontWeight: '600', color: c.textSecondary }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function Divider() {
  const c = useTheme();
  return <View style={{ height: HAIRLINE, backgroundColor: c.border }} />;
}

function Note({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Text
      style={{
        ...Type.footnote,
        color: c.textTertiary,
        paddingHorizontal: Spacing.one,
      }}>
      {children}
    </Text>
  );
}
