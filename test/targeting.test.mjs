// Target picker (single-target spells and attacks) against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, remove() {} }, controls: { render() {} } };
globalThis.CONFIG = { DND5E: {} };
const settings = { targetPicker: true, enableTurns: false };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: false, targets: new Set() }, users: [], combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" } };

const { needsPick, onPreTargetingPick, pickTargets, extraTargets, onTargetingCompletePick, registerTargeting } = await import("../scripts/targeting.js");

const act = ({ type = "save", affects = "creature", count = "1", template = "", units = "ft", value = 60, item = { type: "spell" }, activation = "action", scaling = 0 } = {}) => ({
  type, name: "X", item: { type: item.type, system: { range: item.range ?? {}, description: { value: item.description ?? "" } }, flags: { dnd5e: { scaling } } }, activation: { type: activation },
  target: { affects: { type: affects, count }, template: { type: template } }, range: { units, value, override: false }
});

test("needsPick: a single-target spell, a touch spell or a weapon attack asks for its targets within its range at every use, targets left from the last use included; areas, self spells, aimless utilities, decided targets, targets set off the actor's turn or for a reaction, and the setting off do not", () => {
  assert.deepEqual(needsPick({ activity: act(), targeted: 0 }), { count: 1, range: 60, self: true }); // Sacred Flame
  assert.deepEqual(needsPick({ activity: act({ type: "heal", units: "touch", value: null }), targeted: 0 }), { count: 1, range: 5, self: true }); // Cure Wounds: the caster may click itself
  assert.deepEqual(needsPick({ activity: act({ type: "attack", affects: "", item: { type: "weapon", range: { reach: 5, value: null } } }), targeted: 0 }), { count: 1, range: 5, self: false }); // a weapon: dnd5e leaves affects blank; never yourself
  assert.deepEqual(needsPick({ activity: act({ affects: "enemy" }), targeted: 0 }), { count: 1, range: 60, self: false });
  assert.deepEqual(needsPick({ activity: act({ count: "2", units: "any", value: null }), targeted: 0 }), { count: 2, range: Infinity, self: true });
  assert.equal(needsPick({ activity: act({ template: "sphere" }), targeted: 0 }), null); // Fireball: the template picks
  assert.equal(needsPick({ activity: act({ affects: "self", units: "self", value: null }), targeted: 0 }), null); // Shield
  assert.equal(needsPick({ activity: act({ type: "utility", affects: "" }), targeted: 0 }), null); // nothing to aim at
  assert.deepEqual(needsPick({ activity: act({ type: "save", affects: "", units: "touch", value: null, item: { type: "feat" } }), targeted: 0 }), { count: 1, range: 5, self: false }); // the SRD Engulf: a save at reach with no target type (Midi would aim it at the monster itself)
  assert.equal(needsPick({ activity: act({ type: "save", affects: "", units: "self", value: null }), targeted: 0 }), null); // a self save (Fear-like breath without a template): not ours
  assert.deepEqual(needsPick({ activity: act({ type: "save", affects: "creatureOrObject", count: "", units: "self", value: null, item: { type: "feat" } }), targeted: 0 }), { count: 4, range: 5, self: false }); // the 2024 Engulf: range self, creatures it covers, no count: up to four within reach, Enter confirms fewer
  assert.deepEqual(needsPick({ activity: act({ type: "utility", affects: "creature", count: "1", units: "self", value: null }), targeted: 0 }), { count: 1, range: 5, self: false }); // a touch-like "creature" at range self
  assert.deepEqual(needsPick({ activity: act(), targeted: 1 }), { count: 1, range: 60, self: true }); // the last use's target still marked: picked again (a heal, then an attack, both went to the ally)
  assert.equal(needsPick({ activity: act(), targeted: 1, onTurn: false }), null); // off its turn (Gambit's opportunity attack targets for the reacting actor): the targets set stand
  assert.deepEqual(needsPick({ activity: act(), targeted: 0, onTurn: false }), { count: 1, range: 60, self: true }); // nothing targeted off turn: still picked
  assert.equal(needsPick({ activity: act({ activation: "reaction" }), targeted: 1 }), null); // Counterspell with its target set by the reaction prompt
  assert.equal(needsPick({ activity: act(), targeted: 0, usage: { midiOptions: { targetUuids: ["T.x"] } } }), null); // the autopilot decided
  settings.targetPicker = false;
  assert.equal(needsPick({ activity: act(), targeted: 0 }), null);
  settings.targetPicker = true;
});

