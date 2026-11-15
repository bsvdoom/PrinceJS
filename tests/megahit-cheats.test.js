"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function createStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

function loadContext(search = "", files = ["src/Boot.js", "src/Utils.js", "src/Game.js"]) {
  let lastHistory = null;
  const localStorage = createStorageMock();
  const windowListeners = new Map();

  const context = vm.createContext({
    PrinceJS: undefined,
    Phaser: {
      Sprite: function () {},
      Rectangle: function () {},
      Easing: { Linear: { None: () => {} } },
      Keyboard: {
        R: 82,
        A: 65,
        L: 76,
        M: 77,
        T: 84,
        K: 75,
        W: 87,
        G: 71,
        SPACEBAR: 32,
        CLEAR: 12,
        PAGE_UP: 33,
        PAGE_DOWN: 34,
        END: 35,
        HOME: 36,
        SHIFT: 16,
        NUMPAD_1: 97,
        NUMPAD_2: 98,
        NUMPAD_3: 99,
        NUMPAD_4: 100,
        NUMPAD_5: 101,
        NUMPAD_6: 102,
        NUMPAD_7: 103,
        NUMPAD_8: 104,
        NUMPAD_9: 105
      },
      Signal: function () {
        this.listeners = [];
        this.add = (fn, ctx) => this.listeners.push({ fn, ctx });
        this.dispatch = (...args) => this.listeners.forEach((l) => l.fn.apply(l.ctx, args));
      }
    },
    URLSearchParams,
    window: {
      location: { search },
      localStorage,
      addEventListener(type, fn) {
        windowListeners.set(type, fn);
      },
      removeEventListener(type, fn) {
        if (windowListeners.get(type) === fn) {
          windowListeners.delete(type);
        }
      }
    },
    history: {
      replaceState(_a, _b, url) {
        lastHistory = url;
      }
    },
    document: {
      getElementsByTagName() {
        return [{ getBoundingClientRect: () => ({ width: 640, height: 400 }) }];
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

  const code = files.map((f) => fs.readFileSync(path.join(rootDir, f), "utf8")).join("\n");
  vm.runInContext(`${code}\nthis.PrinceJS = PrinceJS;`, context);
  context.PrinceJS.Init();

  return {
    PrinceJS: context.PrinceJS,
    localStorage,
    getLastHistory: () => lastHistory
  };
}

test("applyQuery and updateQuery parse and preserve megahit / m flag", () => {
  const { PrinceJS, getLastHistory } = loadContext("?megahit=true");
  PrinceJS.Utils.applyQuery();
  assert.equal(PrinceJS.megahit, true);

  PrinceJS.Utils.updateQuery();
  assert.match(getLastHistory(), /megahit=true/);

  PrinceJS.Utils.clearQuery();
  assert.match(getLastHistory(), /megahit=true/);

  const shortcutEnv = loadContext("?m=true&_=true");
  shortcutEnv.PrinceJS.Utils.applyQuery();
  assert.equal(shortcutEnv.PrinceJS.megahit, true);
  shortcutEnv.PrinceJS.Utils.updateQuery();
  assert.match(shortcutEnv.getLastHistory(), /m=true/);
});

test("saveGame and loadGame persist and restore level, health, time, and strength", () => {
  const { PrinceJS } = loadContext();
  PrinceJS.currentLevel = 7;
  PrinceJS.maxHealth = 6;
  PrinceJS.strength = 75;
  PrinceJS.startTime = new Date(Date.now() - 12 * 60000);

  const saved = PrinceJS.Utils.saveGame({ health: 4, maxHealth: 6 });
  assert.equal(saved, true);
  assert.equal(PrinceJS.Utils.hasSavedGame(), true);

  PrinceJS.currentLevel = 1;
  PrinceJS.maxHealth = 3;
  PrinceJS.currentHealth = null;
  PrinceJS.strength = 100;
  PrinceJS.startTime = undefined;

  const loaded = PrinceJS.Utils.loadGame();
  assert.equal(loaded, true);
  assert.equal(PrinceJS.currentLevel, 7);
  assert.equal(PrinceJS.maxHealth, 6);
  assert.equal(PrinceJS.currentHealth, 4);
  assert.equal(PrinceJS.strength, 75);
  assert.equal(PrinceJS.Utils.getRemainingMinutes(), 48);
});

test("nextLevelEvent skips past level 3 only in megahit mode, preserves time, and ignores Ctrl+L", () => {
  const { PrinceJS } = loadContext();
  let nextLevelCalls = [];
  const fakeGame = {
    nextLevel: (triggerLevel, skipped, keepRemainingTime) => {
      nextLevelCalls.push({ triggerLevel, skipped, keepRemainingTime });
    }
  };

  PrinceJS.currentLevel = 5;
  PrinceJS.megahit = false;
  PrinceJS.Game.prototype.nextLevelEvent.call(fakeGame, { shiftKey: true, ctrlKey: false });
  assert.equal(nextLevelCalls.length, 0);

  PrinceJS.megahit = true;
  PrinceJS.Game.prototype.nextLevelEvent.call(fakeGame, { shiftKey: false, ctrlKey: true });
  assert.equal(nextLevelCalls.length, 0);

  PrinceJS.Game.prototype.nextLevelEvent.call(fakeGame, { shiftKey: true, ctrlKey: false });
  assert.deepEqual(nextLevelCalls, [{ triggerLevel: undefined, skipped: true, keepRemainingTime: true }]);
});

test("megahit cheats: reviveKid, killOpponentCheat, addLifeCheatEvent, and floatFallCheatEvent", () => {
  const { PrinceJS } = loadContext();
  PrinceJS.megahit = true;

  let revived = 0;
  let lifeAdded = 0;
  let floated = 0;
  let enemyDied = 0;
  let notice = null;

  const enemy = {
    alive: true,
    active: true,
    room: 4,
    charName: "shadow",
    die: () => {
      enemy.alive = false;
      enemyDied++;
    }
  };

  const fakeGame = {
    game: { stage: {} },
    level: { number: 12, leapOfFaith: false },
    currentCameraRoom: 4,
    enemies: [enemy],
    continueTimer: 5,
    pressButtonToContinueTimer: 100,
    ui: {
      pressButtonToContinueTimer: 50,
      hideText() {},
      showNotice(text) {
        notice = text;
      }
    },
    kid: {
      alive: false,
      opponent: enemy,
      revive() {
        this.alive = true;
        revived++;
        return true;
      },
      addLife() {
        lifeAdded++;
      },
      toggleFloatFall() {
        floated = !floated;
        return floated;
      }
    },
    restartGame() {
      throw new Error("Should not restart game on plain R");
    },
    reset() {
      throw new Error("Should not reset level on plain R when dead in megahit");
    },
    nextLevel() {}
  };

  fakeGame.reviveKid = PrinceJS.Game.prototype.reviveKid.bind(fakeGame);
  fakeGame.killOpponentCheat = PrinceJS.Game.prototype.killOpponentCheat.bind(fakeGame);

  // Plain R when dead revives instead of restarting or resetting
  PrinceJS.Game.prototype.buttonPressed.call(fakeGame, {
    keyCode: 82,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false
  });
  PrinceJS.Game.prototype.restartGameEvent.call(fakeGame, { ctrlKey: false, shiftKey: false, altKey: false });
  assert.equal(revived, 1);
  assert.equal(fakeGame.kid.alive, true);
  assert.equal(fakeGame.continueTimer, -1);
  assert.equal(fakeGame.pressButtonToContinueTimer, -1);
  assert.equal(fakeGame.ui.pressButtonToContinueTimer, -1);
  assert.equal(notice, "REVIVED");

  // Shift+T adds life
  PrinceJS.Utils.flashGreenPotion = () => {};
  PrinceJS.Game.prototype.addLifeCheatEvent.call(fakeGame, { shiftKey: true, ctrlKey: false, altKey: false });
  assert.equal(lifeAdded, 1);
  assert.equal(notice, "EXTRA LIFE");

  // Shift+W toggles floatFall on and off
  PrinceJS.Game.prototype.floatFallCheatEvent.call(fakeGame, { shiftKey: true, ctrlKey: false, altKey: false });
  assert.equal(floated, true);
  assert.equal(notice, "FEATHER FALL ON");
  PrinceJS.Game.prototype.floatFallCheatEvent.call(fakeGame, { shiftKey: true, ctrlKey: false, altKey: false });
  assert.equal(floated, false);
  assert.equal(notice, "FEATHER FALL OFF");

  // K kills current opponent and unlocks level 12 leapOfFaith for shadow
  PrinceJS.Game.prototype.killOpponentCheatEvent.call(fakeGame, { shiftKey: false, ctrlKey: false, altKey: false });
  assert.equal(enemyDied, 1);
  assert.equal(fakeGame.level.leapOfFaith, true);
  assert.equal(notice, "ENEMY KILLED");
});

test("Kid.revive restores alive state, full health, and safe room when out of bounds", () => {
  const { PrinceJS } = loadContext("", [
    "src/Boot.js",
    "src/Utils.js",
    "src/Level.js",
    "src/Actor.js",
    "src/Fighter.js",
    "src/Kid.js"
  ]);

  let changedRoom = null;
  let reviveDispatched = 0;

  const fakeKid = {
    alive: false,
    room: -1,
    spawnRoom: 1,
    spawnX: 50,
    spawnY: 116,
    lastSafeRoom: 3,
    lastSafeX: 77,
    lastSafeY: 179,
    charX: 77,
    charY: 250,
    charBlockX: 5,
    charBlockY: 3,
    health: 0,
    maxHealth: 5,
    swordDrawn: true,
    inJumpUp: true,
    inFallDown: true,
    fallingBlocks: 4,
    charXVel: 3,
    charYVel: 33,
    actionCode: 4,
    ledgeSwing: 2,
    action: "falldead",
    level: {
      rooms: {
        3: { x: 1, y: 0 }
      },
      getTileAt: () => ({ element: 1, roomY: 2 })
    },
    updateBlockXY() {
      this.charBlockX = 5;
      this.charBlockY = 2;
    },
    alignToFloor() {
      this.charY = 179;
    },
    updateBase() {},
    processCommand() {},
    updateCharPosition() {},
    updateSwordPosition() {},
    maskAndCrop() {},
    onChangeRoom: {
      dispatch(room) {
        changedRoom = room;
      }
    },
    onRevive: {
      dispatch() {
        reviveDispatched++;
      }
    }
  };

  const result = PrinceJS.Kid.prototype.revive.call(fakeKid);
  assert.equal(result, true);
  assert.equal(fakeKid.alive, true);
  assert.equal(fakeKid.room, 3);
  assert.equal(fakeKid.charX, 77);
  assert.equal(fakeKid.charY, 179);
  assert.equal(fakeKid.health, 5);
  assert.equal(fakeKid.action, "stand");
  assert.equal(fakeKid.inFallDown, false);
  assert.equal(fakeKid.fallingBlocks, 0);
  assert.equal(changedRoom, 3);
  assert.equal(reviveDispatched, 1);
});

test("camera peek, room info, screen flip, and time adjust cheats preserve game room and frozen endTime", () => {
  const { PrinceJS } = loadContext();
  PrinceJS.megahit = true;
  PrinceJS.startTime = new Date(Date.now() - 10 * 60000);

  let flipped = 0;
  let cameraPosRoom = 1;
  let setupCameraCalls = 0;
  let notice = null;
  let shownMinutes = 0;

  const fakeGame = {
    currentCameraRoom: 1,
    peekRoom: null,
    kid: {
      room: 1,
      flipScreen() {
        flipped++;
      }
    },
    level: {
      rooms: {
        1: { links: { left: 2, right: 3, up: 4, down: -1 } },
        2: { links: { left: -1, right: 1, up: -1, down: -1 } },
        3: { links: { left: 1, right: -1, up: -1, down: -1 } },
        4: { links: { left: -1, right: -1, up: -1, down: 1 } }
      }
    },
    ui: {
      showNotice(text) {
        notice = text;
      },
      showRemainingMinutes() {
        shownMinutes++;
      }
    },
    setCameraPosition(room) {
      cameraPosRoom = room;
    },
    setupCamera() {
      setupCameraCalls++;
    }
  };

  fakeGame.peekRoomCheat = PrinceJS.Game.prototype.peekRoomCheat.bind(fakeGame);
  fakeGame.isPlainKeyEvent = PrinceJS.Game.prototype.isPlainKeyEvent.bind(fakeGame);

  // Shift+I flips screen
  PrinceJS.Game.prototype.flipScreenCheatEvent.call(fakeGame, { shiftKey: true, ctrlKey: false, altKey: false });
  assert.equal(flipped, 1);

  // Shift+C shows room info
  PrinceJS.Game.prototype.showRoomInfoCheatEvent.call(fakeGame, { shiftKey: true, ctrlKey: false, altKey: false });
  assert.equal(notice, "ROOM 1 L2 R3 U4 D-");

  // H peeks left room without calling setupCamera or mutating currentCameraRoom
  PrinceJS.Game.prototype.peekRoomLeftCheatEvent.call(fakeGame, { shiftKey: false, ctrlKey: false, altKey: false });
  assert.equal(cameraPosRoom, 2);
  assert.equal(fakeGame.peekRoom, 2);
  assert.equal(fakeGame.currentCameraRoom, 1);
  assert.equal(setupCameraCalls, 0);
  assert.equal(notice, "ROOM 2");

  // Shift+C while peeking shows peeked room links
  PrinceJS.Game.prototype.showRoomInfoCheatEvent.call(fakeGame, { shiftKey: true, ctrlKey: false, altKey: false });
  assert.equal(notice, "ROOM 2 L- R1 U- D-");

  // SPACE snaps back to currentCameraRoom and shows remaining minutes
  PrinceJS.Game.prototype.showRemainingMinutes.call(fakeGame, true);
  assert.equal(cameraPosRoom, 1);
  assert.equal(fakeGame.peekRoom, null);
  assert.equal(shownMinutes, 1);

  // + / - adjusts remaining minutes and clamps between 1 and 60
  const minusOne = PrinceJS.Utils.adjustRemainingMinutes(-1);
  assert.equal(minusOne, 49);
  const plusOne = PrinceJS.Utils.adjustRemainingMinutes(1);
  assert.equal(plusOne, 50);
  const clampedMax = PrinceJS.Utils.adjustRemainingMinutes(100);
  assert.equal(clampedMax, 60);
  const clampedMin = PrinceJS.Utils.adjustRemainingMinutes(-100);
  assert.equal(clampedMin, 1);

  // Frozen endTime is preserved across +/- time adjustment
  const frozenEnd = new Date(Date.now() - 5 * 60000);
  PrinceJS.endTime = frozenEnd;
  PrinceJS.startTime = new Date(frozenEnd.getTime() - 10 * 60000);
  const adjustedFrozen = PrinceJS.Utils.adjustRemainingMinutes(-1);
  assert.equal(adjustedFrozen, 49);
  assert.equal(PrinceJS.endTime, frozenEnd);
});

test("Kid.revive moves back to lastSafeRoom when dying on spikes or chopper", () => {
  const { PrinceJS } = loadContext("", [
    "src/Boot.js",
    "src/Utils.js",
    "src/Level.js",
    "src/Actor.js",
    "src/Fighter.js",
    "src/Kid.js"
  ]);

  const fakeKid = {
    alive: false,
    room: 5,
    spawnRoom: 1,
    spawnX: 50,
    spawnY: 116,
    lastSafeRoom: 4,
    lastSafeX: 70,
    lastSafeY: 116,
    charX: 90,
    charY: 116,
    charBlockX: 6,
    charBlockY: 1,
    health: 0,
    maxHealth: 3,
    swordDrawn: false,
    inJumpUp: false,
    inFallDown: false,
    fallingBlocks: 0,
    charXVel: 0,
    charYVel: 0,
    actionCode: 1,
    ledgeSwing: 0,
    action: "impale",
    level: {
      rooms: {
        4: { x: 0, y: 0 },
        5: { x: 1, y: 0 }
      },
      getTileAt: () => ({ element: PrinceJS.Level.TILE_SPIKES, roomY: 1 })
    },
    updateBlockXY() {},
    alignToFloor() {},
    updateBase() {},
    processCommand() {},
    updateCharPosition() {},
    updateSwordPosition() {},
    maskAndCrop() {},
    onChangeRoom: { dispatch() {} },
    onRevive: { dispatch() {} }
  };

  const result = PrinceJS.Kid.prototype.revive.call(fakeKid);
  assert.equal(result, true);
  assert.equal(fakeKid.room, 4);
  assert.equal(fakeKid.charX, 70);
  assert.equal(fakeKid.action, "stand");
});

test("Title Ctrl+L only intercepts and loads when megahit is enabled, and loadGame validates integer levels", () => {
  const listeners = {};
  const { PrinceJS, localStorage } = loadContext("", ["src/Boot.js", "src/Utils.js", "src/Title.js"]);

  // Verify loadGame validation rejects non-integer and out-of-range levels
  localStorage.setItem(PrinceJS.Utils.SAVE_KEY, JSON.stringify({ level: 1.5, health: 3, maxHealth: 3, elapsedMs: 0 }));
  assert.equal(PrinceJS.Utils.loadGame(), false);
  localStorage.setItem(PrinceJS.Utils.SAVE_KEY, JSON.stringify({ level: 1200, health: 3, maxHealth: 3, elapsedMs: 0 }));
  assert.equal(PrinceJS.Utils.loadGame(), false);

  PrinceJS.currentLevel = 4;
  PrinceJS.Utils.saveGame({ health: 4, maxHealth: 4 });
  PrinceJS.currentLevel = 1;

  let played = 0;
  let prevented = 0;

  const titleState = {
    input: { keyboard: {} },
    game: {
      world: { setBounds() {} },
      sound: { stopAll() {} },
      add: {
        image: () => ({ alpha: 0, anchor: { setTo() {} }, visible: false, crop() {}, updateCrop() {} }),
        tween: () => ({
          to() {
            return this;
          },
          onComplete: { add() {} }
        })
      }
    },
    world: { centerX: 160, centerY: 100, height: 200 },
    stopMusic() {},
    play() {
      played++;
    }
  };

  // Capture handler from Title.create using a temporary window mock inside vm?
  // Instead, reuse loadContext's window by checking Title.create + shutdown directly:
  const fakeEvent = {
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    key: "l",
    keyCode: 76,
    preventDefault() {
      prevented++;
    },
    stopImmediatePropagation() {}
  };

  PrinceJS.Title.prototype.create.call(titleState);
  assert.equal(typeof titleState._cheatKeydownHandler, "function");

  PrinceJS.megahit = false;
  titleState._cheatKeydownHandler(fakeEvent);
  assert.equal(prevented, 0);
  assert.equal(played, 0);

  PrinceJS.megahit = true;
  titleState._cheatKeydownHandler(fakeEvent);
  assert.equal(prevented, 1);
  assert.equal(played, 1);
  assert.equal(PrinceJS.currentLevel, 4);

  PrinceJS.Title.prototype.shutdown.call(titleState);
  assert.equal(titleState._cheatKeydownHandler, null);
  assert.deepEqual(listeners, {});
});

test("Kid diagonal and numpad keys map to DOS Prince of Persia directions", () => {
  const { PrinceJS } = loadContext("?level=1", [
    "src/Boot.js",
    "src/Utils.js",
    "src/Actor.js",
    "src/Fighter.js",
    "src/Kid.js"
  ]);
  const keyStates = {};
  const makeKey = (code) => {
    if (!keyStates[code]) {
      keyStates[code] = { isDown: false };
    }
    return keyStates[code];
  };
  const fakeGame = {
    input: {
      gamepad: { pad1: { connected: false } },
      keyboard: {
        createCursorKeys: () => ({
          left: { isDown: false },
          right: { isDown: false },
          up: { isDown: false },
          down: { isDown: false }
        }),
        addKey: (code) => makeKey(code)
      }
    }
  };
  const fakeKid = {
    game: fakeGame,
    cursors: fakeGame.input.keyboard.createCursorKeys(),
    shiftKey: fakeGame.input.keyboard.addKey(16),
    navKeys: {
      home: makeKey(36),
      pageUp: makeKey(33),
      end: makeKey(35),
      pageDown: makeKey(34),
      clear: makeKey(12),
      numpad1: makeKey(97),
      numpad2: makeKey(98),
      numpad3: makeKey(99),
      numpad4: makeKey(100),
      numpad5: makeKey(101),
      numpad6: makeKey(102),
      numpad7: makeKey(103),
      numpad8: makeKey(104),
      numpad9: makeKey(105)
    },
    anyNavKeyDown: PrinceJS.Kid.prototype.anyNavKeyDown,
    pointerL: () => false,
    pointerR: () => false,
    pointerU: () => false,
    pointerD: () => false
  };

  const readDirs = () => ({
    l: PrinceJS.Kid.prototype.keyL.call(fakeKid),
    r: PrinceJS.Kid.prototype.keyR.call(fakeKid),
    u: PrinceJS.Kid.prototype.keyU.call(fakeKid),
    d: PrinceJS.Kid.prototype.keyD.call(fakeKid)
  });

  const cases = [
    ["home", { l: true, r: false, u: true, d: false }],
    ["pageUp", { l: false, r: true, u: true, d: false }],
    ["end", { l: true, r: false, u: false, d: true }],
    ["pageDown", { l: false, r: true, u: false, d: true }],
    ["clear", { l: false, r: false, u: false, d: true }],
    ["numpad7", { l: true, r: false, u: true, d: false }],
    ["numpad8", { l: false, r: false, u: true, d: false }],
    ["numpad9", { l: false, r: true, u: true, d: false }],
    ["numpad4", { l: true, r: false, u: false, d: false }],
    ["numpad5", { l: false, r: false, u: false, d: true }],
    ["numpad6", { l: false, r: true, u: false, d: false }],
    ["numpad1", { l: true, r: false, u: false, d: true }],
    ["numpad2", { l: false, r: false, u: false, d: true }],
    ["numpad3", { l: false, r: true, u: false, d: true }]
  ];

  for (const [keyName, expected] of cases) {
    fakeKid.navKeys[keyName].isDown = true;
    assert.deepEqual(readDirs(), expected, `Failed for ${keyName}`);
    fakeKid.navKeys[keyName].isDown = false;
  }
});
