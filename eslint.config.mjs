/**
 * ESLint Configuration for Pencil Agent Gateway
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist', 'node_modules', 'coverage', '*.test.ts', '**/*.test.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-console': 'off',
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
];
