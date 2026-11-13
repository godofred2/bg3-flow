// Light spells against stubbed Foundry globals: the token's light follows Light, Produce Flame, Continual Flame, Daylight and Faerie Fire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = { hooks: [], updates: [], gm: [], created: [], hookFns: {} };
globalThis.Hooks = { once() {}, on: (h, fn) => { calls.hooks.push(h); calls.hookFns[h] = fn; return calls.hooks.length; }, off: (h) => { delete calls.hookFns[h]; }, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.CONFIG = { DND5E: {} };
const settings = { lightSpells: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: { activeGM: { isSelf: true } }, combat: null, scenes: [],
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { scene: { id: "s", tokens: { contents: [] }, lights: { contents: [] }, createEmbeddedDocuments: async (type, data) => { calls.created.push([type, ...data]); return data; } } };
globalThis.fromUuidSync = () => null;

const { lightSpell, onRollComplete, onDeleteEffect, onRenderTokenHUD, extinguish, registerLight, templateCenter, onPreTargetingLight, throwFlame } = await import("../scripts/light.js");

function tok(id, { light = { bright: 0, dim: 0, color: null }, flags = {}, owner = true } = {}) {
  const f = { "bg3-flow": { ...flags } };
  const doc = {
    id, name: id, uuid: `Scene.s.Token.${id}`, isOwner: owner, flags: f, light,
    getFlag: (m, k) => f[m]?.[k],
    update: async (u) => {
      calls.updates.push([id, u]);
      if (u.light) doc.light = u.light;
      if (u["flags.bg3-flow.light"]) f["bg3-flow"].light = u["flags.bg3-flow.light"];
      if ("flags.bg3-flow.-=light" in u) delete f["bg3-flow"].light;
    }
  };
  doc.object = { document: doc };
  return doc;
}
const actor = (uuid) => ({ uuid, name: uuid });
const cast = (name, { activityType = "utility", targets = [], failed = [], caster, token, aborted = false, concentration = false, templateUuid = null } = {}) => ({
  aborted, activity: { type: activityType }, item: { name, uuid: `${caster.uuid}.Item.${name}`, system: { properties: new Set(concentration ? ["concentration"] : []) } },
  actor: caster, token: token?.object, targets: new Set(targets.map((d) => d.object)), failedSaves: new Set(failed.map((d) => d.object)), templateUuid
});
const reset = () => { calls.updates = []; calls.gm = []; calls.created = []; canvas.scene.tokens.contents = []; canvas.scene.lights.contents = []; game.user.isGM = true; };
const LIGHT = { bright: 20, dim: 40, color: "#ffe6b3", alpha: 0.15, animation: { type: null } };
const layer = (key, casterUuid, light, itemName = "Light", concentration = false) => ({ key, casterUuid, itemUuid: `${casterUuid}.Item.${itemName}`, concentration, light });

test("lightSpell: the five light spells by name, English or Spanish; anything else is null", () => {
  assert.deepEqual([lightSpell("Light").key, lightSpell(" luz ").key, lightSpell("Produce Flame").key, lightSpell("Producir llama").key, lightSpell("Continual Flame").key, lightSpell("Daylight").key, lightSpell("Luz del día").key, lightSpell("Faerie Fire").key, lightSpell("Fuego feérico").key],
    ["light", "light", "produceFlame", "produceFlame", "continualFlame", "daylight", "daylight", "faerieFire", "faerieFire"]);
  assert.equal(lightSpell("Light Crossbow"), null);
  assert.equal(lightSpell("Lightning Bolt"), null);
  assert.equal(lightSpell(null), null);
});

test("Light lights the picked token (bright 20, dim 40) and remembers its old light; casting it again puts the first light back and lights the new target; a cancelled or aborted use lights nothing", async () => {
  reset();
  const cleric = actor("Actor.cleric"), me = tok("cleric"), rogue = tok("rogue", { light: { bright: 5, dim: 10, color: "#ff0000" } }), goblin = tok("goblin");
  canvas.scene.tokens.contents = [me, rogue, goblin];
  await onRollComplete(cast("Light", { targets: [rogue], caster: cleric, token: me }));
  assert.equal(calls.updates.length, 1);
  const [id, u] = calls.updates[0];
  assert.equal(id, "rogue");
  assert.deepEqual(u.light, LIGHT);
  assert.deepEqual(u["flags.bg3-flow.light"], { prev: { bright: 5, dim: 10, color: "#ff0000" }, layers: [layer("light", "Actor.cleric", LIGHT)] });
  calls.updates = [];
  await onRollComplete(cast("Light", { targets: [goblin], caster: cleric, token: me })); // the spell ends when cast again
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright, x.light.dim]), [["rogue", 5, 10], ["goblin", 20, 40]]);
  assert.equal(rogue.getFlag("bg3-flow", "light"), undefined);
  calls.updates = [];
  await onRollComplete(cast("Light", { targets: [], caster: cleric, token: me })); // Esc on the picker: nothing lit, the goblin keeps its light
  await onRollComplete(cast("Light", { targets: [rogue], caster: cleric, token: me, aborted: true }));
  assert.deepEqual(calls.updates, []);
  settings.lightSpells = false;
  await onRollComplete(cast("Light", { targets: [rogue], caster: cleric, token: me }));
  assert.deepEqual(calls.updates, []);
  settings.lightSpells = true;
});

