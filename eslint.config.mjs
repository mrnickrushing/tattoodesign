import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // mobile/ is an independent Expo/React Native project with its own
    // eslint config and tsconfig — lint it via `cd mobile && npx expo lint`.
    "mobile/**",
    // public/ is the deployed Expo web export (minified bundle output),
    // not source — see AGENTS.md.
    "public/**",
  ]),
]);

export default eslintConfig;
