"use strict";

// Regression tests for the audit fixes (docs/audit-fix-plan.md). Every expectation follows the
// original DOS game as documented by SDLPoP (function names are referenced in the comments).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function createSignal() {
  const signal = {
    listeners: [],
    add(fn, ctx) {
      if (!signal.listeners.some((l) => l.fn === fn && l.ctx === ctx)) {
        signal.listeners.push({ fn, ctx });
      }
    },
    remove(fn, ctx) {
      signal.listeners = signal.listeners.filter((l) => !(l.fn === fn && l.ctx === ctx));
    },
    removeAll() {
      signal.listeners = [];
    },
    has(fn, ctx) {
      return signal.listeners.some((l) => l.fn === fn && (ctx === undefined || l.ctx === ctx));
    },
    dispatch(...args) {
      signal.listeners.slice().forEach((l) => l.fn.apply(l.ctx, args));
    }
  };
  return signal;
}

function loadContext(files) {
  const clock = { now: Date.UTC(2026, 0, 1, 12, 0, 0) };
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length) {
        super(...args);
      } else {
        super(clock.now);
      }
    }
    static now() {
      return clock.now;
    }
  }
  const context = vm.createContext({
    PrinceJS: undefined,
    Phaser: {
      Sprite: function (game) {
        this.game = game;
        this.scale = { x: 1, y: 1 };
        this.anchor = { setTo() {} };
        this.addChild = () => {};
      },
      Signal: createSignal,
      Rectangle: function () {},
      Keyboard: { SHIFT: 16, R: 82 }
    },
    URLSearchParams,
    window: { location: { search: "" }, addEventListener() {}, removeEventListener() {} },
    history: { replaceState() {} },
    document: {},
    Date: FakeDate,
    Math,
    console,
    setTimeout,
    clearTimeout
  });
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(rootDir, rel), "utf8"), context, { filename: rel });
  }
  vm.runInContext("this.PrinceJS = PrinceJS;", context);
  context.PrinceJS.Init();
  return { PrinceJS: context.PrinceJS, clock };
}

const BASE = ["src/Boot.js", "src/Utils.js"];

// --- 1.1 Interface keeps the guard's own listeners (DOS guard_refrac after every hit) ---

test("Interface.resetOpponentLive removes only its own listeners, the guard keeps resetRefracTimer", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Interface.js"]);
  const sprite = () => ({ destroy() {}, visible: true });
  const ui = Object.create(PrinceJS.Interface.prototype);
  Object.assign(ui, {
    game: { add: { sprite } },
    layer: { addChild() {} },
    opp: null,
    oppHPs: [],
    oppHPActive: 0
  });
  const makeGuard = () => {
    const guard = { active: true, charName: "guard", baseCharName: "guard", health: 3, charColor: 0 };
    guard.onDamageLife = createSignal();
    guard.onDead = createSignal();
    guard.resetRefracTimer = function () {};
    guard.onDamageLife.add(guard.resetRefracTimer, guard);
    return guard;
  };
  const a = makeGuard();
  const b = makeGuard();

  ui.setOpponentLive(a);
  assert.equal(a.onDamageLife.has(ui.damageOpponentLive, ui), true);
  ui.setOpponentLive(b); // opponent switch
  ui.setOpponentLive(a);
  ui.resetOpponentLive(); // kid separated from the guard

  assert.equal(a.onDamageLife.has(a.resetRefracTimer, a), true);
  assert.equal(b.onDamageLife.has(b.resetRefracTimer, b), true);
  assert.equal(a.onDamageLife.has(ui.damageOpponentLive, ui), false);
  assert.equal(a.onDead.listeners.length, 0);
});

test("Interface.setOpponentLive does not remember an inactive actor, so its bar appears later", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Interface.js"]);
  const ui = Object.create(PrinceJS.Interface.prototype);
  Object.assign(ui, {
    game: { add: { sprite: () => ({ destroy() {} }) } },
    layer: { addChild() {} },
    opp: null,
    oppHPs: [],
    oppHPActive: 0
  });
  const guard = { active: false, charName: "skeleton", baseCharName: "skeleton", health: 3, charColor: 0 };
  guard.onDamageLife = createSignal();
  guard.onDead = createSignal();

  ui.setOpponentLive(guard);
  assert.equal(ui.opp, null);
  guard.active = true;
  guard.charName = "guard";
  ui.setOpponentLive(guard);
  assert.equal(ui.opp, guard);
  assert.equal(ui.oppHPs.length, 3);
});

