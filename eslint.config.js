import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'build/**',
      'node_modules/**',
      '.react-router/**',
      '.agents/**',
      'spikes/**',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,

  // Type-aware linting for the website and the scripts alike.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['app/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
  },

  // Config files are plain ESM and outside the TS project.
  {
    files: ['*.js'],
    languageOptions: { sourceType: 'module' },
  },

  // Must stay last so formatting rules are switched off in favour of Prettier.
  prettier,
);
