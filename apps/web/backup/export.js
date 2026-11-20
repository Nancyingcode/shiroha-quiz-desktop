// 组织各导出入口的读取范围与输出，并提供跨端备份共用的序列化规则。
(() => {
  'use strict';

  // 将 Web 题型对应到跨端备份使用的原生题型枚举，保留主观题回退。
  function toNativeQuestionType(type) {
    const value = globalThis.ShirohaQuizCore.normalizeWebQuestionType(type);
    if (value === 'multiple') {
      return 'MULTIPLE';
    }

    if (value === 'judge') {
      return 'JUDGE';
    }

    if (value === 'blank') {
      return 'BLANK';
    }

    if (value === 'short') {
      return 'SHORT';
    }

    return 'SINGLE';
  }

  // 构造跨端题目副本，将图片与题干、富文本的导出形式统一。
  function serializeQuestionForCrossExportV53(question) {
    const { exportQuestionImagesForCrossExportV83, buildQuestionRichContentV57 } = globalThis.ShirohaRichContent;
    const out = JSON.parse(JSON.stringify(question || {}));
    const media = exportQuestionImagesForCrossExportV83(out);
    out.type = toNativeQuestionType(out.type || out.questionType || out.kind);
    out.question = media.question;
    // 显式空数组属于原有跨端数据；缺失字段和无效媒体继续按原规则处理。
    if (media.images.length) {
      out.images = media.images;
    } else if (!Array.isArray(out.images) || out.images.length) {
      delete out.images;
    }

    const rich = buildQuestionRichContentV57(out);
    if (rich) {
      out.richContent = rich;
    } else {
      delete out.richContent;
    }

    return out;
  }

  // 序列化题库副本和组名，让跨端导出无需修改当前工作题库。
  function serializeBankForCrossExportV53(bank, normalizeGroup) {
    const out = JSON.parse(JSON.stringify(bank || {}));
    out.groupName = normalizeGroup(out.groupName);
    out.questions = Array.isArray(out.questions) ? out.questions.map(serializeQuestionForCrossExportV53) : [];
    return out;
  }

  // 只导出兼容设置字段，AI 配置的认证信息继续由凭据层持有。
  function exportSettingsV1(settings) {
    const result = {};
    const fields = [
      'suppressDefaultBank', 'practiceScope', 'practiceProgressV58916', 'lastMigratedFromSchema',
      'lastMigratedAt', 'migratedFromStorageKey',
    ];
    for (const key of fields) {
      if (settings?.[key] !== undefined) {
        result[key] = structuredClone(settings[key]);
      }
    }

    if (settings?.aiImportV99) {
      result.aiImportV99 = {};
      for (const key of ['provider', 'endpoint', 'model', 'timeoutSeconds', 'rememberKey']) {
        if (settings.aiImportV99[key] !== undefined) {
          result.aiImportV99[key] = settings.aiImportV99[key];
        }
      }
    }

    return result;
  }

  function cleanFileNameV23(value) {
    return String(value || '')
      .replace(/* 将宿主不接受的文件名分隔符和通配字符替换为下划线。 */ /[\\/:*?"<>|]/g, '_')
      .replace(/* 将连续空白折叠成单个下划线，使导出文件名便于使用。 */ /\s+/g, '_').slice(0, 80) || 'bank';
  }

  // 由应用提供在途读取和共享选择，保存和回滚仍按同一套状态协调。
  function create({
    state,
    activeBank,
    selection,
    serializeBank,
    backupData,
    reads,
    output,
    appVersion,
    schemaVersion,
    now,
  }) {
    const {
      download,
      setPreview,
      copy,
      toast,
      platformStatus,
      warnDev,
    } = output;

    function today() {
      return now().slice(0, 10);
    }

    function reportError(error) {
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      platformStatus('导出失败：' + error.message, true);
      return false;
    }

    // 导出时同时填充文本区，便于用户手动复制生成的内容。
    function downloadJson(name, text) {
      setPreview(text);
      return download(name, new Blob([text], { type: 'application/json;charset=utf-8' }));
    }

    function notifyChangedTarget() {
      toast('导出目标已变化，请重新导出。', 'warn');
    }

    // 只有读取完成的原目标题库仍有效时，才为同一个对象生成文件名和正文。
    async function exportSingleBank(getBank, fallbackName) {
      try {
        const target = getBank();
        const id = target?.id;
        if (!id || !await reads.banks([id])) {
          return;
        }

        const bank = getBank();
        if (bank?.id !== id || bank !== target) {
          notifyChangedTarget();
          return;
        }

        const name = fallbackName ? bank.name || fallbackName : bank.name;
        const text = JSON.stringify(serializeBank(bank), null, 2);
        // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
        await downloadJson(name + '.json', text);
      } catch (error) {
        return reportError(error);
      }
    }

    function exportBankById(id) {
      return exportSingleBank(() => state.banks.find((bank) => bank.id === id), '题库');
    }

    function exportCurrentBank() {
      return exportSingleBank(activeBank);
    }

    function selectedBanks() {
      const ids = selection.get();
      return state.banks.filter((bank) => ids.has(bank.id));
    }

    // 单库与多库分别使用既有导出格式，保留旧导入入口的兼容性。
    function buildQuestionBanksExportPayloadV598(banks) {
      const { RICH_CONTENT_VERSION_V57, buildRichContentCapabilitiesV57 } = globalThis.ShirohaRichContent;
      const exported = (banks || []).map(serializeBank);
      if (exported.length === 1) {
        return exported[0];
      }

      const { activeBankId } = state;
      return {
        app: 'Shiroha Quiz',
        appVersion,
        schemaVersion,
        richContentVersion: RICH_CONTENT_VERSION_V57,
        richContentCapabilities: buildRichContentCapabilitiesV57(exported),
        exportType: 'question_banks',
        exportedAt: now(),
        banks: exported,
        activeBankId: exported.some((bank) => bank.id === activeBankId) ? activeBankId : (exported[0]?.id || ''),
      };
    }

    // 比较有效的库 ID 和已读对象，普通重绘或事务回滚替换 Set 时仍可导出原选择。
    async function exportSelectedBanks() {
      try {
        const banks = selectedBanks();
        if (!banks.length) {
          toast('请至少选择一个题库。', 'warn');
          return;
        }

        const targets = new Map(banks.map((bank) => [bank.id, bank]));
        if (!await reads.banks([...targets.keys()])) {
          return;
        }

        const current = selectedBanks();
        const selectionChanged = current.length !== banks.length || current.some((bank) => targets.get(bank.id) !== bank);
        if (selectionChanged) {
          notifyChangedTarget();
          return;
        }

        const text = JSON.stringify(buildQuestionBanksExportPayloadV598(banks), null, 2);
        const name = banks.length === 1
          ? `shiroha-quiz-bank-${cleanFileNameV23(banks[0].name)}-${today()}.json`
          : `shiroha-quiz-question-banks-${today()}.json`;
        await downloadJson(name, text);
        toast(`已导出 ${banks.length} 个题库 JSON。题库管理页导出的 JSON 只包含题库内容，不包含错题、收藏、记录和设置。`, 'ok');
      } catch (error) {
        return reportError(error);
      }
    }

    // 导出前补齐原生分页记录详情，避免把只读摘要当成完整学习记录。
    async function exportRecords() {
      try {
        if (!await reads.records(state.records.map((record) => record.id))) {
          return;
        }

        await downloadJson('学习记录.json', JSON.stringify(state.records || [], null, 2));
      } catch (error) {
        return reportError(error);
      }
    }

    function fullBackupText() {
      return JSON.stringify(backupData.buildBackupPayloadV23(state, state.banks || [], 'all_data', true), null, 2);
    }

    // 完整读取题库及学习数据后导出 Web 备份，失败时保留数据与设置。
    async function exportAllBackup() {
      try {
        if (!await reads.all()) {
          return;
        }

        await downloadJson(`shiroha-quiz-all-data-${today()}.json`, fullBackupText());
        toast('已生成全部数据备份。手机端若未弹出下载，可复制文本框内容。', 'ok');
      } catch (error) {
        return reportError(error);
      }
    }

    // 完整加载后生成原生兼容 ZIP，确保备份含试题、学习记录和相关资源。
    async function exportNativeCompatibleBackupZip() {
      try {
        if (!await reads.all()) {
          return;
        }
      } catch (error) {
        return reportError(error);
      }

      try {
        const result = backupData.buildNativeCompatibleBackupZipV611(state);
        setPreview(JSON.stringify(result.payload, null, 2));
        await download(`shiroha-quiz-native-backup-${today()}.zip`, result.blob);
        const assets = result.assetCount ? `已外置 ${result.assetCount} 张图片。` : '当前没有需要外置的图片。';
        toast(`已生成含图片备份 ZIP。${assets}`, 'ok');
      } catch (error) {
        warnDev('导出含图片备份 ZIP 失败', error);
        toast('导出含图片备份 ZIP 失败，请先使用完整 JSON 备份。', 'danger');
      }
    }

    // 复制完整备份前载入题库正文，避免导出的桌面备份只有摘要。
    async function copyAllBackupJson() {
      if (!await reads.all()) {
        return;
      }

      const text = fullBackupText();
      setPreview(text);
      await copy(text, '已复制全部数据备份文本。');
    }

    return Object.freeze({
      buildQuestionBanksExportPayloadV598,
      downloadJson,
      exportBankById,
      exportCurrentBank,
      exportSelectedBanks,
      exportRecords,
      exportAllBackup,
      exportNativeCompatibleBackupZip,
      copyAllBackupJson,
    });
  }

  globalThis.ShirohaBackupExport = Object.freeze({
    create,
    cleanFileNameV23,
    exportSettingsV1,
    toNativeQuestionType,
    serializeQuestionForCrossExportV53,
    serializeBankForCrossExportV53,
  });
})();
