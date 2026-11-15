"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function loadBootAndUtils(search = "", rect = { width: 1280, height: 800 }) {
  const bootCode = fs.readFileSync(path.join(rootDir, "src/Boot.js"), "utf8");
  const utilsCode = fs.readFileSync(path.join(rootDir, "src/Utils.js"), "utf8");
  let lastHistory = null;
  let displayApplied = 0;
  let shortcutsBound = 0;

  const context = vm.createContext({
    PrinceJS: undefined,
    URLSearchParams,
    window: { location: { search } },
    history: {
      replaceState(_a, _b, url) {
        lastHistory = url;
      }
    },
    document: {
      getElementsByTagName() {
        return [{ getBoundingClientRect: () => rect }];
      },
      getElementById() {
        return {
          style: {},
          classList: {
            contains: () => false,
            remove() {},
            toggle() {}
          }
        };
      }
    }
  });

  vm.runInContext(`${bootCode}\n${utilsCode}\nthis.PrinceJS = PrinceJS;`, context);
  context.PrinceJS.Init();
  context.PrinceJS.Display = {
    apply() {
      displayApplied++;
    },
    bindShortcuts() {
      shortcutsBound++;
    }
  };

  return {
    PrinceJS: context.PrinceJS,
    getLastHistory: () => lastHistory,
    getDisplayApplied: () => displayApplied,
    getShortcutsBound: () => shortcutsBound
  };
}

test("applyQuery parses scale and crt and ignores invalid scale values", () => {
  const { PrinceJS } = loadBootAndUtils("?scale=fit&crt=true");
  PrinceJS.Utils.applyQuery();
  assert.equal(PrinceJS.scaleMode, "fit");
  assert.equal(PrinceJS.crtEnabled, true);

  const invalid = loadBootAndUtils("?scale=bogus&crt=false");
  invalid.PrinceJS.Utils.applyQuery();
  assert.equal(invalid.PrinceJS.scaleMode, "integer");
  assert.equal(invalid.PrinceJS.crtEnabled, false);
});

test("updateQuery and clearQuery preserve scale and crt alongside width", () => {
  const { PrinceJS, getLastHistory } = loadBootAndUtils("?w=500&scale=fit&crt=true");
  PrinceJS.Utils.applyQuery();
  PrinceJS.Utils.updateQuery();
  assert.match(getLastHistory(), /width=500/);
  assert.match(getLastHistory(), /scale=fit/);
  assert.match(getLastHistory(), /crt=true/);

  PrinceJS.Utils.clearQuery();
  assert.match(getLastHistory(), /width=500/);
  assert.match(getLastHistory(), /scale=fit/);
  assert.match(getLastHistory(), /crt=true/);
});

test("Boot.create binds Display shortcuts and applyScreenWidth delegates to Display.apply", () => {
  const { PrinceJS, getDisplayApplied, getShortcutsBound } = loadBootAndUtils();
  const fakeBoot = {
    world: { scale: { set() {} } },
    state: { start() {} },
    stage: { smoothed: true },
    game: {
      renderer: { renderSession: { roundPixels: false } },
      time: { desiredFps: 0 },
      forceSingleUpdate: true
    }
  };
  PrinceJS.Boot.prototype.create.call(fakeBoot);

  assert.equal(getDisplayApplied(), 1);
  assert.equal(getShortcutsBound(), 1);
});

test("effectiveScreenSize and effectivePointer compute accurate bounds for integer and fit letterbox", () => {
  const integerEnv = loadBootAndUtils("", { width: 1280, height: 800 });
  const intSize = integerEnv.PrinceJS.Utils.effectiveScreenSize({});
  assert.equal(intSize.width, 1280);
  assert.equal(intSize.height, 800);

  const fitEnv = loadBootAndUtils("", { width: 1920, height: 1080 });
  const fitSize = fitEnv.PrinceJS.Utils.effectiveScreenSize({});
  assert.equal(Math.round(fitSize.width), 1728);
  assert.equal(fitSize.height, 1080);

  const ptr = fitEnv.PrinceJS.Utils.effectivePointer({
    input: {
      activePointer: { x: 96, y: 540 },
      pointer1: { isDown: false, x: 0, y: 0 },
      pointer2: { isDown: false, x: 0, y: 0 }
    }
  });
  assert.equal(Math.round(ptr.x), 0);
  assert.equal(ptr.y, 540);
});
