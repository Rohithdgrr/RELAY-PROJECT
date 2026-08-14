// Relay provider bridge — v0.1 stub.
//
// Production wiring (typed `relay:*` IPC events, provider-specific selectors
// from the community registry) is the Phase 1 platform spike — see PRD §8.3
// and Complete Docs §7.1. Preload injection into *remote* pages differs per
// webview (WKWebView, WebView2, WebKitGTK), which is why this is spiked before
// being wired.
//
// Security posture (Complete Docs §8.1 / §8.5): this script only *observes*
// the page and fires CustomEvents. It never sends messages, never evades bot
// detection, and the provider window has no Tauri capability — a compromised
// provider page cannot reach IPC.
(() => {
  if (window.__RELAY_BRIDGE__) return;

  const bridge = {
    provider: null, // set by the host in later phases

    // Assisted-only handoff request — surfaced to the user, never auto-fired.
    requestHandoff(reason) {
      window.dispatchEvent(
        new CustomEvent("relay:handoff-request", { detail: { reason } })
      );
    },

    // Passive observation of rate-limit / error indicators.
    observe() {
      const HINTS = [
        "You've reached your limit",
        "Too many requests",
        "请求过于频繁",
        "请求太频繁",
        "请稍后再试",
      ];
      const probe = () => {
        const text = document.body ? document.body.innerText : "";
        const hit = HINTS.find((h) => text.includes(h));
        if (hit) {
          window.dispatchEvent(
            new CustomEvent("relay:signal-detected", { detail: { hint: hit } })
          );
        }
      };
      const observer = new MutationObserver(probe);
      observer.observe(document.body, { childList: true, subtree: true });
      probe();
    },
  };

  window.__RELAY_BRIDGE__ = bridge;
  bridge.observe();
})();
