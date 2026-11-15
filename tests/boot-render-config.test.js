"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");

test("index.html initializes Phaser.Game with Phaser.CANVAS", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  assert.match(html, /new Phaser\.Game\(\s*640\s*,\s*400\s*,\s*Phaser\.CANVAS\b/);
  assert.doesNotMatch(html, /new Phaser\.Game\(\s*640\s*,\s*400\s*,\s*Phaser\.AUTO\b/);
});

test("assets/web/game.css does not shift body by 0.5px", () => {
  const css = fs.readFileSync(path.join(rootDir, "assets/web/game.css"), "utf8");
  assert.doesNotMatch(css, /margin-top:\s*0\.5px/);
});

test("Boot.Init and Boot.create configure crisp canvas rendering and 60Hz fixed-step timing", () => {
  const bootCode = fs.readFileSync(path.join(rootDir, "src/Boot.js"), "utf8");
  const context = vm.createContext({
    PrinceJS: undefined
  });
  vm.runInContext(`${bootCode}\nthis.PrinceJS = PrinceJS;`, context);
  const { PrinceJS } = context;

  PrinceJS.Utils = {
    applyQuery() {},
    applyScreenWidth() {}
  };

  PrinceJS.Init();
  assert.equal(PrinceJS.scaleMode, "integer");
  assert.equal(PrinceJS.crtEnabled, false);

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

  assert.equal(fakeBoot.game.renderer.renderSession.roundPixels, true);
  assert.equal(fakeBoot.stage.smoothed, false);
  assert.equal(fakeBoot.game.time.desiredFps, 60);
  assert.equal(fakeBoot.game.forceSingleUpdate, false);
});
