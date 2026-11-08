'use strict';

const { runWebScripts } = require('./source-tools.cjs');

function installAiSettings(context) {
  runWebScripts(context, ['ai-settings.js']);
  const settings = context.ShirohaAiSettings.create({
    presets: context.AI_PROVIDER_PRESETS_V99,
    platform: context.ShirohaPlatform,
    config: () => context.ensureAiImportStateV99?.() || {},
    readKey: (config) => context.readStoredAiKeyV99?.(config) || '',
    view: { select: (selector) => context.$?.(selector) || null,
      escape: (text) => context.esc?.(text) || text,
      copy: (...args) => context.copyTextV23?.(...args), toast: (...args) => context.toast?.(...args) },
  });
  for (const [name, value] of Object.entries(settings)) {
    if (!(name in context)) { context[name] = value; }
  }
  return settings;
}

module.exports = { installAiSettings };
