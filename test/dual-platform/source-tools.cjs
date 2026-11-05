'use strict';

const assert = require('node:assert/strict');
const { readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Linter } = require('../../apps/desktop/node_modules/eslint');

const webRoot = path.resolve(__dirname, '../../apps/web');

function memberName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type !== 'MemberExpression' || node.computed) return null;
  return `${memberName(node.object)}.${memberName(node.property)}`;
}

function isIife(statement) {
  const call = statement.type === 'ExpressionStatement' && statement.expression;
  return call?.type === 'CallExpression' && call.callee.type === 'FunctionExpression';
}

function createWebSource(source) {
  // 复用桌面已有解析器，不在 vm 中启动页面；解析结果仅由本次加载持有。
  const linter = new Linter();
  const messages = linter.verify(source, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
    rules: {},
  });
  assert(!messages.some((message) => message.fatal),
    `测试源码无法解析：${messages.map((message) => message.message).join('; ')}`);
  const code = linter.getSourceCode();
  const program = code.ast.body;
  const wrappers = program.filter(isIife);
  let wrapper;
  if (wrappers.length) {
    assert.equal(wrappers.length, 1, '应用 IIFE 必须唯一。');
    assert.equal(program.length, 1, '应用 IIFE 外出现了额外语句。');
    wrapper = wrappers[0].expression;
    assert(wrapper.arguments.length === 0 && wrapper.callee.params.length === 0
      && !wrapper.callee.id && !wrapper.callee.async && !wrapper.callee.generator,
    '应用 IIFE 契约已改变。');
  }
  const body = wrapper ? wrapper.callee.body.body : program;

  function unique(nodes, label) {
    assert.equal(nodes.length, 1, `${label} 必须存在且唯一。`);
    return nodes[0];
  }

  function declaration(name) {
    return unique(body.filter((node) => node.type === 'FunctionDeclaration'
      && node.id.name === name), `函数 ${name}`);
  }

  function startup() {
    assert(wrapper, '测试桥接需要应用 IIFE。');
    const node = unique(body.filter((statement) => {
      const call = statement.type === 'ExpressionStatement' && statement.expression;
      return call?.type === 'CallExpression' && call.callee.type === 'Identifier'
        && call.callee.name === 'startApplication' && call.arguments.length === 0;
    }), '应用启动边界');
    assert.equal(body.at(-1), node, '应用启动必须是 IIFE 的最后一条语句。');
    return node;
  }

  return {
    between(startName, endName) {
      const start = declaration(startName).range[0];
      const end = declaration(endName).range[0];
      assert(end > start, `函数边界顺序错误：${startName} / ${endName}`);
      return source.slice(start, end);
    },
    functionSource(name) { return code.getText(declaration(name)); },
    stringConstant(name) {
      const declarations = body.filter((node) => node.type === 'VariableDeclaration'
        && node.kind === 'const').flatMap((node) => node.declarations);
      const entry = unique(declarations.filter((node) => node.id.type === 'Identifier'
        && node.id.name === name), `常量 ${name}`);
      assert(entry.init?.type === 'Literal' && typeof entry.init.value === 'string',
        `常量 ${name} 必须是字符串字面量。`);
      return entry.init.value;
    },
    replaceStartup(bridge) {
      const node = startup();
      return source.slice(0, node.range[0]) + bridge + source.slice(node.range[1]);
    },
    injectIife(bridge) {
      if (!wrapper) return { source, bridgeUsed: false };
      startup();
      const offset = wrapper.callee.body.range[1] - 1;
      return { source: source.slice(0, offset) + bridge + source.slice(offset), bridgeUsed: true };
    },
    closeHookSource() {
      const node = unique(body.filter((statement) => {
        if (statement.type !== 'IfStatement'
          || memberName(statement.test) !== 'globalThis.ShirohaDesktopHost') return false;
        const consequent = statement.consequent.type === 'BlockStatement'
          ? statement.consequent.body : [statement.consequent];
        const assignment = consequent.length === 1 && consequent[0].type === 'ExpressionStatement'
          && consequent[0].expression;
        return assignment?.type === 'AssignmentExpression' && assignment.operator === '='
          && memberName(assignment.left) === 'globalThis.ShirohaDesktopHost.canClose';
      }), '桌面关闭钩子');
      return code.getText(node);
    },
  };
}

function loadWebSource() {
  return createWebSource(readFileSync(path.join(webRoot, 'app.js'), 'utf8'));
}

function runWebScripts(context, names) {
  const root = realpathSync(webRoot);
  for (const name of names) {
    const target = realpathSync(path.resolve(root, name));
    const relative = path.relative(root, target);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      && path.extname(target) === '.js', '测试脚本必须位于 apps/web 内。');
    vm.runInContext(readFileSync(target, 'utf8'), context, { filename: target, timeout: 5000 });
  }
}

module.exports = { createWebSource, loadWebSource, runWebScripts };
