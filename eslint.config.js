import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Historical before-source snapshots are evidence, not maintained APP code.
    ignores: ['**/dist/**', '**/.tmp-dry-run/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'reports/**/before/**',
      // This retained esbuild output is checked through its maintained TS source.
      'reports/official-testnet-faucet-2026-10-03/native-gas-read.bundle.cjs',
      // Generated from currentSharedDexTokenDistribution.ts; source and byte hashes
      // are checked by the focused suite and native-read.cjs.
      'reports/shared-token-distribution-2026-10-07/compiled/app-reader.cjs',
      'reports/shared-token-distribution-2026-10-07/compiled/app-private-funds.cjs',
      // Exact esbuild output of maintained sources, pinned by native-funds-read.cjs.
      'reports/prepared-candidate-2026-10-07/compiled/app-prepared-funds.cjs',
      'reports/current-claims-2026-10-09/compiled/app-current-funds.cjs',
      // Generated public registry reader; maintained TS and native-read pins are checked.
      'reports/prepared-candidate-2026-10-07/market-registry/compiled/public-registry.cjs',
      // Generated exact ABI codec; authored TS and sealed ABI binding remain checked.
      'reports/prepared-candidate-2026-10-07/pool-owner-codec/codec.bundle.cjs',
      // Retained generated Vite assets; their maintained source remains linted.
      'reports/**/build-output-*/assets/**',
      // Generated esbuild readers/codecs; native runners bind their maintained
      // entry points and bundle hashes. Do not lint emitted helper code.
      'reports/exit-consumers-2026-10-08/compiled-funds.cjs',
      'reports/exit-limits-2026-10-08/compiled-binding.cjs',
      'reports/exit-price-history-2026-10-08/compiled-reader.cjs',
      'reports/exit-price-history-2026-10-08/all-markets/**/compiled-reader-v1.cjs',
      // Recoverable historical source, kept unchanged with its accepted pins.
      'reports/exit-candidate-2026-10-07/history/*.before.cjs',
      // Retained Vite outputs. Their authored capture scripts remain linted.
      'reports/dex-builder-funding-failure-scope-2026-10-05/candidate-build-output/**',
      'reports/dex-builder-local-funding-2026-10-05/candidate-build-output/**',
      'reports/dex-builder-owner-failure-scope-2026-10-05/candidate-build-output/**',
      'reports/dex-builder-owner-privacy-scope-2026-10-05/candidate-build-output/**',
      'reports/dex-builder-owner-recovery-boundary-2026-10-05/candidate-build-output/**',
      'reports/dex-builder-owner-serialization-2026-10-05/candidate-build-output/**',
      'reports/dex-builder-pool-recovery-scope-2026-10-05/candidate-build-output/**',
      'reports/dex-builder-price-impact-2026-10-05/build-output/**',
      'reports/dex-builder-price-impact-2026-10-05/final-build-output/**',
      'reports/dex-builder-result-cache-2026-10-05/build-output/**',
      'reports/dex-builder-review-scope-2026-10-05/build-output/**',
      'reports/dex-builder-snapshot-recovery-route-2026-10-05/candidate-build-output/**',
      'reports/dex-builder-swap-review-scope-2026-10-05/build-output/**',
      // esbuild bundles checked through the maintained TS adapter and source pins.
      'reports/shared-token-distribution-2026-10-07/compiled/app-native-funding.cjs',
      'reports/shared-token-distribution-2026-10-07/compiled/app-native-funds.cjs',
      'reports/shared-token-distribution-2026-10-07/native-funding-adapter-2/compiled/app-native-funding.cjs',
      'reports/shared-token-distribution-2026-10-07/native-funding-adapter-2/compiled/app-native-funds.cjs']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'reports/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    }
  },
  {
    files: ['scripts/**/*.cjs', 'reports/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    files: ['scripts/**/*.cjs', 'reports/**/*.{cjs,mjs}'],
    // Node modules can shadow globals in their own scope. Keep checks for
    // repeated declarations in that scope, including existing global comments.
    rules: {'no-redeclare': ['error', {builtinGlobals: false}]}
  },
  {
    files: [
      'reports/next-dex-app-2026-10-04/native-pool-fit/runtime.test.cjs',
      'reports/next-dex-app-2026-10-04/native-pool-recovery/runtime.test.cjs'
    ],
    // Hardhat runs these retained tests in Mocha.
    languageOptions: {globals: {describe: 'readonly', it: 'readonly', after: 'readonly'}}
  },
  {
    files: ['reports/next-dex-app-2026-10-04/native-pool-ui-integration/render.cjs'],
    // These names occur only in Playwright's browser-evaluated callbacks.
    languageOptions: {globals: {window: 'readonly', document: 'readonly'}}
  },
  {
    files: ['reports/prepared-candidate-2026-10-07/swap-view/browser-check.mjs'],
    // These names occur only inside the retained Playwright browser callback.
    languageOptions: {globals: {window: 'readonly', document: 'readonly'}}
  },
  {
    files: [
      'reports/exit-consumers-2026-10-08/browser/check.js',
      'reports/exit-limits-2026-10-08/browser/check.js'
    ],
    // These files store callback expressions for the browser runner to load.
    languageOptions: {globals: globals.browser},
    rules: {'@typescript-eslint/no-unused-expressions': 'off'}
  },
  {
    files: ['reports/exit-pool-positions-2026-10-08/browser-check.mjs'],
    // Browser globals occur only inside Playwright-evaluated callbacks.
    languageOptions: {globals: globals.browser}
  },
  {
    files: ['reports/app-readiness-2026-10-03/measure.mjs'],
    // This name occurs only inside Playwright's browser-evaluated callback.
    languageOptions: {globals: {getComputedStyle: 'readonly'}}
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'no-empty': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'error'
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/features/wallet/directChatV2MetaMaskCapability.ts',
      'src/features/wallet/groupChatV2MetaMaskCapability.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx'
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/directChatV2Chain'],
          importNames: ['bindDirectChatV2MetaMaskCapability'],
          message: 'Only the dedicated wallet-layer issuer may mint a Direct Chat V2 MetaMask capability.'
        }, {
          group: ['**/groupChatV2Chain'],
          importNames: ['bindGroupChatV2MetaMaskCapability'],
          message: 'Only the dedicated wallet-layer issuer may mint a Group Chat V2 MetaMask capability.'
        }]
      }]
    }
  },
  {
    files: ['tests/real-wallet/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@coti-io/coti-ethers',
          importNames: ['onboard', 'recoverAesFromTx'],
          message: 'The real-wallet recovery gate must use its exact receipt parser and must never use the broken SDK recovery helper.'
        }]
      }]
    }
  }
);
