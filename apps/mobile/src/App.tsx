import { useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StyleSheet, Text } from "react-native";

import { TABS } from "./navigation/tabs";
import { PlaceholderScreen, TAB_BAR_HEIGHT } from "./screens/placeholder-screen";
import { HealthScreen } from "./screens/health-screen";
import { OnboardingScreen } from "./screens/onboarding-screen";
import { TodayScreen } from "./screens/today-screen";
import { DataboxScreen } from "./screens/databox-screen";
import { YouScreen } from "./screens/you-screen";
import { color, typography } from "@orbb/ui/tokens";

/**
 * ORBB mobile shell (M0-B, extended by M4-B, M6-A and M6-B).
 *
 * A five-destination bottom-tab navigator exactly per the frozen
 * architecture: `Today | Health | DataBox | Services | You`.
 *   - Today carries the FIRST-RUN ONBOARDING journey (M6-A: welcome,
 *     persona, metric interests, source summary) until it completes; the
 *     completed state is session-scoped (AsyncStorage lands at
 *     integration — recorded handoff), then M6-B B4 renders the real
 *     intent-driven Today surface (task flow + inline capture).
 *   - Health carries the real manual-capture journey (M4-B) plus the
 *     intent journey (M6-A) and the B5 provenance detail affordances.
 *   - DataBox carries the real B6 surface: pinned corpus timeline /
 *     collections with search + the four filters, and B5 provenance links.
 * Tab icons are simple text glyphs; tab labels double as accessibility
 * labels.
 *
 * Navigation choice (recorded in the M0-B report): @react-navigation/bottom-tabs
 * over expo-router — the shell needs exactly five static tabs, no deep
 * links, no file-based routing, and bottom-tabs has the smaller dependency
 * footprint for that.
 */
const Tab = createBottomTabNavigator();

export default function App() {
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: color.accent,
          tabBarInactiveTintColor: color.fgMuted,
          tabBarStyle: {
            backgroundColor: color.surface,
            borderTopColor: color.borderSubtle,
            borderTopWidth: StyleSheet.hairlineWidth,
            height: TAB_BAR_HEIGHT,
          },
          tabBarLabelStyle: {
            fontSize: typography.size.xs,
            fontWeight: "500" as const,
          },
          tabBarAccessibilityLabel: "Primary navigation",
        }}
      >
        {TABS.map((tab) => (
          <Tab.Screen
            key={tab.key}
            name={tab.label}
            options={{
              title: tab.label,
              tabBarIcon: ({ color: iconColor }) => (
                <Text
                  accessibilityLabel={`${tab.label} tab icon`}
                  style={{ color: iconColor, fontSize: typography.size.lg }}
                >
                  {tab.icon}
                </Text>
              ),
              tabBarAccessibilityLabel: `${tab.label} tab`,
            }}
          >
            {() => {
              if (tab.key === "today" && !onboardingComplete) {
                return <OnboardingScreen onComplete={() => setOnboardingComplete(true)} />;
              }
              if (tab.key === "health") {
                return <HealthScreen />;
              }
              if (tab.key === "today") {
                return <TodayScreen />;
              }
              if (tab.key === "databox") {
                return <DataboxScreen />;
              }
              if (tab.key === "you") {
                return <YouScreen />;
              }
              return <PlaceholderScreen title={tab.label} note={tab.note} />;
            }}
          </Tab.Screen>
        ))}
      </Tab.Navigator>
    </NavigationContainer>
  );
}
