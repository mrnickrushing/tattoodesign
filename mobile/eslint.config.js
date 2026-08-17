// mobile/ is an independent Expo/React Native project — it needs its own
// config so it isn't accidentally linted with the web app's Next.js rules
// (or, without this file at all, silently inherit the root config via
// ESLint's directory-tree lookup, which is what was happening before this
// file existed).
const expoConfig = require("eslint-config-expo/flat");
const { defineConfig, globalIgnores } = require("eslint/config");

module.exports = defineConfig([
  expoConfig,
  globalIgnores([".expo/**", "dist/**", "ios/**", "android/**"]),
]);
