import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/node_modules/**',
    '**/next-env.d.ts',
    '**/coverage/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // Unused vars are an error, but an underscore prefix marks a deliberate
      // discard (destructuring rest, required-but-ignored callback params).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['**/*.{mjs,js}'],
    rules: {},
  },
]);