test("onPreTargetingPick: runs the picker for the caster with the activity's range and count and lets Midi go on with the picked targets; a cancelled pick aborts the use (false); targets already set are picked again on the actor's turn, kept off it", async () => {
  const calls = [], t = { id: "t1" }, actor = { id: "a1" };
  const pick = async (o) => { calls.push(o); return [t]; };
  const workflow = { activity: act(), token: { id: "caster" }, actor };
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.deepEqual(calls, [{ token: workflow.token, range: 60, count: 1, self: true, name: "X" }]);
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick: async () => null }), false); // Esc: Midi removes the workflow, nothing is spent
  game.user.targets = new Set([t]);
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.equal(calls.length, 2); // no combat: picked again
  game.combat = { started: true, combatants: [{ id: "c1", actor }, { id: "c2", actor: {} }], combatant: { id: "c2" } };
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.equal(calls.length, 2); // not its turn: the targets set stand
  game.combat.combatant = { id: "c1" };
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.equal(calls.length, 3); // its turn: picked again
  game.combat = null;
  game.user.targets = new Set();
});

test("onPreTargetingPick: the picked tokens replace Midi's snapshot of the targets taken at the start of the use (workflowOptions.preSelectedTargetUuids on the usage and on the workflow), else Midi re-marks the old ones", async () => {
  const t = { id: "t1", name: "Goblin 1", document: { uuid: "Scene.s.Token.t1" } };
  const pick = async () => [t];
  const stale = ["Scene.s.Token.rogue"];
  const usage = { midiOptions: { workflowOptions: { preSelectedTargetUuids: [...stale] } } };
  const workflow = { activity: act(), token: { id: "caster" }, actor: {}, workflowOptions: { preSelectedTargetUuids: [...stale] }, preSelectedTargets: new Set([{ id: "rogue" }]) };
  assert.equal(await onPreTargetingPick({ workflow, usage }, { pick }), undefined);
  assert.deepEqual(usage.midiOptions.workflowOptions.preSelectedTargetUuids, ["Scene.s.Token.t1"]);
  assert.deepEqual(workflow.workflowOptions.preSelectedTargetUuids, ["Scene.s.Token.t1"]);
  assert.deepEqual([...workflow.preSelectedTargets], [t]);
  const bare = {}; // a use that brought no midiOptions at all
  assert.equal(await onPreTargetingPick({ workflow: { activity: act(), token: { id: "caster" }, actor: {} }, usage: bare }, { pick }), undefined);
  assert.deepEqual(bare.midiOptions.workflowOptions.preSelectedTargetUuids, ["Scene.s.Token.t1"]);
});