test("lights stack: a Light over a Continual Flame shows Light, and when Light moves on the token goes back to the Continual Flame, not to darkness; a second caster's Light does not put out the first's; Daylight on a token is 60/120", async () => {
  reset();
  const a = actor("Actor.a"), b = actor("Actor.b"), ta = tok("ta"), tb = tok("tb"), t1 = tok("t1"), t2 = tok("t2");
  canvas.scene.tokens.contents = [ta, tb, t1, t2];
  await onRollComplete(cast("Continual Flame", { targets: [t1], caster: a, token: ta }));
  await onRollComplete(cast("Continual Flame", { targets: [t2], caster: a, token: ta })); // no single-cast rule: both burn
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright]), [["t1", 20], ["t2", 20]]);
  const flame = t1.light;
  calls.updates = [];
  await onRollComplete(cast("Light", { targets: [t1], caster: a, token: ta }));
  assert.deepEqual(t1.light, LIGHT);
  assert.deepEqual(t1.getFlag("bg3-flow", "light").layers.map((l) => l.key), ["continualFlame", "light"]);
  assert.deepEqual(t1.getFlag("bg3-flow", "light").prev, { bright: 0, dim: 0, color: null });
  calls.updates = [];
  await onRollComplete(cast("Light", { targets: [t2], caster: a, token: ta })); // Light moves on
  assert.deepEqual(calls.updates.map(([i]) => i), ["t1", "t2"]);
  assert.deepEqual(t1.light, flame); // back to the Continual Flame
  assert.deepEqual(t1.getFlag("bg3-flow", "light").layers.map((l) => l.key), ["continualFlame"]);
  calls.updates = [];
  await onRollComplete(cast("Light", { targets: [t1], caster: b, token: tb })); // b's Light does not touch a's
  assert.deepEqual(calls.updates.map(([i]) => i), ["t1"]);
  assert.deepEqual(t2.getFlag("bg3-flow", "light").layers.map((l) => l.key), ["continualFlame", "light"]);
  await onRollComplete(cast("Daylight", { targets: [t1], caster: b, token: tb }));
  assert.deepEqual(calls.updates.at(-1)[1].light, { bright: 60, dim: 120, color: "#ffffff", alpha: 0.1, animation: { type: null } });
});

