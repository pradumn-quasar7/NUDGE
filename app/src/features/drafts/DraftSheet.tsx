import { useEffect, useState } from 'react';
import { Linking, Modal, Platform, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import {
  AiLabel,
  Avatar,
  Button,
  Chip,
  Dot,
  Icon,
  Input,
  Sheet,
  Skeleton,
  SparkPulse,
  Txt,
  useSheetClose,
  useToast,
} from '@/components';
import { DraftError, discardDraft, getContactPolicy, markDraftSent, requestDraft, saveDeviceDraft } from '@/data/remote-drafts';
import { customerById } from '@/data/selectors';
import { backendMode } from '@/data/session';
import { useStore } from '@/data/store';
import type { ID } from '@/data/types';
import {
  availableChannels,
  composeUrls,
  DRAFT_CHANNEL_LABEL,
  evidenceLine,
  intentFor,
  localDraft,
  SEND_LABEL,
  sentEvent,
  type Draft,
  type DraftChannel,
  type DraftIntent,
} from '@/lib/draft';
import { firstName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

/** What to draft: a customer, optionally the promise / inbox item it is about. */
export type DraftTarget = {
  customerId: ID;
  commitmentId?: ID;
  /** Inbox item (followup_suggestions.id in cloud mode) resolved once the message is sent. */
  suggestionId?: ID;
  intent?: DraftIntent;
  /** Amount from the inbox item (payment links). */
  amount?: number;
};

const ALL_CHANNELS: DraftChannel[] = ['whatsapp', 'sms', 'email'];

/**
 * "✦ Drafted for Rahul" — an editable message draft. Sending opens the person's own WhatsApp / SMS /
 * mail app with the text filled in; Nudge never sends anything. When they come back and confirm
 * "Sent it?", the message is recorded on the customer's timeline (cloud: mark_draft_sent()).
 */
export function DraftSheet({ target, onClose }: { target: DraftTarget | null; onClose: () => void }) {
  return (
    <Modal visible={!!target} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {target && (
        <Sheet onClose={onClose}>
          <DraftBody key={`${target.customerId}:${target.commitmentId ?? ''}:${target.suggestionId ?? ''}`} target={target} />
        </Sheet>
      )}
    </Modal>
  );
}

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'opted_out'; message: string } | { kind: 'confirm' };

function DraftBody({ target }: { target: DraftTarget }) {
  const { state, actions, dispatch, reload } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const close = useSheetClose();
  const { height } = useWindowDimensions();
  const cloud = backendMode === 'cloud' && !!state.org.id;

  const customer = customerById(state, target.customerId);
  const name = customer?.name ?? 'this customer';
  const first = firstName(name);
  const commitment = target.commitmentId ? state.commitments.find((x) => x.id === target.commitmentId) : undefined;
  const intent = target.intent ?? intentFor(commitment);
  const channels = availableChannels(customer);
  const canOpen = channels.length > 0;

  // The on-device draft: what demo mode shows, and the cloud fallback when the AI can't be reached.
  const [local] = useState<Draft>(() => localDraft(state, { customerId: target.customerId, commitmentId: target.commitmentId, intent, amount: target.amount }));
  const [phase, setPhase] = useState<Phase>(cloud ? { kind: 'loading' } : { kind: 'ready' });
  const [draftId, setDraftId] = useState<ID | undefined>();
  const [channel, setChannel] = useState<DraftChannel>(local.channel);
  const [body, setBody] = useState(cloud ? '' : local.body);
  const [subject, setSubject] = useState<string | null>(cloud ? null : local.subject);
  const [hint, setHint] = useState<string | null>(cloud ? null : local.sendHint);
  const [evidenceIds, setEvidenceIds] = useState<ID[]>(cloud ? [] : local.evidenceEventIds);
  const [language, setLanguage] = useState(local.language);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cloud) return;
    let live = true;
    const orgId = state.org.id;
    requestDraft({ orgId, customerId: target.customerId, commitmentId: target.commitmentId, suggestionId: target.suggestionId, intent })
      .then((d) => {
        if (!live) return;
        setDraftId(d.draftId);
        setChannel(d.channel);
        setBody(d.body);
        setSubject(d.subject);
        setHint(d.sendHint);
        setEvidenceIds(d.evidenceEventIds);
        setLanguage(d.language);
        setPhase({ kind: 'ready' });
      })
      .catch(async (e: unknown) => {
        if (!live) return;
        const code = e instanceof DraftError ? e.code : undefined;
        if (code === 'opted_out') {
          setPhase({ kind: 'opted_out', message: e instanceof Error ? e.message : `${first} asked not to be contacted.` });
          return;
        }
        // The AI is busy or unreachable: same flow with the on-device draft, saved as a row —
        // unless the contact policy says not to (the edge function would have answered opted_out).
        const policy = await getContactPolicy(orgId, target.customerId).catch(() => null);
        if (!live) return;
        if (policy?.optedOut) {
          setPhase({ kind: 'opted_out', message: `${first} asked not to be contacted.` });
          return;
        }
        setBody(local.body);
        setSubject(local.subject);
        setHint(local.sendHint);
        setEvidenceIds(local.evidenceEventIds);
        setNote(code === 'rate_limited' ? 'Drafted on this device · you’ve asked for a lot of drafts this hour' : 'Drafted on this device · the AI couldn’t be reached');
        setPhase({ kind: 'ready' });
        try {
          const id = await saveDeviceDraft(orgId, { customerId: target.customerId, commitmentId: target.commitmentId, suggestionId: target.suggestionId, intent, ...local });
          if (live) setDraftId(id);
        } catch {
          // Saved again when they confirm "Sent it?".
        }
      });
    return () => {
      live = false;
    };
    // One request per sheet: the target is fixed for its lifetime (DraftBody is keyed by it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Most relevant first (the promise's source, then what the model cited).
  const evidenceEvents = evidenceIds.map((eid) => state.events.find((e) => e.id === eid)).filter((e): e is NonNullable<typeof e> => !!e);
  const basedOn = evidenceLine(evidenceEvents, name);
  const evidence = basedOn && language && !/^english$/i.test(language) ? `${basedOn} · in ${language}` : basedOn;

  const text = body.trim();
  const to = channel === 'email' ? customer?.email : customer?.phone;

  const openComposer = async () => {
    setError(null);
    const urls = composeUrls(channel, { phone: customer?.phone, email: customer?.email }, text, subject, Platform.OS);
    for (const url of urls) {
      try {
        await Linking.openURL(url);
        setPhase({ kind: 'confirm' });
        return;
      } catch {
        // try the next link (e.g. WhatsApp app → wa.me)
      }
    }
    setError(`Couldn’t open ${DRAFT_CHANNEL_LABEL[channel]} here. Copy the message instead.`);
  };

  const copy = async () => {
    setError(null);
    const full = channel === 'email' && subject ? `${subject}\n\n${text}` : text;
    if (Platform.OS === 'web') {
      const clip = (globalThis as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }).navigator?.clipboard;
      try {
        if (!clip) throw new Error('no clipboard');
        await clip.writeText(full);
        toast({ text: 'Copied · paste it where you talk to ' + first, icon: 'check' });
        setPhase({ kind: 'confirm' });
        return;
      } catch {
        // fall through to the share sheet
      }
    }
    try {
      const res = await Share.share({ message: full });
      if (res.action !== Share.dismissedAction) setPhase({ kind: 'confirm' });
    } catch {
      setError('Couldn’t copy on this device. Select the text and copy it instead.');
    }
  };

  const confirmSent = async () => {
    setBusy(true);
    setError(null);
    try {
      if (cloud) {
        const id =
          draftId ??
          (await saveDeviceDraft(state.org.id, {
            customerId: target.customerId,
            commitmentId: target.commitmentId,
            suggestionId: target.suggestionId,
            intent,
            channel,
            subject,
            body: text,
            language,
            evidenceEventIds: evidenceIds,
            sendHint: hint,
          }));
        await markDraftSent(id, channel, text);
        await reload();
      } else {
        dispatch({ type: 'addEvent', event: sentEvent({ customerId: target.customerId, channel, intent, body: text, authorId: state.me }) });
        if (target.suggestionId) actions.resolveInbox(target.suggestionId);
      }
      const keep = commitment && commitment.status === 'open' && commitment.promisor === 'us' ? commitment : undefined;
      toast({
        text: `Added to ${first}’s timeline`,
        icon: 'check',
        action: keep ? { label: 'Mark kept', onPress: () => actions.completeCommitment(keep.id) } : undefined,
      });
      close();
    } catch (e) {
      setBusy(false);
      const msg = e instanceof Error ? e.message.replace(/^Record message: /, '') : '';
      setError(e instanceof DraftError && e.code === '42501' ? msg : 'Couldn’t record it. Check your connection and try again.');
    }
  };

  const discard = () => {
    if (cloud && draftId) void discardDraft(draftId).catch(() => {});
    close();
  };

  const openPreferences = () => {
    close();
    setTimeout(() => router.push({ pathname: '/customer/[id]/contact', params: { id: target.customerId } }), 220);
  };

  /* ── Opted out: nothing to draft ── */
  if (phase.kind === 'opted_out') {
    return (
      <View style={{ gap: 14, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Dot tone="neutral" />
          <Txt variant="meta">Do not contact is on</Txt>
        </View>
        <Txt variant="h2" accessibilityRole="header">
          {first} asked not to be contacted
        </Txt>
        <Txt variant="body">Nudge won’t draft or remind you to message {first} while this is on. You can change it in their contact preferences.</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Contact preferences" variant="secondary" flex onPress={openPreferences} />
          <Button label="Close" variant="ghost" onPress={close} />
        </View>
      </View>
    );
  }

  /* ── After opening their app: did it go? ── */
  if (phase.kind === 'confirm') {
    return (
      <View style={{ gap: 14, paddingTop: 4 }}>
        <Txt variant="h2" accessibilityRole="header">
          Sent it?
        </Txt>
        <Txt variant="body">
          Once the message has gone to {first}, tap “Yes, sent” and Nudge adds it to {first}’s timeline. Nothing was sent by Nudge.
        </Txt>
        {error ? <ErrorLine text={error} /> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Yes, sent" size="lg" flex loading={busy} onPress={confirmSent} />
          <Button label="Not yet" size="lg" variant="secondary" disabled={busy} onPress={close} />
        </View>
      </View>
    );
  }

  /* ── Drafting ── */
  if (phase.kind === 'loading') {
    return (
      <View style={{ gap: 14, paddingTop: 4 }} accessibilityLabel={`Drafting a message for ${first}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <SparkPulse size={18} />
          <Txt variant="s">Drafting from your conversation with {first}…</Txt>
        </View>
        <Skeleton h={14} w="92%" />
        <Skeleton h={14} w="80%" />
        <Skeleton h={14} w="60%" />
      </View>
    );
  }

  /* ── The draft ── */
  const choices = canOpen ? channels : ALL_CHANNELS;
  return (
    <ScrollView style={{ maxHeight: height * 0.78 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingTop: 4 }}>
      <AiLabel>Drafted for {first}</AiLabel>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={name} size={30} />
        <View style={{ flex: 1 }}>
          <Txt weight="semibold" numberOfLines={1}>
            {name}
          </Txt>
          <Txt variant="meta" numberOfLines={1}>
            {canOpen ? `${DRAFT_CHANNEL_LABEL[channel]} · ${to ?? ''}` : 'No phone number or email yet'}
          </Txt>
        </View>
      </View>

      {choices.length > 1 && (
        <View style={{ gap: 6 }}>
          {!canOpen && <Txt variant="meta">Where will you send it?</Txt>}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
            {choices.map((ch) => (
              <Chip key={ch} small label={DRAFT_CHANNEL_LABEL[ch]} on={channel === ch} onPress={() => setChannel(ch)} />
            ))}
          </View>
        </View>
      )}

      {channel === 'email' && (
        <Input value={subject ?? ''} onChangeText={setSubject} placeholder="Subject" accessibilityLabel="Email subject" />
      )}
      <Input
        value={body}
        onChangeText={setBody}
        multiline
        accessibilityLabel="Message draft"
        placeholder={`Message to ${first}`}
        style={{ minHeight: 136, fontSize: 15.5, lineHeight: 22 }}
      />

      <View style={{ gap: 6 }}>
        {hint ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Dot tone="warn" />
            <Txt variant="meta" color={c.warn} style={{ flexShrink: 1 }}>
              {hint}
            </Txt>
          </View>
        ) : null}
        {evidence ? <Txt variant="meta">{evidence}</Txt> : null}
        {note ? <Txt variant="meta">{note}</Txt> : null}
        <Txt variant="meta">
          {canOpen
            ? `Opens ${channel === 'email' ? 'your mail app' : DRAFT_CHANNEL_LABEL[channel]} with this text. Nothing is sent until you tap send there.`
            : `Add ${first}’s number or email to open WhatsApp, SMS or mail directly.`}
        </Txt>
      </View>

      {error ? <ErrorLine text={error} /> : null}

      {canOpen ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Button label={SEND_LABEL[channel]} size="lg" flex disabled={!text} onPress={openComposer} />
          <Button label="Discard" variant="ghost" onPress={discard} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Button label="Copy message" size="lg" flex disabled={!text} onPress={copy} />
            <Button label="Discard" variant="ghost" onPress={discard} />
          </View>
          <Button label="Add contact details" variant="secondary" full onPress={openPreferences} />
        </View>
      )}
      {canOpen && error ? <Button label="Copy message" variant="secondary" full onPress={copy} /> : null}
    </ScrollView>
  );
}

function ErrorLine({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name="alert" size={16} color={c.bad} />
      <Txt style={{ fontSize: 13, flexShrink: 1 }} tone="bad">
        {text}
      </Txt>
    </View>
  );
}
