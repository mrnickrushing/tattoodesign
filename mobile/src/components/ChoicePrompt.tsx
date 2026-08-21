import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { SPACE, RADIUS, TYPE } from "@/lib/theme";

export type Choice = {
  /** What comes back when this row is picked. */
  value: number;
  label: string;
  /** The half-sentence that makes the choice obvious. */
  detail?: string;
};

/**
 * Asks which of several. For the same reason NamePrompt exists.
 *
 * `Alert.alert` takes at most three buttons on Android — it maps them onto the
 * platform's negative, neutral and positive slots — and quietly drops the rest.
 * A "Cancel" and four cavity counts is five, so the two that matter most were
 * simply unreachable on a phone, with nothing to show that anything was wrong.
 *
 * A list is the better shape anyway: every option is visible at once with room
 * to say what it means, rather than three words on a button.
 */
export function ChoicePrompt({
  visible,
  title,
  subtitle,
  choices,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  choices: Choice[];
  onPick: (value: number) => void;
  onClose: () => void;
}) {
  const { theme } = useBrand();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        {/* Swallows taps so pressing inside the card doesn't dismiss it. */}
        <Pressable
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}
          onPress={() => {}}
        >
          <View style={{ gap: SPACE.xs }}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
            >
              {title}
            </Text>
            {!!subtitle && (
              <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>{subtitle}</Text>
            )}
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: SPACE.xs }}>
            {choices.map((choice) => (
              <Pressable
                key={`${choice.value}-${choice.label}`}
                onPress={() => {
                  onPick(choice.value);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={choice.detail ? `${choice.label}. ${choice.detail}` : choice.label}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    backgroundColor: pressed ? theme.accent : theme.surfaceAlt,
                    borderColor: pressed ? theme.accent : theme.line,
                  },
                ]}
              >
                <Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
                  {choice.label}
                </Text>
                {!!choice.detail && (
                  <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
                    {choice.detail}
                  </Text>
                )}
              </Pressable>
            ))}
          </ScrollView>

          <Button label="Cancel" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(8,7,7,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACE.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACE.md,
    gap: SPACE.md,
  },
  title: { fontSize: 22, letterSpacing: 0.3 },
  // Capped so a long list scrolls inside the card rather than off the screen.
  list: { maxHeight: 320 },
  choice: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.sm,
    gap: 2,
  },
});
