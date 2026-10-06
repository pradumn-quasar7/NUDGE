import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, Icon, IconButton, SparkPulse, Txt } from '@/components';
import { useStore } from '@/data/store';
import { openCommitments } from '@/data/selectors';
import { answer, SUGGESTED, type CopilotAnswer } from '@/lib/ai';
import { monthName } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { AnswerView } from '@/features/copilot/AnswerView';
import { AskInput, ChatBubble } from '@/features/copilot/Chat';

/**
 * 10a / 10b AI copilot. Answers in a sentence, shows the records it came from, always offers the next action.
 * `?q=` asks immediately.
 */

type Turn = { id: string; q: string; a: CopilotAnswer; ready: boolean };

const THINK_MS = 650;

export default function Copilot() {
  const { state } = useStore();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const scroll = useRef<ScrollView>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const autoAsked = useRef(false);

  const ask = (q: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setTurns((t) => [...t, { id, q, a: answer(q, state), ready: false }]);
    timers.current.push(setTimeout(() => setTurns((t) => t.map((x) => (x.id === id ? { ...x, ready: true } : x))), THINK_MS));
  };

  useEffect(() => {
    if (autoAsked.current) return;
    if (typeof params.q === 'string' && params.q.trim()) {
      autoAsked.current = true;
      ask(params.q.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const customers = state.customers.filter((x) => !x.archived).length;
  const promises = openCommitments(state).length;
  const since = state.events.length ? monthName(Math.min(...state.events.map((e) => e.at))) : undefined;
  const empty = turns.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <LinearGradient
        pointerEvents="none"
        colors={[c.accWash2, c.accWash, c.bg + '00']}
        locations={[0, 0.4, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 380 }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
          {empty ? <View style={{ width: 44 }} /> : <IconButton name="pencil" label="New question" onPress={() => setTurns([])} />}
          <IconButton name="close" label="Close copilot" onPress={close} />
        </View>

        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => !empty && scroll.current?.scrollToEnd({ animated: true })}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, width: '100%', maxWidth: 720, alignSelf: 'center' }}
        >
          {empty ? (
            <View style={{ gap: 28 }}>
              <View style={{ gap: 16, paddingTop: 30 }}>
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: c.accWash2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: `0 0 0 8px ${c.accWash}`,
                  }}
                >
                  <Icon name="spark" size={24} color={c.acc} />
                </View>
                <Txt variant="display" accessibilityRole="header">
                  What do you need?
                </Txt>
                <Txt variant="body">
                  I know your {customers} customers, {promises} open promises and every conversation{since ? ` since ${since}` : ''}.
                </Txt>
              </View>
              <View style={{ gap: 8, alignItems: 'flex-start' }}>
                {SUGGESTED.map((s) => (
                  <Chip key={s} label={s} onPress={() => ask(s)} />
                ))}
              </View>
            </View>
          ) : (
            <View style={{ gap: 28 }}>
              {turns.map((t) => (
                <View key={t.id} style={{ gap: 22 }}>
                  <ChatBubble text={t.q} />
                  {t.ready ? (
                    <AnswerView answer={t.a} />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLabel="Nudge is thinking">
                      <SparkPulse size={18} />
                      <Txt variant="s">Looking through your business memory…</Txt>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12) + 18, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
          <AskInput
            placeholder={empty ? 'Ask anything…' : 'Ask a follow-up…'}
            onSubmit={ask}
            onVoice={() => router.push('/voice')}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
