/** @typedef {import('eslint').Rule.Node} Node */
/** @typedef {import('eslint').SourceCode} SourceCode */
/** @typedef {import('eslint').AST.Token} Token */
/** @typedef {ReturnType<SourceCode['getAllComments']>[number]} Comment */
/** @typedef {Extract<Node, {type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression'}>} FunctionNode */

const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const structuralTokens = new Set(['{', '}', '[', ']', '(', ')', ',', ';']);
const functionLineLimit = 3;
const blockLineLimit = 20;

/** @param {SourceCode} sourceCode @param {Token[]} tokens */
function countCodeLines(sourceCode, tokens) {
  const lines = new Set();
  for (const token of tokens) {
    if (token.type === 'Punctuator' && structuralTokens.has(token.value)) {
      continue;
    }

    const { start, end } = token.loc;
    const { line: firstLine } = start;
    for (let line = firstLine; line <= end.line; line += 1) {
      if (sourceCode.lines[line - 1].trim()) {
        lines.add(line);
      }
    }
  }

  return lines.size;
}

/** @param {SourceCode} sourceCode @param {Node} node */
function leadingComment(sourceCode, node) {
  let nextLine = sourceCode.getFirstToken(node)?.loc.start.line;
  for (const comment of sourceCode.getCommentsBefore(node).reverse()) {
    if (nextLine === undefined || !comment.loc || nextLine - comment.loc.end.line > 1) {
      break;
    }

    const before = sourceCode.getTokenBefore(comment);
    const trailsPreviousCode = before?.loc.end.line === comment.loc.start.line
      && comment.loc.end.line < nextLine;
    if (trailsPreviousCode) {
      break;
    }

    const description = comment.value.split(/\r?\n/).some((line) => {
      const content = line.trim().replace(/^\*\s*/, '');
      return content && !/^(?:@|eslint\b|global(?:s)?\s|exported\s|istanbul\b|c8\b)/.test(content);
    });
    if (description) {
      return comment;
    }

    nextLine = comment.loc.start.line;
  }

  return null;
}

/** @param {FunctionNode} node */
function functionOwner(node) {
  const { parent } = node;
  if (parent.type === 'VariableDeclarator' && parent.init === node
    && parent.parent.type === 'VariableDeclaration' && parent.parent.declarations.length === 1) {
    return parent.parent;
  }

  if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition')
    && parent.value === node) {
    return parent;
  }

  if (parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration') {
    return parent;
  }

  if (parent.type === 'CallExpression' && parent.callee === node && parent.parent.type === 'ExpressionStatement') {
    return parent.parent;
  }

  return node;
}

