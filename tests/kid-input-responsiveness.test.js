"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function createSignalMock() {
  const listeners = [];
  return {
    add(fn) {
      listeners.push(fn);
    },
    dispatch(...args) {
      for (const fn of listeners) {
        fn(...args);
      }
    }
  };
}

function createKeyMock() {
  const onDown = createSignalMock();
  return {
    isDown: false,
    onDown,
    press() {
      this.isDown = true;
      onDown.dispatch(this);
    },
    release() {
      this.isDown = false;
    },
    tap() {
      this.press();
      this.release();
    }
  };
}

function loadKidContext() {
  const context = vm.createContext({
    PrinceJS: undefined,
    Phaser: {
      Sprite: function (game, x, y, key) {
        this.game = game;
        this.x = x;
        this.y = y;
        this.key = key;
        this.scale = { x: 1, y: 1 };
        this.anchor = { setTo() {} };
        this.addChild = () => {};
      },
      Signal: createSignalMock,
      Keyboard: {
        HOME: 36,
        PAGE_UP: 33,
        END: 35,
        PAGE_DOWN: 34,
        CLEAR: 12,
        NUMPAD_1: 97,
        NUMPAD_2: 98,
        NUMPAD_3: 99,
        NUMPAD_4: 100,
        NUMPAD_5: 101,
        NUMPAD_6: 102,
        NUMPAD_7: 103,
        NUMPAD_8: 104,
        NUMPAD_9: 105,
        SHIFT: 16
      }
    },
    window: {
      location: { search: "" },
      history: { replaceState() {} },
      addEventListener() {}
    },
    Date,
    Math,
    parseInt
  });

  for (const rel of ["src/Boot.js", "src/Utils.js", "src/Actor.js", "src/Fighter.js", "src/Kid.js"]) {
    const code = fs.readFileSync(path.join(rootDir, rel), "utf8");
    vm.runInContext(code, context, { filename: rel });
  }
  vm.runInContext("this.PrinceJS = PrinceJS;", context);

  return context;
}

function createKidHarness() {
  const ctx = loadKidContext();
  const { PrinceJS } = ctx;
  const kidAnims = JSON.parse(fs.readFileSync(path.join(rootDir, "assets/anims/kid.json"), "utf8"));
  const swordAnims = JSON.parse(fs.readFileSync(path.join(rootDir, "assets/anims/sword.json"), "utf8"));

  const cursors = {
    left: createKeyMock(),
    right: createKeyMock(),
    up: createKeyMock(),
    down: createKeyMock()
  };
  const shiftKey = createKeyMock();
  const navKeys = {};

  const fakeGame = {
    add: { existing() {} },
    make: {
      sprite() {
        return { scale: { x: 1, y: 1 }, anchor: { setTo() {}, set() {} }, visible: false };
      }
    },
    cache: {
      getJSON(key) {
        if (key === "kid-anims") {
          return kidAnims;
        }
        if (key === "sword-anims") {
          return swordAnims;
        }
        return null;
      }
    },
    sound: { play() {} },
    input: {
      activePointer: { isDown: false, leftButton: { isDown: false } },
      pointer1: { isDown: false },
      pointer2: { isDown: false },
      gamepad: { pad1: { connected: false } },
      keyboard: {
        createCursorKeys: () => cursors,
        addKey: (code) => {
          if (code === ctx.Phaser.Keyboard.SHIFT) {
            return shiftKey;
          }
          navKeys[code] = createKeyMock();
          return navKeys[code];
        }
      }
    }
  };

  const fakeLevel = {
    rooms: { 1: { links: {} } },
    getTileAt() {
      return { element: 1, isSpace: () => false, isBarrier: () => false };
    },
    recheckCurrentRoom() {}
  };

  const kid = new PrinceJS.Kid(fakeGame, fakeLevel, 5, 1, 1);
  kid.x = 100;
  kid.y = 100;
  kid.opponent = {
    charBlockY: kid.charBlockY,
    alive: true,
    swordDrawn: true,
    charFrame: 21,
    frameID(from, to) {
      return typeof to === "undefined" ? this.charFrame === from : this.charFrame >= from && this.charFrame <= to;
    },
    onEnemyStrike: createSignalMock()
  };

  return { PrinceJS, kid, cursors, shiftKey };
}

