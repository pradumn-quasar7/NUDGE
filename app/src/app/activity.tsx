import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Button, EmptyState, Group, Icon, LargeTitle, Screen, SectionLabel, Sep, Skeleton, Spinner, Tap, TopBar, Txt } from '@/components';
import { useSession } from '@/data/session';
import { useMe, useStore } from '@/data/store';
import { listActivity, type ActivityItem } from '@/data/remote-security';
import { demoActivity } from '@/features/security/demo';
import { firstName, longDate, shortDay, time12 } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useTheme } from '@/theme/ThemeProvider';

/** Activity — who changed what in the workspace (audit trail). Owners only. */
export default function Activity() {
  const me = useMe();
  const { state } = useStore();
  const owner = state.members.find((m) => m.role === 'owner' && m.status === 'active' && m.id !== me.id);

  if (me.role !== 'owner') {
    return (
      <Screen header={<TopBar />}>
        <EmptyState
          art={<Art name="clock" />}
          title="Only owners can see the activity log"
          body={`It shows who changed what across the workspace${owner ? `. Ask ${firstName(owner.name)} if you need to know.` : '.'}`}
        />
      </Screen>
    );
  }
  return <OwnerActivity />;
}

type Load = 'loading' | 'idle' | 'more' | 'error';

function OwnerActivity() {
  const session = useSession();
  const cloud = session.mode === 'cloud';
  const { state } = useStore();
  const now = useNow();
  const orgId = state.org.id;

  const demoItems = useMemo(() => (cloud ? [] : demoActivity(state, now)), [cloud, state, now]);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [load, setLoad] = useState<Load>(cloud ? 'loading' : 'idle');
  const busy = useRef(false);

  const fetchPage = useCallback(
    async (from: number | null) => {
      if (!cloud || !orgId || busy.current) return;
      busy.current = true;
      try {
        const page = await listActivity(orgId, from);
        setItems((prev) => (from == null ? page.items : [...prev, ...page.items.filter((x) => !prev.some((p) => p.id === x.id))]));
        setCursor(page.nextCursor);
        setLoad('idle');
      } catch {
        setLoad('error');
      } finally {
        busy.current = false;
      }
    },
    [cloud, orgId],
  );

  // First page on open (load starts as 'loading').
  useEffect(() => {
    if (!cloud || !orgId) return;
    let live = true;
    busy.current = true;
    listActivity(orgId, null)
      .then((page) => {
        if (!live) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoad('idle');
      })
      .catch(() => live && setLoad('error'))
      .finally(() => {
        busy.current = false;
      });
    return () => {
      live = false;
    };
  }, [cloud, orgId]);

  const reload = () => {
    setLoad('loading');
    void fetchPage(null);
  };
  const more = () => {
    if (cursor == null || busy.current) return;
    setLoad('more');
    void fetchPage(cursor);
  };

  const list = cloud ? items : demoItems;
  const groups = useMemo(() => groupByDay(list), [list]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (load === 'idle' && layoutMeasurement.height + contentOffset.y >= contentSize.height - 480) more();
  };

  return (
    <Screen gap={22} header={<TopBar />} scrollProps={{ onScroll, scrollEventThrottle: 200 }}>
      <LargeTitle sub={<Txt variant="s">Who changed what in {state.org.name || 'your workspace'}. Only owners see this.</Txt>}>Activity</LargeTitle>

      {load === 'loading' && list.length === 0 ? (
        <Group>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i}>
              {i > 0 && <Sep inset={44} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 }}>
                <Skeleton w={32} h={32} r={16} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton w="70%" h={12} />
                  <Skeleton w="40%" h={10} />
                </View>
              </View>
            </View>
          ))}
        </Group>
      ) : load === 'error' && list.length === 0 ? (
        <EmptyState
          art={<Art name="cloudOff" />}
          title="Couldn’t load activity"
          body="Check your connection. Nothing has changed in your workspace."
        >
          <Button variant="secondary" label="Try again" full onPress={reload} />
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState art={<Art name="clock" />} title="Nothing yet" body="Changes your team makes — promises, customers, settings — will show up here." />
      ) : (
        groups.map((g) => (
          <View key={g.key} style={{ gap: 8 }}>
            <SectionLabel style={{ paddingLeft: 4 }}>{dayLabel(g.at, now)}</SectionLabel>
            <Group>
              {g.items.map((it, i) => (
                <ActivityRow key={it.id} item={it} first={i === 0} />
              ))}
            </Group>
          </View>
        ))
      )}

      {cloud && list.length > 0 && (
        <View style={{ alignItems: 'center', minHeight: 44, justifyContent: 'center' }}>
          {load === 'more' ? (
            <SpinnerRow />
          ) : load === 'error' ? (
            <Button variant="ghost" label="Couldn’t load more · Try again" onPress={more} />
          ) : cursor != null ? (
            <Button variant="ghost" label="Show older" onPress={more} />
          ) : (
            <Txt variant="meta">That’s everything</Txt>
          )}
        </View>
      )}
    </Screen>
  );
}