test("templateCenter: a MeasuredTemplate's x/y, or a Foundry 14 Region's first shape (circle centre, rectangle middle, polygon average)", () => {
  assert.deepEqual(templateCenter({ x: 1250, y: 850 }), { x: 1250, y: 850 });
  assert.deepEqual(templateCenter({ shapes: [{ type: "circle", x: 1100, y: 800, radius: 600 }] }), { x: 1100, y: 800 });
  assert.deepEqual(templateCenter({ shapes: [{ type: "rectangle", x: 1000, y: 700, width: 200, height: 100 }] }), { x: 1100, y: 750 });
  assert.deepEqual(templateCenter({ shapes: [{ type: "polygon", points: [0, 0, 200, 0, 200, 100, 0, 100] }] }), { x: 100, y: 50 });
  assert.equal(templateCenter({ shapes: [] }), null);
  assert.equal(templateCenter(null), null);
});

test("Daylight cast on a point (a template, a Region on Foundry 14): an ambient light at the template, flagged, no token touched; Faerie Fire's cube still lights the creatures that failed; the caster's concentration ending removes flagged ambient lights too", async () => {
  reset();
  const b = actor("Actor.b"), tb = tok("tb"), t1 = tok("t1");
  canvas.scene.tokens.contents = [tb, t1];
  globalThis.fromUuidSync = (u) => u === "Scene.s.MeasuredTemplate.tpl" ? { shapes: [{ type: "circle", x: 1250, y: 850, radius: 600 }] } : u === "Scene.s.Region.cube" ? { shapes: [{ type: "rectangle", x: 0, y: 0, width: 400, height: 400 }] } : null;
  await onRollComplete(cast("Daylight", { targets: [t1], caster: b, token: tb, templateUuid: "Scene.s.MeasuredTemplate.tpl" }));
  assert.deepEqual(calls.updates, []);
  await onRollComplete(cast("Faerie Fire", { activityType: "save", targets: [t1], failed: [t1], caster: b, token: tb, concentration: true, templateUuid: "Scene.s.Region.cube" }));
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.dim]), [["t1", 10]]); // the cube's creatures, no ambient light
  assert.deepEqual(calls.created, [["AmbientLight", { x: 1250, y: 850, config: { bright: 60, dim: 120, color: "#ffffff", alpha: 0.1, animation: { type: null } }, flags: { "bg3-flow": { light: { key: "daylight", casterUuid: "Actor.b", itemUuid: "Actor.b.Item.Daylight", concentration: false } } } }]]);
  const deleted = [];
  canvas.scene.lights.contents = [{ flags: { "bg3-flow": { light: { key: "faerieFire", casterUuid: "Actor.b", concentration: true } } }, delete: async () => deleted.push("ff") }, { flags: {}, delete: async () => deleted.push("torch") }];
  await onDeleteEffect({ statuses: new Set(["concentrating"]), parent: b });
  assert.deepEqual(deleted, ["ff"]);
  globalThis.fromUuidSync = () => null;
});

test("Produce Flame lights the caster's own token, also when the SRD item's only activity is the attack and nothing (or the caster itself, Midi's self target) is targeted; throwing it at someone puts it out; recasting keeps one flame", async () => {
  reset();
  const dru = actor("Actor.dru"), me = tok("dru");
  canvas.scene.tokens.contents = [me];
  await onRollComplete(cast("Produce Flame", { caster: dru, token: me }));
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright, x.light.dim]), [["dru", 10, 20]]);
  calls.updates = [];
  await onRollComplete(cast("Produce Flame", { activityType: "attack", caster: dru, token: me })); // the SRD item: an attack with no target is the flame in hand
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright]), [["dru", 0], ["dru", 10]]); // off, then on again
  calls.updates = [];
  await onRollComplete(cast("Produce Flame", { activityType: "attack", targets: [me], caster: dru, token: me })); // Midi targeted the caster (the SRD item affects self): still the flame in hand
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright]), [["dru", 0], ["dru", 10]]);
  calls.updates = [];
  await onRollComplete(cast("Produce Flame", { activityType: "attack", targets: [tok("g")], caster: dru, token: me }));
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright]), [["dru", 0]]);
  assert.equal(me.getFlag("bg3-flow", "light"), undefined);
});