test("pickTargets: a click on the caster's own token counts when the activity can affect it (a touch heal, a potion), never for an attack", async () => {
  const view = { fn: null, addEventListener(type, fn) { this.fn = fn; }, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.MidiQOL = { computeDistance: () => 0 };
  const targeted = [];
  const me = { name: "Cleric", center: { x: 0, y: 0 }, visible: true, setTarget() { targeted.push(this.name); } }, other = { name: "Rogue", center: { x: 0, y: 0 }, visible: true, setTarget() { targeted.push(this.name); } };
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" }, app: { view }, tokens: { hover: me } };
  const heal = pickTargets({ token: me, range: 5, count: 1, name: "Cure Wounds", self: true });
  view.fn({ button: 0 });
  assert.deepEqual((await heal).map((t) => t.name), ["Cleric"]);
  const swing = pickTargets({ token: me, range: 5, count: 1, name: "Longsword", self: false });
  view.fn({ button: 0 }); // own token: ignored, still waiting
  canvas.tokens.hover = other;
  view.fn({ button: 0 });
  assert.deepEqual((await swing).map((t) => t.name), ["Rogue"]);
  assert.deepEqual(targeted, ["Cleric", "Rogue"]);
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" } };
});

test("pickTargets: the targets left from the last use are cleared as the picker opens, and Enter confirms fewer targets than the count once at least one is picked", async () => {
  const view = { fn: null, addEventListener(type, fn) { this.fn = fn; }, removeEventListener() {} };
  let onKey = null;
  globalThis.window = { addEventListener(type, fn) { onKey = fn; }, removeEventListener() {} };
  globalThis.MidiQOL = { computeDistance: () => 0 };
  const cleared = [];
  const me = { name: "Wizard", center: { x: 0, y: 0 }, visible: true }, goblin = { name: "Goblin", center: { x: 0, y: 0 }, visible: true, setTarget() {} };
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" }, app: { view }, tokens: { hover: goblin, setTargets: (ids) => cleared.push(ids) } };
  game.user.targets = new Set([{ id: "stale" }]);
  const rays = pickTargets({ token: me, range: 120, count: 3, name: "Scorching Ray", self: false });
  assert.deepEqual(cleared, [[]]); // the ally healed a moment ago is no longer marked
  onKey({ key: "Enter", stopPropagation() {}, preventDefault() {} }); // nothing picked yet: ignored
  view.fn({ button: 0 });
  onKey({ key: "Enter", stopPropagation() {}, preventDefault() {} });
  assert.deepEqual((await rays).map((t) => t.name), ["Goblin"]); // all three rays at the one goblin
  game.user.targets = new Set();
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" } };
});

// Upcasting: the slot is chosen in dnd5e's dialog, after Midi fixed the targets, so a higher level's extra targets are picked once the
// card is up, at midi-qol.targetingComplete (awaited by Midi); dnd5e marks the scaled clone's item with flags.dnd5e.scaling.
test("extraTargets: a use scaled to a higher level whose target count grew asks for the difference; an unscaled use, a count already covered, or an item whose count does not grow and whose text promises no extra creature ask for nothing", () => {
  assert.equal(extraTargets({ activity: act({ count: "2", scaling: 1 }), targeted: 1 }), 1); // Hold Person at 3rd level with "1 + @scaling"
  assert.equal(extraTargets({ activity: act({ count: "3", scaling: 2 }), targeted: 1 }), 2);
  assert.equal(extraTargets({ activity: act({ count: "1" }), targeted: 1 }), 0); // cast at its level
  assert.equal(extraTargets({ activity: act({ count: "2", scaling: 1 }), targeted: 2 }), 0); // both already picked
  assert.equal(extraTargets({ activity: act({ count: "1", scaling: 2, item: { type: "spell", description: "<p>At Higher Levels. you can target one additional humanoid for each slot level above 2nd.</p>" } }), targeted: 1 }), 2); // SRD text, no @scaling in the data
  assert.equal(extraTargets({ activity: act({ count: "3", scaling: 1, item: { type: "spell", description: "<p>A niveles superiores: una criatura adicional por cada nivel por encima de 1.</p>" } }), targeted: 3 }), 1); // Bane at 2nd
  assert.equal(extraTargets({ activity: act({ count: "3", scaling: 1, item: { type: "spell", description: "<p>At Higher Levels. one additional creature for each slot level above 1st.</p>" } }), targeted: 2 }), 2); // Bane on two with Enter, then 2nd level: the level's own target and the one declined
  assert.equal(extraTargets({ activity: act({ count: "1", scaling: 2, item: { type: "spell", description: "<p>At Higher Levels. the damage increases by 1d8.</p>" } }), targeted: 1 }), 0); // more damage, same target
  assert.equal(extraTargets({ activity: { ...act({ count: "2", scaling: 1, item: { type: "spell", description: "<p>one additional creature for each slot level above 2nd.</p>" } }), _source: { target: { affects: { count: "1 + @scaling" } } } }, targeted: 1 }), 1); // data that scales (2024 wording too): not counted twice
  assert.equal(extraTargets({ activity: act({ count: "2", scaling: 1, template: "sphere" }), targeted: 0 }), 0); // an area: the template picks
  settings.targetPicker = false;
  assert.equal(extraTargets({ activity: act({ count: "2", scaling: 1 }), targeted: 1 }), 0);
  settings.targetPicker = true;
});

test("onTargetingCompletePick: once the card is up, the extra targets of a higher level are picked without dropping the first ones and added to Midi's workflow; Esc keeps the targets already there (the slot is spent)", async () => {
  const calls = [], g1 = { id: "g1", name: "Goblin 1", document: { uuid: "S.T.g1" } }, g2 = { id: "g2", name: "Goblin 2", document: { uuid: "S.T.g2" } };
  const pick = async (o) => { calls.push(o); return [g2]; };
  const sets = [];
  const workflow = { activity: act({ count: "2", scaling: 1 }), token: { id: "caster" }, targets: new Set([g1]), setTargets: (s) => sets.push([...s]), workflowOptions: { preSelectedTargetUuids: ["S.T.g1"] } };
  assert.equal(await onTargetingCompletePick(workflow, { pick }), undefined);
  assert.deepEqual(calls, [{ token: workflow.token, range: 60, count: 1, self: true, name: "X", keep: true }]);
  assert.deepEqual(sets, [[g1, g2]]);
  assert.deepEqual(workflow.workflowOptions.preSelectedTargetUuids, ["S.T.g1", "S.T.g2"]);
  assert.deepEqual([...workflow.preSelectedTargets], [g1, g2]);
  assert.equal(await onTargetingCompletePick(workflow, { pick: async () => null }), undefined); // Esc: goes on with what is there
  assert.equal(sets.length, 1);
  assert.equal(await onTargetingCompletePick({ ...workflow, activity: act({ count: "1" }) }, { pick }), undefined); // cast at its level
  assert.equal(await onTargetingCompletePick({ ...workflow, token: null }, { pick }), undefined);
  assert.equal(calls.length, 1);
  const hooks = {}; const on = Hooks.on; Hooks.on = (n, fn) => { hooks[n] = fn; };
  try { registerTargeting(); } finally { Hooks.on = on; }
  assert.ok(hooks["midi-qol.targetingComplete"] && hooks["midi-qol.preTargetingV2"]);
});

test("pickTargets with keep: the targets already marked stay (nothing cleared, the first click releases nothing) and the notice asks for more", async () => {
  const view = { fn: null, addEventListener(type, fn) { this.fn = fn; }, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.MidiQOL = { computeDistance: () => 0 };
  const cleared = [], notes = [], info = ui.notifications.info;
  ui.notifications.info = (t) => { notes.push(t); return 1; };
  const me = { name: "Cleric", center: { x: 0, y: 0 } }, g2 = { name: "Goblin 2", center: { x: 0, y: 0 }, visible: true, setTarget(on, o) { this.release = o.releaseOthers; } };
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" }, app: { view }, tokens: { hover: g2, setTargets: (ids) => cleared.push(ids) } };
  game.user.targets = new Set([{ id: "g1" }]);
  const more = pickTargets({ token: me, range: 60, count: 1, name: "Hold Person", self: false, keep: true });
  view.fn({ button: 0 });
  assert.deepEqual((await more).map((t) => t.name), ["Goblin 2"]);
  assert.deepEqual(cleared, []);
  assert.equal(g2.release, false);
  assert.match(notes[0], /Picker\.More/);
  ui.notifications.info = info;
  game.user.targets = new Set();
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" } };
});
