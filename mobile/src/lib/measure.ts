// What one inch is worth on this screen.
//
// A design's size in inches is the whole point of a stencil, but nothing in
// React Native reports physical screen size — points are only loosely tied to
// real inches, and the tie differs per device. So the number is calibrated
// once against something everyone has: a bank card, which is 3.370in wide by
// ISO/IEC 7810 ID-1 and identical worldwide.

import AsyncStorage from "@react-native-async-storage/async-storage";

/** ID-1 card width in inches — the calibration reference. */
export const CARD_WIDTH_IN = 3.37;
export const CARD_HEIGHT_IN = 2.125;

/** Close enough for iPhone-class screens until it's calibrated. */
export const DEFAULT_PPI = 160;

const KEY = "inkline:screen-ppi";

export async function getScreenPpi(): Promise<{ ppi: number; calibrated: boolean }> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const value = raw ? Number(raw) : NaN;
    // A wild value would silently render everything at the wrong size, which
    // is worse than falling back to the estimate.
    if (Number.isFinite(value) && value >= 60 && value <= 600) {
      return { ppi: value, calibrated: true };
    }
  } catch {
    // Fall through to the default.
  }
  return { ppi: DEFAULT_PPI, calibrated: false };
}

export async function setScreenPpi(ppi: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(ppi));
  } catch {
    // Not worth interrupting the user over; the value stays for this session.
  }
}
