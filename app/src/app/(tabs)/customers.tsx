import { useMemo, useState } from 'react';
import { Platform, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AskBar,
  Button,
  Chip,
  Icon,
  IconButton,
  LargeTitle,
  Screen,
  SectionLabel,
  Sep,
  Txt,
  useIsTablet,
  webNoOutline,
} from '@/components';
import { useStore, type AppState } from '@/data/store';
import { lastEvent, needsYou } from '@/data/selectors';
import type { Customer, ID } from '@/data/types';
import { DAY_MS, firstName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { CustomerRow, NoCustomers } from '@/features/customer/CustomerRow';
import { ProfileBody } from '@/features/customer/ProfileBody';
import { useNow } from '@/lib/useNow';

type Filter = 'all' | 'needs' | 'active' | 'quiet';

const QUIET_DAYS = 10;
const QUESTION = /\?\s*$|^(who|what|which|when|how|show|did|list|find|whom)\b|haven.?t|hasn.?t|not replied/i;

function matches(c: Customer, q: string) {
  if (!q) return true;
  const t = q.toLowerCase();
  return [c.name, c.company ?? '', c.headline].some((f) => f.toLowerCase().includes(t));
}

function useSections(state: AppState, filter: Filter, query: string) {
  const now = useNow();
  return useMemo(() => {
    const { needing, rest } = needsYou(state, now);
    const all = [...needing, ...rest];
    const isQuiet = (c: Customer) => {
      const last = lastEvent(state, c.id);
      return !last || now - last.at > QUIET_DAYS * DAY_MS;
    };
    const byRecent = (a: Customer, b: Customer) => (lastEvent(state, b.id)?.at ?? 0) - (lastEvent(state, a.id)?.at ?? 0);
    const q = query.trim();
    const f = (list: Customer[]) => list.filter((c) => matches(c, q));
    let sections: { title: string; items: Customer[] }[];
    if (filter === 'needs') sections = [{ title: 'Needs you', items: f(needing) }];
    else if (filter === 'active') sections = [{ title: 'Active', items: f(all.filter((c) => !isQuiet(c)).sort(byRecent)) }];
    else if (filter === 'quiet') sections = [{ title: 'Gone quiet', items: f(all.filter(isQuiet).sort(byRecent)) }];
    else
      sections = [
        { title: 'Needs you', items: f(needing) },
        { title: 'Recently active', items: f(rest) },
      ];
    return { total: all.length, needCount: needing.length, sections: sections.filter((s) => s.items.length), first: all[0] };
  }, [state, filter, query, now]);
}

function SearchField({
  value,
  onChange,
  onSubmit,
  placeholder,
  height = 48,
  shortcut,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  height?: number;
  shortcut?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height, borderRadius: height === 48 ? 16 : 14, backgroundColor: c.bg2, paddingHorizontal: height === 48 ? 14 : 12 }}
    >
      <Icon name="search" size={20} color={c.t3} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={c.t3}
        returnKeyType="search"
        accessibilityLabel="Search customers or ask a question"
        autoCorrect={false}
        style={[{ flex: 1, height: '100%', fontFamily: fonts.regular, fontSize: height === 48 ? 15 : 14.5, color: c.t1 }, webNoOutline]}
      />
      {value ? (
        <IconButton name="close" label="Clear search" size={36} color={c.t3} onPress={() => onChange('')} />
      ) : shortcut && Platform.OS === 'web' ? (
        <View style={{ borderWidth: 1, borderColor: c.line2, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
          <Txt variant="meta" mono>
            ⌘K
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

function NoMatch({ query }: { query: string }) {
  return (
    <View style={{ gap: 6, paddingVertical: 16, alignItems: 'flex-start' }}>
      <Txt variant="s">No customer matches “{query.trim()}”.</Txt>
      <Button
        variant="ghost"
        label={`Ask Nudge “${query.trim()}”`}
        style={{ paddingHorizontal: 0 }}
        onPress={() => router.push({ pathname: '/search', params: { q: query.trim() } })}
      />
    </View>
  );
}

/**
 * 08 · Customer list — who needs me, then who's been active.
 * Tablet: list column beside the selected customer's memory (board 11).
 */
export default function Customers() {
  const { state } = useStore();
  const { c } = useTheme();
  const isTablet = useIsTablet();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<ID | undefined>();
  const { total, needCount, sections, first } = useSections(state, filter, query);

  const submit = () => {
    const q = query.trim();
    if (q && QUESTION.test(q)) router.push({ pathname: '/search', params: { q } });
  };

  if (total === 0) {
    return (
      <Screen tabBar scroll={false} contentStyle={{ flex: 1 }}>
        <View style={{ minHeight: 44, justifyContent: 'center' }}>
          <Txt variant="h1" accessibilityRole="header">
            Customers
          </Txt>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', maxWidth: 420, width: '100%', alignSelf: 'center' }}>
          <NoCustomers />
        </View>
      </Screen>
    );
  }

  const addButton = (
    <View style={{ marginRight: -10 }}>
      <IconButton name="plus" label="Add customer" onPress={() => router.push('/customer/new')} />
    </View>
  );

  const list = (variant: 'phone' | 'tablet') =>
    sections.length === 0 ? (
      query.trim() ? (
        <NoMatch query={query} />
      ) : (
        <Txt variant="s" style={{ paddingVertical: 16 }}>
          Nobody here right now.
        </Txt>
      )
    ) : (
      sections.map((s) => (
        <View key={s.title} style={{ gap: variant === 'tablet' ? 2 : 0 }}>
          <SectionLabel style={variant === 'tablet' ? { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8 } : { marginTop: 4, marginBottom: 2 }}>
            {s.title}
          </SectionLabel>
          {s.items.map((cust, i) => (
            <View key={cust.id}>
              {variant === 'phone' && i > 0 && <Sep inset={54} />}
              <CustomerRow
                state={state}
                customer={cust}
                variant={variant}
                selected={variant === 'tablet' && cust.id === selected?.id}
                onPress={() => (variant === 'tablet' ? setSelectedId(cust.id) : router.push(`/customer/${cust.id}`))}
              />
            </View>
          ))}
        </View>
      ))
    );

  const selectedCandidate = state.customers.find((x) => x.id === selectedId && !x.archived);
  const selected = selectedCandidate ?? first;

  if (isTablet) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.bg }}>
        <View style={{ width: 360, borderRightWidth: 1, borderRightColor: c.line }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: insets.top + 28, paddingHorizontal: 14, paddingBottom: insets.bottom + 32, gap: 16 }}
          >
            <View style={{ paddingHorizontal: 6, gap: 16 }}>
              <LargeTitle right={addButton}>Customers</LargeTitle>
              <SearchField value={query} onChange={setQuery} onSubmit={submit} placeholder="Search or ask…" height={44} shortcut />
            </View>
            {list('tablet')}
          </ScrollView>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {selected ? (
            <>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingTop: insets.top + 32, paddingHorizontal: 36, paddingBottom: insets.bottom + 130 }}
              >
                <View style={{ maxWidth: 1040, width: '100%', alignSelf: 'center' }}>
                  <ProfileBody key={selected.id} customerId={selected.id} layout="tablet" />
                </View>
              </ScrollView>
              <LinearGradient
                pointerEvents="none"
                colors={[c.bg + '00', c.bg]}
                locations={[0, 0.78]}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 + insets.bottom }}
              />
              <View
                pointerEvents="box-none"
                style={{ position: 'absolute', left: 24, right: 24, bottom: 28 + insets.bottom, alignItems: 'center' }}
              >
                <View style={{ width: '100%', maxWidth: 520 }}>
                  <AskBar inline placeholder={`Ask about ${firstName(selected.name)}…`} customerId={selected.id} />
                </View>
              </View>
            </>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <Screen tabBar gap={18}>
      <LargeTitle right={addButton}>Customers</LargeTitle>
      <SearchField value={query} onChange={setQuery} onSubmit={submit} placeholder="Search or ask “who hasn’t replied?”" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -20 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
      >
        <Chip label="All" count={total} on={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Needs you" count={needCount} on={filter === 'needs'} onPress={() => setFilter('needs')} />
        <Chip label="Active" on={filter === 'active'} onPress={() => setFilter('active')} />
        <Chip label="Gone quiet" on={filter === 'quiet'} onPress={() => setFilter('quiet')} />
      </ScrollView>
      {list('phone')}
    </Screen>
  );
}
