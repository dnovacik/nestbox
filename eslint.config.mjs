import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const HEX = '/#[0-9a-fA-F]{3,8}\\b/';
const HEX_MESSAGE =
  'No hex colours in renderer code; use the theme tokens from styles/globals.css.';

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'docs/**',
      '.worktrees/**',
      'src/renderer/components/ui/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'platform',
          message: 'OS checks belong in src/main/platform/ (PlatformAdapter).',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/main/platform/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${HEX}]`, message: HEX_MESSAGE },
        { selector: `TemplateElement[value.raw=${HEX}]`, message: HEX_MESSAGE },
      ],
    },
  },
  prettier,
);
