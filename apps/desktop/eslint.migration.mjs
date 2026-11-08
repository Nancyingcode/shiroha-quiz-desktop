// 仅暂缓实际未清零的文件/格式规则；P3—P5 清零后逐项移除，新路径默认完整检查。
export const styleDebt = {
  'apps/desktop/frontend/adapter.js': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/frontend/bridge.js': [
    '@stylistic/arrow-parens',
  ],
  'apps/desktop/frontend/codebuddy-login.js': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/frontend/harness.js': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/frontend/titlebar.js': [
    '@stylistic/arrow-parens',
  ],
  'apps/desktop/scripts/benchmark.mjs': [
    '@stylistic/arrow-parens',
  ],
  'apps/desktop/scripts/codebuddy-cli-smoke.mjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/scripts/codebuddy-login-smoke.mjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/scripts/dev-smoke.mjs': [
    '@stylistic/arrow-parens',
  ],
  'apps/desktop/scripts/document-smoke.mjs': [
    '@stylistic/arrow-parens',
  ],
  'apps/desktop/scripts/harness-smoke.mjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/scripts/network-smoke.mjs': [
    '@stylistic/arrow-parens',
  ],
  'apps/desktop/scripts/prepare-web.mjs': [
    '@stylistic/arrow-parens',
  ],
  'apps/desktop/scripts/smoke.mjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/semi',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/test/codebuddy-login.test.mjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/test/native-adapter.test.mjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'apps/desktop/test/native-services.test.mjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/object-curly-spacing',
  ],
  'apps/desktop/test/prepare-web.test.mjs': [
    '@stylistic/arrow-parens',
  ],
  'apps/desktop/test/titlebar.test.mjs': [
    '@stylistic/arrow-parens',
  ],
  'apps/web/platform/browser-network.js': [
    '@stylistic/arrow-parens',
  ],
  'apps/web/platform/dialogs.js': [
    '@stylistic/arrow-parens',
  ],
  'apps/web/platform/validation.js': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/ai-codebuddy-execution.test.cjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'test/dual-platform/ai-connection.test.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/ai-harness.test.cjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'test/dual-platform/browser-credentials.test.cjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/semi',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'test/dual-platform/browser-page.cjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/keyword-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/semi',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'test/dual-platform/browser-storage.test.cjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/semi',
    '@stylistic/space-infix-ops',
  ],
  'test/dual-platform/business.test.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/circled-stem.test.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/dialog-page.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/document-lifecycle.test.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/document-page.cjs': [
    '@stylistic/arrow-parens',
    '@stylistic/indent',
  ],
  'test/dual-platform/exit.test.cjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-before-blocks',
    '@stylistic/space-infix-ops',
  ],
  'test/dual-platform/format.test.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/json-import.test.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/review-options.test.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/select-page.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/training.test.cjs': [
    '@stylistic/arrow-parens',
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-infix-ops',
  ],
  'test/dual-platform/web-source.cjs': [
    '@stylistic/arrow-parens',
  ],
  'test/dual-platform/zip-safety.test.cjs': [
    '@stylistic/comma-spacing',
    '@stylistic/key-spacing',
    '@stylistic/object-curly-spacing',
    '@stylistic/space-infix-ops',
  ],
};
export const legacyStyleFiles = Object.keys(styleDebt);

// 这些历史文件原本不在门禁中；单独报告语义债务，迁移后从此清单移除。
// 原门禁外文件清单已清空，相关手写脚本均已纳入正式门禁。
// 仅尚未清零的文件/规则暂缓强制；其余语义规则保持 error，报告不以数量抵扣。
export const semanticDebt = {
  'apps/desktop/frontend/adapter.js': [
    'curly',
    'no-nested-ternary',
  ],
  'apps/desktop/frontend/codebuddy-login.js': [
    'curly',
    'no-param-reassign',
  ],
  'apps/desktop/frontend/harness.js': [
    'curly',
  ],
  'apps/desktop/frontend/titlebar.js': [
    'curly',
  ],
  'apps/desktop/scripts/benchmark.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/codebuddy-cli-smoke.mjs': [
    'curly',
    'no-param-reassign',
  ],
  'apps/desktop/scripts/codebuddy-login-smoke.mjs': [
    'curly',
    'no-param-reassign',
  ],
  'apps/desktop/scripts/dev-smoke.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/document-smoke.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/harness-smoke.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/native-isolation.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/network-smoke.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/prepare-web.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/release-artifacts.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/release-github.mjs': [
    'curly',
  ],
  'apps/desktop/scripts/smoke.mjs': [
    'curly',
    'no-nested-ternary',
  ],
  'apps/desktop/test/codebuddy-login.test.mjs': [
    'curly',
  ],
  'apps/desktop/test/native-adapter.test.mjs': [
    'curly',
  ],
  'apps/desktop/test/native-services.test.mjs': [
    'curly',
  ],
  'apps/desktop/test/prepare-web.test.mjs': [
    'curly',
  ],
  'apps/desktop/test/release.test.mjs': [
    'curly',
  ],
  'apps/web/platform/browser-credentials.js': [
    'curly',
    'no-nested-ternary',
  ],
  'apps/web/platform/browser-network.js': [
    'curly',
  ],
  'apps/web/platform/browser.js': [
    'curly',
  ],
  'apps/web/platform/dialogs.js': [
    'curly',
  ],
  'apps/web/platform/save-queue.js': [
    'curly',
    'no-nested-ternary',
  ],
  'apps/web/platform/validation.js': [
    'curly',
  ],
  'test/dual-platform/ai-codebuddy-execution.test.cjs': [
    'curly',
  ],
  'test/dual-platform/ai-connection.test.cjs': [
    'curly',
  ],
  'test/dual-platform/ai-harness.test.cjs': [
    'curly',
    'no-nested-ternary',
  ],
  'test/dual-platform/browser-credentials.test.cjs': [
    'curly',
  ],
  'test/dual-platform/browser-page.cjs': [
    'curly',
  ],
  'test/dual-platform/browser-storage.test.cjs': [
    'curly',
  ],
  'test/dual-platform/business.test.cjs': [
    'curly',
  ],
  'test/dual-platform/circled-stem.test.cjs': [
    'curly',
  ],
  'test/dual-platform/contracts.test.cjs': [
    'curly',
  ],
  'test/dual-platform/document-lifecycle.test.cjs': [
    'curly',
  ],
  'test/dual-platform/format.test.cjs': [
    'curly',
  ],
  'test/dual-platform/json-import.test.cjs': [
    'curly',
  ],
  'test/dual-platform/review-options.test.cjs': [
    'curly',
  ],
  'test/dual-platform/select-page.cjs': [
    'curly',
  ],
  'test/dual-platform/source-tools.cjs': [
    'curly',
  ],
  'test/dual-platform/web-source.cjs': [
    'curly',
  ],
  'apps/desktop/frontend/bridge.js': [
    'curly',
  ],
};
