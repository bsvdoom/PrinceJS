"use strict";

PrinceJS.Game = function (game) {
  this.kid;

  this.level;

  this.ui;
  this.currentRoom;

  this.enemies = [];
};

PrinceJS.Game.prototype = {
  preload: function () {
    this.game.load.audio("TheShadow", "assets/music/15_The_Shadow.mp3");
    this.game.load.audio("Float", "assets/music/16_Float.mp3");
    this.game.load.audio("Jaffar2", "assets/music/19_Jaffar_2.mp3");
    this.game.load.audio("JaffarDead", "assets/music/20_Jaffar_Dead.mp3");
    this.game.load.audio("HeroicDeath", "assets/music/13_Heroic_Death.mp3");

    // Drop the previous level from the cache, so a missing map is detected in create()
    // instead of silently reusing the last loaded one.
    if (this.game.cache.checkJSONKey && this.game.cache.checkJSONKey("level")) {
      this.game.cache.removeJSON("level");
    }
    if (!PrinceJS.Utils.isPlayableLevel(PrinceJS.currentLevel)) {
      return;
    }
    let levelBasePath = PrinceJS.currentLevel < 90 ? "assets/maps/" : "assets/maps/custom/";
    this.load.json("level", levelBasePath + "level" + PrinceJS.currentLevel + ".json");
  },

  create: function () {
    this.game.sound.stopAll();

    // The Game state object is reused between levels: start from a clean slate.
    this.enemies = [];
    this.kid = null;
    this.timeIsUp = false;
    this.continueTimer = -1;
    this.pressButtonToContinueTimer = -1;
    this.pressButtonToNext = false;

    let json = this.game.cache.getJSON("level");
    if (!json) {
      this.restartGame();
      return;
    }
    this.level = new PrinceJS.LevelBuilder(this.game, this).buildFromJSON(json);

    // DOS show_time: the clock only runs during play (not in cutscenes / while dead) and not on
    // level 14 (current_level < 13, or 13 until Jaffar is defeated; never from 14 on).
    PrinceJS.Utils.releaseTimer("state");
    PrinceJS.Utils.releaseTimer("dead");
    PrinceJS.Utils.setTimerHold("level", PrinceJS.Utils.levelNumber(this.level) >= 14);
    if (!PrinceJS.startTime) {
      PrinceJS.Utils.setRemainingTime(PrinceJS.minutes);
    }
    this.specialEvents = json.prince.specialEvents !== false;
    this.playDanger = json.prince.danger !== false;

    this.shadow = null;
    this.mouse = null;
    for (let i = 0; i < json.guards.length; i++) {
      let data = json.guards[i];
      let enemy = new PrinceJS.Enemy(
        this.game,
        this.level,
        data.location + (data.bias || 0),
        data.direction * (data.reverse || 1),
        data.room,
        data.skill,
        data.colors,
        data.type,
        i + 1
      );
      if (data.visible === false) {
        enemy.setInvisible();
      }
      if (data.active === false) {
        enemy.setInactive();
      }
      if (data.sneak === false) {
        enemy.setSneakUp(false);
      }
      enemy.onInitLife.add((fighter) => {
        this.ui.setOpponentLive(fighter);
      }, this);
      this.enemies.push(enemy);
      if (enemy.charName === "shadow") {
        this.shadow = enemy;
      }
    }
    let turn = json.prince.turn !== false;
    let direction = json.prince.direction * (json.prince.reverse || 1);
    if (turn) {
      direction = -direction;
    }

    this.kid = new PrinceJS.Kid(
      this.game,
      this.level,
      json.prince.location + (json.prince.bias || 0),
      direction,
      json.prince.room
    );
    if (typeof json.prince.sword === "boolean") {
      this.kid.hasSword = json.prince.sword;
    }
    // currentHealth is a one-shot hand-over (seamless 12→13 transition, megahit load). A later
    // restart of this level starts with full health again (DOS: hitp_curr = hitp_beg_lev).
    PrinceJS.currentHealth = null;
    if (turn) {
      this.kid.charX += 7;
      PrinceJS.Utils.gameDelayed(
        this.game,
        () => {
          this.kid.action = "turn";
        },
        100
      );
    }
    this.kid.charX += json.prince.offset || 0;

    this.game.onPause.add(this.onPause, this);
    this.game.onResume.add(this.onResume, this);

    this.kid.onChangeRoom.add(this.changeRoom, this);
    this.kid.onDead.add(this.handleDead, this);
    this.kid.onFlipped.add(this.handleFlipped, this);
    this.kid.onNextLevel.add(this.nextLevel, this);
    this.kid.onLevelFinished.add(this.levelFinished, this);

    PrinceJS.Tile.Gate.reset();
    this.visitedRooms = {};
    this.currentRoom = json.prince.room;
    this.blockCamera = false;
    this.peekRoom = null;

    this.world.sort("z");
    this.world.alpha = 1;

    this.ui = new PrinceJS.Interface(this.game, this);
    this.ui.setPlayerLive(this.kid);
    this.setupCamera(json.prince.room, json.prince.cameraRoom);

    this.game.time.events.loop(80, this.updateWorld, this);

    this.input.keyboard.addKey(Phaser.Keyboard.R).onDown.add(this.restartGameEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.A).onDown.add(this.restartLevelEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.L).onDown.add(this.nextLevelEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.M).onDown.add(this.toggleMegahitEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.T).onDown.add(this.addLifeCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.K).onDown.add(this.killOpponentCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.W).onDown.add(this.floatFallCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.I).onDown.add(this.flipScreenCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.C).onDown.add(this.showRoomInfoCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.H).onDown.add(this.peekRoomLeftCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.J).onDown.add(this.peekRoomRightCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.U).onDown.add(this.peekRoomUpCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.N).onDown.add(this.peekRoomDownCheatEvent, this);
    this.input.keyboard.addKey(Phaser.Keyboard.SPACEBAR).onDown.add(this.showRemainingMinutes, this);

    this.input.keyboard.onDownCallback = this.buttonPressed.bind(this);

    this._cheatKeydownHandler = (event) => {
      if (!PrinceJS.megahit) {
        return;
      }
      if (PrinceJS.Utils.isCtrlKeyShortcut(event, "g", 71)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.saveGameCheat();
      } else if (PrinceJS.Utils.isCtrlKeyShortcut(event, "l", 76)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.loadGameCheat();
      } else if (!event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.key === "+" || event.keyCode === 107) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.adjustTimeCheat(1);
        } else if (event.key === "-" || event.keyCode === 109) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.adjustTimeCheat(-1);
        }
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this._cheatKeydownHandler, true);
    }

    this.firstUpdate = true;
    if (PrinceJS.danger === null) {
      PrinceJS.danger = this.level.number === 1 && this.playDanger;
    }
    PrinceJS.Utils.resetFlipScreen();
    PrinceJS.Utils.updateQuery();
  },

  update: function () {
    if (!this.kid) {
      return;
    }
    // Touch: a released pointer is the "button"; only a real pointer release may hit the strip.
    if (PrinceJS.Utils.pointerPressed(this.game)) {
      this.continuePressed();
      this.handlePointerStrip();
    }
    // Gamepad: face/shoulder buttons are the "button" (never the D-pad or +/-).
    if (PrinceJS.Utils.gamepadContinuePressed(this.game)) {
      this.continuePressed();
    }
    if (PrinceJS.Utils.gamepadInfoPressed(this.game)) {
      if (this.isRemainingMinutesShown() || this.isLevelShown()) {
        this.restartLevel(true);
      } else {
        this.showRemainingMinutes();
      }
    } else if (PrinceJS.Utils.gamepadPreviousPressed(this.game)) {
      this.requestPreviousLevel();
    } else if (PrinceJS.Utils.gamepadNextPressed(this.game)) {
      this.requestNextLevel();
    }
  },

  handlePointerStrip: function () {
    let pos = PrinceJS.Utils.effectivePointer(this.game);
    let size = PrinceJS.Utils.effectiveScreenSize(this.game);
    if (
      (PrinceJS.Utils.isScreenFlipped() && pos.y >= 0 && pos.y <= 0.04 * size.height) ||
      (!PrinceJS.Utils.isScreenFlipped() && pos.y >= 0.96 * size.height && pos.y <= size.height)
    ) {
      if (this.isRemainingMinutesShown() || this.isLevelShown()) {
        if (pos.x >= 0 && pos.x <= 0.2 * size.width) {
          this.requestPreviousLevel();
        } else if (pos.x >= 0.8 * size.width && pos.x <= size.width) {
          this.requestNextLevel();
        } else if (pos.x >= 0.4 * size.width && pos.x <= 0.6 * size.width) {
          this.restartLevel(true);
        }
      }
      if (pos.x >= 0 && pos.x <= size.width) {
        this.showRemainingMinutes();
      }
    }
  },

  // DOS Shift+L: only on levels 1-3 (or with cheats); without cheats the time is cut to 15 minutes.
  // Keyboard, gamepad (+) and the touch strip all go through this rule.
  canSkipLevel: function () {
    return PrinceJS.megahit || PrinceJS.Utils.levelNumber(this.level) < 4;
  },

  requestNextLevel: function () {
    if (!this.canSkipLevel()) {
      return false;
    }
    this.nextLevel(PrinceJS.currentLevel, true, PrinceJS.megahit);
    return true;
  },

  // There is no DOS key for going back a level: cheat mode only.
  requestPreviousLevel: function () {
    if (!PrinceJS.megahit) {
      return false;
    }
    this.previousLevel(PrinceJS.currentLevel, true);
    return true;
  },

  updateWorld: function () {
    // DOS show_time: no time passes once the kid is dead (Kid.alive >= 0).
    PrinceJS.Utils.setTimerHold("dead", !this.kid.alive);
    this.level.update();
    this.kid.updateActor();
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].updateActor();
    }
    if (this.mouse) {
      this.mouse.updateActor();
    }
    this.checkLevelLogic();
    this.ui.updateUI();
    this.checkTimers();
    this.firstUpdate = false;
  },

  preRender: function () {
    this.stage.updateTransform();
  },

  checkLevelLogic: function () {
    if (!this.specialEvents) {
      return;
    }
    let jaffar;
    let skeleton;
    let tile;
    switch (this.level.number) {
      case 1:
        if (this.firstUpdate) {
          this.level.fireEvent(8, PrinceJS.Level.TILE_DROP_BUTTON);
          if (PrinceJS.danger) {
            PrinceJS.Utils.gameDelayed(
              this.game,
              () => {
                this.game.sound.play("Danger");
              },
              800
            );
          }
        }
        break;

      case 2:
        if (this.firstUpdate) {
          for (let i = 0; i < this.enemies.length; i++) {
            let enemy = this.enemies[i];
            if (enemy && enemy.room === 24 && enemy.charBlockX === 0 && enemy.charBlockY === 1) {
              enemy.charX -= 12;
              enemy.updateBlockXY();
            }
          }
        }
        break;

      case 3:
        skeleton = this.kid.opponent && this.kid.opponent.charName === "skeleton" ? this.kid.opponent : null;
        if (skeleton) {
          if (
            this.level.exitDoorOpen &&
            this.kid.room === skeleton.room &&
            Math.abs(this.kid.opponentDistance()) < 999
          ) {
            let tile = this.level.getTileAt(skeleton.charBlockX, skeleton.charBlockY, skeleton.room);
            if (tile.element === PrinceJS.Level.TILE_SKELETON) {
              tile.removeObject();
              skeleton.setActive();
              this.game.sound.play("BonesLeapToLife");
            }
          }
          if (skeleton.room === 3 && skeleton.setCharForRoom !== skeleton.room) {
            skeleton.setCharForRoom = skeleton.room;
            PrinceJS.Utils.gameDelayed(
              this.game,
              () => {
                if (skeleton.charFace === -1) {
                  skeleton.turn();
                }
                skeleton.room = 3;
                skeleton.charX = PrinceJS.Utils.convertBlockXtoX(4);
                skeleton.charY = PrinceJS.Utils.convertBlockYtoY(1);
                skeleton.action = "stand";
                this.kid.sheathe();
              },
              100
            );
          }
          if (skeleton.room === 3 && skeleton.charBlockY === 1 && skeleton.charX <= 45 && !skeleton.inFallDown) {
            skeleton.charX = 55;
            skeleton.updateBlockXY();
            skeleton.startFall();
          }
          if (skeleton.room === 8 && !skeleton.defeated) {
            skeleton.defeated = true;
            this.game.sound.play("Victory");
            this.kid.sheathe();
          }
        }
        break;

      case 4:
        if (this.level.exitDoorOpen && this.kid.room === 11 && this.kid.charBlockY === 0) {
          tile = this.level.getTileAt(4, 0, 4);
          if (tile instanceof PrinceJS.Tile.Mirror) {
            tile.addObject();
            this.kid.delegate = tile;
            this.level.mirror = tile;
          }
        } else if (
          this.level.exitDoorOpen &&
          this.currentCameraRoom === 4 &&
          this.kid.charBlockY === 0 &&
          this.level.mirror &&
          !this.level.mirrorDetected
        ) {
          this.level.mirrorDetected = true;
          PrinceJS.Utils.gameDelayed(
            this.game,
            () => {
              this.game.sound.play("Danger");
            },
            100
          );
        }
        tile = this.level.getTileAt(this.kid.charBlockX - this.kid.charFace, this.kid.charBlockY, this.kid.room);
        if (
          tile &&
          tile.element === PrinceJS.Level.TILE_MIRROR &&
          this.kid.action === "runjump" &&
          this.kid.faceL() &&
          !this.level.shadowOutOfMirror
        ) {
          if (this.kid.distanceToFloor() === 0) {
            this.kid.bump();
          } else {
            tile.hideReflection();
            this.shadow && this.shadow.appearOutOfMirror(tile);
            this.level.shadowOutOfMirror = true;
            this.game.sound.play("Mirror");
            this.kid.stealLife();
          }
        }
        if (this.level.mirror && this.kid.room === 4 && this.kid.charBlockX <= 3 && this.kid.charBlockY === 1) {
          tile = this.level.getTileAt(4, 0, 4);
          if (tile && tile.element === PrinceJS.Level.TILE_MIRROR) {
            tile.hideReflection();
          }
        }
        if (this.shadow && this.shadow.visible && this.shadow.charBlockY > 0) {
          this.shadow.action = "stand";
          this.shadow.setInvisible();
        }
        break;

      case 5:
        if (this.shadow) {
          tile = this.level.getTileAt(1, 0, 24);
          if (tile.state === PrinceJS.Tile.Gate.STATE_RAISING && !this.shadow.visible && this.shadow.faceR()) {
            this.shadow.visible = true;
            this.performProgram(
              [
                { i: "ACTION", p1: 2600, p2: "running" },
                { i: "ACTION", p1: 700, p2: "runstop" },
                { i: "ACTION", p1: 0, p2: "drinkpotion" },
                { i: "SOUND", p1: 0, p2: "DrinkPotionGlugGlug" },
                { i: "REM_OBJECT" },
                { i: "WAIT", p1: 1500 },
                { i: "ACTION", p1: 500, p2: "turn" },
                { i: "ACTION", p1: 3000, p2: "running" }
              ],
              this.shadow
            );
          }
          if (
            this.shadow.visible &&
            (this.currentCameraRoom === 11 ||
              (this.shadow.room === 11 && this.shadow.charBlockX === 8 && this.shadow.faceL()))
          ) {
            this.shadow.action = "stand";
            this.shadow.setInvisible();
          }
        }
        break;

      case 6:
        if (this.shadow) {
          if (this.firstUpdate) {
            this.shadow.charX += 8;
          }
          if (this.currentCameraRoom === 1) {
            if (!this.level.shadowDetected) {
              this.level.shadowDetected = true;
              this.game.sound.play("Danger");
            }
            if (this.kid.charBlockX === 6) {
              this.shadow.action = "step11";
            }
          }
        }
        if (this.currentCameraRoom === 1 && this.kid.charBlockY === 2 && this.kid.charY >= 185) {
          this.blockCamera = true;
          PrinceJS.Utils.gameDelayed(
            this.game,
            () => {
              this.nextLevel(PrinceJS.currentLevel);
            },
            100
          );
        }
        break;

      case 8:
        // DOS timers(): while the kid is in room 16 with the level door open, leveldoor_open counts
        // frames; the mouse comes at 150 (12.5 s). Leaving the room pauses the count.
        if (this.level.exitDoorOpen && this.kid.room === 16 && !this.mouse) {
          this.level.mouseTicks = (this.level.mouseTicks || 0) + 1;
          if (this.level.mouseTicks >= PrinceJS.Game.MOUSE_DELAY_TICKS) {
            this.mouse = new PrinceJS.Mouse(this.game, this.level, 16, 9, -1);
            this.performProgram(
              [
                { i: "ACTION", p1: 625, p2: "scurry" },
                { i: "ACTION", p1: 0, p2: "stop" },
                { i: "ACTION", p1: 1000, p2: "raise" },
                { i: "ACTION", p1: 0, p2: "stop" },
                { i: "TURN", p1: 0 },
                { i: "ACTION", p1: 600, p2: "scurry" },
                { i: "REM_ACTOR" }
              ],
              this.mouse
            );
          }
        }
        break;

      case 12:
        if (
          this.kid.room === 20 &&
          this.kid.charBlockY === 1 &&
          this.level.getTileAt(1, 0, 15).element === PrinceJS.Level.TILE_SWORD
        ) {
          this.level.removeObject(1, 0, 15);
        }
        if (!this.shadow) {
          this.level.leapOfFaith = true;
        } else {
          if (
            this.kid.room === 15 &&
            (this.kid.charBlockX === 5 || this.kid.charBlockX === 6) &&
            !this.shadow.visible &&
            !this.level.shadowMerge
          ) {
            this.shadow.charX = PrinceJS.Utils.convertBlockXtoX(1);
            this.shadow.charY = PrinceJS.Utils.convertBlockYtoY(1);
            this.shadow.setVisible();
            this.shadow.setActive();
            PrinceJS.Utils.gameDelayed(
              this.game,
              () => {
                this.shadow.refracTimer = 9;
                this.shadow.opponent = this.kid;
                this.kid.opponent = this.shadow;
                this.kid.opponentSync = true;
              },
              1000
            );
          }
          if (
            !this.shadow.active &&
            this.kid.opponent &&
            Math.abs(this.kid.opponentDistance()) <= (this.kid.action.includes("jump") ? 15 : 7) &&
            !this.level.shadowMerge
          ) {
            this.level.shadowMerge = true;
            this.level.leapOfFaith = true;
            this.ui.resetOpponentLive();
            this.kid.addLife();
            this.kid.mergeShadowPosition();
            this.kid.showShadowOverlay();
            this.kid.flashShadowOverlay();
            PrinceJS.Utils.flashWhiteShadowMerge(this.game);
            PrinceJS.Utils.gameDelayed(
              this.game,
              () => {
                this.game.sound.play("Prince");
              },
              2000
            );
          }
        }
        if (this.level.leapOfFaith && !this.level.leapOfFaithSetup && this.level.rooms[2]) {
          this.level.leapOfFaithSetup = true;
          for (let i = 0; i < 10; i++) {
            tile = this.level.getTileAt(i, 0, 2);
            if (tile && tile.element === PrinceJS.Level.TILE_SPACE) {
              tile.element = PrinceJS.Level.TILE_FLOOR;
              tile.hidden = true;
            }
            if (i >= 6) {
              tile = this.level.getTileAt(i, 0, this.level.rooms[2].links.left);
              if (tile && tile.element === PrinceJS.Level.TILE_SPACE) {
                tile.element = PrinceJS.Level.TILE_FLOOR;
                tile.hidden = true;
              }
            }
          }
        }
        if (this.currentCameraRoom === 23) {
          this.nextLevel(PrinceJS.currentLevel);
        }
        break;

      case 13:
        if (this.firstUpdate) {
          this.kid.action = "startrun";
        }
        Object.keys(this.visitedRooms).forEach((visitedRoom) => {
          if (!["16", "23"].includes(visitedRoom)) {
            return;
          }
          let tiles = [2, 3, 4, 5, 6, 7].sort(() => Math.random() - 0.5);
          for (let i = 0; i < tiles.length; i++) {
            let tile = this.kid.level.getTileAt(tiles[i], 2, this.level.rooms[visitedRoom].links.up);
            if (tile.element === PrinceJS.Level.TILE_LOOSE_BOARD && !tile.fallStarted()) {
              tile.shake(true);
              break;
            }
          }
        });
        // Found among all enemies (not via kid.opponent, which is cleared when the opponent dies
        // while en garde, e.g. by the megahit K cheat).
        jaffar = this.enemies.find((enemy) => enemy && enemy.baseCharName === "jaffar");
        if (jaffar && !jaffar.alive && !this.level.jaffarDefeated) {
          // DOS on_guard_killed: leveldoor_open = 2 stops the clock and shows the remaining time.
          this.level.jaffarDefeated = true;
          if (!PrinceJS.endTime) {
            PrinceJS.endTime = new Date(PrinceJS.Utils.timerNow());
            this.showRemainingMinutes();
          }
        }
        break;

      case 14:
        if (this.currentCameraRoom === 5) {
          this.nextLevel(PrinceJS.currentLevel);
        }
        break;
    }
  },

  fireEvent: function (event, type, stuck) {
    this.level.fireEvent(event, type, stuck);
  },

  performProgram: function (program, actor) {
    return program.reduce((promise, operation) => {
      return promise.then(() => {
        let object = operation.o || actor;
        let fn;
        switch (operation.i) {
          case "ACTION":
            fn = () => {
              object.action = operation.p2;
            };
            break;
          case "WAIT":
            fn = () => {};
            break;
          case "TURN":
            fn = () => {
              object.turn();
            };
            break;
          case "SOUND":
            fn = () => {
              this.game.sound.play(operation.p2);
            };
            break;
          case "REM_OBJECT":
            fn = () => {
              this.level.removeObject(object.charBlockX, object.charBlockY, object.room);
            };
            break;
          case "REM_ACTOR":
            fn = () => {
              object.visible = false;
              object.kill();
            };
            break;
          default:
            fn = operation.i;
            break;
        }
        return PrinceJS.Utils.gamePerform(this.game, fn, operation.p1);
      });
    }, Promise.resolve());
  },

  checkTimers: function () {
    if (this.continueTimer > -1) {
      this.continueTimer--;
      if (this.continueTimer === 0) {
        this.continueTimer = -1;
        this.ui.showPressButtonToContinue();
        this.pressButtonToContinueTimer = 260;
      }
    }
    if (this.pressButtonToContinueTimer > -1) {
      // DOS reads the held Shift state (control_shift): holding it restarts as soon as allowed.
      if (this.kid && this.kid.shiftKey && this.kid.shiftKey.isDown) {
        this.continueAfterDeath();
        return;
      }
      this.pressButtonToContinueTimer--;
      if (this.pressButtonToContinueTimer === 0) {
        this.pressButtonToContinueTimer = -1;
        this.restartGame();
      }
    }
  },

  showRemainingMinutes: function (force) {
    if (PrinceJS.megahit && this.peekRoom) {
      this.peekRoom = null;
      this.setCameraPosition(this.currentCameraRoom);
    }
    this.ui.showRemainingMinutes(force);
  },

  isRemainingMinutesShown: function () {
    return this.ui.isRemainingMinutesShown();
  },

  isLevelShown: function () {
    return this.ui.isLevelShown();
  },

  restartGameEvent(event) {
    if (!event.ctrlKey && !event.shiftKey) {
      if (PrinceJS.megahit && !event.altKey && !(event.event && event.event.metaKey) && this.kid && !this.kid.alive) {
        this.reviveKid();
      }
      return;
    }
    this.restartGame();
  },

  restartLevelEvent(event) {
    if (!event.ctrlKey && !event.shiftKey) {
      return;
    }
    this.restartLevel(true);
  },

  nextLevelEvent: function (event) {
    if (!event.shiftKey || event.ctrlKey) {
      return;
    }
    this.requestNextLevel();
  },

  toggleMegahitEvent: function (event) {
    if (!event.shiftKey || event.ctrlKey || event.altKey || (event.event && event.event.metaKey)) {
      return;
    }
    PrinceJS.megahit = !PrinceJS.megahit;
    PrinceJS.Utils.updateQuery();
    if (this.ui) {
      this.ui.showNotice(PrinceJS.megahit ? "MEGAHIT ON" : "MEGAHIT OFF");
    }
  },

  addLifeCheatEvent: function (event) {
    if (!PrinceJS.megahit || !event.shiftKey || event.ctrlKey || event.altKey || (event.event && event.event.metaKey)) {
      return;
    }
    if (this.kid && this.kid.alive) {
      this.kid.addLife();
      PrinceJS.Utils.flashGreenPotion(this.game);
      if (this.ui) {
        this.ui.showNotice("EXTRA LIFE");
      }
    }
  },

  killOpponentCheatEvent: function (event) {
    if (!PrinceJS.megahit || event.ctrlKey || event.shiftKey || event.altKey || (event.event && event.event.metaKey)) {
      return;
    }
    this.killOpponentCheat();
  },

  killOpponentCheat: function () {
    let target = this.kid && this.kid.opponent && this.kid.opponent.alive ? this.kid.opponent : null;
    if (!target || target.room !== this.currentCameraRoom) {
      target =
        this.enemies.find((enemy) => enemy && enemy.alive && enemy.active && enemy.room === this.currentCameraRoom) ||
        target;
    }
    if (!target || !target.alive) {
      return false;
    }
    target.die();
    if (this.level && this.level.number === 12 && target.charName === "shadow") {
      this.level.leapOfFaith = true;
    }
    if (this.ui) {
      this.ui.showNotice("ENEMY KILLED");
    }
    return true;
  },

  floatFallCheatEvent: function (event) {
    if (!PrinceJS.megahit || !event.shiftKey || event.ctrlKey || event.altKey || (event.event && event.event.metaKey)) {
      return;
    }
    if (this.kid && this.kid.alive) {
      let enabled = this.kid.toggleFloatFall();
      if (this.ui) {
        this.ui.showNotice(enabled ? "FEATHER FALL ON" : "FEATHER FALL OFF");
      }
    }
  },

  reviveKid: function () {
    if (!this.kid || this.kid.alive || !this.kid.revive()) {
      return false;
    }
    if (this.game && this.game.sound) {
      this.game.sound.stopAll();
    }
    this.continueTimer = -1;
    this.pressButtonToContinueTimer = -1;
    if (this.ui) {
      this.ui.pressButtonToContinueTimer = -1;
      this.ui.hideText();
      this.ui.showNotice("REVIVED");
    }
    return true;
  },

  saveGameCheat: function () {
    if (PrinceJS.Utils.saveGame(this.kid) && this.ui) {
      this.ui.showNotice("GAME SAVED");
    }
  },

  loadGameCheat: function () {
    if (PrinceJS.Utils.loadGame()) {
      this.reset(true);
    } else if (this.ui) {
      this.ui.showNotice("NO SAVED GAME");
    }
  },

  flipScreenCheatEvent: function (event) {
    if (!PrinceJS.megahit || !event.shiftKey || event.ctrlKey || event.altKey || (event.event && event.event.metaKey)) {
      return;
    }
    if (this.kid) {
      this.kid.flipScreen();
    }
  },

  showRoomInfoCheatEvent: function (event) {
    if (!PrinceJS.megahit || !event.shiftKey || event.ctrlKey || event.altKey || (event.event && event.event.metaKey)) {
      return;
    }
    let room = this.peekRoom || this.currentCameraRoom;
    let links = (this.level && this.level.rooms[room] && this.level.rooms[room].links) || {};
    let fmt = (id) => (id > 0 ? id : "-");
    if (this.ui) {
      this.ui.showNotice(`ROOM ${room} L${fmt(links.left)} R${fmt(links.right)} U${fmt(links.up)} D${fmt(links.down)}`);
    }
  },

  isPlainKeyEvent: function (event) {
    return Boolean(
      event && !event.ctrlKey && !event.shiftKey && !event.altKey && !(event.event && event.event.metaKey)
    );
  },

  peekRoomLeftCheatEvent: function (event) {
    if (PrinceJS.megahit && this.isPlainKeyEvent(event)) {
      this.peekRoomCheat("left");
    }
  },

  peekRoomRightCheatEvent: function (event) {
    if (PrinceJS.megahit && this.isPlainKeyEvent(event)) {
      this.peekRoomCheat("right");
    }
  },

  peekRoomUpCheatEvent: function (event) {
    if (PrinceJS.megahit && this.isPlainKeyEvent(event)) {
      this.peekRoomCheat("up");
    }
  },

  peekRoomDownCheatEvent: function (event) {
    if (PrinceJS.megahit && this.isPlainKeyEvent(event)) {
      this.peekRoomCheat("down");
    }
  },

  peekRoomCheat: function (direction) {
    let fromRoom = this.peekRoom || this.currentCameraRoom;
    let current = this.level && this.level.rooms[fromRoom];
    if (!current || !current.links) {
      return false;
    }
    let targetRoom = current.links[direction];
    if (targetRoom > 0 && this.level.rooms[targetRoom]) {
      this.peekRoom = targetRoom;
      this.setCameraPosition(targetRoom);
      if (this.ui) {
        this.ui.showNotice("ROOM " + targetRoom);
      }
      return true;
    }
    return false;
  },

  adjustTimeCheat: function (deltaMinutes) {
    PrinceJS.Utils.adjustRemainingMinutes(deltaMinutes);
    if (this.ui) {
      this.ui.showRemainingMinutes(true);
    }
  },

  restartGame() {
    this.input.keyboard.onDownCallback = null;
    this.enemies = [];
    PrinceJS.Restart();
    this.state.start("Title");
  },

  restartLevel(skipped = true) {
    if (this.timeIsUp) {
      return;
    }
    // DOS: restarting resets leveldoor_open, so on level 13 the clock runs again until Jaffar
    // is defeated anew. Health is reset by Game.create (currentHealth was consumed there).
    if (PrinceJS.Utils.levelNumber(this.level) === 13 && PrinceJS.endTime) {
      PrinceJS.Utils.resumeEndTime();
    }
    this.reset(true);
    PrinceJS.skipShowLevel = [13, 14].includes(PrinceJS.Utils.levelNumberOf(PrinceJS.currentLevel)) && !skipped;
  },

  levelFinished() {
    this.pressButtonToNext = true;
  },

  nextLevel: function (triggerLevel, skipped = false, keepRemainingTime = false) {
    if (triggerLevel !== undefined && triggerLevel !== PrinceJS.currentLevel) {
      return;
    }
    if (this.timeIsUp) {
      return;
    }

    let finishedLevelNumber = PrinceJS.Utils.levelNumber(this.level);
    PrinceJS.danger = null;
    PrinceJS.currentLevel++;
    // DOS: only the max HP carries over (hitp_beg_lev = hitp_max); the current HP is kept only on
    // the seamless 12→13 transition, never when the level is skipped.
    PrinceJS.currentHealth = !skipped && finishedLevelNumber === 12 && this.kid ? this.kid.health : null;
    if (this.kid) {
      PrinceJS.maxHealth = this.kid.maxHealth;
    }
    if (
      (PrinceJS.currentLevel > 15 && PrinceJS.currentLevel < 90) ||
      PrinceJS.currentLevel > PrinceJS.Utils.CUSTOM_LEVEL_LAST
    ) {
      this.restartGame();
      return;
    }

    if (skipped && !keepRemainingTime) {
      PrinceJS.Utils.setRemainingMinutesTo15();
    }

    if (PrinceJS.currentLevel >= 100 && finishedLevelNumber === 14) {
      PrinceJS.Utils.resetRemainingMinutesTo60();
    }

    this.reset();
    PrinceJS.skipShowLevel = [13, 14].includes(PrinceJS.Utils.levelNumberOf(PrinceJS.currentLevel)) && !skipped;
  },

  previousLevel: function (triggerLevel, skipped = false) {
    if (triggerLevel !== undefined && triggerLevel !== PrinceJS.currentLevel) {
      return;
    }
    if (this.timeIsUp) {
      return;
    }

    // Stay on the first level of the original game or of the custom levels (98 has no map).
    if (!PrinceJS.Utils.isPlayableLevel(PrinceJS.currentLevel - 1)) {
      return;
    }
    PrinceJS.danger = null;
    PrinceJS.currentLevel--;

    this.reset();
    PrinceJS.skipShowLevel = [13, 14].includes(PrinceJS.Utils.levelNumberOf(PrinceJS.currentLevel)) && !skipped;
  },

  handleDead: function () {
    if (this.kid && this.kid.alive) {
      return;
    }
    if (this.continueTimer > -1 || this.pressButtonToContinueTimer > -1) {
      return;
    }
    this.continueTimer = 10;
  },

  handleFlipped: function () {
    this.ui.flipped();
  },

  handleChop: function (tile) {
    tile.chop(tile.room === this.currentCameraRoom);
  },

  timeUp() {
    // DOS expired(): the game is over, no restart or level change any more.
    this.timeIsUp = true;
    this.continueTimer = -1;
    this.pressButtonToContinueTimer = -1;
    this.pressButtonToNext = false;
    PrinceJS.Utils.gameDelayed(
      this.game,
      () => {
        PrinceJS.currentLevel = 16;
        this.state.start("Cutscene");
      },
      1000
    );
  },

  outOfRoom() {
    this.kid.die();
    this.handleDead();
  },

  // Keyboard handler (Phaser onDownCallback, also called for key autorepeat).
  buttonPressed: function (event) {
    if (event && event.repeat) {
      return;
    }
    // DOS process_key: after death only Shift or Enter restarts the level ("Press Button").
    if (this.pressButtonToContinueTimer > -1 && PrinceJS.Game.isContinueKey(event)) {
      this.continueAfterDeath();
      return;
    }
    if (this.pressButtonToNext) {
      this.nextLevel(PrinceJS.currentLevel);
    }
  },

  // Touch release or gamepad face button: the "button" of the DOS joystick.
  continuePressed: function () {
    if (this.pressButtonToContinueTimer > -1) {
      this.continueAfterDeath();
      return;
    }
    if (this.pressButtonToNext) {
      this.nextLevel(PrinceJS.currentLevel);
    }
  },

  continueAfterDeath: function () {
    if (this.timeIsUp || this.pressButtonToContinueTimer < 0 || (this.kid && this.kid.alive)) {
      return;
    }
    this.restartLevel(true);
  },

  reset: function (suppressCutscene) {
    this.game.sound.stopAll();

    this.continueTimer = -1;
    this.pressButtonToContinueTimer = -1;
    this.pressButtonToNext = false;

    this.enemies = [];
    if (!suppressCutscene && [2, 4, 6, 8, 9, 12, 15].indexOf(PrinceJS.currentLevel) > -1) {
      this.state.start("Cutscene");
    } else {
      this.state.start("Game");
    }
    PrinceJS.skipShowLevel = [13, 14].includes(PrinceJS.Utils.levelNumberOf(PrinceJS.currentLevel));
  },

  // The clock itself is held globally (Boot); here only the text is updated.
  onPause: function () {
    PrinceJS.Utils.updateQuery();
    if (this.ui) {
      this.ui.showGamePaused();
    }
  },

  onResume: function () {
    if (this.ui) {
      this.showRemainingMinutes(true);
    }
  },

  changeRoom: function (room, cameraRoom) {
    this.peekRoom = null;
    let previousRoom = this.currentRoom;
    this.setupCamera(room, cameraRoom);
    if (this.currentRoom === room) {
      return;
    }
    this.checkJaffarExit(previousRoom, room);
    this.currentRoom = room;
    this.kid.flee = false;
  },

  // DOS Jaffar_exit (called from leave_room when leaving a room to the left): once Jaffar is
  // defeated, the level door is opened by triggering the button in room 24.
  checkJaffarExit: function (fromRoom, toRoom) {
    if (
      !this.specialEvents ||
      PrinceJS.Utils.levelNumber(this.level) !== 13 ||
      !this.level.jaffarDefeated ||
      this.level.triggerOpenExitDoor ||
      !(fromRoom > 0) ||
      !(toRoom > 0) ||
      !this.level.rooms[fromRoom] ||
      this.level.rooms[fromRoom].links.left !== toRoom
    ) {
      return false;
    }
    let button = this.level.getTileAt(0, 0, 24);
    if (!button || button.element !== PrinceJS.Level.TILE_RAISE_BUTTON) {
      return false;
    }
    this.level.triggerOpenExitDoor = true;
    button.mute = true;
    button.push();
    return true;
  },

  setCameraPosition: function (room) {
    if (this.level && this.level.rooms[room]) {
      this.game.camera.x = this.level.rooms[room].x * PrinceJS.SCREEN_WIDTH * PrinceJS.SCALE_FACTOR;
      this.game.camera.y = this.level.rooms[room].y * PrinceJS.ROOM_HEIGHT * PrinceJS.SCALE_FACTOR;
      this.world.position.set(-this.game.camera.x, -this.game.camera.y);
    }
  },

  setupCamera: function (room, cameraRoom) {
    if (this.blockCamera) {
      return;
    }
    if (this.currentRoom > 0 && room <= 0) {
      this.outOfRoom();
      return;
    }
    if (cameraRoom === 0) {
      return;
    }
    room = cameraRoom || room;
    if (this.level.rooms[room]) {
      PrinceJS.Game.prototype.setCameraPosition.call(this, room);
      this.checkForOpponent(room);
      this.level.checkGates(room, this.currentCameraRoom);
      this.currentCameraRoom = room;
      this.visitedRooms[this.currentCameraRoom] = true;
    }
  },

  checkGateFastDropped: function (gate) {
    for (let i = 0; i < this.enemies.length; i++) {
      let enemy = this.enemies[i];
      if (enemy.room === gate.room) {
        if (enemy.faceL() && enemy.charBlockX <= gate.roomX) {
          enemy.turn();
        } else if (enemy.faceR() && enemy.charBlockX >= gate.roomX) {
          enemy.turn();
        }
      }
    }
  },

  recheckCurrentRoom: function () {
    this.checkForOpponent(this.currentCameraRoom);
  },

  checkForOpponent: function (room) {
    let currentEnemy;
    // Same Room / Same BlockY
    for (let i = 0; i < this.enemies.length; i++) {
      let enemy = this.enemies[i];
      if (enemy.alive && this.kid.charBlockY === enemy.charBlockY && this.kid.opponentInSameRoom(enemy, room)) {
        currentEnemy = enemy;
        break;
      }
    }
    // Near Room / Same BlockY
    if (!currentEnemy) {
      for (let i = 0; i < this.enemies.length; i++) {
        let enemy = this.enemies[i];
        if (enemy.alive && this.kid.charBlockY === enemy.charBlockY && this.kid.opponentNearRoom(enemy, room)) {
          currentEnemy = enemy;
          break;
        }
      }
    }
    // Same Room
    if (!currentEnemy) {
      for (let i = 0; i < this.enemies.length; i++) {
        let enemy = this.enemies[i];
        if (enemy.alive && this.kid.opponentInSameRoom(enemy, room)) {
          currentEnemy = enemy;
          break;
        }
      }
    }
    // Near Room
    if (!currentEnemy) {
      for (let i = 0; i < this.enemies.length; i++) {
        let enemy = this.enemies[i];
        if (enemy.alive && this.kid.opponentNearRoom(enemy, room)) {
          currentEnemy = enemy;
          break;
        }
      }
    }
    if (currentEnemy) {
      if (currentEnemy.baseCharName === "jaffar" && currentEnemy.alive && !currentEnemy.meet) {
        this.game.sound.play("Jaffar2");
      }
      if (this.kid.opponent !== currentEnemy) {
        this.kid.opponent = currentEnemy;
        this.kid.flee = false;
        // DOS enter_guard: a guard that (re)becomes the opponent starts with guard_refrac = 0.
        currentEnemy.refracTimer = 0;
      }
      currentEnemy.opponent = this.kid;
      currentEnemy.meet = true;
    }
    let opponentSameRoom = false;
    let opponentNextRoom = false;
    if (this.kid.opponent) {
      if (this.kid.opponentInSameRoom(this.kid.opponent, room)) {
        opponentSameRoom = true;
      }
      if (this.kid.opponentNextRoom(this.kid.opponent, room)) {
        opponentNextRoom = true;
      }
    }
    if (this.ui) {
      if (opponentSameRoom) {
        this.ui.setOpponentLive(this.kid.opponent);
      } else if (
        !this.kid.opponent ||
        this.kid.opponent !== this.ui.opp ||
        !this.kid.opponentOnSameLevel() ||
        !opponentNextRoom
      ) {
        this.ui.resetOpponentLive();
      }
    }
  },

  floorStartFall: function (tile) {
    this.level.floorStartFall(tile);
  },

  floorStopFall: function (tile) {
    this.level.floorStopFall(tile);
    this.kid.checkLooseFloor(tile);
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].checkLooseFloor(tile);
    }
  },

  shutdown: function () {
    // Outside of gameplay (level change, cutscenes, title) the DOS clock does not run.
    PrinceJS.Utils.holdTimer("state");
    if (this.game.onPause) {
      this.game.onPause.remove(this.onPause, this);
      this.game.onResume.remove(this.onResume, this);
    }
    this.enemies = [];
    this.kid = null;
    this.ui = null;
    if (typeof window !== "undefined" && this._cheatKeydownHandler) {
      window.removeEventListener("keydown", this._cheatKeydownHandler, true);
      this._cheatKeydownHandler = null;
    }
  }
};

PrinceJS.Game.MOUSE_DELAY_TICKS = 149; // DOS: leveldoor_open counts from 1 to custom->mouse_delay (150)

PrinceJS.Game.isContinueKey = function (event) {
  if (!event) {
    return false;
  }
  let keyCode = event.keyCode;
  return keyCode === 16 || keyCode === 13 || event.key === "Shift" || event.key === "Enter";
};