function ActivityRow({ item, first }: { item: ActivityItem; first: boolean }) {
  const { state } = useStore();
  const [verb, ...rest] = item.summary.split(' · ');
  const label = rest.join(' · ');
  const actor = item.actorKind === 'user' ? firstName(item.actorName) : 'Nudge';
  const target = routeFor(item, state);
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 }}>
      {item.actorKind === 'user' ? <Avatar name={item.actorName} size={32} /> : <NudgeGlyph />}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="t">
          <Txt variant="t" weight="medium">
            {actor}
          </Txt>{' '}
          {verb}
        </Txt>
        <Txt variant="meta" numberOfLines={2}>
          {label ? `${label} · ` : ''}
          {time12(item.at)}
        </Txt>
      </View>
    </View>
  );
  return (
    <>
      {!first && <Sep inset={44} />}
      {target ? (
        <Tap onPress={() => router.push(target)} scale={0.99} accessibilityRole="button" accessibilityLabel={`${actor} ${item.summary}. Open`}>
          {body}
        </Tap>
      ) : (
        <View accessible accessibilityLabel={`${actor} ${item.summary}, ${time12(item.at)}`}>
          {body}
        </View>
      )}
    </>
  );
}

function Art({ name }: { name: 'clock' | 'cloudOff' }) {
  const { c } = useTheme();
  return <Icon name={name} size={32} color={c.t3} />;
}

function NudgeGlyph() {
  const { c } = useTheme();
  return (
    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="logo" size={16} color={c.t2} />
    </View>
  );
}

function SpinnerRow() {
  const { c } = useTheme();
  return <Spinner color={c.t3} />;
}

/** Customers and promises that still exist open their screen; everything else is a plain line. */
function routeFor(item: ActivityItem, state: ReturnType<typeof useStore>['state']) {
  if (!item.entityId || item.action === 'delete') return null;
  if (item.entityType === 'customers' && state.customers.some((c) => c.id === item.entityId)) {
    return { pathname: '/customer/[id]', params: { id: item.entityId } } as const;
  }
  if (item.entityType === 'commitments' && state.commitments.some((c) => c.id === item.entityId)) {
    return { pathname: '/promise/[id]', params: { id: item.entityId } } as const;
  }
  return null;
}

function groupByDay(items: ActivityItem[]) {
  const out: { key: string; at: number; items: ActivityItem[] }[] = [];
  for (const it of items) {
    const d = new Date(it.at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = out[out.length - 1];
    if (last?.key === key) last.items.push(it);
    else out.push({ key, at: it.at, items: [it] });
  }
  return out;
}

function dayLabel(at: number, now: number) {
  const s = shortDay(at, now);
  return s === 'Today' || s === 'Yesterday' ? s : longDate(at);
}
