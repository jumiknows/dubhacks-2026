import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/.next/**", "apps/web/next-env.d.ts", "apps/web/public/mediapipe/**", "apps/web/public/models/**", "**/node_modules/**", "data/**", "docs/prototype/**", "coverage/**", "**/.venv/**", "research/artifacts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/src/**/*.js", "apps/web/src/**/*.jsx", "apps/web/public/*.js"],
    languageOptions: {
      globals: { ...globals.browser, sampleRate: "readonly" },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    },
  },
);
