// Zentrale ESLint-Konfiguration (Flat Config) für das gesamte Monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // public/ enthält statische Assets (u. a. den Service Worker mit
    // Service-Worker-Globals) – kein TS-Quellcode, daher nicht linten.
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*', '**/public/**'],
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
