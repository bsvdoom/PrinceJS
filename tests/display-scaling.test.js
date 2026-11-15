"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const Display = require(path.resolve(__dirname, "../src/Display.js"));

test("computeIntegerSize calculates exact physical integer multiples for 1080p", () => {
  const result = Display.computeIntegerSize(1920, 1080, 1);
  assert.deepEqual(result, {
    mode: "integer",
    factor: 2,
    widthPx: 1280,
    heightPx: 800
  });
});

test("computeIntegerSize accounts for fractional devicePixelRatio (125% on 1080p)", () => {
  const result = Display.computeIntegerSize(1536, 864, 1.25);
  assert.deepEqual(result, {
    mode: "integer",
    factor: 2,
    widthPx: 1024,
    heightPx: 640
  });
});

test("computeIntegerSize falls back to fit when viewport is smaller than 640x400 physical", () => {
  const result = Display.computeIntegerSize(375, 667, 1);
  assert.deepEqual(result, {
    mode: "fit",
    factor: 0,
    widthPx: null,
    heightPx: null
  });
});

test("apply respects screenWidth > 0 without distorting aspect ratio", () => {
  global.PrinceJS = {
    WORLD_WIDTH: 640,
    WORLD_HEIGHT: 400,
    scaleMode: "integer",
    crtEnabled: false,
    screenWidth: 500
  };
  global.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 };

  const container = { style: {} };
  const overlay = { classList: { toggle() {} } };

  Display.apply(container, overlay);

  assert.equal(container.style.maxWidth, "500px");
  assert.equal(container.style.width, "");
  assert.equal(container.style.height, "");
});

test("F8 and F9 hotkeys stop propagation and toggle scaleMode and crtEnabled", () => {
  let listener = null;
  let updated = 0;
  global.PrinceJS = {
    WORLD_WIDTH: 640,
    WORLD_HEIGHT: 400,
    scaleMode: "integer",
    crtEnabled: false,
    screenWidth: 0,
    Utils: {
      gameContainer: () => ({ style: {} }),
      updateQuery: () => {
        updated++;
      }
    }
  };
  global.document = { getElementById: () => ({ classList: { toggle() {} } }) };
  global.window = {
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    addEventListener(type, fn, capture) {
      if (type === "keydown" && capture === true) {
        listener = fn;
      }
    }
  };

  Display._shortcutsBound = false;
  Display.bindShortcuts();
  assert.equal(typeof listener, "function");

  let stopped = 0;
  let prevented = 0;
  listener({
    key: "F8",
    stopImmediatePropagation() {
      stopped++;
    },
    preventDefault() {
      prevented++;
    }
  });
  assert.equal(PrinceJS.scaleMode, "fit");
  assert.equal(stopped, 1);
  assert.equal(prevented, 1);

  listener({
    key: "F9",
    stopImmediatePropagation() {
      stopped++;
    },
    preventDefault() {
      prevented++;
    }
  });
  assert.equal(PrinceJS.crtEnabled, true);
  assert.equal(stopped, 2);
  assert.equal(prevented, 2);
  assert.equal(updated, 2);
});
