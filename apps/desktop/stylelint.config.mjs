export default {
  extends: ['stylelint-config-recommended'],
  // 样式表已按功能拆分，基础变量与主题变量分散在两个文件，未知变量检查必须跨文件收集定义。
  referenceFiles: ['../web/styles.css', '../web/styles/responsive-artwork.css'],
  rules: {
    'no-unknown-custom-properties': true,
    'custom-property-pattern': '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
    'selector-class-pattern': '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
    // 新组件样式限制选择器复合深度，避免继续叠加「页面状态 + 卡片 + 侧栏 + 子元素」式长链。
    'selector-max-compound-selectors': 4,
  },
};
