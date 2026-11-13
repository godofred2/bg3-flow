// Light spells against stubbed Foundry globals: the token's light follows Light, Produce Flame, Continual Flame, Daylight and Faerie Fire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = { hooks: [], updates: [], gm: [] };
globalThis.Hooks = { once() {}, on: (h) => calls.hooks.push(h), callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.CONFIG = { DND5E: {} };
const settings = { lightSpells: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: { activeGM: { isSelf: true } }, combat: null, scenes: [],
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { scene: { tokens: { contents: [] } } };

const { lightSpell, onRollComplete, onDeleteEffect, onRenderTokenHUD, extinguish, registerLight } = await import("../scripts/light.js");

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
const cast = (name, { activityType = "utility", targets = [], failed = [], caster, token, aborted = false, concentration = false } = {}) => ({
  aborted, activity: { type: activityType }, item: { name, uuid: `${caster.uuid}.Item.${name}`, system: { properties: new Set(concentration ? ["concentration"] : []) } },
  actor: caster, token: token?.object, targets: new Set(targets.map((d) => d.object)), failedSaves: new Set(failed.map((d) => d.object))
});
const reset = () => { calls.updates = []; calls.gm = []; canvas.scene.tokens.contents = []; game.user.isGM = true; };

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
  assert.deepEqual([u.light.bright, u.light.dim], [20, 40]);
  assert.deepEqual(u["flags.bg3-flow.light"], { prev: { bright: 5, dim: 10, color: "#ff0000" }, key: "light", casterUuid: "Actor.cleric", itemUuid: "Actor.cleric.Item.Light", concentration: false });
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

test("Continual Flame and Daylight stack on several targets (no single-cast rule); a second Light caster does not put out the first caster's", async () => {
  reset();
  const a = actor("Actor.a"), b = actor("Actor.b"), ta = tok("ta"), tb = tok("tb"), t1 = tok("t1"), t2 = tok("t2");
  canvas.scene.tokens.contents = [ta, tb, t1, t2];
  await onRollComplete(cast("Continual Flame", { targets: [t1], caster: a, token: ta }));
  await onRollComplete(cast("Continual Flame", { targets: [t2], caster: a, token: ta }));
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright]), [["t1", 20], ["t2", 20]]);
  calls.updates = [];
  await onRollComplete(cast("Light", { targets: [t1], caster: a, token: ta })); // our Light over a Continual Flame: the flame is what comes back later
  assert.deepEqual(t1.getFlag("bg3-flow", "light").prev, { bright: 0, dim: 0, color: null }); // the first flag's prev is kept
  await onRollComplete(cast("Light", { targets: [t2], caster: b, token: tb }));
  assert.deepEqual(calls.updates.map(([i]) => i), ["t1", "t2"]); // b's cast did not touch a's
  await onRollComplete(cast("Daylight", { targets: [t1], caster: b, token: tb }));
  assert.deepEqual(calls.updates.at(-1)[1].light, { bright: 60, dim: 120, color: "#ffffff", alpha: 0.1, animation: { type: null } });
});

test("Produce Flame lights the caster's own token; throwing it (the attack activity) puts it out; recasting keeps one flame", async () => {
  reset();
  const dru = actor("Actor.dru"), me = tok("dru");
  canvas.scene.tokens.contents = [me];
  await onRollComplete(cast("Produce Flame", { caster: dru, token: me }));
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright, x.light.dim]), [["dru", 10, 20]]);
  calls.updates = [];
  await onRollComplete(cast("Produce Flame", { caster: dru, token: me }));
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright]), [["dru", 0], ["dru", 10]]); // off, then on again
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
  assert.deepEqual(calls.updates.map(([i, x]) => [i, x.light.bright, x.light.dim, x["flags.bg3-flow.light"].concentration]), [["g1", 0, 10, true], ["g2", 0, 10, true]]);
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

test("the token HUD gets a put-out button only on a token we lit; pressing it puts the old light back", async () => {
  reset();
  const lit = tok("lit", { light: { bright: 20, dim: 40 }, flags: { light: { prev: { bright: 0, dim: 0 }, key: "light", casterUuid: "Actor.x", itemUuid: "I", concentration: false } } }), plain = tok("plain");
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
  for (const h of ["midi-qol.RollComplete", "deleteActiveEffect", "renderTokenHUD"]) assert.ok(calls.hooks.includes(h), h);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).BG3FLOW, es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url), "utf8")).BG3FLOW;
  assert.ok(en.Settings.lightSpells?.Name && es.Settings.lightSpells?.Name);
  assert.ok(en.Light?.Off && es.Light?.Off);
});
