// 本机语言偏好与文档同寿命。切换时更新标记过的文案，保留业务 DOM 和交互状态。
(() => {
  'use strict';

  const messages = globalThis.ShirohaI18nMessages;
  const defaultLocale = 'zh-CN';
  const attributes = ['aria-label', 'alt', 'placeholder', 'title'];
  const escapeCodes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const formats = new Map([defaultLocale, 'en'].map((locale) => [
    locale,
    {
      messageIndex: locale === defaultLocale ? 0 : 1,
      number: new Intl.NumberFormat(locale),
      percent: new Intl.NumberFormat(locale, { style: 'percent' }),
      plural: new Intl.PluralRules(locale),
      date: new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      }),
    },
  ]));
  let locale = defaultLocale;

  function number(value) {
    return formats.get(locale).number.format(value);
  }

  function percent(value) {
    return formats.get(locale).percent.format(Number(value) / 100);
  }

  function date(value) {
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? '—' : formats.get(locale).date.format(time);
  }

  // 数字参数按目标语言格式化，译文可重排参数并根据 count 选择复数。
  function translate(language, key, values = {}) {
    const format = formats.get(language);
    const pair = Object.hasOwn(messages, key) ? messages[key] : undefined;
    const translation = pair?.[format.messageIndex] ?? pair?.[0] ?? key;
    const template = typeof translation === 'string'
      ? translation
      : translation[format.plural.select(values.count)] || translation.other;
    // 词条占位符只读取显式提供的参数，参数内容不会被再次解释。
    return template.replace(/\{([A-Za-z]\w*)\}/g, (_, name) => {
      const value = Object.hasOwn(values, name) ? values[name] : '';
      return typeof value === 'number' ? format.number.format(value) : String(value ?? '');
    });
  }

  function text(key, values) {
    return translate(locale, key, values);
  }

  function escape(value) {
    // 动态标签可能带用户题库名称。转义文字和属性分隔符后才可插入 HTML。
    return String(value).replace(/[&<>"']/g, (character) => escapeCodes[character]);
  }

  function marker(name, key, values) {
    const args = values ? ` ${name}-values="${escape(JSON.stringify(values))}"` : '';
    return `${name}="${escape(key)}"${args}`;
  }

  function html(key, values) {
    return `<span ${marker('data-i18n', key, values)}>${escape(text(key, values))}</span>`;
  }

  function attribute(name, key, values) {
    return `${marker(`data-i18n-${name}`, key, values)} ${name}="${escape(text(key, values))}"`;
  }

  // 保留单个元素当前词条及原始参数，切换时可以重新格式化而不替换控件。
  function remember(element, name, key, values) {
    element.setAttribute(name, key);
    if (values) {
      element.setAttribute(`${name}-values`, JSON.stringify(values));
    } else {
      element.removeAttribute(`${name}-values`);
    }
  }

  function bindText(element, key, values) {
    remember(element, 'data-i18n', key, values);
    element.textContent = text(key, values);
  }

  function bindAttribute(element, name, key, values) {
    remember(element, `data-i18n-${name}`, key, values);
    element.setAttribute(name, text(key, values));
  }

  function boundText(element, markerName) {
    const values = element.getAttribute(`${markerName}-values`);
    return text(element.getAttribute(markerName), values ? JSON.parse(values) : undefined);
  }

  // 标记只出现在界面文案节点。保留选择、键盘焦点、答题内容和已挂载的事件。
  function apply() {
    document.documentElement.lang = locale;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = boundText(element, 'data-i18n');
    });
    for (const name of attributes) {
      const markerName = `data-i18n-${name}`;
      document.querySelectorAll(`[${markerName}]`).forEach((element) => {
        element.setAttribute(name, boundText(element, markerName));
      });
    }

    document.querySelectorAll('[data-ui-language]').forEach((control) => {
      control.value = locale;
    });
  }

  function loadLocale(preferences) {
    try {
      const saved = preferences.locale();
      return formats.has(saved) ? saved : defaultLocale;
    } catch {
      return defaultLocale;
    }
  }

  // 先持久化再切换。浏览器无法保存偏好时保留当前语言，两个入口仍保持一致。
  function initialize(preferences, refresh, reportError) {
    locale = loadLocale(preferences);
    apply();
    document.querySelectorAll('[data-ui-language]').forEach((control) => {
      control.onchange = () => {
        const next = control.value;
        if (next === locale || !formats.has(next)) {
          control.value = locale;
          return;
        }

        try {
          preferences.setLocale(next);
        } catch {
          control.value = locale;
          reportError(text('language.saveFailed'));
          return;
        }

        locale = next;
        apply();
        refresh();
      };
    });
  }

  // 共用答题组件可以为尚未绑定语言的历史渲染入口生成固定中文。
  const chinese = Object.freeze({
    html: (key, values) => escape(translate(defaultLocale, key, values)),
    attribute: (name, key, values) => `${name}="${escape(translate(defaultLocale, key, values))}"`,
    bindText(element, key, values) {
      element.textContent = translate(defaultLocale, key, values);
    },
    bindAttribute(element, name, key, values) {
      element.setAttribute(name, translate(defaultLocale, key, values));
    },
  });
  globalThis.ShirohaI18n = Object.freeze({
    locale: () => locale,
    text,
    html,
    attribute,
    bindText,
    bindAttribute,
    number,
    percent,
    date,
    initialize,
    chinese,
  });
})();
