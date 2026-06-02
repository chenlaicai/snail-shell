/** Stage 目标选择器：多转移目标时展示下拉菜单替代 window.prompt()。 */

/** 销毁已有的 stage 选择器。 */
export function dismissStageSelector() {
  const existing = document.querySelector(".stage-selector-dropdown");
  if (existing) existing.remove();
}

/**
 * 弹出 stage 目标选择器：多个可用目标时展示下拉菜单，点击即选。
 * 单目标或无目标由调用方直接处理，不经过此函数。
 *
 * 为什么按需获取 stage_definitions：避免在全局 state 中长期存储仅选择器使用的数据。
 * SOP 数据通过 loadSopTransitions 已有缓存层，此请求在选择器生命周期内仅发生一次。
 *
 * @param {Array} available - 可用转移列表（含 to_stage_key）
 * @param {string} sopId - 当前 Issue 采纳的 SOP ID
 * @param {function} apiFn - API 请求函数
 * @param {function} escapeHtml
 * @param {function} onSelect - 选中回调，参数为 stage key
 */
export async function showStageSelector(available, sopId, apiFn, escapeHtml, onSelect) {
  dismissStageSelector();
  const anchor = document.querySelector(".stage-action-row");
  if (!anchor) return;

  let titleMap = {};
  try {
    const sop = await apiFn("GET", `/sops/${sopId}`);
    for (const def of sop?.stage_definitions ?? []) titleMap[def.key] = def.title;
  } catch { /* 获取失败时回退到原始 key */ }

  const dropdown = document.createElement("div");
  dropdown.className = "stage-selector-dropdown";
  dropdown.innerHTML = available
    .map((t) => {
      const title = titleMap[t.to_stage_key] ?? t.to_stage_key;
      return `<div class="stage-selector-option" data-target="${escapeHtml(t.to_stage_key)}">${escapeHtml(title)}</div>`;
    })
    .join("");
  anchor.style.position = "relative";
  anchor.appendChild(dropdown);
  dropdown.addEventListener("click", (e) => {
    const option = e.target.closest(".stage-selector-option");
    if (!option) return;
    onSelect(option.dataset.target);
    dismissStageSelector();
  });
  const onDocClick = (e) => {
    if (!dropdown.contains(e.target)) { dismissStageSelector(); document.removeEventListener("click", onDocClick); }
  };
  setTimeout(() => document.addEventListener("click", onDocClick), 0);
}
