import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  CheckCircle,
  Icon,
  Sep,
  Tap,
  Txt,
  useSheetClose,
  useToast,
  webNoOutline,
} from '@/components';
import { useStore, type AppState } from '@/data/store';
import { customerById } from '@/data/selectors';
import type { ID } from '@/data/types';
import { extractCapture, type CaptureDraft } from '@/lib/ai';
import { DAY_MS, dayDiff, firstName, plural, startOfDay } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { ThinkingDots } from './Waveform';

/* ───────────── Understanding (shared by voice + quick note) ───────────── */

/** How long the "understanding" dots show before the result — feels considered, not instant. */
export const UNDERSTAND_MS = 950;

/**
 * Run the on-device extraction (stand-in for the `ai-extract` edge function) and enrich it from memory:
 * if the requirement has no item but the customer's memory names one ("4-tier rack"), add it.
 */
export function understandText(text: string, s: AppState, hintCustomerId?: ID, now = Date.now()): CaptureDraft {
  const normalised = text.replace(/[’‘]/g, "'");
  const draft = extractCapture(normalised, s, hintCustomerId, now);
  draft.transcript = text.trim();
  if (hintCustomerId && !draft.customerId) draft.customerId = hintCustomerId;
  if (draft.requirement && !draft.requirement.includes('·') && draft.customerId) {
    const item = s.facts
      .filter((f) => f.customerId === draft.customerId)
      .map((f) => f.text.match(/(\d+-tier rack|rack|shelving|shelves|display)/i)?.[1])
      .find(Boolean);
    if (item) draft.requirement = `${draft.requirement} · ${item}`;
  }
  return draft;
}

/** "Tomorrow, Wed 7 Oct" · "Today, Tue 6 Oct" · "Fri 9 Oct". */
export function dueText(ts: number, now = Date.now()) {
  const d = new Date(ts);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const date = `${wd} ${d.getDate()} ${mon}`;
  const diff = dayDiff(ts, now);
  if (diff === 0) return `Today, ${date}`;
  if (diff === 1) return `Tomorrow, ${date}`;
  return date;
}

function dueOptions(current: number | undefined, now = Date.now()) {
  const base = startOfDay(now);
  const opts = [base + 18 * 3_600_000, base + DAY_MS + 12 * 3_600_000, base + 2 * DAY_MS + 12 * 3_600_000, base + 7 * DAY_MS + 12 * 3_600_000];
  if (current && !opts.some((o) => dayDiff(o, current) === 0)) opts.push(current);
  return opts.sort((a, b) => a - b);
}

export function UnderstandingView({ transcript, fill, detail }: { transcript?: string; fill?: boolean; detail?: string }) {
  return (
    <View style={{ flex: fill ? 1 : undefined, alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 40 }}>
      <ThinkingDots />
      <Txt variant="s" accessibilityLiveRegion="polite">
        Understanding…
      </Txt>
      {transcript ? (
        <Txt variant="s" center style={{ fontStyle: 'italic', paddingHorizontal: 12 }} numberOfLines={3}>
          “{transcript}”
        </Txt>
      ) : null}
      {detail ? <Txt variant="meta">{detail}</Txt> : null}
    </View>
  );
}

/* ───────────── Multiline note field (shared Input is single-line, 52pt) ───────────── */

export function NoteField(props: TextInputProps) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View
      style={[
        { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: focus ? c.acc : c.line2, paddingHorizontal: 16, paddingVertical: 14, minHeight: 140 },
        focus && { boxShadow: `0 0 0 4px ${c.accWash2}` },
      ]}
    >
      <TextInput
        multiline
        textAlignVertical="top"
        placeholderTextColor={c.t3}
        {...props}
        onFocus={(e) => {
          setFocus(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          props.onBlur?.(e);
        }}
        style={[{ flex: 1, minHeight: 110, fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: c.t1, padding: 0 }, webNoOutline]}
      />
    </View>
  );
}

/* ───────────── Understood (16b) ───────────── */

type EditKey = 'requirement' | 'action' | null;

