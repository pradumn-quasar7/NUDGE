import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Button,
  Chip,
  EmptyState,
  Group,
  Input,
  LargeTitle,
  Num,
  Screen,
  SectionLabel,
  SettingsRow,
  Skeleton,
  Toggle,
  TopBar,
  Txt,
  useToast,
} from '@/components';
import { getContactPolicy, saveContactPolicy, updateCustomerContact, type ContactMethod, type ContactPolicy } from '@/data/remote-drafts';
import { backendMode } from '@/data/session';
import { useCustomer, useStore } from '@/data/store';
import { isEmail, phoneDigits } from '@/lib/draft';
import { firstName, shortDay } from '@/lib/format';

/**
 * Contact preferences (Quiet Hours / Contact Policy): how and when a customer likes to hear from you,
 * how often, and "Do not contact". Drafts and follow-up reminders respect it.
 * Cloud: contact_policies (any member who can see the customer). Demo: kept on this screen only.
 */

const METHODS: { value: ContactMethod; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
];

type Preset = 'any' | 'morning' | 'afternoon' | 'evening' | 'custom';
const PRESETS: { value: Preset; label: string; hours?: [string, string] }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'morning', label: 'Mornings 9–12', hours: ['09:00', '12:00'] },
  { value: 'afternoon', label: 'Afternoons 12–5', hours: ['12:00', '17:00'] },
  { value: 'evening', label: 'Evenings 5–9', hours: ['17:00', '21:00'] },
  { value: 'custom', label: 'Custom' },
];

