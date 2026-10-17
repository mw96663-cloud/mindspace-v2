
/* =====================================================
   MINDSPACE V2 — TOOL BASKET
   右側工具收納籃

   功能：
   1. 將原本的工具欄收納到右側
   2. 點擊 🧺 展開工具
   3. 點擊 ✕ 收起工具
   4. 支援全螢幕
   5. 不修改原本按鈕的功能
===================================================== */

(function () {
  "use strict";

  function initToolBasket() {

    /* ===== 尋找原本網頁元素 ===== */

    const app =
      document.getElementById("app");

    const sidebar =
      document.getElementById("sidebar");

    if (!sidebar) {
      console.warn(
        "Mindspace：找不到 #sidebar，無法建立收納籃"
      );
      return;
    }

    if (
      document.getElementById(
        "toolBasketToggle"
      )
    ) {
      return;
    }

    /* ===== 注入 CSS ===== */

    const style =
      document.createElement("style");

    style.id = "toolBasketStyle";

    style.textContent = `

      /* ===== 右側工具欄 ===== */

      #sidebar {
        position: fixed !important;

        top: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        left: auto !important;

        width: min(360px, 88vw) !important;
        max-width: 88vw !important;
        height: 100dvh !important;

        box-sizing: border-box !important;

        overflow-x: hidden !important;
        overflow-y: auto !important;

        padding: 20px 16px 35px !important;

        background: rgba(
          255, 250, 255, 0.97
        ) !important;

        backdrop-filter: blur(18px);

        border-left:
          2px solid rgba(
            230, 210, 240, 0.9
          );

        box-shadow:
          -8px 0 30px
          rgba(60, 40, 90, 0.15);

        z-index: 9998 !important;

        transform:
          translateX(105%) !important;

        visibility: hidden !important;
        pointer-events: none !important;

        transition:
          transform 0.3s ease,
          visibility 0.3s ease !important;
      }

      /* ===== 展開狀態 ===== */

      body.mindspace-basket-open #sidebar {
        transform:
          translateX(0) !important;

        visibility: visible !important;
        pointer-events: auto !important;
      }

      /* ===== 收納籃按鈕 ===== */

      #toolBasketToggle {
        position: fixed !important;

        top: 78px !important;
        right: 14px !important;

        width: 56px !important;
        height: 56px !important;

        min-width: 56px !important;

        display: flex !important;
        align-items: center !important;
        justify-content: center !important;

        padding: 0 !important;

        border: 2px solid white !important;
        border-radius: 18px !important;

        background: #ffe1ed !important;
        color: #57456a !important;

        box-shadow:
          0 5px 18px
          rgba(55, 35, 85, 0.22);

        font-size: 27px !important;

        line-height: 1 !important;

        cursor: pointer !important;

        z-index: 9999 !important;

        transition:
          right 0.3s ease,
          transform 0.2s ease,
          background 0.2s ease !important;
      }

      #toolBasketToggle:hover {
        transform: scale(1.07);
        background: #f5d2e7 !important;
      }

      /* 展開後按鈕移到側欄左邊 */

      body.mindspace-basket-open
      #toolBasketToggle {
        right:
          min(374px, calc(88vw + 14px))
          !important;

        background: #e9ddff !important;
      }

      /* ===== 背景遮罩 ===== */

      #toolBasketOverlay {
        position: fixed !important;

        inset: 0 !important;

        background:
          rgba(25, 20, 40, 0.15);

        backdrop-filter: blur(2px);

        z-index: 9997 !important;

        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;

        transition:
          opacity 0.3s ease,
          visibility 0.3s ease !important;
      }

      body.mindspace-basket-open
      #toolBasketOverlay {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }

      /* ===== 不讓原本側欄佔用主畫面 ===== */

      #app {
        min-width: 0 !important;
      }

      #world {
        min-width: 0 !important;
      }

      /* ===== 小螢幕 ===== */

      @media (max-width: 600px) {

        #sidebar {
          width: 88vw !important;
          max-width: 88vw !important;
        }

        #toolBasketToggle {
          top: 72px !important;
          right: 10px !important;

          width: 50px !important;
          height: 50px !important;

          min-width: 50px !important;

          font-size: 24px !important;
        }

        body.mindspace-basket-open
        #toolBasketToggle {
          right:
            calc(88vw + 5px)
            !important;

          width: 38px !important;
          height: 38px !important;
          min-width: 38px !important;

          font-size: 20px !important;
        }
      }

      /* ===== 減少動畫模式 ===== */

      @media (
        prefers-reduced-motion: reduce
      ) {

        #sidebar,
        #toolBasketToggle,
        #toolBasketOverlay {
          transition: none !important;
        }
      }

    `;

    document.head.appendChild(style);

    /* ===== 建立背景遮罩 ===== */

    const overlay =
      document.createElement("div");

    overlay.id = "toolBasketOverlay";

    overlay.setAttribute(
      "aria-hidden",
      "true"
    );

    /* ===== 建立工具收納籃按鈕 ===== */

    const toggle =
      document.createElement("button");

    toggle.id = "toolBasketToggle";

    toggle.type = "button";

    toggle.textContent = "🧺";

    toggle.title = "展開工具收納籃";

    toggle.setAttribute(
      "aria-label",
      "展開工具收納籃"
    );

    toggle.setAttribute(
      "aria-controls",
      "sidebar"
    );

    toggle.setAttribute(
      "aria-expanded",
      "false"
    );

    /* ===== 展開與收起 ===== */

    function setOpen(open) {

      document.body.classList.toggle(
        "mindspace-basket-open",
        open
      );

      toggle.textContent =
        open ? "✕" : "🧺";

      toggle.title =
        open
          ? "收起工具收納籃"
          : "展開工具收納籃";

      toggle.setAttribute(
        "aria-label",
        toggle.title
      );

      toggle.setAttribute(
        "aria-expanded",
        String(open)
      );

      sidebar.setAttribute(
        "aria-hidden",
        String(!open)
      );

      if ("inert" in sidebar) {
        sidebar.inert = !open;
      }

      if (
        !open &&
        sidebar.contains(
          document.activeElement
        )
      ) {
        toggle.focus();
      }
    }

    /* ===== 點擊收納籃 ===== */

    toggle.addEventListener(
      "click",
      function () {

        const open =
          document.body.classList.contains(
            "mindspace-basket-open"
          );

        setOpen(!open);
      }
    );

    /* ===== 點擊背景收起 ===== */

    overlay.addEventListener(
      "click",
      function () {
        setOpen(false);
      }
    );

    /* ===== ESC 收起 ===== */

    document.addEventListener(
      "keydown",
      function (event) {

        if (
          event.key === "Escape" &&
          document.body.classList.contains(
            "mindspace-basket-open"
          )
        ) {
          setOpen(false);
        }
      }
    );

    /* ===== 放置元素 ===== */

    // 全螢幕時，按鈕和側欄必須在
    // 進入全螢幕的元素內，才會顯示。
    // 只移動原本的側欄，不複製內容，
    // 因此保留原本按鈕的事件。

    const fullscreenRoot =
      app || document.body;

    if (
      sidebar.parentElement !==
      fullscreenRoot
    ) {
      fullscreenRoot.appendChild(
        sidebar
      );
    }

    fullscreenRoot.appendChild(
      overlay
    );

    fullscreenRoot.appendChild(
      toggle
    );

    /* ===== 全螢幕定位 ===== */

    function syncFullscreen() {

      const root =
        document.fullscreenElement;

      if (
        root &&
        !root.contains(toggle)
      ) {
        root.appendChild(overlay);
        root.appendChild(toggle);
        root.appendChild(sidebar);
      }

      if (
        !root &&
        toggle.parentElement !==
        fullscreenRoot
      ) {
        fullscreenRoot.appendChild(
          overlay
        );

        fullscreenRoot.appendChild(
          sidebar
        );

        fullscreenRoot.appendChild(
          toggle
        );
      }
    }

    document.addEventListener(
      "fullscreenchange",
      syncFullscreen
    );

    /* ===== 預設收起 ===== */

    setOpen(false);

    console.log(
      "🧺 Mindspace 右側工具收納籃已啟用"
    );
  }

  /* ===== 等待網頁載入 ===== */

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      initToolBasket,
      { once: true }
    );

  } else {

    initToolBasket();

  }

})();
