// Blood Hunter's Crimson Rite: the blood cost paid by itself when a rite's enchantment lands on a weapon, and Rite of the Dawn's light.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = { hooks: [], rolls: [], damage: [], updates: [] };
globalThis.Hooks = { once() {}, on: (h) => calls.hooks.push(h), callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.CONFIG = { DND5E: {} };
globalThis.ChatMessage = { create: async () => {}, getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
const settings = { crimsonRite: true, lightSpells: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { id: "u1", isGM: false }, users: { activeGM: { isSelf: true } }, combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { scene: { tokens: { contents: [] } } };
globalThis.Roll = class { constructor(f, d) { this.formula = f; this.data = d; } async evaluate() { this.total = 4; return this; } async toMessage(m) { calls.rolls.push([this.formula, m.flavor]); } };

const { isRite, onCreateRite, onDeleteRite, registerRites } = await import("../scripts/rites.js");

function hunter({ scale = true } = {}) {
  const actor = { uuid: "Actor.alex", name: "Alexander", isOwner: true,
    getRollData: () => (scale ? { scale: { "blood-hunter": { "hemocraft-die": "1d6" } } } : { scale: {} }),
    applyDamage: async (v, o) => calls.damage.push([v, o]) };
  const f = { "bg3-flow": {} };
  const token = { id: "t", name: "Alexander", uuid: "Scene.s.Token.t", isOwner: true, actor, flags: f, light: { bright: 0, dim: 0 }, getFlag: (m, k) => f[m]?.[k],
    update: async (u) => { calls.updates.push(u); if (u.light) token.light = u.light; if (u["flags.bg3-flow.light"]) f["bg3-flow"].light = u["flags.bg3-flow.light"]; if ("flags.bg3-flow.-=light" in u) delete f["bg3-flow"].light; } };
  canvas.scene.tokens.contents = [token];
  const weapon = { name: "Daga", documentName: "Item", parent: actor };
  return { actor, token, weapon };
}
const rite = (name, weapon, type = "enchantment") => ({ name, type, parent: weapon });
const reset = () => { calls.rolls = []; calls.damage = []; calls.updates = []; };

test("isRite: an enchantment named Rite of ... / Rito de ..., on an item an actor carries", () => {
  const { weapon } = hunter();
  assert.equal(isRite(rite("Rite of the Flame", weapon)), true);
  assert.equal(isRite(rite("Rito del Alba", weapon)), true);
  assert.equal(isRite(rite("Rite of the Flame", weapon, "base")), false); // not an enchantment
  assert.equal(isRite(rite("Blessing of the Forge", weapon)), false);
  assert.equal(isRite(rite("Rite of the Flame", { name: "loose", documentName: "Item", parent: null })), false);
});

test("a rite landing on a weapon: its creator's client rolls the hemocraft die, says so, and applies it as damage nothing reduces; other clients, other enchantments, the setting off and a sheet without the die do nothing", async () => {
  reset();
  const { actor, weapon } = hunter();
  await onCreateRite(rite("Rite of the Flame", weapon), {}, "u1");
  assert.deepEqual(calls.rolls, [["@scale.blood-hunter.hemocraft-die", 'BG3FLOW.Rites.Cost:{"name":"Alexander","rite":"Rite of the Flame"}']]);
  assert.deepEqual(calls.damage, [[4, { ignore: true }]]);
  reset();
  await onCreateRite(rite("Rite of the Flame", weapon), {}, "someone-else");
  await onCreateRite(rite("Blessing of the Forge", weapon), {}, "u1");
  settings.crimsonRite = false;
  await onCreateRite(rite("Rite of the Flame", weapon), {}, "u1");
  settings.crimsonRite = true;
  const bare = hunter({ scale: false });
  await onCreateRite(rite("Rite of the Flame", bare.weapon), {}, "u1");
  assert.deepEqual([calls.rolls, calls.damage], [[], []]);
  void actor;
});

test("Rite of the Dawn lights its wielder's token (bright 20) while the rite lasts and puts the light back when it ends; the other rites light nothing", async () => {
  reset();
  const { token, weapon } = hunter();
  const dawn = rite("Rite of the Dawn", weapon);
  await onCreateRite(dawn, {}, "u1");
  assert.deepEqual([token.light.bright, token.light.dim], [20, 20]);
  assert.deepEqual(token.getFlag("bg3-flow", "light").layers.map((l) => [l.key, l.casterUuid]), [["riteDawn", "Actor.alex"]]);
  await onDeleteRite(dawn, {}, "u1");
  assert.deepEqual([token.light.bright, token.getFlag("bg3-flow", "light")], [0, undefined]);
  reset();
  await onCreateRite(rite("Rite of the Flame", weapon), {}, "u1");
  assert.equal(calls.updates.length, 0);
  await onDeleteRite(rite("Rite of the Flame", weapon), {}, "u1"); // nothing of ours to put out
  assert.equal(calls.updates.length, 0);
});

test("registerRites hooks the effect creation and deletion; the strings exist in both languages", () => {
  calls.hooks = [];
  registerRites();
  for (const h of ["createActiveEffect", "deleteActiveEffect"]) assert.ok(calls.hooks.includes(h), h);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).BG3FLOW, es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url), "utf8")).BG3FLOW;
  assert.ok(en.Rites?.Cost && es.Rites?.Cost);
  assert.ok(en.Settings.crimsonRite?.Name && es.Settings.crimsonRite?.Name);
});
