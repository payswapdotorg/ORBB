import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StyleSheet, Text } from "react-native";

import { TABS } from "./navigation/tabs";
import { PlaceholderScreen, TAB_BAR_HEIGHT } from "./screens/placeholder-screen";
import { HealthScreen } from "./screens/health-screen";
import { color, typography } from "@orbb/ui/tokens";

/**
 * ORBB mobile shell (M0-B, extended by M4-B).
 *
 * A five-destination bottom-tab navigator exactly per the frozen
 * architecture: `Today | Health | DataBox | Services | You`. The Health
 * tab now carries the real manual-capture journey (M4-B: three-step
 * capture form with quality self-assessment, offline-tolerant submit, and
 * the recent-observations history); the other destinations remain
 * token-styled placeholder screens ("Coming in M6+"). Tab icons are
 * simple text glyphs; tab labels double as accessibility labels.
 *
 * Navigation choice (recorded in the M0-B report): @react-navigation/bottom-tabs
 * over expo-router — the M0 shell needs exactly five static tabs, no deep
 * links, no file-based routing, and bottom-tabs has the smaller dependency
 * footprint for that.
 */
const Tab = createBottomTabNavigator();

export default function App() {
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
            {() =>
              tab.key === "health" ? (
                <HealthScreen />
              ) : (
                <PlaceholderScreen title={tab.label} note={tab.note} />
              )
            }
          </Tab.Screen>
        ))}
      </Tab.Navigator>
    </NavigationContainer>
  );
}
