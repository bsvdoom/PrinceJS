"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function loadGameAndCutscene() {
  const context = vm.createContext({
    PrinceJS: {
      SCREEN_WIDTH: 320,
      ROOM_HEIGHT: 192,
      SCALE_FACTOR: 2
    },
    Phaser: {}
  });
  vm.runInContext(fs.readFileSync(path.join(rootDir, "src/Game.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(rootDir, "src/Cutscene.js"), "utf8"), context);
  return context.PrinceJS;
}

test("Game.preRender and Cutscene.preRender flush stage transforms before rendering", () => {
  const PrinceJS = loadGameAndCutscene();

  let gameTransforms = 0;
  PrinceJS.Game.prototype.preRender.call({
    stage: {
      updateTransform: () => {
        gameTransforms++;
      }
    }
  });
  assert.equal(gameTransforms, 1);

  let cutsceneTransforms = 0;
  PrinceJS.Cutscene.prototype.preRender.call({
    stage: {
      updateTransform: () => {
        cutsceneTransforms++;
      }
    }
  });
  assert.equal(cutsceneTransforms, 1);
});

test("Game.setupCamera syncs world.position immediately with camera coordinates", () => {
  const PrinceJS = loadGameAndCutscene();
  let posX = null;
  let posY = null;

  const fakeGameState = {
    blockCamera: false,
    currentRoom: 1,
    currentCameraRoom: 1,
    visitedRooms: {},
    level: {
      rooms: {
        2: { x: 2, y: 1 }
      },
      checkGates: () => {}
    },
    game: {
      camera: { x: 0, y: 0 }
    },
    world: {
      position: {
        set: (x, y) => {
          posX = x;
          posY = y;
        }
      }
    },
    checkForOpponent: () => {}
  };

  PrinceJS.Game.prototype.setupCamera.call(fakeGameState, 2);

  assert.equal(fakeGameState.game.camera.x, 1280);
  assert.equal(fakeGameState.game.camera.y, 384);
  assert.equal(posX, -1280);
  assert.equal(posY, -384);
});
