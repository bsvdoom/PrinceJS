"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function loadKidPrototype() {
  const kidCode = fs.readFileSync(path.join(rootDir, "src/Kid.js"), "utf8");
  const context = vm.createContext({
    PrinceJS: {
      Actor: function () {},
      Fighter: function () {},
      Utils: {}
    },
    Phaser: {
      Rectangle: function (x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
      }
    }
  });
  vm.runInContext(kidCode, context);
  return context.PrinceJS.Kid.prototype;
}

test("maskAndCrop uses positive crop width even if width and charFace sign mismatch", () => {
  const KidProto = loadKidPrototype();
  const crops = [];
  const fakeKid = {
    charFace: 1,
    charFrame: 78,
    action: "jumpup",
    width: 24,
    height: 40,
    inJumpUp: true,
    recoverCrop: false,
    faceR: () => true,
    faceL: () => false,
    frameID: (from, to) => (to === undefined ? fakeKid.charFrame === from : fakeKid.charFrame >= from && fakeKid.charFrame <= to),
    level: { unMaskTile() {}, maskTile() {} },
    crop(rect) {
      crops.push(rect);
    }
  };

  KidProto.maskAndCrop.call(fakeKid);
  assert.equal(crops.length, 1);
  assert.equal(crops[0].width, 24);
  assert.equal(crops[0].y, 7);

  fakeKid.charFrame = 81;
  KidProto.maskAndCrop.call(fakeKid);
  assert.equal(crops.length, 3);
  assert.equal(crops[1], null);
  assert.equal(crops[2].width, 24);
  assert.equal(crops[2].y, 3);
  assert.equal(fakeKid.inJumpUp, false);
  assert.equal(fakeKid.recoverCrop, true);

  fakeKid.charFrame = 15;
  KidProto.maskAndCrop.call(fakeKid);
  assert.equal(crops[3], null);
  assert.equal(fakeKid.recoverCrop, false);
});
