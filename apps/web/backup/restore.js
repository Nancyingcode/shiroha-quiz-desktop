// 统一应用已校验的备份，文件和云端面板各自控制确认与结果反馈。
(() => {
  'use strict';

  // 在导入和未就绪修复间共享附件解析，显示预览由各自入口决定。
  async function readBackupContents(file, archive, setPreview) {
    const { text, assets = {} } = await archive.read(file);
    setPreview?.(text);
    const data = JSON.parse(text);
    if (Object.keys(assets).length) {
      archive.applyAssets(data, assets);
    }

    return { data, unresolvedImageCount: archive.countUnresolvedImages(data) };
  }

  // 套用已有备份格式的回退字段，兼容不含 Web 设置的旧 Android 文件。
  function replacementFields(normalized, settings, schemaVersion, normalizeGroup) {
    const banks = normalized.banks.map((bank) => ({ ...bank, groupName: normalizeGroup(bank.groupName) }));
    const hasWebSettings = normalized.hasWebSettings && normalized.settings && typeof normalized.settings === 'object';
    const hasCrossPlatformMeta = normalized.crossPlatformMeta && typeof normalized.crossPlatformMeta === 'object';
    return {
      schemaVersion,
      banks,
      activeBankId: normalized.activeBankId || banks[0]?.id || '',
      wrongBook: normalized.wrongBook || {},
      favorites: normalized.favorites || {},
      records: Array.isArray(normalized.records) ? normalized.records : [],
      settings: hasWebSettings ? normalized.settings : settings,
      crossPlatformMeta: hasCrossPlatformMeta ? normalized.crossPlatformMeta : { favoriteQuestions: {} },
    };
  }

  // 装配时只持有目前的应用状态，设置页和文件选择控件在启动后挂载。
  function create({
    state,
    schemaVersion,
    platform,
    archive,
    data,
    storage,
    view,
  }) {
    const {
      normalize,
      merge,
      normalizeGroup,
      upgrade,
      ensureDefaultBank,
    } = data;
    const {
      transaction,
      loadAll,
      save,
      saveFailed,
    } = storage;
    const {
      select,
      confirm,
      setPreview,
      refresh,
      toast,
    } = view;
    // 两个文件选择入口共享模式，重试使用失败时选定的文件和模式。
    let fileImportMode = 'merge';

    // 覆盖前保留可用检查点，原生凭据撤销及 Harness 重新验证独立于数据回滚。
    async function prepareOverwrite() {
      if (!await loadAll()) {
        throw new Error('恢复前读取失败，原数据已保留。');
      }

      await platform.storage.checkpoint?.();
      await platform.harness?.cancelAll();
      if (platform.credentials.native) {
        await platform.credentials.reset();
      }
    }

    // 调用方须已进入共享事务，确保替换、升级和保存失败时一起回滚。
    async function applyNormalized(normalized, mode) {
      if (mode === 'overwrite') {
        await prepareOverwrite();
        const settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
        Object.assign(state, replacementFields(normalized, settings, schemaVersion, normalizeGroup));
      } else {
        merge(normalized);
      }

      upgrade();
      ensureDefaultBank();
      await save();
    }

    function assertAvailableImages(unresolvedImageCount) {
      if (unresolvedImageCount && platform.storage.checkpoint) {
        throw new Error('备份缺少图片，尚未更改本地数据。请补齐原始图片后重试。');
      }
    }

    // 本地文件与导入页共用应用和成功反馈，只有本地覆盖需要再次确认。
    async function applyLocalBackup(normalized, mode, unresolvedImageCount = 0) {
      assertAvailableImages(unresolvedImageCount);
      if (!normalized.banks.length) {
        toast('没有在 JSON 中找到可导入的题库。', 'warn');
        return false;
      }

      if (mode === 'overwrite') {
        const accepted = await confirm(`覆盖恢复会清空当前本地数据，并导入 ${normalized.banks.length} 个题库。确定继续？`);
        if (!accepted) {
          return false;
        }
      }

      try {
        await applyNormalized(normalized, mode);
      } catch (error) {
        if (!platform.credentials.native && saveFailed()) {
          throw new Error('导入内容超过浏览器本地存储容量，已恢复导入前数据。可减少图片后重试，或只导入部分题库。', { cause: error });
        }

        throw error;
      }

      refresh();
      const total = normalized.banks.reduce((count, bank) => count + (bank.questions || []).length, 0);
      const missing = unresolvedImageCount
        ? ` 另有 ${unresolvedImageCount} 张图片未包含在备份文件中，Web 端无法显示。`
        : '';
      toast(`导入完成：${normalized.banks.length} 个题库，${total} 道题。${missing}`, unresolvedImageCount ? 'warn' : 'ok');
      return true;
    }

    // WebDAV 已由面板确认恢复，不再弹本地覆盖确认。
    function applyWebdavBackup(normalized, mode, retry) {
      return transaction(/* 保存失败由应用回滚，面板保留待恢复项。 */ async () => {
        try {
          await applyNormalized(normalized, mode);
        } catch (error) {
          if (!platform.credentials.native && saveFailed()) {
            throw new Error('恢复内容未能写入浏览器本地存储，已回滚到恢复前数据。请检查本地存储空间，或减少备份中的大图片。', { cause: error });
          }

          throw error;
        }
      }, retry);
    }

    function reportFileError(error) {
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      toast('导入备份失败：' + error.message, 'danger');
    }

    // 无效文件仍保留原始预览，清空选择后可重新选择同一文件。
    async function parseLocalFile(input, file) {
      try {
        const { data: payload, unresolvedImageCount } = await readBackupContents(file, archive, setPreview);
        const normalized = normalize(payload, file.name);
        assertAvailableImages(unresolvedImageCount);
        return { normalized, unresolvedImageCount };
      } catch (error) {
        reportFileError(error);
        input.value = '';
        return null;
      }
    }

    // 文件读完才应用备份，保存失败时保留该文件供原事务重试。
    async function restoreFile(input, file, mode) {
      const prepared = await parseLocalFile(input, file);
      if (!prepared) {
        return false;
      }

      const { normalized, unresolvedImageCount } = prepared;
      try {
        const restored = await applyLocalBackup(normalized, mode, unresolvedImageCount);
        input.value = '';
        return restored;
      } catch (error) {
        reportFileError(error);
        throw error;
      }
    }

    // 只允许重试原文件和页面的恢复意图，避免把新选择当作之前已确认的备份。
    function onFileSelected(event) {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) {
        return;
      }

      const mode = fileImportMode;
      const modeInput = select('#settings-backup-mode-v23');
      const selectedMode = modeInput?.value;
      const page = select('.view.active');
      // 文件控件在应用之外，点击全局重试时仍须核验原文件与当前页。
      const retry = () => {
        const sameFile = input.isConnected && input.files?.[0] === file;
        const samePage = select('.view.active') === page;
        const sameMode = fileImportMode === mode && modeInput?.value === selectedMode;
        if (!sameFile || !samePage || !sameMode) {
          toast('恢复来源或方式已变化，请重新选择备份。', 'warn');
          return false;
        }

        return run();
      };

      const run = () => transaction(() => restoreFile(input, file, mode), retry);

      return run();
    }

    function chooseFile() {
      fileImportMode = select('#settings-backup-mode-v23')?.value || 'overwrite';
      select('#backup-json-file-v23')?.click();
    }

    // 两处备份选择共用一个隐藏控件，启动重入时复用原有监听。
    function mountFileInput() {
      if (select('#backup-json-file-v23')) {
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'backup-json-file-v23';
      input.accept = '.json,.zip,application/json,application/zip';
      input.style.display = 'none';
      input.onchange = onFileSelected;
      document.body.appendChild(input);
    }

    // 挂载设置页备份工具，导出和 WebDAV 动作仍由各自业务模块处理。
    function mountSettings({ exportZip, copyBackup, mountWebdav }) {
      mountFileInput();
      const quick = select('#import-backup-quick-btn-v598');
      if (quick && quick.onclick !== chooseFile) {
        quick.onclick = chooseFile;
      }

      const settingsCard = select('#settings .card');
      if (!settingsCard || select('#settings-backup-panel-v23')) {
        return;
      }

      settingsCard.insertAdjacentHTML('beforeend', `<div id="settings-backup-panel-v23" class="data-tools-v23">
    <h2>备份与恢复</h2>
    <p class="muted">设置页只处理完整数据备份：包含题库、错题本、收藏夹、练习记录和设置。单个题库或选中题库 JSON 请到“题库管理”页导出。</p>
    <div class="form-grid">
      <label>恢复方式<select id="settings-backup-mode-v23"><option value="merge">合并导入：保留当前数据，新增备份中的题库</option><option value="overwrite" selected>覆盖恢复：用备份替换当前本地数据</option></select></label>
      <label>备份范围<input disabled value="全部题库、错题本、收藏夹、记录、设置" /></label>
    </div>
    <div class="actions wrap-v23">
      <button class="ghost" id="settings-export-native-backup-v611" type="button">导出含图片备份 ZIP</button>
      <button class="ghost" id="settings-import-backup-v23" type="button">导入备份 JSON/ZIP</button>
      <button class="ghost" id="settings-copy-all-backup-v23" type="button">复制 Web 备份文本</button>
    </div>
    <p class="muted">提示：顶部“导出 Web 完整备份”用于 Web 端完整恢复；“含图片备份 ZIP”保存题库、图片及现有可交换学习数据，兼容旧版备份格式，不包含所有平台专属设置；复制文本只作为浏览器下载失败时的兜底。覆盖恢复会替换本机数据；合并导入遇到同名题库会自动追加“_导入”。</p>
    <details class="asset-reference-details"><summary>角色基准素材预览</summary><img src="./media/mascot_character_sheet.webp" alt="角色基准素材" /></details>
  </div>`);
      select('#settings-export-native-backup-v611').onclick = exportZip;
      select('#settings-copy-all-backup-v23').onclick = copyBackup;
      select('#settings-import-backup-v23').onclick = chooseFile;
      mountWebdav(settingsCard);
    }

    // 配置保存须关联已暂存凭据，只有持久化成功才可确认新绑定。
    async function persistDavConfiguration(stage, change, config) {
      const { credentials } = platform;
      if (!credentials.native) {
        await stage();
        return true;
      }

      let failure;
      const applied = await transaction(/* 配置重试从按钮重新暂存凭据，避免复用已撤销的操作。 */ async () => {
        try {
          const undo = await stage();
          state.serviceConfigurations = { ...state.serviceConfigurations };
          change(state.serviceConfigurations);
          try {
            await save(undo ? credentials.operationId?.(undo) : undefined);
          } catch (error) {
            await undo?.();
            throw error;
          }

          if (undo) {
            try {
              await credentials.finalize(undo);
            } catch (error) {
              throw new Error('配置数据已写入，凭据确认未完成。请重新打开应用核对凭据状态。', { cause: error });
            }
          }

          credentials.updateDav(config);
        } catch (error) {
          failure = error;
          throw error;
        }
      }, null);
      if (failure) {
        throw failure;
      }

      return applied;
    }

    // 配置中只写公开字段，上传记录更新不另行暂存密码。
    function storeWebdavConfig(defaultConfig, config, password, storePassword = true) {
      const safe = { ...defaultConfig, ...config };
      delete safe.password;
      delete safe.authorization;
      return persistDavConfiguration(
        () => platform.credentials.saveDav(safe, password, storePassword),
        (configs) => {
          configs.webdav = safe;
        },
        safe,
      );
    }

    // 清除 WebDAV 配置时，先暂存撤销，配置写入成功后才提交凭据变更。
    function clearWebdavConfig() {
      return persistDavConfiguration(
        () => platform.credentials.clearDav(),
        (configs) => {
          delete configs.webdav;
        },
        null,
      );
    }

    return Object.freeze({
      mountSettings,
      applyLocalBackup,
      applyWebdavBackup,
      storeWebdavConfig,
      clearWebdavConfig,
      readBackupContents: (file) => readBackupContents(file, archive),
    });
  }

  globalThis.ShirohaBackupRestore = Object.freeze({ create });
})();
