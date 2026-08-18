import { useState } from "react";
import { Modal, View, Text, TextInput, StyleSheet, Pressable } from "react-native";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { SPACE, RADIUS } from "@/lib/theme";

/**
 * Asks for a name. `Alert.prompt` would be one line, but it's iOS-only and
 * carries none of the brand — and naming a sheet is a moment worth styling,
 * since the name is what you'll scan for later.
 */
export function NamePrompt({
  visible,
  title,
  placeholder = "Name",
  initialValue = "",
  confirmLabel = "Save",
  /** Optional second action, e.g. "Save as copy" alongside "Save". */
  secondary,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  secondary?: { label: string; onSubmit: (value: string) => void };
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const { theme } = useBrand();
  // Seeded once, on mount. Callers give each open its own `key` so the field
  // starts from the right value rather than whatever was last typed here.
  const [value, setValue] = useState(initialValue);

  const submit = (fn: (v: string) => void) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    fn(trimmed);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        {/* Swallows taps so pressing inside the card doesn't dismiss it. */}
        <Pressable
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}
          onPress={() => {}}
        >
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
          >
            {title}
          </Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => submit(onSubmit)}
            accessibilityLabel={placeholder}
            style={[
              styles.input,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.line,
                color: theme.foreground,
                fontFamily: theme.fontBody,
              },
            ]}
          />
          <View style={styles.row}>
            <Button label="Cancel" onPress={onClose} style={{ flex: 1 }} />
            <Button
              label={confirmLabel}
              variant="primary"
              disabled={!value.trim()}
              onPress={() => submit(onSubmit)}
              style={{ flex: 1 }}
            />
          </View>
          {secondary && (
            <Button
              label={secondary.label}
              icon="duplicate-outline"
              disabled={!value.trim()}
              onPress={() => submit(secondary.onSubmit)}
              style={{ marginTop: SPACE.sm }}
            />
          )}
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
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 15,
  },
  row: { flexDirection: "row", gap: SPACE.sm },
});
