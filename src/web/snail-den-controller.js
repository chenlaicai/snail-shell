import { renderSnailDen } from "./snail-den-view.js";

/**
 * Snail Den 控制器：管理 snail template 池的状态、渲染和顶层状态文本。
 * 从 app.js 中提取，保持 app.js 行数在限制内。
 */
export function createSnailDenController({ api, showNotice }) {
  let templates = [];

  async function load() {
    try {
      templates = await api("GET", "/snail-den");
      return templates;
    } catch (err) {
      showNotice(`加载 Snail Den 失败：${err.message}`, true);
      return [];
    }
  }

  function render(container) {
    if (!container) return;
    renderSnailDen(container, templates);
  }

  function topStateText() {
    return "Snail Den";
  }

  return { load, render, topStateText };
}