/** "18:00", "6 pm", "6:30pm", "9" → "HH:MM" (24h), else null. */
function parseClock(text: string): string | null {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "17:00" → "5 pm" */
function clock(v: string) {
  const [h, m] = v.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

function presetOf(start: string | null, end: string | null): Preset {
  if (!start || !end) return 'any';
  return PRESETS.find((p) => p.hours && p.hours[0] === start && p.hours[1] === end)?.value ?? 'custom';
}

export default function ContactPreferences() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useStore();
  const customer = useCustomer(id);
  const toast = useToast();
  const cloud = backendMode === 'cloud' && !!state.org.id;
  const orgId = state.org.id;

  const [loading, setLoading] = useState(cloud);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [method, setMethod] = useState<ContactMethod | null>(() =>
    customer?.preferredChannel === 'phone' ? 'call' : customer?.preferredChannel === 'email' ? 'email' : customer?.preferredChannel === 'whatsapp' ? 'whatsapp' : null,
  );
  const [preset, setPreset] = useState<Preset>('any');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [maxPerWeek, setMaxPerWeek] = useState<number | null>(null);
  const [optedOut, setOptedOut] = useState(false);
  const [reason, setReason] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [updated, setUpdated] = useState<{ at?: number; by?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ hours?: string; phone?: string; email?: string; save?: string }>({});

  useEffect(() => {
    if (!cloud || !id) return;
    let live = true;
    getContactPolicy(orgId, id)
      .then((p) => {
        if (!live) return;
        if (p) {
          setMethod(p.method);
          const pr = presetOf(p.hoursStart, p.hoursEnd);
          setPreset(pr);
          if (pr === 'custom') {
            setFrom(p.hoursStart ?? '');
            setTo(p.hoursEnd ?? '');
          }
          setMaxPerWeek(p.maxPerWeek);
          setOptedOut(p.optedOut);
          setReason(p.optedOutReason ?? '');
          setUpdated({ at: p.updatedAt, by: p.updatedBy });
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setLoadError(e instanceof Error ? e.message : 'Couldn’t load contact preferences.');
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [cloud, orgId, id]);

  if (!customer) {
    return (
      <Screen header={<TopBar />}>
        <EmptyState title="Customer not found" body="They may have been removed. Your customer list has the latest." />
      </Screen>
    );
  }

  const first = firstName(customer.name);
  const missingPhone = !phoneDigits(customer.phone);
  const missingEmail = !isEmail(customer.email);
  const updatedBy = updated?.by ? state.members.find((m) => m.id === updated.by) : undefined;

  const save = async () => {
    const next: typeof errors = {};
    let hours: [string, string] | null = null;
    if (preset === 'custom') {
      const s = parseClock(from);
      const e = parseClock(to);
      if (!s || !e) next.hours = 'Enter both times, like 18:00 or 6 pm.';
      else if (s === e) next.hours = 'Start and end can’t be the same.';
      else hours = [s, e];
    } else {
      hours = PRESETS.find((p) => p.value === preset)?.hours ?? null;
    }
    if (missingPhone && phone.trim() && !phoneDigits(phone)) next.phone = 'That doesn’t look like a phone number.';
    if (missingEmail && email.trim() && !isEmail(email)) next.email = 'That doesn’t look like an email address.';
    setErrors(next);
    if (next.hours || next.phone || next.email) return;

    const policy: ContactPolicy = {
      method,
      hoursStart: hours?.[0] ?? null,
      hoursEnd: hours?.[1] ?? null,
      maxPerWeek,
      optedOut,
      optedOutReason: optedOut ? reason.trim() || null : null,
    };
    if (!cloud) {
      toast({ text: `Saved ${first}’s contact preferences`, icon: 'check' });
      return;
    }
    setSaving(true);
    try {
      await saveContactPolicy(orgId, customer.id, policy);
      const contact: { phone?: string; email?: string } = {};
      // Stored as E.164 so WhatsApp messages from this number match the customer.
      if (missingPhone && phone.trim()) contact.phone = `+${phoneDigits(phone)}`;
      if (missingEmail && email.trim()) contact.email = email;
      if (contact.phone || contact.email) await updateCustomerContact(customer.id, contact);
      await reload();
      toast({ text: `Saved ${first}’s contact preferences`, icon: 'check' });
      if (router.canGoBack()) router.back();
    } catch (e) {
      setErrors({ save: e instanceof Error ? e.message : 'Couldn’t save. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen gap={24} header={<TopBar />} contentStyle={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
      <LargeTitle sub={<Txt variant="s">How and when {first} likes to hear from you. Drafts and reminders follow this.</Txt>}>
        Contact preferences
      </LargeTitle>

      {loading ? (
        <View style={{ gap: 12 }} accessibilityLabel="Loading contact preferences">
          <Skeleton h={44} />
          <Skeleton h={44} />
          <Skeleton h={88} />
        </View>
      ) : loadError ? (
        <EmptyState title="Couldn’t load preferences" body={loadError}>
          <Button variant="secondary" label="Go back" onPress={() => router.back()} />
        </EmptyState>
      ) : (
        <>
          {(missingPhone || missingEmail) && (
            <View style={{ gap: 8 }}>
              <SectionLabel style={{ paddingLeft: 4 }}>Contact details</SectionLabel>
              {missingPhone && (
                <Input
                  icon="phone"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Phone (WhatsApp / SMS)"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  accessibilityLabel={`${first}’s phone number`}
                  error={errors.phone}
                />
              )}
              {missingEmail && (
                <Input
                  icon="mail"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  accessibilityLabel={`${first}’s email`}
                  error={errors.email}
                />
              )}
              <Txt variant="meta" style={{ paddingHorizontal: 4 }}>
                {cloud ? 'Saved on the customer for everyone in your workspace.' : 'Demo mode: not saved.'}
              </Txt>
            </View>
          )}

          <View style={{ gap: 10 }}>
            <SectionLabel style={{ paddingLeft: 4 }}>Prefers</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
              {METHODS.map((m) => (
                <Chip key={m.value} label={m.label} on={method === m.value} onPress={() => setMethod(method === m.value ? null : m.value)} />
              ))}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <SectionLabel style={{ paddingLeft: 4 }}>Best time to reach {first}</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
              {PRESETS.map((p) => (
                <Chip key={p.value} label={p.label} on={preset === p.value} onPress={() => setPreset(p.value)} />
              ))}
            </View>
            {preset === 'custom' && (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Input value={from} onChangeText={setFrom} placeholder="From · 18:00" accessibilityLabel="From time" autoCapitalize="none" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input value={to} onChangeText={setTo} placeholder="To · 21:00" accessibilityLabel="To time" autoCapitalize="none" />
                  </View>
                </View>
                {errors.hours ? (
                  <Txt style={{ fontSize: 13 }} tone="bad">
                    {errors.hours}
                  </Txt>
                ) : parseClock(from) && parseClock(to) ? (
                  <Txt variant="meta">
                    {first} prefers messages between {clock(parseClock(from)!)} and {clock(parseClock(to)!)}.
                  </Txt>
                ) : null}
              </View>
            )}
          </View>

          <View style={{ gap: 10 }}>
            <SectionLabel style={{ paddingLeft: 4 }}>How often</SectionLabel>
            <Group>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60 }}>
                <Txt style={{ flex: 1, fontSize: 15.5 }}>At most</Txt>
                <Button
                  variant="secondary"
                  size="sm"
                  label="−"
                  accessibilityLabel="Fewer messages a week"
                  disabled={maxPerWeek === 1}
                  onPress={() => setMaxPerWeek(maxPerWeek == null ? 3 : Math.max(1, maxPerWeek - 1))}
                  style={{ width: 44, paddingHorizontal: 0 }}
                />
                <Num style={{ minWidth: 28, textAlign: 'center', fontSize: 17 }} accessibilityLabel={maxPerWeek == null ? 'No limit' : `${maxPerWeek} a week`}>
                  {maxPerWeek == null ? '–' : String(maxPerWeek)}
                </Num>
                <Button
                  variant="secondary"
                  size="sm"
                  label="+"
                  accessibilityLabel="More messages a week"
                  disabled={maxPerWeek === 7}
                  onPress={() => setMaxPerWeek(maxPerWeek == null ? 3 : Math.min(7, maxPerWeek + 1))}
                  style={{ width: 44, paddingHorizontal: 0 }}
                />
                <Txt variant="s">a week</Txt>
              </View>
            </Group>
            <View style={{ flexDirection: 'row' }}>
              <Chip small label="No limit" on={maxPerWeek == null} onPress={() => setMaxPerWeek(maxPerWeek == null ? 3 : null)} />
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Group>
              <SettingsRow
                icon="shield"
                title="Do not contact"
                subtitle={optedOut ? 'On' : 'Off'}
                right={<Toggle value={optedOut} onChange={setOptedOut} label={`Do not contact ${first}`} />}
                last
              />
            </Group>
            <Txt variant="meta" style={{ paddingHorizontal: 4 }}>
              Nudge won’t draft or remind you to message {first} while this is on.
            </Txt>
            {optedOut && (
              <Input
                value={reason}
                onChangeText={setReason}
                placeholder="Reason (optional) · e.g. asked us to stop"
                accessibilityLabel="Reason for do not contact"
                maxLength={280}
              />
            )}
          </View>

          <View style={{ gap: 10 }}>
            {errors.save ? (
              <Txt style={{ fontSize: 13 }} tone="bad">
                {errors.save}
              </Txt>
            ) : null}
            <Button label="Save" size="lg" full loading={saving} onPress={save} />
            {updated?.at ? (
              <Txt variant="meta" center>
                Last changed {shortDay(updated.at).toLowerCase() === 'today' ? 'today' : `on ${shortDay(updated.at)}`}
                {updatedBy ? ` by ${updatedBy.id === state.me ? 'you' : firstName(updatedBy.name)}` : ''}
              </Txt>
            ) : !cloud ? (
              <Txt variant="meta" center>
                Demo mode: preferences stay on this screen.
              </Txt>
            ) : null}
          </View>
        </>
      )}
    </Screen>
  );
}
