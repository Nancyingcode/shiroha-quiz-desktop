export const styleTargets = ['ai-panels', 'controls-and-feedback'].map((name) => ({
  source: `apps/web-scss/${name}.scss`,
  output: `apps/web/styles/${name}.css`,
}));
