// Monster features the SRD import leaves to the table (Engulf), against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = { hooks: [], created: [], gm: [], chat: [] };
globalThis.Hooks = { once() {}, on: (h) => calls.hooks.push(h), callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.CONFIG = { DND5E: {} };
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: { activeGM: { isSelf: true } }, combat: null, scenes: [],
  settings: { get: () => undefined, set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { scene: { tokens: { contents: [] } } };
globalThis.MidiQOL = { socket: () => ({ executeAsGM: async (name, data) => calls.gm.push([name, data]) }) };

const { isEngulf, onRollCompleteFeatures, registerFeatures } = await import("../scripts/features.js");

const victim = (id, { owner = true, effects = [] } = {}) => { const a = { uuid: `Actor.${id}`, name: id, isOwner: owner, effects, createEmbeddedDocuments: async (type, data) => { calls.created.push([id, type, ...data]); return data; } }; return { document: { id: `tok-${id}`, name: id, actor: a } }; };
const engulf = ({ name = "Engulf", failed = [], targets = failed, effects = 0, aborted = false, dc = 12 } = {}) => ({
  aborted, item: { name, uuid: "Actor.cube.Item.engulf", img: "icons/engulf.webp", effects: { size: effects } }, actor: { name: "Gelatinous Cube" }, token: { document: { name: "Gelatinous Cube", uuid: "Scene.s.Token.cube" } },
  activity: { type: "save", save: { dc: { value: dc } } }, targets: new Set(targets), failedSaves: new Set(failed)
});
const reset = () => { calls.created = []; calls.gm = []; calls.chat = []; game.user.isGM = true; };

test("isEngulf: the SRD feature by name, English or Spanish", () => {
  assert.equal(isEngulf("Engulf"), true);
  assert.equal(isEngulf(" engullir "), true);
  assert.equal(isEngulf("Engulfing Maw"), false);
  assert.equal(isEngulf(null), false);
});

test("Engulf: a creature that fails the save gets an Engulfed effect (Restrained, the cube as origin) and the table is told the escape; a save, another feature, an item with its own effects, an aborted use or a creature already engulfed by this cube get nothing", async () => {
  reset();
  const rogue = victim("rogue"), fighter = victim("fighter"), cleric = victim("cleric");
  await onRollCompleteFeatures(engulf({ failed: [rogue, fighter], targets: [rogue, fighter, cleric] }));
  assert.deepEqual(calls.created.map(([id, type, e]) => [id, type, e.name, e.statuses, e.origin, e.img, e.flags["bg3-flow"]]),
    [["rogue", "ActiveEffect", "BG3FLOW.Features.Engulfed:{\"name\":\"Gelatinous Cube\"}", ["restrained"], "Actor.cube.Item.engulf", "icons/engulf.webp", { engulfedBy: "Scene.s.Token.cube" }],
     ["fighter", "ActiveEffect", "BG3FLOW.Features.Engulfed:{\"name\":\"Gelatinous Cube\"}", ["restrained"], "Actor.cube.Item.engulf", "icons/engulf.webp", { engulfedBy: "Scene.s.Token.cube" }]]);
  assert.ok(calls.created[0][2].description.includes("BG3FLOW.Features.EngulfedHint"));
  assert.deepEqual(calls.chat.map((m) => m.content), ['BG3FLOW.Features.EngulfedLine:{"names":"rogue, fighter","by":"Gelatinous Cube","dc":12}']);
  reset();
  await onRollCompleteFeatures(engulf({ failed: [], targets: [rogue] })); // saved
  await onRollCompleteFeatures(engulf({ name: "Bite", failed: [rogue] })); // not Engulf
  await onRollCompleteFeatures(engulf({ failed: [rogue], effects: 1 })); // an automated item (2024, CPR) carries its own effect
  await onRollCompleteFeatures(engulf({ failed: [rogue], aborted: true }));
  const held = victim("held", { effects: [{ origin: "Actor.cube.Item.engulf", flags: { "bg3-flow": { engulfedBy: "Scene.s.Token.cube" } } }] });
  await onRollCompleteFeatures(engulf({ failed: [held] }));
  assert.deepEqual([calls.created, calls.chat], [[], []]);
});

test("a player's client (the DM's cube is rare, but a summoned or charmed one is not) creates the effect through Midi's GM socket when it does not own the victim", async () => {
  reset(); game.user.isGM = false;
  const goblin = victim("goblin", { owner: false });
  await onRollCompleteFeatures(engulf({ failed: [goblin] }));
  assert.deepEqual(calls.created, []);
  assert.deepEqual(calls.gm.map(([n, d]) => [n, d.actorUuid, d.effects[0].statuses]), [["createEffects", "Actor.goblin", ["restrained"]]]);
  game.user.isGM = true;
});

test("registerFeatures hooks RollComplete; the strings exist in both languages", () => {
  calls.hooks = [];
  registerFeatures();
  assert.ok(calls.hooks.includes("midi-qol.RollComplete"));
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).BG3FLOW, es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url), "utf8")).BG3FLOW;
  for (const k of ["Engulfed", "EngulfedHint", "EngulfedLine"]) { assert.ok(en.Features?.[k], k); assert.ok(es.Features?.[k], k); }
});
