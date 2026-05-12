// ==UserScript==
// @name         年代售票 鍵盤快捷鍵覆蓋層 (Flowra)
// @namespace    flowra-ticket-keyboard
// @version      0.1.0
// @description  把幾個固定的下單按鈕對應到鍵盤上。一次按鍵 = 一次點擊。不會自動推進、不會繞過驗證碼、不會替你選區/選位/選票別。
// @match        https://ticket.com.tw/application/UTK02/*
// @match        https://ticket.com.tw/application/UTK01/*
// @run-at       document-end
// @grant        none
// ==/UserScript==
//
// 安裝方式：
// 1. 在 Chrome / Edge / Firefox 安裝 Tampermonkey 擴充套件
// 2. 點 Tampermonkey 圖示 → 建立新指令碼 → 把整份檔案內容貼上 → Ctrl+S
// 3. 開啟 https://ticket.com.tw/application/UTK02/... 應該能看到右上角面板
//
// 設計原則（請勿改成自動推進的版本）：
// - 一次按鍵只觸發一次 click()，按住按鍵也不會連點（KeyboardEvent.repeat 過濾）
// - 不使用 setInterval / MutationObserver 主動偵測按鈕出現後自動點擊
// - 不對驗證碼、選區、選位、選票別這些「你必須親自決定」的步驟提供快捷鍵
// - 在 input/textarea 內按鍵時自動停用，避免打驗證碼或備註時誤觸

(function () {
  "use strict";

  let enabled = true;

  // 鍵 → 按鈕文字（regex）。腳本會在當下可見、未 disabled 的元素裡找第一個符合的，呼叫 .click() 一次。
  const BINDINGS = [
    { key: "1", label: "立即訂購", match: /立即訂購/ },
    { key: "2", label: "加入購物車", match: /加入購物車/ },
    { key: "3", label: "同意條款（勾選）", match: /已詳閱.*同意|同意.*條款|我同意/ },
    { key: "4", label: "核對無誤，下一步", match: /核對.*下一步|下一步/ },
    { key: "5", label: "核對無誤，結帳", match: /核對.*結帳|確認.*結帳/ },
  ];

  function findClickable(re) {
    const nodes = document.querySelectorAll(
      'input[type="submit"], input[type="button"], input[type="image"], input[type="checkbox"], button, a',
    );
    for (const el of nodes) {
      if (el.disabled) continue;
      const text = (el.value || el.alt || el.innerText || el.textContent || "").trim();
      if (!text || !re.test(text)) continue;
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
      if (visible) return el;
    }
    return null;
  }

  function flash(msg, ok = true) {
    const div = document.createElement("div");
    div.textContent = msg;
    div.style.cssText = `
      position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
      padding: 8px 14px; border-radius: 6px;
      font: 14px/1.4 system-ui, -apple-system, "Microsoft JhengHei", sans-serif;
      color: #fff; background: ${ok ? "#16a34a" : "#dc2626"};
      box-shadow: 0 2px 8px rgba(0,0,0,.2);
      pointer-events: none; opacity: 0; transition: opacity .15s;
    `;
    document.body.appendChild(div);
    requestAnimationFrame(() => (div.style.opacity = "1"));
    setTimeout(() => {
      div.style.opacity = "0";
      setTimeout(() => div.remove(), 200);
    }, 900);
  }

  function buildPanel() {
    if (document.getElementById("flowra-ticket-helper-panel")) return;
    const panel = document.createElement("div");
    panel.id = "flowra-ticket-helper-panel";
    panel.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 2147483647;
      background: rgba(15, 23, 42, 0.94); color: #f1f5f9;
      padding: 10px 14px; border-radius: 8px;
      font: 13px/1.5 system-ui, -apple-system, "Microsoft JhengHei", sans-serif;
      min-width: 200px; user-select: none;
      box-shadow: 0 4px 12px rgba(0,0,0,.3);
    `;
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span>年代搶票快捷鍵</span>
        <span id="flowra-toggle" style="font-size:11px;padding:2px 8px;border-radius:4px;background:#16a34a;cursor:pointer;">ON</span>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">一次按鍵 = 一次點擊（不自動推進）</div>
      <div id="flowra-binding-list"></div>
      <div style="font-size:11px;color:#64748b;margin-top:8px;border-top:1px solid #1e293b;padding-top:6px;">
        按 <kbd style="background:#1e293b;border:1px solid #334155;padding:0 4px;border-radius:3px;font-family:monospace;">\`</kbd> 切換開關<br/>
        在輸入框中時自動停用
      </div>
    `;
    document.body.appendChild(panel);
    const list = panel.querySelector("#flowra-binding-list");
    BINDINGS.forEach((b) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;margin:3px 0;";
      row.innerHTML = `
        <kbd style="background:#1e293b;border:1px solid #334155;padding:1px 8px;border-radius:3px;font-family:monospace;min-width:18px;text-align:center;">${b.key}</kbd>
        <span>${b.label}</span>
      `;
      list.appendChild(row);
    });
    panel.querySelector("#flowra-toggle").addEventListener("click", toggle);
  }

  function toggle() {
    enabled = !enabled;
    const t = document.querySelector("#flowra-toggle");
    if (t) {
      t.textContent = enabled ? "ON" : "OFF";
      t.style.background = enabled ? "#16a34a" : "#64748b";
    }
    flash(enabled ? "快捷鍵已開啟" : "快捷鍵已關閉", enabled);
  }

  function onKey(e) {
    // 過濾長按連發 —— 強制每次點擊都需要重新按下
    if (e.repeat) return;

    // 在輸入框內不啟動（驗證碼必須親自輸入）
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable)
      return;

    // 修飾鍵組合不處理
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "`") {
      e.preventDefault();
      toggle();
      return;
    }
    if (!enabled) return;

    const binding = BINDINGS.find((b) => b.key === e.key);
    if (!binding) return;

    e.preventDefault();
    const el = findClickable(binding.match);
    if (!el) {
      flash(`找不到「${binding.label}」按鈕`, false);
      return;
    }
    el.click();
    flash(`已點擊：${binding.label}`);
  }

  buildPanel();
  document.addEventListener("keydown", onKey, true);
})();