/** @type {import('eslint').Rule.RuleModule} */
const explainFunction = {
  meta: { schema: [], messages: { missing: '超过三行的函数需要说明用途及调用边界。' } },
  create(context) {
    const { sourceCode } = context;
    /** @param {FunctionNode} node */
    function check(node) {
      const owner = functionOwner(node);
      if (countCodeLines(sourceCode, sourceCode.getTokens(node.body)) > functionLineLimit
        && !leadingComment(sourceCode, node) && !leadingComment(sourceCode, owner)) {
        context.report({ node: owner, messageId: 'missing' });
      }
    }

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const explainRegExp = {
  meta: { schema: [], messages: { missing: '请说明此正则匹配什么，以及匹配结果用于什么。' } },
  create(context) {
    const { sourceCode } = context;
    // 同一条说明只能供一个模式使用，避免批量匹配共用含糊的注释。
    const usedComments = new Set();
    /** @param {Node} node */
    function check(node) {
      let target = node;
      while (target && target.type !== 'Program' && target.type !== 'BlockStatement') {
        const comment = leadingComment(sourceCode, target);
        if (comment && !usedComments.has(comment)) {
          usedComments.add(comment);
          return;
        }

        if (/(?:Statement|Declaration)$/.test(target.type) || functionTypes.has(target.type)) {
          break;
        }

        target = target.parent;
      }

      context.report({ node, messageId: 'missing' });
    }

    /** @param {Extract<Node, {type: 'CallExpression' | 'NewExpression'}>} node */
    function checkConstructor(node) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'RegExp') {
        return;
      }

      const reference = sourceCode.getScope(node).references.find(({ identifier }) => identifier === node.callee);
      if (!reference?.resolved?.defs.length) {
        check(node);
      }
    }

    return {
      Literal(node) {
        if ('regex' in node) {
          check(node);
        }
      },
      CallExpression: checkConstructor,
      NewExpression: checkConstructor,
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const reviewLongBlock = {
  meta: { schema: [], messages: { long: '代码块有 {{lines}} 个有效代码行，请审查是否能按职责拆分。' } },
  create(context) {
    const { sourceCode } = context;
    /** @param {Node} node */
    function check(node) {
      const lines = countCodeLines(sourceCode, sourceCode.getTokens(node));
      if (lines > blockLineLimit) {
        context.report({ node, messageId: 'long', data: { lines } });
      }
    }

    return { BlockStatement: check, StaticBlock: check, SwitchStatement: check };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const blankAfterObjectMethod = {
  meta: { schema: [], fixable: 'whitespace', messages: { missing: '对象方法后应留一个空行。' } },
  create(context) {
    const { sourceCode } = context;
    const newline = sourceCode.text.includes('\r\n') ? '\r\n' : '\n';
    return {
      ObjectExpression(node) {
        for (const [index, property] of node.properties.slice(0, -1).entries()) {
          if (property.type !== 'Property' || !functionTypes.has(property.value.type)) {
            continue;
          }

          const next = node.properties[index + 1];
          const comma = sourceCode.getTokenAfter(property);
          if (!comma || !next.loc) {
            continue;
          }

          /** @type {Token | Comment} */
          let left = comma;
          let leftEndLine = comma.loc.end.line;
          let right = sourceCode.getTokenAfter(comma, { includeComments: true });
          while (right?.loc && ['Line', 'Block'].includes(right.type) && right.loc.start.line === leftEndLine
            && right.loc.end.line < next.loc.start.line) {
            left = right;
            leftEndLine = right.loc.end.line;
            right = sourceCode.getTokenAfter(left, { includeComments: true });
          }

          if (right?.loc && right.loc.start.line - leftEndLine < 2) {
            const padding = newline.repeat(right.loc.start.line === leftEndLine ? 2 : 1);
            context.report({
              node: next,
              messageId: 'missing',
              fix: (fixer) => fixer.insertTextAfter(left, padding),
            });
          }
        }
      },
    };
  },
};

/** @type {import('eslint').ESLint.Plugin} */
export const readabilityPlugin = {
  rules: {
    'explain-function': explainFunction,
    'explain-regexp': explainRegExp,
    'review-long-block': reviewLongBlock,
    'blank-after-object-method': blankAfterObjectMethod,
  },
};

const endsInFunction = [
  'VariableDeclaration:has(> VariableDeclarator[init.type=/^(Arrow)?FunctionExpression$/])',
  'ExpressionStatement:has(> AssignmentExpression[right.type=/^(Arrow)?FunctionExpression$/])',
  'ExpressionStatement:has(CallExpression > :matches(FunctionExpression, ArrowFunctionExpression).arguments)',
  ':matches(ExportNamedDeclaration, ExportDefaultDeclaration):has(> FunctionDeclaration)',
];

/** @type {import('eslint').Linter.RulesRecord} */
export const readabilityGate = {
  'readability/explain-function': 'error',
  'readability/explain-regexp': 'error',
  'readability/blank-after-object-method': 'error',
  '@stylistic/padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: ['block', 'if', 'for', 'while', 'do', 'switch', 'try', 'function'], next: '*' },
    { blankLine: 'always', prev: endsInFunction.map((selector) => ({ selector })), next: '*' },
  ],
  '@stylistic/lines-between-class-members': ['error', { enforce: [{ blankLine: 'always', prev: 'method', next: '*' }] }],
};

/** @type {import('eslint').Linter.RulesRecord} */
export const readabilityReportRules = { ...readabilityGate, 'readability/review-long-block': 'warn' };
