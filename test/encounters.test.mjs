// Feature 3 hooks against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { flags: [], status: [], warn: [], chat: [], gm: [] };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn: (m) => calls.warn.push(m) } };
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
globalThis.CONFIG = { DND5E: { skills: { ste: { label: "Stealth" }, prc: { label: "Perception" } } }, Canvas: { polygonBackends: { sight: { testCollision: () => false } } } };
let nextId = 0;
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null, prompt: async () => null } } }, utils: { escapeHTML: (s) => s, randomID: () => `id${++nextId}` } };
const settings = { defaultEncounterRadius: 60, obscuredDarkness: 0.5 };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: [], combat: null, combats: [], scenes: new Map(),
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.canvas = null;

function tokenDoc(id, { flags = {}, owner = true, hp = 10, passive = 10, hidden = false, type = "npc", playerOwner = false, roll = async () => [{ total: 10 }] } = {}) {
  const f = { "bg3-flow": { ...flags } };
  const doc = {
    id, name: id, uuid: `Scene.scene.Token.${id}`, isOwner: owner, hidden, flags: f, actorId: `act-${id}`,
    parent: { id: "scene" },
    getCenterPoint: () => ({ x: 0, y: 0 }),
    testUserPermission: () => playerOwner,
    getFlag: (m, k) => f[m]?.[k],
    setFlag: async (m, k, v) => { f[m][k] = v; calls.flags.push([id, k, v]); },
    unsetFlag: async (m, k) => { delete f[m][k]; calls.flags.push([id, k, undefined]); }
  };
  doc.actor = {
    id: `act-${id}`, type, hasPlayerOwner: playerOwner,
    system: { attributes: { hp: { value: hp } }, skills: { prc: { passive } } },
    toggleStatusEffect: async (s, o) => calls.status.push([id, s, o.active]),
    getActiveTokens: () => [doc],
    rollSkill: roll
  };
  return doc;
}

const { markEncounter, onSceneControls, hideToken, revealToken, onPostUseActivityReveal, onRenderTokenHUD } = await import("../scripts/encounters.js");

test("markEncounter sets one shared id and the radius on every token, and clears when all are marked", async () => {
  const a = tokenDoc("g1"), b = tokenDoc("g2");
  calls.flags = [];
  await markEncounter([a, b], 45);
  const fa = a.getFlag("bg3-flow", "encounter"), fb = b.getFlag("bg3-flow", "encounter");
  assert.equal(fa.id, fb.id);
  assert.deepEqual([fa.radius, fb.radius], [45, 45]);
  calls.flags = [];
  await markEncounter([a, b], 45);
  assert.deepEqual(calls.flags, [["g1", "encounter", undefined], ["g2", "encounter", undefined]]);
});

test("onSceneControls adds a GM-only button tool under tokens", () => {
  const controls = { tokens: { tools: {} } };
  game.user.isGM = true;
  onSceneControls(controls);
  const tool = controls.tokens.tools.bg3Encounter;
  assert.equal(tool.button, true);
  assert.equal(tool.visible, true);
  assert.equal(typeof tool.onChange, "function");
  game.user.isGM = false;
  onSceneControls(controls);
  assert.equal(controls.tokens.tools.bg3Encounter.visible, false);
  game.user.isGM = true;
});

test("hideToken stores the Stealth value and turns the hiding status on; again clears it", async () => {
  const r = tokenDoc("r");
  calls.flags = []; calls.status = [];
  await hideToken(r, async () => 13);
  assert.deepEqual(r.getFlag("bg3-flow", "stealth"), { value: 13, hidden: true, checked: [] });
  assert.deepEqual(calls.status, [["r", "hiding", true]]);
  calls.flags = []; calls.status = [];
  await hideToken(r, async () => 99);
  assert.equal(r.getFlag("bg3-flow", "stealth"), undefined);
  assert.deepEqual(calls.status, [["r", "hiding", false]]);
});

test("hideToken does nothing when the dialog is closed, and re-hides over a darkness-only value", async () => {
  const r = tokenDoc("r2");
  calls.flags = []; calls.status = [];
  await hideToken(r, async () => null);
  assert.deepEqual(calls.flags, []);
  assert.deepEqual(calls.status, []);
  const d = tokenDoc("r3", { flags: { stealth: { value: 8, hidden: false, checked: ["g"] } } });
  await hideToken(d, async () => 16);
  assert.deepEqual(d.getFlag("bg3-flow", "stealth"), { value: 16, hidden: true, checked: [] });
});

test("an attack or save activity reveals the actor's stealthy tokens; other activities do not", async () => {
  const r = tokenDoc("r4", { flags: { stealth: { value: 15, hidden: true, checked: [] } } });
  calls.status = [];
  await onPostUseActivityReveal({ type: "utility", actor: r.actor });
  assert.equal(r.getFlag("bg3-flow", "stealth").value, 15);
  await onPostUseActivityReveal({ type: "attack", actor: r.actor });
  assert.equal(r.getFlag("bg3-flow", "stealth"), undefined);
  assert.deepEqual(calls.status, [["r4", "hiding", false]]);
  await revealToken(r); // idempotent
  assert.equal(r.getFlag("bg3-flow", "stealth"), undefined);
});

test("renderTokenHUD adds the Hide button only for owned tokens", () => {
  const added = []; const clicks = [];
  const col = { insertAdjacentHTML: (pos, h) => added.push(h), querySelector: () => ({ addEventListener: (ev, fn) => clicks.push(fn) }) };
  const html = { querySelector: (sel) => sel === ".col.left" ? col : null };
  onRenderTokenHUD({ object: { document: tokenDoc("r5", { owner: true }) } }, html);
  assert.equal(added.length, 1);
  assert.match(added[0], /fa-eye-slash/);
  assert.equal(clicks.length, 1);
  onRenderTokenHUD({ object: { document: tokenDoc("g9", { owner: false }) } }, html);
  assert.equal(added.length, 1);
});