test("Shift (strike) followed by quick Up tap blocks at end of strike (frame 157)", () => {
  const { kid, cursors, shiftKey } = createKidHarness();
  kid.action = "engarde";
  kid.charFrame = 158;
  kid.swordDrawn = true;

  // Tap Shift -> strike
  shiftKey.tap();
  kid.updateBehaviour();
  assert.equal(kid.action, "strike");
  kid.processCommand();
  assert.equal(kid.charFrame, 151);

  // Immediately tap & release Up while still in early strike
  cursors.up.tap();

  // Advance through strike frames 152..156
  for (const expectedFrame of [152, 153, 154, 155, 156]) {
    kid.updateBehaviour();
    assert.equal(kid.action, "strike");
    kid.processCommand();
    assert.equal(kid.charFrame, expectedFrame);
  }

  // On frame 157 (last frame of strike), buffered Up triggers block
  kid.updateBehaviour();
  kid.processCommand();
  assert.equal(kid.charFrame, 157);
  kid.updateBehaviour();
  assert.equal(kid.action, "block");
});

test("Shift (strike) followed by quick Up tap triggers striketoblock when strike is blocked", () => {
  const { kid, cursors, shiftKey } = createKidHarness();
  kid.action = "engarde";
  kid.charFrame = 158;
  kid.swordDrawn = true;

  shiftKey.tap();
  kid.updateBehaviour();
  assert.equal(kid.action, "strike");
  kid.processCommand();

  // Quick Up tap and release before opponent parries
  cursors.up.tap();

  // Simulate opponent parrying at frame 154 -> blockedstrike (frame 167)
  kid.action = "blockedstrike";
  kid.processCommand();
  assert.equal(kid.charFrame, 167);

  kid.updateBehaviour();
  assert.equal(kid.action, "striketoblock");
});

test("Buffered Up press survives 1-tick deferral when opponent is on strike windup frame 18", () => {
  const { kid, cursors } = createKidHarness();
  kid.action = "engarde";
  kid.charFrame = 158;
  kid.swordDrawn = true;
  kid.opponent.charFrame = 18;

  cursors.up.tap();
  kid.updateBehaviour();
  // Deferred because opponent is on frame 18
  assert.equal(kid.action, "engarde");

  // Next tick: opponent advances to frame 1; buffered Up still triggers block
  kid.opponent.charFrame = 1;
  kid.updateBehaviour();
  assert.equal(kid.action, "block");
});

test("Quick Shift tap during block windup (frame 169) triggers blocktostrike on frame 150", () => {
  const { kid, shiftKey } = createKidHarness();
  kid.action = "block";
  kid.processCommand();
  assert.equal(kid.charFrame, 169);

  shiftKey.tap();
  kid.updateBehaviour();
  assert.equal(kid.action, "block");
  kid.processCommand();
  assert.equal(kid.charFrame, 150);

  kid.updateBehaviour();
  assert.equal(kid.action, "blocktostrike");
});

test("Quick Up tap between ticks in stand triggers jump once without repeating", () => {
  const { kid, cursors } = createKidHarness();
  kid.action = "stand";
  kid.charFrame = 15;

  let jumped = 0;
  kid.jump = () => {
    jumped++;
    kid.action = "standjump";
  };

  cursors.up.tap();
  kid.updateBehaviour();
  assert.equal(jumped, 1);

  // Returning to stand without another press must not jump again
  kid.action = "stand";
  kid.updateBehaviour();
  assert.equal(jumped, 1);
});

test("Releasing Left stops running even if Left was tapped recently", () => {
  const { kid, cursors } = createKidHarness();
  kid.action = "running";
  kid.charFace = -1;
  kid.charFrame = 7;

  let stopped = 0;
  kid.runstop = () => {
    stopped++;
    kid.action = "runstop";
  };

  cursors.left.tap();
  kid.updateBehaviour();
  assert.equal(stopped, 1);
});

test("Fighter.strike does not dispatch onEnemyStrike on non-strikeable frames", () => {
  const { kid } = createKidHarness();
  let enemyStrikeEvents = 0;
  kid.opponent.onEnemyStrike.add(() => {
    enemyStrikeEvents++;
  });

  kid.action = "strike";
  kid.charFrame = 152;
  kid.strike();
  assert.equal(enemyStrikeEvents, 0);
});