// --- 1.2 The game clock: exact pause, no time while dead / outside gameplay ---

test("pausing freezes the remaining time exactly (no gain, no loss)", () => {
  const { PrinceJS, clock } = loadContext(BASE);
  const U = PrinceJS.Utils;
  U.setRemainingTime(60);
  clock.now += 14 * 60000 + 59000; // 45:01 left
  const remainingMs = () => 3600000 - (U.timerNow() - PrinceJS.startTime.getTime());
  const before = remainingMs();

  for (const pauseMs of [5000, 40000, 61000]) {
    U.holdTimer("pause");
    clock.now += pauseMs;
    assert.equal(remainingMs(), before, "frozen while paused");
    U.releaseTimer("pause");
    assert.equal(remainingMs(), before, "unchanged after a " + pauseMs + " ms pause");
  }
  clock.now += 1000;
  assert.equal(remainingMs(), before - 1000, "runs again after the pause");
});

test("overlapping holds (pause while dead) release the clock only when the last one ends", () => {
  const { PrinceJS, clock } = loadContext(BASE);
  const U = PrinceJS.Utils;
  U.setRemainingTime(30);
  const remaining = () => 3600000 - (U.timerNow() - PrinceJS.startTime.getTime());
  const start = remaining();

  U.holdTimer("dead");
  clock.now += 3000;
  U.holdTimer("pause");
  clock.now += 3000;
  U.releaseTimer("dead");
  clock.now += 3000;
  assert.equal(remaining(), start);
  U.releaseTimer("pause");
  assert.equal(remaining(), start);
  assert.equal(U.isTimerHeld(), false);
});

test("Shift+L time cut writes PrinceJS.minutes (not Utils.minutes) and respects a frozen clock", () => {
  const { PrinceJS, clock } = loadContext(BASE);
  const U = PrinceJS.Utils;
  U.setRemainingTime(50);
  U.holdTimer("state");
  clock.now += 120000;
  U.setRemainingMinutesTo15();
  assert.equal(PrinceJS.minutes, 15);
  assert.equal(U.minutes, undefined);
  U.releaseTimer("state");
  assert.equal(U.getRemainingMinutes(), 15);
  U.resetRemainingMinutesTo60();
  assert.equal(PrinceJS.minutes, 60);
});

test("resumeEndTime continues the clock where Jaffar's death stopped it (level 13 restart)", () => {
  const { PrinceJS, clock } = loadContext(BASE);
  const U = PrinceJS.Utils;
  U.setRemainingTime(20);
  clock.now += 60000;
  PrinceJS.endTime = new Date(U.timerNow());
  clock.now += 5 * 60000;
  assert.equal(U.getRemainingMinutes(), 19);
  U.resumeEndTime();
  assert.equal(PrinceJS.endTime, undefined);
  assert.equal(U.getRemainingMinutes(), 19);
});

test("Game.updateWorld holds the clock while the kid is dead (DOS show_time: Kid.alive < 0)", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Game.js"]);
  const fake = {
    kid: { alive: false, updateActor() {} },
    level: { update() {} },
    enemies: [],
    mouse: null,
    ui: { updateUI() {} },
    checkLevelLogic() {},
    checkTimers() {}
  };
  PrinceJS.Game.prototype.updateWorld.call(fake);
  assert.equal(PrinceJS.Utils.timerHolds.dead, true);
  fake.kid.alive = true;
  PrinceJS.Game.prototype.updateWorld.call(fake);
  assert.equal(PrinceJS.Utils.timerHolds.dead, undefined);
});

test("time only expires before level 13; on 13/14 the clock stops at zero", () => {
  const { PrinceJS, clock } = loadContext([...BASE, "src/Interface.js"]);
  const U = PrinceJS.Utils;
  const makeUi = (levelNumber) => {
    const ui = Object.create(PrinceJS.Interface.prototype);
    let timeUp = 0;
    Object.assign(ui, {
      showTextType: null,
      text: { setText() {} },
      delegate: { level: { number: levelNumber }, timeUp: () => timeUp++ }
    });
    return { ui, timeUps: () => timeUp };
  };

  U.setRemainingTime(1);
  clock.now += 61000;
  const late = makeUi(13);
  late.ui.showRegularRemainingTime();
  assert.equal(late.timeUps(), 0);
  assert.ok(PrinceJS.endTime, "clock stopped");

  PrinceJS.endTime = undefined;
  U.setRemainingTime(1);
  clock.now += 61000;
  const early = makeUi(12);
  early.ui.showRegularRemainingTime();
  assert.equal(early.timeUps(), 1);
});

