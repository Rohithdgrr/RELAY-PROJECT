// Relay provider bridge — v0.1.
//
// Security posture (Complete Docs §8.1 / §8.5): provider pages are remote
// third-party sites with NO Tauri IPC — this framework version grants remote
// pages no window.__TAURI__ and no capability, so a compromised provider page
// cannot invoke commands or read app state. This script only reads the DOM.
//
// Injection (PRD §6.2): on an *assisted* handoff the host bakes
// window.__RELAY_INJECT__ = { provider, prompt } into this script before the
// webview is created. The script waits for the provider's input field, fills
// it, and copies the prompt to the clipboard as a fallback. The user reviews
// and presses Enter — Relay never sends a message automatically.
(() => {
  if (window.__RELAY_BRIDGE__) return;

  const INJECT = window.__RELAY_INJECT__ || null;

  // Provider input selectors (PRD appendix A — volatile, community
  // maintained). If none matches we fall back to the clipboard.
  const SELECTORS = {
    chatgpt: "#prompt-textarea",
    kimi: "textarea[placeholder*='输入']",
    qwen: "#chat-input",
    gemini: "div.ql-editor[contenteditable='true'], textarea[placeholder]",
  };

  const banner = (text, isError) => {
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "2147483647",
      background: isError ? "#EF4444" : "#22C55E",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "8px",
      font: "13px system-ui, sans-serif",
      boxShadow: "0 6px 20px rgba(0,0,0,.4)",
      maxWidth: "340px",
    });
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 12000);
  };

  if (INJECT && INJECT.prompt) {
    const sel = SELECTORS[INJECT.provider] || "textarea, [contenteditable='true']";
    const copy = () => {
      try {
        navigator.clipboard && navigator.clipboard.writeText(INJECT.prompt);
      } catch (_) {
        /* clipboard unavailable */
      }
    };

    const tryFill = () => {
      const input = document.querySelector(sel);
      if (!input) return false;
      const proto =
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLDivElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      const setter = desc && desc.set;
      if (setter) setter.call(input, INJECT.prompt);
      else input.value = INJECT.prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      copy();
      banner("Relay context loaded — review, then press Enter to send", false);
      return true;
    };

    const started = Date.now();
    const wait = () => {
      if (tryFill()) return;
      if (Date.now() - started < 20000) {
        setTimeout(wait, 400);
      } else {
        copy();
        banner("Could not find the input field — context copied, paste with Ctrl+V", true);
      }
    };
    setTimeout(wait, 500);
  }

  window.__RELAY_BRIDGE__ = {
    provider: INJECT ? INJECT.provider : null,
    assisted: true, // never auto-sends; user reviews before submitting
  };
})();
