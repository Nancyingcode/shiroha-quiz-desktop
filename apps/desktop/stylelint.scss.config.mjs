export default {
  customSyntax: 'postcss-scss',
  plugins: ['stylelint-scss'],
  rules: {
    // 级联和 CSS 声明规则由 lint:css 对实际编译产物检查。
    'scss/at-rule-no-unknown': true,
  },
};
