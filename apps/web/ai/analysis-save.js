/* SHIROHA_WEB_PRACTICE_AI_SINGLE_QUESTION_V613_START
 单题 AI 解析由会话保留为草稿，练习与复盘只在用户确认保存时写入题库。 */
(() => {
  'use strict';

  const MISSING_SOURCE = '来源题库或题目不存在，无法保存；AI 草稿已保留。';
  const CHANGED_SOURCE = '来源题目已发生变化，请重新生成后再保存。';

  function analysisText(session) {
    return String(session.analysis?.analysis || '').trim();
  }

  // 校验点击时固定的来源和草稿，并通过应用事务同步可以安全更新的活跃副本。
  function create({
    state,
    practice,
    exam,
    question,
    rich,
    storage,
    view,
    confirm,
    now,
  }) {
    // 按会话去重尚在补读的保存。入口失效后，新一次明确保存可使用新的意图。
    const pending = new WeakMap();

    function findSource(bankId, questionId) {
      const bank = bankId && questionId ? state.banks.find((entry) => entry.id === bankId) || null : null;
      const index = bank?.questions?.findIndex((entry) => entry.id === questionId) ?? -1;
      return { bank, index, bankId };
    }

    // 复盘按明确来源定位原题，题库已删除时仍可使用历史题目。
    function reviewAnalysisSource(item) {
      const q = question.fromItem(item);
      return { q, ...findSource(item?.bankId || '', q?.id) };
    }

    // 原题正文补读后才比对指纹。历史重复 ID 必须能凭指纹定位到唯一题目。
    function findWriteTarget(intent) {
      const { bank, index } = findSource(intent.bankId, intent.questionId);
      if (index < 0) {
        return { error: MISSING_SOURCE };
      }

      const matches = (entry) => entry.id === intent.questionId && question.fingerprint(entry) === intent.fingerprint;

      const match = bank.questions.findIndex(matches);
      const ambiguous = match >= 0 && bank.questions.some((entry, position) => position > match && matches(entry));
      if (match < 0 || ambiguous) {
        return { error: CHANGED_SOURCE };
      }

      return { bank, index: match, target: bank.questions[match] };
    }

    // 构造带新解析的题目副本，并让富文本解析与普通解析保持一致。
    function aiSingleWithAnalysisV613(source, text) {
      const next = { ...source, analysis: text };
      const field = rich.buildField(text, 'analysis', []);
      if (!source.richContent?.fields && !field) {
        return next;
      }

      const fields = { ...source.richContent?.fields };
      if (field) {
        fields.analysis = field;
      } else {
        delete fields.analysis;
      }

      const features = Object.values(fields).flatMap((value) => {
        const entries = Array.isArray(value) ? value : [value];
        return entries.flatMap((entry) => entry?.features || []);
      });
      next.richContent = {
        ...source.richContent,
        schema: source.richContent?.schema || rich.schema,
        fields,
        features: [...new Set(features)],
      };
      return next;
    }

    function hasSameContent(copy, intent) {
      return !!copy && question.fingerprint(copy) === intent.fingerprint;
    }

    // 练习和考试沿用自己的题目副本与会话包装，只把正确来源及正文的解析同步过去。
    function updateSessionQuestions(items, intent) {
      for (const [index, item] of (items || []).entries()) {
        const copy = question.fromItem(item);
        const matchesSource = copy?.id === intent.questionId && question.bankId(item) === intent.bankId;
        if (!matchesSource || !hasSameContent(copy, intent)) {
          continue;
        }

        const next = aiSingleWithAnalysisV613(copy, intent.text);
        if (copy === item) {
          items[index] = next;
        } else {
          item.question = next;
        }
      }
    }

    // 错题与收藏可能来自旧备份，只更新与当前正文对应的现存副本。
    function updateSavedQuestions(intent) {
      const { bankId, questionId, text } = intent;
      for (const entry of state.wrongBook[bankId] || []) {
        const copy = entry?.nativeQuestion;
        if (entry?.id === questionId && hasSameContent(copy, intent)) {
          entry.nativeQuestion = aiSingleWithAnalysisV613(copy, text);
        }
      }

      const favorite = state.crossPlatformMeta?.favoriteQuestions?.[bankId]?.[questionId];
      if (hasSameContent(favorite?.question, intent)) {
        favorite.question = aiSingleWithAnalysisV613(favorite.question, text);
      }
    }

    function isCurrentIntent(intent) {
      const { session } = intent;
      return intent.ownsDraft() && !session.loading && !session.saved && session.requestId === intent.requestId
        && session.fingerprint === intent.fingerprint && analysisText(session) === intent.text;
    }

    // 将失败反馈交给触发写回的面板，保留模型返回的草稿供后续处理。
    function showError(intent, message) {
      intent.session.error = message;
      intent.session.notice = '';
      intent.render();
      return false;
    }

    // 全局重试重复补读点击时的来源，当前入口和草稿仍匹配时才进入写入事务。
    async function execute(intent) {
      if (!isCurrentIntent(intent)) {
        return false;
      }

      const previous = pending.get(intent.session);
      if (previous && isCurrentIntent(previous)) {
        return false;
      }

      pending.set(intent.session, intent);
      try {
        const { bankId, questionId } = intent;
        if (findSource(bankId, questionId).index >= 0) {
          const loaded = await storage.load([{ bankId, question: { id: questionId } }], () => isCurrentIntent(intent));
          if (!isCurrentIntent(intent)) {
            return false;
          }

          if (!loaded) {
            return showError(intent, '读取来源题目失败，草稿已保留，请重试。');
          }
        }

        return await write(intent);
      } finally {
        if (pending.get(intent.session) === intent) {
          pending.delete(intent.session);
        }
      }
    }

    // 只在事务内应用解析；应用按原对象身份回滚各副本一次，草稿独立于持久化数据。
    async function write(intent) {
      let saveFailed = false;
      const result = await storage.transaction(/* 在正文和确认状态仍有效时同步各副本并保存。 */ async () => {
        if (!isCurrentIntent(intent)) {
          return false;
        }

        let location = findWriteTarget(intent);
        if (location.error) {
          return showError(intent, location.error);
        }

        const { session, text, review } = intent;
        const { analysis } = location.target;
        const needsOverwrite = !!String(analysis || '').trim() && analysis !== text;
        if (needsOverwrite) {
          const approved = await confirm('这道题已有解析，是否用当前 AI 草稿替换？题干、选项和答案不会改变。');
          if (!approved || !isCurrentIntent(intent)) {
            return false;
          }

          // 用户确认的是此前显示的解析，来源替换后须重新定位并核对这次确认。
          location = findWriteTarget(intent);
          if (location.error) {
            return showError(intent, location.error);
          }

          if (location.target.analysis !== analysis) {
            return showError(intent, '来源解析已发生变化，请再次确认后保存。');
          }
        }

        const { bank, index, target } = location;
        bank.questions[index] = aiSingleWithAnalysisV613(target, text);
        bank.updatedAt = now();
        updateSessionQuestions(practice.current().items, intent);
        updateSessionQuestions(exam.current.items, intent);
        updateSavedQuestions(intent);
        const revision = storage.revision();
        try {
          await storage.save();
        } catch (error) {
          saveFailed = storage.revision() === revision;
          throw error;
        }

        session.error = '';
        session.notice = '已写入题库解析，可在题库管理与导出中看到。';
        if (review) {
          session.saved = true;
          view.review();
        } else {
          view.practiceSaved();
          view.notice('AI 单题解析', '已写入本题题库解析。', 'ok');
        }

        return true;
      }, () => execute(intent));
      if (saveFailed && isCurrentIntent(intent)) {
        return showError(intent, '保存失败，本地题库改动已回滚，AI 草稿仍保留。请检查本地存储空间后重试。');
      }

      return result;
    }

    // 固定稿件版本及来源身份，避免重试采纳切换后生成的新稿件。
    function saveAiSingleAnalysisV613({
      session,
      bankId,
      questionId,
      ownsDraft,
      review,
    }) {
      const text = analysisText(session);
      if (!text) {
        return false;
      }

      return execute({
        session,
        bankId,
        questionId,
        text,
        ownsDraft,
        review,
        fingerprint: session.fingerprint,
        requestId: session.requestId,
        render: review ? view.review : view.practice,
      });
    }

    // 练习允许回到旧题继续使用草稿，但旧保存只属于点击时的轮次与选择版本。
    function savePractice() {
      const item = practice.currentItem();
      if (!practice.allowed(item)) {
        return false;
      }

      const key = practice.key(item);
      const session = practice.getSession(key);
      const owner = practice.current();
      const selection = practice.selectionVersion();
      const ownsDraft = () => practice.current() === owner && practice.selectionVersion() === selection
        && practice.key(practice.currentItem()) === key;

      return saveAiSingleAnalysisV613({
        session,
        bankId: question.bankId(item),
        questionId: question.fromItem(item).id,
        ownsDraft,
        review: false,
      });
    }

    function saveReview(session, ownsDraft) {
      const { item } = session;
      return saveAiSingleAnalysisV613({
        session, bankId: item.bankId || '', questionId: question.fromItem(item).id, ownsDraft, review: true,
      });
    }

    return { reviewAnalysisSource, savePractice, saveReview };
  }

  globalThis.ShirohaAiAnalysisSave = Object.freeze({ create });
})();
/* SHIROHA_WEB_PRACTICE_AI_SINGLE_QUESTION_V613_END */