// --- 1.3 / D2 Level navigation rule is shared; gamepad never hits the touch strip ---

test("Game.update: a gamepad button does not evaluate the touch strip, only a pointer release does", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Game.js"]);
  const U = PrinceJS.Utils;
  let strip = 0;
  let continued = 0;
  const fake = {
    game: {},
    kid: {},
    handlePointerStrip: () => strip++,
    continuePressed: () => continued++,
    isRemainingMinutesShown: () => false,
    isLevelShown: () => false,
    showRemainingMinutes() {}
  };
  U.pointerPressed = () => false;
  U.gamepadContinuePressed = () => true;
  U.gamepadInfoPressed = () => false;
  U.gamepadPreviousPressed = () => false;
  U.gamepadNextPressed = () => false;
  PrinceJS.Game.prototype.update.call(fake);
  assert.equal(strip, 0);
  assert.equal(continued, 1);

  U.pointerPressed = () => true;
  U.gamepadContinuePressed = () => false;
  PrinceJS.Game.prototype.update.call(fake);
  assert.equal(strip, 1);
  assert.equal(continued, 2);
});

// --- 2.x Timers on the game clock / in ticks ---

test("gameDelayed uses the Phaser game clock (paused with the game, removed on state change)", () => {
  const { PrinceJS } = loadContext(BASE);
  const added = [];
  const removed = [];
  const game = {
    time: {
      events: {
        add: (ms, fn) => {
          const ev = { ms, fn };
          added.push(ev);
          return ev;
        },
        remove: (ev) => removed.push(ev)
      }
    }
  };
  let fired = 0;
  const handle = PrinceJS.Utils.gameDelayed(game, () => fired++, 3500);
  assert.equal(added.length, 1);
  assert.equal(added[0].ms, 3500);
  added[0].fn();
  assert.equal(fired, 1);
  handle.cancel();
  assert.deepEqual(removed, [added[0]]);
});

test("Enemy notice delay is counted in ticks: Jaffar 28 (DOS guard_notice_timer), guards 6", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Actor.js", "src/Fighter.js", "src/Enemy.js"]);
  const run = (baseCharName) => {
    const enemy = Object.create(PrinceJS.Enemy.prototype);
    Object.assign(enemy, {
      baseCharName,
      alive: true,
      opponent: { alive: true },
      startFight: false,
      startFightTimer: -1,
      refracTimer: 0,
      blockTimer: 0,
      strikeTimer: 0,
      action: "stabbed", // stop after the timers
      willStartFight() {
        return !this.startFight;
      }
    });
    let ticks = 0;
    while (!enemy.startFight && ticks < 100) {
      enemy.updateBehaviour();
      ticks++;
    }
    return ticks;
  };
  assert.equal(run("jaffar"), 29);
  assert.equal(run("guard"), 7);
});

test("feather fall lasts 225 ticks (DOS is_feather_fall) and stops with the game clock", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Actor.js", "src/Fighter.js", "src/Kid.js"]);
  const kid = Object.create(PrinceJS.Kid.prototype);
  Object.assign(kid, {
    game: { sound: { play() {} } },
    bumpTimer: 0,
    shadowFlashTimer: 0,
    fallingBlocks: 3
  });
  kid.floatFall();
  for (let i = 0; i < 224; i++) {
    kid.updateTimer();
  }
  assert.equal(kid.inFloat, true);
  kid.updateTimer();
  assert.equal(kid.inFloat, false);
  assert.equal(kid.fallingBlocks, 0);
  assert.equal(kid.toggleFloatFall(), true);
  assert.equal(kid.toggleFloatFall(), false);
  assert.equal(kid.inFloatTicks, 0);
});

test("level 8: the mouse comes after 149 ticks spent in room 16 with the door open (DOS timers)", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Game.js"]);
  PrinceJS.Mouse = function () {};
  let programs = 0;
  const fake = {
    specialEvents: true,
    level: { number: 8, exitDoorOpen: true },
    kid: { room: 16 },
    mouse: null,
    game: {},
    performProgram: () => programs++
  };
  for (let i = 0; i < 148; i++) {
    PrinceJS.Game.prototype.checkLevelLogic.call(fake);
  }
  fake.kid.room = 15; // leaving the room pauses the count
  PrinceJS.Game.prototype.checkLevelLogic.call(fake);
  assert.equal(fake.mouse, null);
  fake.kid.room = 16;
  PrinceJS.Game.prototype.checkLevelLogic.call(fake);
  assert.ok(fake.mouse);
  assert.equal(programs, 1);
});