/**
 * "Understood" review: every line is tappable to fix before anything is saved.
 * Save writes the raw note, the promise (if any) and facts — all linked to the note — then closes the sheet.
 */
export function UnderstoodView({
  draft,
  kind,
  onEdit,
  onSaved,
  fill,
  audioPath,
  language,
}: {
  draft: CaptureDraft;
  kind: 'voice' | 'note';
  /** Cloud voice notes: the uploaded recording, attached to the saved note. */
  audioPath?: string;
  /** Language(s) the transcript was heard in ("Hinglish") — shown under the quote. */
  language?: string;
  /** "Edit" — go back to typing with the transcript. */
  onEdit: (transcript: string) => void;
  /** After save. Defaults to closing the enclosing sheet. */
  onSaved?: () => void;
  /** Stretch to fill a full-height sheet (buttons pinned to the bottom). */
  fill?: boolean;
}) {
  const { state, actions } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const close = useSheetClose();
  const [customerId, setCustomerId] = useState<ID | undefined>(draft.customerId);
  const [requirement, setRequirement] = useState(draft.requirement ?? '');
  const [action, setAction] = useState(draft.action ?? '');
  const [dueAt, setDueAt] = useState<number | undefined>(draft.dueAt);
  const [editing, setEditing] = useState<EditKey>(null);
  const [picking, setPicking] = useState(!draft.customerId);
  const customer = customerById(state, customerId);
  const first = customer ? firstName(customer.name) : 'the customer';
  const options = useMemo(() => dueOptions(draft.dueAt), [draft.dueAt]);
  const hasAction = action.trim().length > 0;
  const transcript = /[.!?]$/.test(draft.transcript) ? draft.transcript : `${draft.transcript}.`;

  const cycleDue = () => {
    const cur = dueAt ?? options[1];
    const i = options.findIndex((o) => dayDiff(o, cur) === 0);
    setDueAt(options[(i + 1) % options.length]);
  };

  const save = () => {
    if (!customer) {
      setPicking(true);
      return;
    }
    const facts = [requirement.trim() ? `Requirement · ${requirement.trim()}` : null, ...draft.facts].filter((f): f is string => !!f);
    const act = action.trim();
    const title = /^(send|share)\b/i.test(act) && !act.toLowerCase().includes(first.toLowerCase()) ? `${act} to ${first}` : act;
    actions.saveCapture({
      customerId: customer.id,
      transcript: draft.transcript,
      kind,
      promise: act ? { title, dueAt: dueAt ?? Date.now() + DAY_MS } : undefined,
      facts,
      audioPath,
    });
    const n = 1 + (act ? 1 : 0) + facts.length;
    toast({ text: `Remembered ${plural(n, 'detail')} about ${first}`, icon: 'spark' });
    (onSaved ?? close)();
  };

  return (
    <View style={{ flex: fill ? 1 : undefined, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <CheckCircle size={28} />
        <Txt variant="h2" accessibilityRole="header">
          Understood
        </Txt>
      </View>
      <View style={{ gap: 4 }}>
        <Txt variant="s" style={{ fontStyle: 'italic' }}>
          “{transcript}”
        </Txt>
        {language && language !== 'Unknown' ? <Txt variant="meta">Transcribed from your voice · {language}</Txt> : null}
      </View>

      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {picking ? (
          <CustomerPicker
            selected={customerId}
            onPick={(id) => {
              setCustomerId(id);
              setPicking(false);
            }}
            onCancel={customer ? () => setPicking(false) : undefined}
          />
        ) : (
          <View style={{ backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 2 }}>
            <Field label="Customer" onPress={() => setPicking(true)} hint="Change customer">
              {customer ? (
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar name={customer.name} size={30} />
                  <View style={{ flex: 1 }}>
                    <Txt numberOfLines={1}>{customer.name}</Txt>
                    {customer.company ? <Txt variant="meta" numberOfLines={1}>{customer.company}</Txt> : null}
                  </View>
                </View>
              ) : (
                <Txt tone="t3" style={{ flex: 1 }}>
                  Choose customer
                </Txt>
              )}
            </Field>
            <Sep />
            <Field label="Requirement" onPress={() => setEditing('requirement')} hint="Edit requirement">
              {editing === 'requirement' ? (
                <InlineInput value={requirement} onChangeText={setRequirement} onDone={() => setEditing(null)} placeholder="e.g. 50 units" />
              ) : (
                <Txt tone={requirement ? 't1' : 't3'} style={{ flex: 1 }}>
                  {requirement || 'Add requirement'}
                </Txt>
              )}
            </Field>
            <Sep />
            <Field label="Action" onPress={() => setEditing('action')} hint="Edit action">
              {editing === 'action' ? (
                <InlineInput value={action} onChangeText={setAction} onDone={() => setEditing(null)} placeholder="e.g. Send quotation" />
              ) : (
                <>
                  <Txt tone={hasAction ? 't1' : 't3'} style={{ flex: 1 }} numberOfLines={1}>
                    {hasAction ? action : 'No follow-up — just a note'}
                  </Txt>
                  {hasAction && <Badge tone="acc" label="Promise" />}
                </>
              )}
            </Field>
            {hasAction && (
              <>
                <Sep />
                <Field label="Due" onPress={cycleDue} hint="Change due date">
                  <Txt style={{ flex: 1 }}>{dueText(dueAt ?? options[1])}</Txt>
                  <Icon name="chevron" size={16} color={c.t3} />
                </Field>
              </>
            )}
          </View>
        )}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 2 }}>
        <View style={{ marginTop: 2 }}>
          <Icon name="spark" size={16} color={c.accText} />
        </View>
        <Txt variant="s" style={{ flex: 1 }}>
          {hasAction
            ? `Saving adds a promise to Promise Radar and a note to ${first}’s memory. Tap any line to fix it.`
            : `Saving adds a note to ${first}’s memory. Tap any line to fix it.`}
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: fill ? 'auto' : 4 }}>
        <Button variant="secondary" size="lg" label="Edit" style={{ flex: 1 }} onPress={() => onEdit(draft.transcript)} />
        <Button size="lg" label="Save" style={{ flex: 2 }} onPress={save} disabled={!customer} />
      </View>
    </View>
  );
}