test("Faerie Fire lights the creatures that failed the save (dim 10) under concentration; the caster's concentration ending puts them out and nobody else's", async () => {
  reset();
  const bard = actor("Actor.bard"), other = actor("Actor.other"), me = tok("bard"), g1 = tok("g1"), g2 = tok("g2"), g3 = tok("g3"), lit = tok("lit");
  canvas.scene.tokens.contents = [me, g1, g2, g3, lit];
  await onRollComplete(cast("Faerie Fire", { activityType: "save", targets: [g1, g2, g3], failed: [g1, g2], caster: bard, token: me, concentration: true }));
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright, x.light.dim, x["flags.bg3-flow.light"].layers[0].concentration]), [["g1", 0, 10, true], ["g2", 0, 10, true]]);
  await onRollComplete(cast("Light", { targets: [lit], caster: other, token: me }));
  calls.updates = [];
  await onDeleteEffect({ statuses: new Set(["concentrating"]), parent: bard });
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright, x.light.dim]), [["g1", 0, 0], ["g2", 0, 0]]);
  calls.updates = [];
  await onDeleteEffect({ statuses: new Set(["prone"]), parent: bard }); // not concentration
  await onDeleteEffect({ statuses: new Set(["concentrating"]), parent: other }); // other's Light is not a concentration spell
  assert.deepEqual(calls.updates, []);
  game.users.activeGM = { isSelf: false };
  await onDeleteEffect({ statuses: new Set(["concentrating"]), parent: bard }); // only the lead GM's client touches tokens
  assert.deepEqual(calls.updates, []);
  game.users.activeGM = { isSelf: true };
});

test("a player's cast sends the token update through the GM (socket); the GM's client updates directly", async () => {
  reset();
  const pc = actor("Actor.pc"), me = tok("pc"), ally = tok("ally", { owner: false });
  canvas.scene.tokens.contents = [me, ally];
  game.user.isGM = false;
  await onRollComplete(cast("Light", { targets: [ally], caster: pc, token: me }), { asGm: async (uuid, u) => calls.gm.push([uuid, u]) });
  assert.deepEqual(calls.updates, []);
  assert.deepEqual(calls.gm.map(([u, x]) => [u, x.light.bright]), [["Scene.s.Token.ally", 20]]);
  game.user.isGM = true;
});

test("the token HUD gets a put-out button only on a token we lit; pressing it puts out every layer and the old light comes back", async () => {
  reset();
  const lit = tok("lit", { light: LIGHT, flags: { light: { prev: { bright: 0, dim: 0 }, layers: [layer("continualFlame", "Actor.x", { bright: 20, dim: 40 }, "Continual Flame"), layer("light", "Actor.x", LIGHT)] } } }), plain = tok("plain");
  const html = () => { const h = { inserted: "", handlers: {}, querySelector: (sel) => sel === ".col.left" ? h : (h.inserted.includes("bg3-light-off") ? { addEventListener: (e, fn) => { h.handlers[e] = fn; } } : null), insertAdjacentHTML: (w, s) => { h.inserted += s; } }; return h; };
  const h1 = html();
  onRenderTokenHUD({ object: { document: plain } }, h1);
  assert.equal(h1.inserted, "");
  const h2 = html();
  onRenderTokenHUD({ object: { document: lit } }, h2);
  assert.match(h2.inserted, /bg3-light-off/);
  await h2.handlers.click();
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light]), [["lit", { bright: 0, dim: 0 }]]);
  assert.equal(lit.getFlag("bg3-flow", "light"), undefined);
  await extinguish(plain); // nothing of ours: nothing done
  assert.equal(calls.updates.length, 1);
});

test("registerLight hooks the roll, the effect deletion and the HUD; the strings exist in both languages", () => {
  calls.hooks = [];
  registerLight();
  for (const h of ["midi-qol.RollComplete", "midi-qol.preTargetingV2", "deleteActiveEffect", "renderTokenHUD"]) assert.ok(calls.hooks.includes(h), h);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).BG3FLOW, es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url), "utf8")).BG3FLOW;
  assert.ok(en.Settings.lightSpells?.Name && es.Settings.lightSpells?.Name);
  assert.ok(en.Light?.Off && es.Light?.Off);
});

