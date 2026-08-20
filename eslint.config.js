import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  // Build output, wherever it lands, plus what wrangler writes while it runs.
  { ignores: ['dist', '**/dist/', '**/.wrangler/'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',
      // No prop-types in this project; props are documented at the call site.
      'react/prop-types': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // The relay is not a browser and not React: it runs on Cloudflare's runtime,
  // where `WebSocketPair` is a global and there is no window to reach for.
  {
    files: ['relay/**/*.js'],
    languageOptions: {
      globals: { ...globals.worker, WebSocketPair: 'readonly' },
    },
    rules: { 'react-refresh/only-export-components': 'off' },
  },
]
