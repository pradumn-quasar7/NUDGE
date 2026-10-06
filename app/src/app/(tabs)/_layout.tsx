import { Redirect, Tabs } from 'expo-router';
import { FloatingTabBar, Rail, useIsTablet } from '@/components';
import { useStore } from '@/data/store';

export default function TabsLayout() {
  const { state } = useStore();
  const isTablet = useIsTablet();
  if (!state.onboarded) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{ headerShown: false, tabBarPosition: isTablet ? 'left' : 'bottom', animation: 'fade' }}
      tabBar={({ state: nav, navigation }) => {
        const active = nav.routes[nav.index]?.name ?? 'index';
        const onSelect = (key: string) => navigation.navigate(key);
        return isTablet ? <Rail active={active} onSelect={onSelect} /> : <FloatingTabBar active={active} onSelect={onSelect} />;
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
