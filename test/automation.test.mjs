// Runs the Foundry-facing hook against minimal stubs of the globals it touches.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { setTargets: null, behaviourUpdate: null, dialog: "enemies" };
class RegionDocument {}
class Behaviour { type = "midi-qol.regionActivity"; async update(d) { calls.behaviourUpdate = d; } }
const region = Object.assign(new RegionDocument(), { uuid: "Scene.x.Region.y", behaviors: [new Behaviour()] });

globalThis.Hooks = { once() {}, on() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.canvas = { tokens: { setTargets: (ids) => { calls.setTargets = ids; } } };
globalThis.game = { i18n: { localize: (k) => k }, user: { isGM: true }, settings: { get() {}, set() {}, settings: new Map() } };
globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => calls.dialog } } },
  utils: { escapeHTML: (s) => s }
};
globalThis.RegionDocument = RegionDocument;
globalThis.fromUuid = async (uuid) => (uuid === region.uuid ? region : null);

const token = (id, name, disposition) => ({ id, name, document: { disposition } });
const cleric = token("a", "Cleric", 1), villager = token("v", "Villager", 1), goblin = token("g", "Goblin", -1);

function workflow(targets) {
  const w = {
    token: cleric, targets: new Set(targets), template: region,
    activity: { target: { affects: { choice: true } } },
    setTargets(set) { this.targets = new Set(set); }
  };
  return w;
}

const { onTargetingComplete } = await import("../scripts/automation.js");

test("enemies only: drops allies, updates user targets via canvas, writes region filter", async () => {
  calls.dialog = "enemies";
  const w = workflow([villager, goblin]);
  await onTargetingComplete(w);
  assert.deepEqual([...w.targets].map((t) => t.id), ["g"]);
  assert.deepEqual(calls.setTargets, ["g"]);
  assert.deepEqual(calls.behaviourUpdate, { "system.dispositionFilter": -1 });
});

test("everyone: keeps all and writes filter 0", async () => {
  calls.dialog = "everyone"; calls.behaviourUpdate = null;
  const w = workflow([villager, goblin]);
  await onTargetingComplete(w);
  assert.equal(w.targets.size, 2);
  assert.deepEqual(calls.behaviourUpdate, { "system.dispositionFilter": 0 });
});

test("no choice flag: untouched", async () => {
  calls.setTargets = null;
  const w = workflow([villager, goblin]);
  w.activity.target.affects.choice = false;
  await onTargetingComplete(w);
  assert.equal(w.targets.size, 2);
  assert.equal(calls.setTargets, null);
});
