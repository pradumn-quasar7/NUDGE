import { useState } from 'react';
import { TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Glass, Icon, Tap, Txt, webNoOutline } from '@/components';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

/** The owner's question — ink bubble, right-aligned, tail corner bottom-right. */
export function ChatBubble({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        maxWidth: '85%',
        backgroundColor: c.inv,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 18,
        borderBottomRightRadius: 6,
      }}
    >
      <Txt color={c.onInv} style={{ fontSize: 15 }}>
        {text}
      </Txt>
    </View>
  );
}

/** Up-arrow send glyph (the shared icon set has no send icon yet). */
function SendGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  );
}

/**
 * Glass ask field with a round ink button: mic when empty, send when there is text.
 */
export function AskInput({
  placeholder,
  onSubmit,
  onVoice,
  autoFocus,
}: {
  placeholder: string;
  onSubmit: (q: string) => void;
  onVoice?: () => void;
  autoFocus?: boolean;
}) {
  const { c, scheme } = useTheme();
  const [text, setText] = useState('');
  const has = text.trim().length > 0;
  const submit = () => {
    if (!has) return;
    onSubmit(text.trim());
    setText('');
  };
  return (
    <Glass
      bg={scheme === 'dark' ? c.card : 'rgba(255,255,255,0.9)'}
      style={{ height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 6, gap: 8 }}
    >
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={c.t3}
        autoFocus={autoFocus}
        returnKeyType="send"
        onSubmitEditing={submit}
        blurOnSubmit={false}
        accessibilityLabel={placeholder}
        style={[{ flex: 1, height: '100%', fontFamily: fonts.regular, fontSize: 15, color: c.t1 }, webNoOutline]}
      />
      <Tap
        haptic
        onPress={has ? submit : onVoice}
        accessibilityRole="button"
        accessibilityLabel={has ? 'Send' : 'Ask by voice'}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.inv, alignItems: 'center', justifyContent: 'center' }}
      >
        {has ? <SendGlyph color={c.onInv} /> : <Icon name="mic" size={20} color={c.onInv} />}
      </Tap>
    </Glass>
  );
}
