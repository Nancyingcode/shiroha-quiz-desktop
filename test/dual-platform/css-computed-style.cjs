'use strict';

function sampleComputedStyles(selectors) {
  return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
    const element = globalThis.document.querySelector(selector);
    if (!element) { throw new Error(`计算样式目标不存在：${selector}`); }
    const style = globalThis.getComputedStyle(element);
    return [name, {
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      gap: [style.rowGap, style.columnGap],
    }];
  }));
}

module.exports = { sampleComputedStyles };
