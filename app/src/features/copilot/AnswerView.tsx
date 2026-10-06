import { Fragment, type ReactNode } from 'react';
import { View, type StyleProp, type TextStyle } from 'react-native';
import { router, type Href } from 'expo-router';
import { Avatar, Button, Card, Dot, Icon, Num, Sep, Tap, Txt, useToast, type ButtonVariant, type Tone } from '@/components';
import { useStore } from '@/data/store';
import { customerById } from '@/data/selectors';
import type { CopilotAnswer, CopilotRow } from '@/lib/ai';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

/* ───────────── Inline money → mono ───────────── */

const MONEY = /(₹[\d,]+(?:\.\d+)?(?:k|L|Cr)?)/g;

/** Renders text with every ₹ amount in Geist Mono (design rule: numerals/money in mono). */
export function WithMoney({
  text,
  variant = 'meta',
  tone,
  style,
  numberOfLines,
}: {
  text: string;
  variant?: 'meta' | 's' | 't' | 'body';
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const parts = text.split(MONEY);
  return (
    <Txt variant={variant} tone={tone} style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <Num key={i} variant={variant} tone={tone}>
            {p}
          </Num>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </Txt>
  );
}

/* ───────────── Answer pieces ───────────── */

export type AnswerAction = CopilotAnswer['actions'][number];

/** Lead sentence with bold segments. Short, all-bold leads read as a headline; longer prose as body. */
export function AnswerLead({ text }: { text: CopilotAnswer['text'] }) {
  const plain = text.map((s) => s.t).join('');
  const headline = plain.length <= 64 && text.every((s) => s.b);
  if (headline) {
    return (
      <Txt accessibilityRole="header" style={{ fontSize: 20, lineHeight: 26, letterSpacing: -0.3, fontFamily: fonts.semibold }}>
        {plain}
      </Txt>
    );
  }
  return (
    <Txt style={{ fontSize: 17, lineHeight: 25, letterSpacing: -0.1 }}>
      {text.map((s, i) =>
        s.b ? (
          <Txt key={i} weight="semibold" style={{ fontSize: 17, lineHeight: 25 }}>
            {s.t}
          </Txt>
        ) : (
          <Fragment key={i}>{s.t}</Fragment>
        ),
      )}
    </Txt>
  );
}

/** Card of customer rows: avatar 30 · name · meta · coloured status dot. */
export function AnswerRows({ rows, onRowPress }: { rows: CopilotRow[]; onRowPress?: (row: CopilotRow) => void }) {
  const { state } = useStore();
  return (
    <Card padding={0} style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
      {rows.map((r, i) => {
        const cust = customerById(state, r.customerId);
        return (
          <View key={`${r.customerId}-${i}`}>
            {i > 0 && <Sep />}
            <Tap
              onPress={() => (onRowPress ? onRowPress(r) : router.push({ pathname: '/customer/[id]', params: { id: r.customerId } }))}
              scale={0.99}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingVertical: 8 }}
            >
              <Avatar name={cust?.name ?? r.title} size={30} />
              <View style={{ flex: 1, gap: 1 }}>
                <Txt numberOfLines={1} style={{ fontFamily: fonts.medium }}>
                  {r.title}
                </Txt>
                <WithMoney text={r.meta} numberOfLines={2} />
              </View>
              {r.tone && r.tone !== 'neutral' ? <Dot tone={r.tone} /> : null}
            </Tap>
          </View>
        );
      })}
    </Card>
  );
}

export function AnswerStats({ stats }: { stats: NonNullable<CopilotAnswer['stats']> }) {
  return (
    <Card padding={16} style={{ flexDirection: 'row' }}>
      {stats.map((s) => (
        <View key={s.label} style={{ flex: 1, gap: 2 }}>
          <Num weight="medium" style={{ fontSize: 20, lineHeight: 26 }}>
            {s.value}
          </Num>
          <Txt variant="meta">{s.label}</Txt>
        </View>
      ))}
    </Card>
  );
}

/**
 * Maps answer actions to buttons. One primary per answer: when an ink action exists, the AI action
 * becomes tonal (indigo wash + spark); otherwise it's the solid indigo AI button.
 */
export function AnswerActions({ actions, onAction }: { actions: AnswerAction[]; onAction?: (a: AnswerAction) => void }) {
  const toast = useToast();
  if (!actions.length) return null;
  const hasPrimary = actions.some((a) => a.kind === 'primary');
  const run = (a: AnswerAction) => {
    if (onAction) return onAction(a);
    if (a.route) return router.push(a.route as Href);
    toast({ text: 'Coming soon' });
  };
  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {actions.map((a) => {
        const variant: ButtonVariant = a.kind === 'primary' ? 'primary' : a.kind === 'secondary' ? 'secondary' : hasPrimary ? 'tonal' : 'ai';
        return (
          <Button
            key={a.label}
            label={a.label}
            variant={variant}
            icon={a.kind === 'ai' ? 'spark' : undefined}
            style={{ flexGrow: 1, flexBasis: 0, minWidth: 120 }}
            onPress={() => run(a)}
          />
        );
      })}
    </View>
  );
}

/** "✦ Nudge" — who is speaking. */
export function NudgeLabel() {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="spark" size={16} color={c.accText} />
      <Txt style={{ fontSize: 13, fontFamily: fonts.semibold }} color={c.accText}>
        Nudge
      </Txt>
    </View>
  );
}

/**
 * AnswerView — renders a `CopilotAnswer` from `answer()` in `@/lib/ai`:
 * label → lead (bold segments) → rows card → stats card → action buttons → evidence.
 *
 * Props
 * - `answer`      the CopilotAnswer to render
 * - `label`       show the "✦ Nudge" speaker label (default true)
 * - `onAction`    override action handling (default: push `action.route`, else "Coming soon" toast)
 * - `onRowPress`  override row taps (default: open the customer profile)
 * - `footer`      optional node rendered after the evidence line
 */
export function AnswerView({
  answer,
  label = true,
  onAction,
  onRowPress,
  footer,
}: {
  answer: CopilotAnswer;
  label?: boolean;
  onAction?: (a: AnswerAction) => void;
  onRowPress?: (row: CopilotRow) => void;
  footer?: ReactNode;
}) {
  return (
    <View style={{ gap: 14 }} accessibilityLiveRegion="polite">
      {label && <NudgeLabel />}
      <AnswerLead text={answer.text} />
      {answer.rows && answer.rows.length > 0 && <AnswerRows rows={answer.rows} onRowPress={onRowPress} />}
      {answer.stats && answer.stats.length > 0 && <AnswerStats stats={answer.stats} />}
      <AnswerActions actions={answer.actions} onAction={onAction} />
      <Txt variant="meta">{answer.evidence}</Txt>
      {footer}
    </View>
  );
}
