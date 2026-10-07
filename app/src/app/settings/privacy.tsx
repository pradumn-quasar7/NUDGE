import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AiCard, AiLabel, Button, Group, LargeTitle, Screen, SectionLabel, SettingsRow, TopBar, Txt, useToast } from '@/components';
import { useSession } from '@/data/session';
import { useMe, useStore } from '@/data/store';
import { deleteWorkspace, exportWorkspace, SecurityError } from '@/data/remote-security';
import { firstName, plural } from '@/lib/format';
import { DeleteWorkspaceSheet } from '@/features/security/DeleteWorkspaceSheet';
import { demoExport } from '@/features/security/demo';
import { exportFileName, saveExport } from '@/features/security/exportFile';

/** What leaves the device for Google Gemini, and why. Shown as-is; keep in line with supabase/functions. */
const AI_SENDS = [
  { title: 'Questions you ask', body: 'Your question and the records that match it, so the answer can quote them.' },
  { title: 'Voice notes you transcribe', body: 'The recording, to turn your words into text. The transcript comes back only to you.' },
  { title: 'New messages and notes', body: 'To spot promises and facts. Nothing is saved until someone confirms it.' },
];

/** Privacy & data export — plain statements of the security model, an export, and a guarded delete. */
export default function Privacy() {
  const { state, actions } = useStore();
  const session = useSession();
  const cloud = session.mode === 'cloud';
  const me = useMe();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOwner = me.role === 'owner';
  const owner = state.members.find((m) => m.role === 'owner' && m.status === 'active' && m.id !== me.id);
  const members = state.members.filter((m) => m.status === 'active').length;
  const orgName = state.org.name || 'this workspace';

  const runExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const doc = cloud ? await exportWorkspace(state.org.id) : demoExport(state);
      const name = exportFileName(orgName);
      const result = await saveExport(JSON.stringify(doc, null, 2), name);
      if (result === 'cancelled') return;
      const partial = doc.truncated ? ' · most recent 5,000 conversations' : '';
      toast({
        icon: 'check',
        text:
          result === 'saved'
            ? `Saved ${name}${partial}`
            : result === 'downloaded'
              ? `Downloaded ${name}${partial}`
              : `Export ready${partial}`,
      });
    } catch (e) {
      const code = e instanceof SecurityError ? e.code : undefined;
      toast({
        icon: 'error',
        text: code === '42501' ? 'Only the owner can export the workspace' : 'Couldn’t export right now. Your data is safe — try again.',
      });
    } finally {
      setExporting(false);
    }
  };

  const remove = async (typedName: string) => {
    if (cloud) {
      try {
        await deleteWorkspace(state.org.id, typedName);
      } catch (e) {
        const code = e instanceof SecurityError ? e.code : undefined;
        throw new Error(
          code === '22023'
            ? 'That doesn’t match the business name.'
            : code === '42501'
              ? 'Only the owner can delete the workspace.'
              : 'Couldn’t reach Nudge. Nothing was deleted.',
        );
      }
      setConfirmDelete(false);
      await session.signOut().catch(() => {});
      router.replace('/welcome');
      return;
    }
    setConfirmDelete(false);
    actions.reset();
    router.replace('/welcome');
  };

  return (
    <Screen gap={22} header={<TopBar />}>
      <LargeTitle sub={<Txt variant="s">Your customers trust you. You can trust Nudge.</Txt>}>Privacy & data export</LargeTitle>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>How your data is kept</SectionLabel>
        <Group>
          <SettingsRow icon="shieldCheck" title="Encrypted, always" subtitle="In transit and at rest on the server. Only your team can read it." />
          <SettingsRow
            icon="shield"
            title="Your workspace stands alone"
            subtitle="Every record belongs to your workspace, and row-level security checks that on every read and write."
          />
          <SettingsRow icon="mic" title="Voice notes stay private" subtitle="Kept in a private store for your workspace. Only the person who recorded one can play it." />
          <SettingsRow icon="message" title="AI never sends messages" subtitle="Nudge drafts. You decide what reaches a customer, with a tap." />
          <SettingsRow icon="spark" title="AI never acts on its own" subtitle="New promises and facts wait for your confirmation." last />
        </Group>
      </View>

      <AiCard>
        <AiLabel>What Google Gemini sees</AiLabel>
        <View style={{ gap: 12 }}>
          {AI_SENDS.map((x) => (
            <View key={x.title} style={{ gap: 2 }}>
              <Txt variant="t" weight="medium">
                {x.title}
              </Txt>
              <Txt variant="s">{x.body}</Txt>
            </View>
          ))}
          <Txt variant="s">
            Only what that one task needs is sent. Nudge keeps a record of each AI request — never your recordings’ words — and limits how
            many each person can make.
          </Txt>
        </View>
      </AiCard>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>Your data</SectionLabel>
        <Txt variant="s" style={{ paddingHorizontal: 4 }}>
          {isOwner
            ? 'Download everything Nudge remembers — customers, conversations, promises and facts — in one file.'
            : `Only owners can export the workspace${owner ? `. Ask ${firstName(owner.name)} for a copy.` : '.'}`}
        </Txt>
        {isOwner && (
          <Button
            variant="secondary"
            icon="doc"
            label={exporting ? 'Preparing your export…' : 'Export my data'}
            loading={exporting}
            full
            style={{ marginTop: 6 }}
            onPress={() => void runExport()}
          />
        )}
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel style={{ paddingLeft: 4 }}>Delete</SectionLabel>
        {isOwner ? (
          <>
            <Txt variant="s" style={{ paddingHorizontal: 4 }}>
              Removes {orgName}, every customer and all history for {plural(members, 'member')}. This can’t be undone.
            </Txt>
            <Button variant="danger" label="Delete workspace" full style={{ marginTop: 6 }} onPress={() => setConfirmDelete(true)} />
          </>
        ) : (
          <Txt variant="s" style={{ paddingHorizontal: 4 }}>
            Only the owner can delete the workspace.
          </Txt>
        )}
      </View>

      <DeleteWorkspaceSheet
        open={confirmDelete}
        orgName={orgName}
        detail={`Every customer, conversation, promise, voice note and setting will be permanently removed for ${plural(members, 'member')}. ${
          cloud ? 'You’ll be signed out.' : 'The demo starts again from the welcome screen.'
        }`}
        onDelete={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}
