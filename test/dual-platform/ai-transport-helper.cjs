'use strict';

const { runWebScripts } = require('./source-tools.cjs');

function installAiTransport(context) {
  runWebScripts(context, ['ai-results.js', 'ai-transport.js']);
  const results = context.ShirohaAiResults.create({});
  const transport = context.ShirohaAiTransport.create({
    platform: context.ShirohaPlatform,
    harness: { taskReason: context.aiHarnessTaskReasonV99, configured: context.aiConfiguredV99,
      unavailableReason: context.aiUnavailableReasonV99 },
    response: { content: results.aiResponseContentV99, httpErrorMessage: results.aiHttpErrorMessage },
  });
  Object.assign(context, transport);
  return transport;
}

module.exports = { installAiTransport };
