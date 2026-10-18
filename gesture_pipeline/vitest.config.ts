import { defineConfig } from 'vitest/config';

// Rule/replay regressions only. The host application's Vite server owns the UI.
export default defineConfig({ test: { include: ['src/gestures/__tests__/**/*.test.ts'] } });