function Field({ label, children, onPress, hint }: { label: string; children: ReactNode; onPress: () => void; hint: string }) {
  return (
    <Tap onPress={onPress} scale={0.99} accessibilityRole="button" accessibilityHint={hint} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 8 }}>
      <Txt variant="meta" style={{ width: 92 }}>
        {label}
      </Txt>
      {children}
    </Tap>
  );
}

function InlineInput({ onDone, ...props }: TextInputProps & { onDone: () => void }) {
  const { c } = useTheme();
  return (
    <TextInput
      {...props}
      autoFocus
      returnKeyType="done"
      onSubmitEditing={onDone}
      onBlur={onDone}
      placeholderTextColor={c.t3}
      style={[{ flex: 1, fontFamily: fonts.regular, fontSize: 15, color: c.t1, padding: 0, minHeight: 40 }, webNoOutline]}
    />
  );
}

/** Simple customer picker — most recently created first, archived hidden. */
export function CustomerPicker({ selected, onPick, onCancel }: { selected?: ID; onPick: (id: ID) => void; onCancel?: () => void }) {
  const { state } = useStore();
  const { c } = useTheme();
  const list = state.customers.filter((x) => !x.archived);
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <Txt variant="cap">Which customer?</Txt>
        {onCancel ? <Button variant="ghost" size="sm" label="Done" onPress={onCancel} /> : null}
      </View>
      <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {list.map((x, i) => (
          <View key={x.id}>
            {i > 0 && <Sep inset={42} />}
            <Tap
              onPress={() => onPick(x.id)}
              scale={0.99}
              accessibilityRole="button"
              accessibilityState={{ selected: x.id === selected }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}
            >
              <Avatar name={x.name} size={30} />
              <View style={{ flex: 1 }}>
                <Txt numberOfLines={1}>{x.name}</Txt>
                {x.company ? <Txt variant="meta" numberOfLines={1}>{x.company}</Txt> : null}
              </View>
              {x.id === selected && <Icon name="check" size={18} color={c.accText} />}
            </Tap>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
