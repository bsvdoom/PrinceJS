"use strict";

(function () {
  function getNamespace() {
    if (typeof PrinceJS !== "undefined") {
      return PrinceJS;
    }
    if (typeof globalThis !== "undefined" && globalThis.PrinceJS) {
      return globalThis.PrinceJS;
    }
    return {};
  }

  const Display = {
    _shortcutsBound: false,

    computeIntegerSize: function (viewportW, viewportH, dpr = 1, baseW = 640, baseH = 400) {
      const safeDpr = dpr > 0 ? dpr : 1;
      const factor = Math.floor(Math.min((viewportW * safeDpr) / baseW, (viewportH * safeDpr) / baseH));
      if (factor < 1) {
        return {
          mode: "fit",
          factor: 0,
          widthPx: null,
          heightPx: null
        };
      }
      return {
        mode: "integer",
        factor: factor,
        widthPx: (baseW * factor) / safeDpr,
        heightPx: (baseH * factor) / safeDpr
      };
    },

    apply: function (container, overlay) {
      const ns = getNamespace();
      const targetContainer = container || (ns.Utils && ns.Utils.gameContainer && ns.Utils.gameContainer());
      const targetOverlay = overlay || (typeof document !== "undefined" && document.getElementById("crtOverlay"));

      if (targetOverlay && targetOverlay.classList) {
        targetOverlay.classList.toggle("active", Boolean(ns.crtEnabled));
      }

      if (!targetContainer || !targetContainer.style) {
        return;
      }

      if (ns.screenWidth > 0) {
        targetContainer.style.maxWidth = ns.screenWidth + "px";
        targetContainer.style.width = "";
        targetContainer.style.height = "";
        return;
      }

      targetContainer.style.maxWidth = "";

      if (ns.scaleMode === "fit") {
        targetContainer.style.width = "";
        targetContainer.style.height = "";
        return;
      }

      const vw = typeof window !== "undefined" ? window.innerWidth : 640;
      const vh = typeof window !== "undefined" ? window.innerHeight : 400;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const baseW = ns.WORLD_WIDTH || 640;
      const baseH = ns.WORLD_HEIGHT || 400;
      const sizing = Display.computeIntegerSize(vw, vh, dpr, baseW, baseH);

      if (sizing.mode === "integer") {
        targetContainer.style.width = sizing.widthPx + "px";
        targetContainer.style.height = sizing.heightPx + "px";
      } else {
        targetContainer.style.width = "";
        targetContainer.style.height = "";
      }
    },

    toggleScale: function () {
      const ns = getNamespace();
      ns.scaleMode = ns.scaleMode === "integer" ? "fit" : "integer";
      Display.apply();
      if (ns.Utils && ns.Utils.updateQuery) {
        ns.Utils.updateQuery();
      }
    },

    toggleCrt: function () {
      const ns = getNamespace();
      ns.crtEnabled = !ns.crtEnabled;
      Display.apply();
      if (ns.Utils && ns.Utils.updateQuery) {
        ns.Utils.updateQuery();
      }
    },

    bindShortcuts: function () {
      if (Display._shortcutsBound || typeof window === "undefined") {
        return;
      }
      Display._shortcutsBound = true;

      window.addEventListener(
        "keydown",
        function (event) {
          if (event.key === "F8") {
            event.preventDefault();
            event.stopImmediatePropagation();
            Display.toggleScale();
          } else if (event.key === "F9") {
            event.preventDefault();
            event.stopImmediatePropagation();
            Display.toggleCrt();
          }
        },
        true
      );

      window.addEventListener("resize", function () {
        Display.apply();
      });
    }
  };

  if (typeof PrinceJS !== "undefined") {
    PrinceJS.Display = Display;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Display;
  }
})();