// --- Level 13: Jaffar ---

test("level 13: Jaffar's death is found among the enemies and stops the clock (megahit K too)", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Game.js"]);
  PrinceJS.Utils.setRemainingTime(30);
  let shown = 0;
  const fake = {
    specialEvents: true,
    firstUpdate: false,
    visitedRooms: {},
    level: { number: 13 },
    kid: { opponent: null },
    enemies: [
      { baseCharName: "guard", alive: false },
      { baseCharName: "jaffar", alive: false }
    ],
    showRemainingMinutes: () => shown++
  };
  PrinceJS.Game.prototype.checkLevelLogic.call(fake);
  assert.equal(fake.level.jaffarDefeated, true);
  assert.ok(PrinceJS.endTime);
  assert.equal(shown, 1);
});

test("level 13: the exit door opens when the kid leaves a room to the left after Jaffar (Jaffar_exit)", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Game.js"]);
  PrinceJS.Level = { TILE_RAISE_BUTTON: 15 };
  let pushed = 0;
  const button = { element: 15, push: () => pushed++ };
  const fake = {
    specialEvents: true,
    level: {
      number: 13,
      jaffarDefeated: false,
      rooms: { 1: { links: { left: 3, right: 17 } }, 3: { links: { left: 0, right: 1 } } },
      getTileAt: () => button
    }
  };
  const exit = (from, to) => PrinceJS.Game.prototype.checkJaffarExit.call(fake, from, to);

  assert.equal(exit(1, 3), false, "Jaffar still alive");
  fake.level.jaffarDefeated = true;
  assert.equal(exit(1, 17), false, "leaving to the right does not open the door");
  assert.equal(exit(1, 3), true);
  assert.equal(pushed, 1);
  assert.equal(button.mute, true);
  assert.equal(exit(1, 3), false, "only once");
});

// --- 3.x Death, restart, health ---

test("health: only the seamless 12→13 transition carries the current HP; skipping never does", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Game.js"]);
  const run = (currentLevel, levelNumber, skipped) => {
    PrinceJS.currentLevel = currentLevel;
    PrinceJS.currentHealth = null;
    const fake = {
      level: { number: levelNumber },
      kid: { health: 2, maxHealth: 5 },
      reset() {},
      restartGame() {}
    };
    PrinceJS.Game.prototype.nextLevel.call(fake, undefined, skipped, true);
    return PrinceJS.currentHealth;
  };
  assert.equal(run(12, 12, false), 2);
  assert.equal(run(112, 12, false), 2, "custom pack level 112 is DOS level 12");
  assert.equal(run(12, 12, true), null);
  assert.equal(run(5, 5, false), null);
  assert.equal(PrinceJS.maxHealth, 5, "max HP carries over (hitp_beg_lev = hitp_max)");
});

test("continue after death: only Shift/Enter (no other keys, no autorepeat); touch/gamepad continue", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Game.js"]);
  let restarts = 0;
  let next = 0;
  const fake = {
    pressButtonToContinueTimer: 100,
    pressButtonToNext: false,
    kid: { alive: false },
    timeIsUp: false,
    restartLevel: () => restarts++,
    nextLevel: () => next++
  };
  fake.continueAfterDeath = PrinceJS.Game.prototype.continueAfterDeath.bind(fake);
  const press = (event) => PrinceJS.Game.prototype.buttonPressed.call(fake, event);

  press({ keyCode: 39, key: "ArrowRight" });
  press({ keyCode: 82, key: "r" });
  press({ keyCode: 16, key: "Shift", repeat: true });
  assert.equal(restarts, 0);
  press({ keyCode: 13, key: "Enter" });
  press({ keyCode: 16, key: "Shift" });
  assert.equal(restarts, 2);

  PrinceJS.Game.prototype.continuePressed.call(fake);
  assert.equal(restarts, 3);

  fake.pressButtonToContinueTimer = -1;
  press({ keyCode: 16, key: "Shift" });
  assert.equal(restarts, 3, "not before the continue window opens");

  fake.pressButtonToNext = true;
  press({ keyCode: 39, key: "ArrowRight", repeat: true });
  assert.equal(next, 0, "a held key does not skip the level-end music");
  press({ keyCode: 39, key: "ArrowRight" });
  assert.equal(next, 1);
});