test("onPreTargetingLight: the SRD Produce Flame's attack with nobody (or only the caster) targeted is stopped before Midi hits the caster: the flame is lit, the action paid, the use refused; with a goblin targeted the throw goes on", async () => {
  reset();
  const dru = actor("Actor.dru"), me = tok("dru"), g = tok("g");
  canvas.scene.tokens.contents = [me, g];
  game.user.targets = new Set();
  const paid = [];
  const wf = (targets) => { game.user.targets = new Set(targets.map((t) => t.object)); return { workflow: { item: { name: "Produce Flame", uuid: "Actor.dru.Item.Produce Flame", system: { properties: new Set() } }, activity: { type: "attack" }, actor: dru, token: me.object }, usage: { midiOptions: {} } }; };
  assert.equal(await onPreTargetingLight(wf([]), { pay: async (a, c) => paid.push([a.uuid, c]) }), false);
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright]), [["dru", 10]]);
  assert.deepEqual(paid, [["Actor.dru", "action"]]);
  calls.updates = [];
  assert.equal(await onPreTargetingLight(wf([me]), { pay: async () => {} }), false); // Midi's self target
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright]), [["dru", 0], ["dru", 10]]);
  calls.updates = [];
  const thrown = [];
  const throwAt = async (workflow, uuids) => thrown.push([workflow.item.name, uuids]);
  assert.equal(await onPreTargetingLight(wf([g]), { pay: async () => {}, throwAt, defer: (fn) => fn() }), false); // the throw: Midi's own use would turn on the caster (the SRD item affects self): stopped, and re-launched on a clone aimed at the goblin
  assert.deepEqual(thrown, [["Produce Flame", ["Scene.s.Token.g"]]]);
  assert.deepEqual(calls.updates, []); // the flame goes out at the re-launched use's RollComplete, not here
  const relaunched = wf([g]); relaunched.usage.midiOptions.workflowOptions = { bg3Throw: true };
  assert.equal(await onPreTargetingLight(relaunched, { pay: async () => {}, throwAt, defer: (fn) => fn() }), undefined); // our own re-launch goes through
  assert.equal(thrown.length, 1);
  const light = wf([]); light.workflow.item.name = "Light"; light.workflow.activity = { type: "utility" };
  assert.equal(await onPreTargetingLight(light, { pay: async () => {} }), undefined); // other spells: not this hook's business
  delete game.user.targets;
});

test("throwFlame: the attack is re-launched through Midi on the clone dnd5e announces, aimed at the creature (target type creature, range 30 ft) by setting the prepared properties, never updateSource (that resets the clone and loses the spellcasting ability from the roll)", async () => {
  const used = [];
  const clone = { uuid: "Actor.dru.Item.pf.Activity.a1", target: { affects: { type: "self", count: "" } }, range: { units: "self", value: null }, updateSource: () => { throw new Error("updateSource resets the clone's prepared data"); } };
  globalThis.MidiQOL = { completeActivityUse: async (activity, config, dialog) => { calls.hookFns["dnd5e.preUseActivity"]?.({ uuid: "other" }); calls.hookFns["dnd5e.preUseActivity"]?.(clone); used.push([activity.uuid, config, dialog]); return {}; } };
  await throwFlame({ activity: { uuid: "Actor.dru.Item.pf.Activity.a1" } }, ["Scene.s.Token.g"]);
  assert.deepEqual([clone.target.affects.type, clone.target.affects.count, clone.range.units, clone.range.value], ["creature", "1", "ft", 30]);
  assert.deepEqual(used, [["Actor.dru.Item.pf.Activity.a1", { midiOptions: { targetUuids: ["Scene.s.Token.g"], ignoreUserTargets: true, workflowOptions: { bg3Throw: true } } }, { configure: false }]]);
  assert.equal(calls.hookFns["dnd5e.preUseActivity"], undefined); // the hook is taken off afterwards
  delete globalThis.MidiQOL;
});
