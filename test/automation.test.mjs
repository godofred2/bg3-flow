// Runs the Foundry-facing hooks against minimal stubs of the globals they touch.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { setTargets: null, dialog: "enemies" };
globalThis.Hooks = { once() {}, on() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.canvas = { tokens: { setTargets: (ids) => { calls.setTargets = ids; } } };
globalThis.game = { i18n: { localize: (k) => k }, user: { isGM: true }, settings: { get() {}, set() {}, settings: new Map() } };
globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => calls.dialog } } },
  utils: { escapeHTML: (s) => s }
};

const token = (id, name, disposition) => ({ id, name, document: { disposition } });
const cleric = token("a", "Cleric", 1), villager = token("v", "Villager", 1), goblin = token("g", "Goblin", -1);

function workflow(targets, { choice = true, templateType = "radius" } = {}) {
  return {
    token: cleric, targets: new Set(targets), workflowOptions: {},
    activity: {
      target: { affects: { choice }, template: { type: templateType } },
      regionBehavior: { dispositionFilter: -1 },
      sourceUpdates: [],
      updateSource(d) { this.sourceUpdates.push(d); }
    },
    setTargets(set) { this.targets = new Set(set); }
  };
}

const { onPreTargeting, onTargetingComplete } = await import("../scripts/automation.js");

test("enemies only: silences Midi confirmation, sets filter -1 before placement, drops allies but not the caster", async () => {
  calls.dialog = "enemies";
  const w = workflow([cleric, villager, goblin]);
  const usage = { midiOptions: { workflowOptions: {} } };
  await onPreTargeting({ workflow: w, usage });
  assert.equal(w.workflowOptions.targetConfirmation, "none");
  assert.equal(usage.midiOptions.workflowOptions.targetConfirmation, "none");
  assert.deepEqual(w.activity.sourceUpdates, [{ "regionBehavior.dispositionFilter": -1 }]);
  assert.equal(w.activity.regionBehavior.dispositionFilter, -1);
  await onTargetingComplete(w);
  assert.deepEqual([...w.targets].map((t) => t.id), ["a", "g"]);
  assert.deepEqual(calls.setTargets, ["a", "g"]);
});

test("everyone: filter 0, keeps all", async () => {
  calls.dialog = "everyone";
  const w = workflow([villager, goblin]);
  await onPreTargeting({ workflow: w, usage: {} });
  assert.deepEqual(w.activity.sourceUpdates, [{ "regionBehavior.dispositionFilter": 0 }]);
  assert.equal(w.activity.regionBehavior.dispositionFilter, 0);
  await onTargetingComplete(w);
  assert.equal(w.targets.size, 2);
});

test("dialog closed: counts as enemies only", async () => {
  calls.dialog = null;
  const w = workflow([villager, goblin]);
  await onPreTargeting({ workflow: w, usage: {} });
  assert.equal(w.activity.regionBehavior.dispositionFilter, -1);
});

test("no choice flag: untouched", async () => {
  calls.setTargets = null;
  const w = workflow([villager, goblin], { choice: false });
  await onPreTargeting({ workflow: w, usage: {} });
  assert.equal(w.workflowOptions.targetConfirmation, undefined);
  assert.deepEqual(w.activity.sourceUpdates, []);
  await onTargetingComplete(w);
  assert.equal(w.targets.size, 2);
  assert.equal(calls.setTargets, null);
});

test("no friend-or-foe prompt for a use whose targets are already fixed (the autopilot's areas)", async () => {
  const w = { activity: { target: { affects: { choice: true }, template: { type: "sphere" } }, updateSource() {} }, workflowOptions: {} };
  let prompted = false;
  globalThis.foundry.applications.api.DialogV2.wait = async () => { prompted = true; return "enemies"; };
  await onPreTargeting({ workflow: w, usage: { midiOptions: { targetUuids: ["T.rogue"] } } });
  assert.equal(prompted, false);
  assert.equal(w.bg3flowChoice, undefined);
});
