(() => {
  'use strict';

  function createPractice({ practice, question, request, result, view, maxFollowUps }) {
    // 草稿和控制器属于当前练习轮次；重置或来源题变化后释放。
    const sessions = new Map();
    let practiceOwner = null;

    function reset() {
      sessions.forEach((session) => session.controller?.abort());
      sessions.clear();
      practiceOwner = null;
    }

    function getSession(key) {
      const currentPractice = practice.current();
      if (practiceOwner !== currentPractice) {
        reset();
        practiceOwner = currentPractice;
      }
      const item = (currentPractice.items || []).find((value) => question.key(value) === key);
      const fingerprint = question.fingerprint(item);
      const previous = sessions.get(key);
      if (previous && previous.fingerprint !== fingerprint) {
        previous.controller?.abort();
        sessions.delete(key);
      }
      if (!sessions.has(key)) {
        sessions.set(key, { analysis: null, initialAnalysis: '', messages: [], loading: '', error: '',
          notice: '', followUpOpen: false, draft: '', expanded: false, controller: null,
          requestId: 0, fingerprint });
      }
      return sessions.get(key);
    }

    function stop(session) {
      session.requestId++;
      session.controller?.abort();
      session.controller = null;
      session.loading = '';
      session.notice = '已请求停止，已有解析和草稿已保留；请等待任务结束后重试。';
      view.render();
    }

    function isCurrentRequest(owner, key, session, requestId, item, fingerprint) {
      return practice.current() === owner && sessions.get(key) === session &&
        session.requestId === requestId && question.fingerprint(item) === fingerprint;
    }

    async function runAnalysis() {
      const item = question.current();
      if (!question.allowed(item)) {return;}
      const key = question.key(item);
      const session = getSession(key);
      if (session.loading) {return;}
      const owner = practice.current();
      const requestId = ++session.requestId;
      const fingerprint = session.fingerprint;
      const { configured, requestConfig } = request.config();
      if (!configured) {
        session.error = requestConfig.execution?.reason || '尚未配置 AI 服务，请先在“AI 设置”中选择并配置执行方式。';
        session.notice = '';
        view.render();
        return;
      }
      const chosen = question.answer(key).chosen || [];
      session.loading = 'analysis';
      session.error = '';
      session.notice = '';
      session.expanded = true;
      view.render();
      const isCurrentAnalysis = () => isCurrentRequest(owner, key, session, requestId, item, fingerprint);
      try {
        const response = await request.timeout(requestConfig.timeoutSeconds, (controller) => {
          session.controller = controller;
          return request.chat(requestConfig, request.analysisMessages(item, chosen), { controller, task: 'question_analysis' });
        });
        if (!isCurrentAnalysis()) {return;}
        const parsed = result.analysis(response.content);
        if (question.hasImages(item)) {
          parsed.confidence = 'LOW';
          parsed.needsReview = true;
          parsed.warning = [parsed.warning, '本次未发送图片，解析仅供文字部分参考。'].filter(Boolean).join(' ');
        }
        session.analysis = parsed;
        session.initialAnalysis = parsed.analysis;
        session.messages = [];
        session.followUpOpen = false;
        session.draft = '';
      } catch (error) {
        if (isCurrentAnalysis()) {
          session.error = view.sanitize(error?.message || 'AI 单题解析失败。', requestConfig);
          view.notice('AI 单题解析', session.error, 'danger');
        }
      } finally {
        if (isCurrentAnalysis()) {
          session.loading = '';
          session.controller = null;
          view.render();
        }
      }
    }

    async function runFollowUp() {
      const item = question.current();
      if (!question.allowed(item)) {return;}
      const key = question.key(item);
      const session = getSession(key);
      const text = String(session.draft || '').trim();
      if (session.loading || !session.analysis) {return;}
      const owner = practice.current();
      const requestId = ++session.requestId;
      const fingerprint = session.fingerprint;
      if (!text) {
        session.error = '请先输入追问内容。';
        view.render();
        return;
      }
      const { configured, requestConfig } = request.config();
      if (!configured) {
        session.error = requestConfig.execution?.reason || '尚未配置 AI 服务，请先在“AI 设置”中选择并配置执行方式。';
        view.render();
        return;
      }
      const chosen = question.answer(key).chosen || [];
      const history = session.messages || [];
      const pending = [...history, { role: 'user', content: text }];
      session.loading = 'followUp';
      session.error = '';
      session.notice = '';
      session.followUpOpen = true;
      view.render();
      const isCurrentFollowUp = () => isCurrentRequest(owner, key, session, requestId, item, fingerprint);
      try {
        const response = await request.timeout(requestConfig.timeoutSeconds, (controller) => {
          session.controller = controller;
          const draft = { analysis: session.analysis, initialAnalysis: session.initialAnalysis, messages: history };
          return request.chat(requestConfig, request.followUpMessages(item, chosen, draft, text), { controller, task: 'question_followup' });
        });
        if (!isCurrentFollowUp()) {return;}
        const parsed = result.followUp(response.content);
        if (question.hasImages(item)) {
          parsed.confidence = 'LOW';
          parsed.needsReview = true;
          parsed.warning = result.mergeWarning(parsed.warning, '本次未发送图片，追问与修订解析仅供文字部分参考。');
        }
        const active = session.analysis;
        session.analysis = { ...active, analysis: parsed.revisedAnalysis, confidence: parsed.confidence,
          needsReview: !!active.needsReview || parsed.needsReview,
          warning: result.mergeWarning(active.warning, parsed.warning) };
        session.messages = [...pending, { role: 'assistant', content: parsed.reply }].slice(-maxFollowUps * 2);
        session.draft = '';
        session.notice = '已根据本次追问更新解析草稿；确认无误后可保存到题库。';
      } catch (error) {
        if (isCurrentFollowUp()) {
          session.draft = text;
          session.error = view.sanitize(error?.message || '追问失败。', requestConfig);
          view.notice('AI 单题追问', session.error, 'danger');
        }
      } finally {
        if (isCurrentFollowUp()) {
          session.loading = '';
          session.controller = null;
          view.render();
        }
      }
    }

    return { reset, getSession, stop, runAnalysis, runFollowUp,
      isBusy: () => Array.from(sessions.values()).some((session) => session.loading) };
  }

  function createReview({ question, request, result, storage, view }) {
    // 解析草稿只属于当前页面会话；来源库、题目和场景共同标识，卸载的列表项会取消请求并释放草稿，不写入备份。
    const sessions = new Map();

    function remove(key) {
      const session = sessions.get(key);
      if (!session) {return;}
      session.requestId++;
      session.controller?.abort();
      sessions.delete(key);
    }

    function getOrCreate(key, item, chosen) {
      const fingerprint = question.fingerprint(item);
      const context = JSON.stringify([fingerprint, chosen]);
      let session = sessions.get(key);
      if (session && session.context !== context) {
        remove(key);
        session = null;
      }
      if (!session) {
        session = { key, item, chosen: [...chosen], fingerprint, context, analysis: null,
          loading: '', saving: false, saved: false, error: '', notice: '', requestId: 0, controller: null };
        sessions.set(key, session);
      }
      session.item = item;
      return session;
    }

    function retain(mounted) {
      sessions.forEach((_session, key) => { if (!mounted.has(key)) {remove(key);} });
    }

    async function run(session) {
      if (session.loading || session.saving) {return;}
      const { configured, requestConfig } = request.config();
      if (!configured) {
        session.error = '尚未配置 AI 服务，请先完成设置。';
        view.render();
        return;
      }
      const requestId = ++session.requestId;
      const source = question.source(session.item);
      const sourceQuestion = source.bank?.questions[source.index];
      const sourceFingerprint = sourceQuestion ? question.fingerprint(sourceQuestion) : null;
      const isCurrentReviewRequest = () => sessions.get(session.key) === session && session.requestId === requestId;
      session.loading = 'analysis';
      session.error = '';
      session.notice = '';
      view.render();
      try {
        const response = await request.timeout(requestConfig.timeoutSeconds, (controller) => {
          session.controller = controller;
          return request.chat(requestConfig, request.analysisMessages(session.item, session.chosen), { controller, task: 'question_analysis' });
        });
        if (!isCurrentReviewRequest()) {return;}
        const current = question.source(session.item);
        const currentQuestion = current.bank?.questions[current.index];
        const sourceChanged = sourceFingerprint !== null &&
          (!currentQuestion || question.fingerprint(currentQuestion) !== sourceFingerprint);
        if (sourceChanged || question.fingerprint(session.item) !== session.fingerprint) {
          throw new Error('来源题目已发生变化，请重新打开题目后再生成。');
        }
        const parsed = result.analysis(response.content);
        if (question.hasImages(session.item)) {
          parsed.confidence = 'LOW';
          parsed.needsReview = true;
          parsed.warning = result.mergeWarning(parsed.warning, '本次未发送图片，解析仅供文字部分参考。');
        }
        session.analysis = parsed;
        session.saved = false;
      } catch (error) {
        if (isCurrentReviewRequest()) {
          session.error = view.sanitize(error?.message || 'AI 解析生成失败，请重试。', requestConfig);
        }
      } finally {
        if (isCurrentReviewRequest()) {
          session.loading = '';
          session.controller = null;
          view.render();
        }
      }
    }

    async function save(session) {
      if (session.loading || session.saving || !session.analysis) {return;}
      session.saving = true;
      view.render();
      try {
        const source = question.source(session.item);
        if (source.bank && source.index >= 0 && !await storage.load([session.item])) {
          session.error = '读取来源题目失败，草稿已保留，请重试。';
          return;
        }
        await storage.save(session);
      } finally {
        session.saving = false;
        view.render();
      }
    }

    function stop(session) {
      session.requestId++;
      session.controller?.abort();
      session.controller = null;
      session.loading = '';
      session.notice = '已停止生成，已有草稿已保留。';
    }

    function discard(session) {
      session.analysis = null;
      session.error = '';
      session.notice = '';
    }

    return { get: (key) => sessions.get(key), getOrCreate, remove, retain, run, save, stop, discard,
      isBusy: () => Array.from(sessions.values()).some((session) => session.loading || session.saving) };
  }

  globalThis.ShirohaAiQuestionSessions = Object.freeze({ createPractice, createReview });
})();
