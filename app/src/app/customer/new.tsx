import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Input, Screen, TopBar, Txt, useIsTablet, useToast } from '@/components';
import { useStore } from '@/data/store';

function emailError(v: string) {
  const e = v.trim();
  if (!e) return undefined;
  if (!e.includes('@')) return 'That email is missing an @.';
  const [user, domain] = e.split('@');
  if (!user) return 'Add the part before the @.';
  if (!domain || !/^[^\s@]+\.[^\s@]{2,}$/.test(domain)) return 'That email looks incomplete — add the domain.';
  return undefined;
}

function phoneError(v: string) {
  const digits = v.replace(/\D/g, '');
  if (!v.trim()) return undefined;
  if (digits.length < 8) return 'That number looks short — include the full number.';
  return undefined;
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt variant="s" tone="t1" weight="medium">
        {label}
        {optional ? <Txt variant="s" tone="t3"> · optional</Txt> : null}
      </Txt>
      {children}
    </View>
  );
}

/** Add customer — only a name is needed; Nudge fills in the rest from conversations. */
export default function NewCustomer() {
  const { actions } = useStore();
  const toast = useToast();
  const isTablet = useIsTablet();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState<{ name?: boolean; phone?: boolean; email?: boolean }>({});

  const errors = {
    name: !name.trim() ? 'Add a name so Nudge knows who this is.' : undefined,
    phone: phoneError(phone),
    email: emailError(email),
  };
  const valid = !errors.name && !errors.phone && !errors.email;

  const save = () => {
    setTouched({ name: true, phone: true, email: true });
    if (!valid) return;
    const customer = actions.addCustomer({ name, company, phone, email });
    toast({ text: 'Customer added', icon: 'check' });
    router.replace(`/customer/${customer.id}`);
  };

  return (
    <Screen
      header={<TopBar title="New customer" />}
      gap={20}
      contentStyle={isTablet ? { maxWidth: 560, width: '100%', alignSelf: 'center' } : undefined}
    >
      <View style={{ gap: 6 }}>
        <Txt variant="h2" accessibilityRole="header">
          Who’s the customer?
        </Txt>
        <Txt variant="body">Just a name is enough. Nudge builds their memory from your conversations.</Txt>
      </View>

      <Field label="Name">
        <Input
          value={name}
          onChangeText={setName}
          placeholder="Rahul Sharma"
          autoFocus
          autoCapitalize="words"
          textContentType="name"
          returnKeyType="next"
          accessibilityLabel="Name, required"
          error={touched.name ? errors.name : undefined}
        />
      </Field>
      <Field label="Company" optional>
        <Input
          value={company}
          onChangeText={setCompany}
          placeholder="Sharma Retail"
          autoCapitalize="words"
          textContentType="organizationName"
          accessibilityLabel="Company, optional"
        />
      </Field>
      <Field label="Phone" optional>
        <Input
          value={phone}
          onChangeText={setPhone}
          onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
          placeholder="+91 98200 11234"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          accessibilityLabel="Phone, optional"
          error={touched.phone ? errors.phone : undefined}
        />
      </Field>
      <Field label="Email" optional>
        <Input
          value={email}
          onChangeText={setEmail}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          placeholder="rahul@sharmaretail.in"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          accessibilityLabel="Email, optional"
          error={touched.email ? errors.email : undefined}
        />
      </Field>

      <View style={{ gap: 8, marginTop: 4 }}>
        <Button label="Save" size="lg" full disabled={!name.trim()} onPress={save} />
        <Button variant="ghost" label="Import from WhatsApp instead" full onPress={() => router.push('/integrations')} />
      </View>
    </Screen>
  );
}
