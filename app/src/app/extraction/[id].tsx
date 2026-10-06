import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AiLabel, Avatar, Button, Icon, IconButton, Sep, Sheet, Tap, Txt, useSheetClose, useToast } from '@/components';
import { customerById, eventById, eventsFor } from '@/data/selectors';
import { useStore } from '@/data/store';
import type { CustomerEvent, Extraction, ExtractionField } from '@/data/types';
import { DAY_MS, shortDay, startOfDay, time12 } from '@/lib/format';
import { channelLabel, dueDay } from '@/features/promises';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * 17 · AI extraction confirmation — "I noticed a commitment".
 * The source chat stays visible behind the sheet; nothing is saved until you confirm.
 */
export default function ExtractionConfirm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useStore();
  const { c } = useTheme();
  const x = state.extractions.find((e) => e.id === id);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {x && <SourceChat extraction={x} />}
      <View style={StyleSheet.absoluteFill}>
        <Sheet>{x ? <Confirm extraction={x} /> : <Missing />}</Sheet>
      </View>
    </View>
  );
}

function Missing() {
  const close = useSheetClose();
  return (
    <View style={{ gap: 12, paddingTop: 4 }}>
      <AiLabel>Nothing to confirm</AiLabel>
      <Txt variant="body">This suggestion was already handled.</Txt>
      <Button label="Close" variant="secondary" full onPress={close} />
    </View>
  );
}

/** The conversation the commitment was noticed in, rendered behind the scrim. */
function SourceChat({ extraction: x }: { extraction: Extraction }) {
  const { state } = useStore();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const customer = customerById(state, x.customerId);
  const source = eventById(state, x.sourceEventId);
  const all = eventsFor(state, x.customerId).filter((e) => e.kind === 'message' || e.kind === 'call');
  let chat: CustomerEvent[];
  if (source) {
    chat = all.filter((e) => e.at <= source.at && source.at - e.at < DAY_MS).sort((a, b) => a.at - b.at);
  } else {
    chat = all.filter((e) => e.at <= x.createdAt).slice(0, 3).reverse();
  }
  const last = chat[chat.length - 1];
  const channel = channelLabel[source?.channel ?? chat[0]?.channel ?? customer?.preferredChannel ?? 'whatsapp'];

  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flex: 1, paddingTop: insets.top + 6, paddingHorizontal: 20, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -10, minHeight: 48 }}>
        <IconButton name="back" label="Back" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar name={customer?.name ?? '?'} size={30} />
          <View>
            <Txt weight="semibold">{customer?.name}</Txt>
            <Txt variant="meta">{channel}</Txt>
          </View>
        </View>
        <IconButton name="phone" label="Call" />
      </View>
      {chat.length > 0 && (
        <Txt variant="meta" center>
          {shortDay(chat[0].at)}
        </Txt>
      )}
      {chat.map((e) => {
        const out = e.direction !== 'in';
        return (
          <View
            key={e.id}
            style={{
              maxWidth: '78%',
              alignSelf: out ? 'flex-end' : 'flex-start',
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 20,
              backgroundColor: out ? c.inv : c.card,
              borderWidth: out ? 0 : 1,
              borderColor: c.line,
              ...(out ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }),
            }}
          >
            <Txt color={out ? c.onInv : c.t1}>{e.body ?? e.aiNote ?? e.title}</Txt>
          </View>
        );
      })}
      {last && (
        <Txt variant="meta" style={{ textAlign: last.direction === 'in' ? 'left' : 'right' }}>
          {time12(last.at)}
        </Txt>
      )}
    </View>
  );
}

function Confirm({ extraction: x }: { extraction: Extraction }) {
  const { actions } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const close = useSheetClose();
  const [fields, setFields] = useState<ExtractionField[]>(x.fields);

  // Due options: the suggested date first, then today / tomorrow / next weekday — Edit cycles through them.
  const dueOptions = useMemo(() => {
    const now = Date.now();
    const base = x.dueAt ?? startOfDay(now) + 18 * 3_600_000;
    const d = new Date(base);
    const hm = (d.getHours() * 60 + d.getMinutes()) * 60_000;
    const t0 = startOfDay(now);
    let wd = 1;
    while ([0, 6].includes(new Date(t0 + (1 + wd) * DAY_MS).getDay())) wd++;
    const list = [base, t0 + hm, t0 + DAY_MS + hm, t0 + (1 + wd) * DAY_MS + hm].filter((t) => t > now);
    return list.filter((t, i) => list.findIndex((u) => startOfDay(u) === startOfDay(t)) === i);
  }, [x.dueAt]);
  const [dueIdx, setDueIdx] = useState(0);
  const dueAt = dueOptions[dueIdx] ?? x.dueAt;

  const title = x.title.replace(/\.$/, '');
  const done = x.status === 'confirmed';

  return (
    <View style={{ gap: 16, paddingTop: 4 }}>
      <AiLabel>I noticed a commitment</AiLabel>
      <Txt variant="h2" accessibilityRole="header">{`“${title}.”`}</Txt>

      <View style={{ backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.line, paddingVertical: 4, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12 }}>
          <Txt variant="meta" style={{ width: 74 }}>
            Due
          </Txt>
          <Txt style={{ flex: 1 }}>{dueAt ? dueDay(dueAt) : 'No date'}</Txt>
          {dueOptions.length > 1 && (
            <Button
              variant="ghost"
              label="Edit"
              accessibilityLabel="Change due date"
              onPress={() => setDueIdx((i) => (i + 1) % dueOptions.length)}
            />
          )}
        </View>
        {fields.map((f) => (
          <View key={f.key}>
            <Sep />
            <Tap
              scale={0.99}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: f.checked }}
              accessibilityLabel={`${f.label}: ${f.value}`}
              onPress={() => setFields((all) => all.map((g) => (g.key === f.key ? { ...g, checked: !g.checked } : g)))}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 12 }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  borderWidth: 1.5,
                  borderColor: f.checked ? c.acc : c.line2,
                  backgroundColor: f.checked ? c.acc : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {f.checked && <Icon name="check" size={14} color="#FFFFFF" strokeWidth={2.4} />}
              </View>
              <Txt style={{ flex: 1 }} tone={f.checked ? 't1' : 't2'}>
                {f.label} · {f.value}
              </Txt>
            </Tap>
          </View>
        ))}
      </View>

      <Txt variant="meta">{x.sourceLabel} Nothing is saved until you confirm.</Txt>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {done ? (
          <Button label="Already on Promise Radar" variant="secondary" size="lg" flex onPress={close} />
        ) : (
          <>
            <Button
              variant="ai"
              size="lg"
              flex
              label="Add to Promise Radar"
              icon={null}
              onPress={() => {
                actions.confirmExtraction(x.id, fields, dueAt);
                toast({ text: 'Added to Promise Radar', icon: 'spark' });
                close();
              }}
            />
            <Button
              variant="secondary"
              size="lg"
              label="Ignore"
              onPress={() => {
                actions.ignoreExtraction(x.id);
                close();
              }}
            />
          </>
        )}
      </View>
    </View>
  );
}
