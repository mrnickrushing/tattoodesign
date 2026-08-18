import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import type { BrandId } from "@/lib/brands";

type Props = {
  brand: BrandId;
  style?: StyleProp<ViewStyle>;
  muted?: boolean;
};

/**
 * Original, code-native studio artwork. Keeping this in SVG means the same
 * illustration stays crisp in the phone UI, browser previews, and future
 * print-oriented surfaces without another image-loading state.
 */
export function BrandArtwork({ brand, style, muted = false }: Props) {
  return (
    <View pointerEvents="none" accessibilityElementsHidden style={style}>
      <Svg width="100%" height="100%" viewBox="0 0 240 180">
        {brand === "ink" ? <InkArtwork muted={muted} /> : <SugarArtwork muted={muted} />}
      </Svg>
    </View>
  );
}

function InkArtwork({ muted }: { muted: boolean }) {
  const red = muted ? "#7d2830" : "#ef233c";
  const paper = muted ? "#9b918a" : "#f5eee6";
  const dark = "#171311";

  return (
    <G>
      <Circle cx="184" cy="83" r="72" fill={red} opacity={muted ? 0.1 : 0.14} />
      <Circle cx="184" cy="83" r="53" fill="none" stroke={red} strokeWidth="1.5" opacity="0.45" />
      <Path d="M27 145C70 123 104 132 146 157" fill="none" stroke={red} strokeWidth="2" opacity="0.5" />

      {/* Dagger: a strong diagonal silhouette makes the card read as tattoo
          flash before any label is visible. */}
      <G transform="rotate(24 132 91)">
        <Path
          d="M126 18L145 82L132 126L119 82Z"
          fill={paper}
          stroke={dark}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <Path d="M126 18L132 126L145 82Z" fill={red} opacity="0.2" />
        <Path
          d="M101 119Q132 101 163 119Q151 135 132 127Q113 135 101 119Z"
          fill={red}
          stroke={dark}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <Rect x="125" y="124" width="14" height="36" rx="7" fill={paper} stroke={dark} strokeWidth="4" />
        <Circle cx="132" cy="164" r="9" fill={red} stroke={dark} strokeWidth="4" />
      </G>

      {/* A simplified rose keeps the art recognizably flash-inspired without
          turning it into a tiny stock icon. */}
      <G transform="translate(33 35)">
        <Path
          d="M42 15C57 6 73 18 67 33C81 38 79 57 64 62C60 78 38 79 31 65C14 68 5 50 16 38C7 24 22 8 36 16Z"
          fill={red}
          stroke={dark}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <Path
          d="M30 32C38 21 54 22 58 34C62 46 49 56 38 51C28 47 25 38 30 32ZM35 31C47 29 55 39 48 48"
          fill="none"
          stroke={paper}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Path d="M23 62C13 77 18 94 30 105M61 62C71 78 67 94 56 105" fill="none" stroke={paper} strokeWidth="4" />
        <Path d="M27 79C12 74 5 82 10 94C22 96 29 90 27 79ZM58 82C72 74 82 81 78 94C66 97 58 92 58 82Z" fill={red} stroke={dark} strokeWidth="3" />
      </G>
    </G>
  );
}

function SugarArtwork({ muted }: { muted: boolean }) {
  const pink = muted ? "#c06a87" : "#df4c82";
  const cream = muted ? "#ead9cf" : "#fff8f1";
  const cocoa = muted ? "#8f7770" : "#4a302d";

  return (
    <G>
      <Circle cx="62" cy="90" r="62" fill={pink} opacity={muted ? 0.08 : 0.12} />
      <Path d="M16 152C58 132 99 138 133 162" fill="none" stroke={pink} strokeWidth="2" opacity="0.45" />

      {/* Decorated cookie with piped border and floral icing. */}
      <G transform="translate(15 23) rotate(-10 67 67)">
        <Circle cx="67" cy="67" r="53" fill="#e9b986" stroke={cocoa} strokeWidth="4" />
        <Circle cx="67" cy="67" r="44" fill={cream} stroke={pink} strokeWidth="3" strokeDasharray="3 7" strokeLinecap="round" />
        <Circle cx="67" cy="67" r="12" fill={pink} />
        {[0, 60, 120, 180, 240, 300].map((rotation) => (
          <Path
            key={rotation}
            d="M67 51C56 43 57 31 67 28C77 31 78 43 67 51Z"
            fill="#f7b9cc"
            stroke={pink}
            strokeWidth="2"
            transform={`rotate(${rotation} 67 67)`}
          />
        ))}
        <Circle cx="67" cy="67" r="5" fill="#f8d36a" />
      </G>

      {/* Two cake pops form a small bouquet behind the cookie. */}
      <G>
        <Path d="M158 76L132 161M203 94L171 166" stroke={cocoa} strokeWidth="5" strokeLinecap="round" />
        <Circle cx="158" cy="65" r="31" fill="#f6c1d2" stroke={cocoa} strokeWidth="4" />
        <Path d="M135 62Q158 42 181 62M139 74Q158 57 177 74" fill="none" stroke={cream} strokeWidth="4" strokeLinecap="round" />
        <Circle cx="203" cy="83" r="27" fill="#f8d99e" stroke={cocoa} strokeWidth="4" />
        <Path d="M184 81Q203 65 222 81M188 91Q203 79 218 91" fill="none" stroke={cream} strokeWidth="4" strokeLinecap="round" />
        <Path d="M126 158Q153 145 180 164" fill="none" stroke={pink} strokeWidth="8" strokeLinecap="round" />
      </G>

      <Circle cx="212" cy="32" r="4" fill={pink} />
      <Circle cx="224" cy="47" r="2.5" fill={pink} opacity="0.65" />
      <Path d="M204 19V31M198 25H210" stroke={pink} strokeWidth="2" strokeLinecap="round" />
    </G>
  );
}
