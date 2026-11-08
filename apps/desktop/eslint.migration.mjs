// 仅暂缓实际未清零的文件/格式规则；P3—P5 清零后逐项移除，新路径默认完整检查。
/** @type {Record<string, string[]>} */
export const styleDebt = {};
export const legacyStyleFiles = Object.keys(styleDebt);

// 历史文件从门禁外迁入时单独报告语义债务，清零后从此清单移除。
// 原门禁外文件清单已清空，相关手写脚本均已纳入正式门禁。
// 仅尚未清零的文件/规则暂缓强制；其余语义规则保持 error，报告不以数量抵扣。
/** @type {Record<string, string[]>} */
export const semanticDebt = {};
