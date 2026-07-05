// Zentrale ESLint-Konfiguration (Flat Config) für das gesamte Monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // In einem Projekt mit Krypto-Code sollen unbenutzte Variablen auffallen,
      // mit Unterstrich-Präfix als bewusste Ausnahme.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
