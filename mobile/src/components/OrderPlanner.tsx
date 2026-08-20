import { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput } from "react-native";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { estimateYield } from "@/lib/yield";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";
import { Icon } from "@/components/Icon";

/**
 * What an order costs in materials.
 *
 * The sheet answers "how do these fit on a page". This answers the question
 * that comes first: the order is forty-eight cookies, so how many sheets is
 * that and how much icing do I need to mix?
 *
 * Both directions of getting it wrong hurt. Short on icing means a second
 * batch that will not match the first — royal icing colour is notoriously hard
 * to reproduce, which is why bakers deliberately over-mix. Short on sheets
 * means another print run and another alignment.
 */
export function OrderPlanner({
  sheetWidthIn,
  sheetHeightIn,
  pieceWidthIn,
  pieceHeightIn,
}: {
  sheetWidthIn: number;
  sheetHeightIn: number;
  /** Defaults from whatever is on the sheet, so it starts from real work. */
  pieceWidthIn: number;
  pieceHeightIn: number;
}) {
  const { theme } = useBrand();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("24");
  const [coverage, setCoverage] = useState(0.8);

  const parsed = Number.parseInt(quantity, 10);
  const estimate = estimateYield({
    quantity: Number.isFinite(parsed) ? parsed : 0,
    widthIn: pieceWidthIn,
    heightIn: pieceHeightIn,
    sheetWidthIn,
    sheetHeightIn,
    floodCoverage: coverage,
  });

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <Pressable
        onPress={() => {
          setOpen((value) => !value);
          Haptics.selectionAsync();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.header}
      >
        <Icon name="sheet" size={TYPE.body.fontSize} color={theme.accent} />
        <View style={{ flex: 1 }}>
          <Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
            Plan the order
          </Text>
          <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
            Sheets, paper and icing for a batch
          </Text>
        </View>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={TYPE.body.fontSize} color={theme.muted} />
      </Pressable>

      {open && (
        <View style={styles.body}>
          <View style={styles.row}>
            <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium, width: 76 }]}>
              HOW MANY
            </Text>
            <TextInput
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="number-pad"
              accessibilityLabel="Number of pieces"
              style={[
                styles.input,
                { color: theme.foreground, borderColor: theme.line, backgroundColor: theme.surfaceAlt, fontFamily: theme.fontBody },
              ]}
            />
            <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody, flex: 1 }]}>
              at {pieceWidthIn.toFixed(2)} × {pieceHeightIn.toFixed(2)}in
            </Text>
          </View>

          <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium, marginTop: SPACE.sm }]}>
            HOW MUCH IS FLOODED
          </Text>
          <View style={styles.row}>
            {[
              { value: 0.45, label: "Accents" },
              { value: 0.8, label: "Most of it" },
              { value: 1, label: "Edge to edge" },
            ].map((option) => {
              const active = Math.abs(coverage - option.value) < 0.01;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => {
                    setCoverage(option.value);
                    Haptics.selectionAsync();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.chip,
                    { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line },
                  ]}
                >
                  <Text
                    style={[TYPE.micro, { color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}
                  >
                    {option.label.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {estimate ? (
            <View style={styles.results}>
              <Result label="Fits per sheet" value={`${estimate.perSheet}`} theme={theme} />
              <Result label="Sheets to print" value={`${estimate.sheets}`} theme={theme} />
              <Result
                label="Sheets to have"
                value={`${estimate.sheetsToBuy}`}
                hint="includes a spare"
                theme={theme}
              />
              <Result label="Flood icing" value={`${estimate.floodCups} cups`} theme={theme} />
              <Result label="Piping icing" value={`${estimate.pipingCups} cups`} theme={theme} />
              {estimate.spareOnLastSheet > 0 && (
                <Result
                  label="Room left over"
                  value={`${estimate.spareOnLastSheet}`}
                  hint="on the last sheet"
                  theme={theme}
                />
              )}
            </View>
          ) : (
            <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody, marginTop: SPACE.sm }]}>
              {pieceWidthIn > sheetWidthIn || pieceHeightIn > sheetHeightIn
                ? "That size does not fit on this sheet — pick a larger template or a smaller piece."
                : "Enter how many you are making."}
            </Text>
          )}

          <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody, marginTop: SPACE.sm }]}>
            Icing is a guide, not a measurement — consistency, flood depth and what stays in the
            bag all move it. Mixing a little extra is always cheaper than matching a second batch.
          </Text>
        </View>
      )}
    </View>
  );
}

function Result({
  label,
  value,
  hint,
  theme,
}: {
  label: string;
  value: string;
  hint?: string;
  theme: ReturnType<typeof useBrand>["theme"];
}) {
  return (
    <View style={[styles.result, { borderColor: theme.line, backgroundColor: theme.surfaceAlt }]}>
      <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
        {label.toUpperCase()}
      </Text>
      <Text style={[TYPE.heading, { color: theme.foreground, fontFamily: theme.fontDisplay }]}>{value}</Text>
      {!!hint && (
        <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>{hint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.lg, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, padding: SPACE.sm },
  body: { paddingHorizontal: SPACE.sm, paddingBottom: SPACE.sm, gap: SPACE.xs },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    minWidth: 72,
    fontSize: 15,
  },
  chip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs },
  results: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.xs, marginTop: SPACE.sm },
  result: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.sm, minWidth: 104, gap: 2 },
});