test("once the time is up, neither restart nor level change can undo it (DOS expired)", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Game.js"]);
  let resets = 0;
  const fake = {
    game: {},
    state: { start() {} },
    level: { number: 5 },
    kid: { health: 3, maxHealth: 3, alive: false },
    reset: () => resets++,
    restartGame() {}
  };
  PrinceJS.Game.prototype.timeUp.call(fake);
  assert.equal(fake.timeIsUp, true);
  PrinceJS.Game.prototype.restartLevel.call(fake, true);
  PrinceJS.Game.prototype.nextLevel.call(fake, undefined, true, true);
  PrinceJS.Game.prototype.previousLevel.call(fake, undefined, true);
  assert.equal(resets, 0);
});

// --- 4.x Edge cases ---

test("Kid.changeRoomDown at the right edge without a room to the right falls out instead of crashing", () => {
  const { PrinceJS } = loadContext([...BASE, "src/Actor.js", "src/Fighter.js", "src/Kid.js"]);
  let changed = null;
  const kid = Object.create(PrinceJS.Kid.prototype);
  Object.assign(kid, {
    room: 5,
    charBlockX: 9,
    charX: 140,
    baseX: 0,
    level: { rooms: { 5: { links: { down: 0, right: 0, left: 0 } } } },
    onChangeRoom: { dispatch: (room) => (changed = room) }
  });
  assert.doesNotThrow(() => kid.changeRoomDown());
  assert.equal(kid.room, 0);
  assert.equal(changed, 0);
});

test("Level.fireEvent passes the stuck flag along the whole event chain (DOS do_trigger_list)", () => {
  const { PrinceJS } = loadContext([...BASE, "src/tiles/Base.js", "src/Level.js"]);
  const received = [];
  const fake = {
    events: [null, { room: 1, location: 1, next: 1 }, { room: 1, location: 2, next: 1 }, { room: 1, location: 3 }],
    getTileAt: (x) => ({ element: 4, raise: (stuck) => received.push([x, stuck]) })
  };
  fake.fireEvent = PrinceJS.Level.prototype.fireEvent.bind(fake);
  fake.fireEvent(1, PrinceJS.Level.TILE_RAISE_BUTTON, true);
  assert.deepEqual(received, [
    [0, true],
    [1, true],
    [2, true]
  ]);
});

test("spikes with a static modifier of 5+ are harmless and inert (DOS is_spike_harmful)", () => {
  const { PrinceJS } = loadContext([...BASE, "src/tiles/Base.js", "src/Level.js", "src/tiles/Spikes.js"]);
  let sounds = 0;
  const game = {
    make: { sprite: () => ({ addChild() {}, height: 63 }) },
    sound: { play: () => sounds++ }
  };
  const armed = new PrinceJS.Tile.Spikes(game, 0, 0);
  const disabled = new PrinceJS.Tile.Spikes(game, 9, 0);
  assert.equal(PrinceJS.Utils.isHarmfulSpikes(armed), true);
  assert.equal(PrinceJS.Utils.isHarmfulSpikes(disabled), false);
  disabled.raise();
  assert.equal(disabled.state, PrinceJS.Tile.Spikes.STATE_INACTIVE);
  assert.equal(sounds, 0);
  armed.raise();
  assert.equal(armed.state, PrinceJS.Tile.Spikes.STATE_RAISING);
  assert.equal(sounds, 1);
});

test("levelNumberOf matches the number of every shipped level; only existing maps are playable", () => {
  const { PrinceJS } = loadContext(BASE);
  const U = PrinceJS.Utils;
  for (let n = 1; n <= 14; n++) {
    const json = JSON.parse(fs.readFileSync(path.join(rootDir, `assets/maps/level${n}.json`), "utf8"));
    assert.equal(U.levelNumberOf(n), json.number);
  }
  for (let n = 99; n <= 310; n++) {
    const json = JSON.parse(fs.readFileSync(path.join(rootDir, `assets/maps/custom/level${n}.json`), "utf8"));
    assert.equal(U.levelNumberOf(n), json.number, `level ${n}`);
  }
  assert.equal(U.isPlayableLevel(14), true);
  assert.equal(U.isPlayableLevel(15), false);
  assert.equal(U.isPlayableLevel(98), false);
  assert.equal(U.isPlayableLevel(99), true);
  assert.equal(U.isPlayableLevel(311), false);
});
