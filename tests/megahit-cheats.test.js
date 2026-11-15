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
      Keyboard: {
        R: 82,
        A: 65,
        L: 76,
        M: 77,
        T: 84,
        K: 75,
        W: 87,
        G: 71,
        SPACEBAR: 32
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
  const { PrinceJS } = loadContext("", ["src/Boot.js", "src/Utils.js", "src/Actor.js", "src/Fighter.js", "src/Kid.js"]);

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

test("Round 2 cheats: flipScreen, room info, H/J/U/N camera peek, SPACE snap-back, and +/- time adjust", () => {
  const { PrinceJS } = loadContext();
  PrinceJS.megahit = true;
  PrinceJS.startTime = new Date(Date.now() - 10 * 60000);

  let flipped = 0;
  let cameraRoom = 1;
  let notice = null;
  let shownMinutes = 0;

  const fakeGame = {
    currentCameraRoom: 1,
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
    setupCamera(room) {
      cameraRoom = room;
      this.currentCameraRoom = room;
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

  // H / J / U / N peek adjacent rooms
  PrinceJS.Game.prototype.peekRoomLeftCheatEvent.call(fakeGame, { shiftKey: false, ctrlKey: false, altKey: false });
  assert.equal(cameraRoom, 2);
  assert.equal(notice, "ROOM 2");

  // SPACE returns camera to Kid's room and shows remaining minutes
  PrinceJS.Game.prototype.showRemainingMinutes.call(fakeGame, true);
  assert.equal(cameraRoom, 1);
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
});
