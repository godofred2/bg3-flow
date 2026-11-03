// Feature 3 hooks against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { flags: [], status: [], warn: [], chat: [], gm: [] };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn: (m) => calls.warn.push(m) } };
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
globalThis.CONFIG = { DND5E: { skills: { ste: { label: "Stealth" }, prc: { label: "Perception" } } }, Canvas: { polygonBackends: { sight: { testCollision: () => false } } } };
let nextId = 0;
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: class { constructor(c) { this.config = c; } render() { return this; } addEventListener() {} async close() {} static async wait() { return null; } static async prompt() { return null; } } } }, utils: { escapeHTML: (s) => s, randomID: () => `id${++nextId}` } };
const settings = { defaultEncounterRadius: 60, obscuredDarkness: 0.5 };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: [], combat: null, combats: [], scenes: new Map(),
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.canvas = null;

function tokenDoc(id, { flags = {}, owner = true, hp = 10, passive = 10, hidden = false, type = "npc", playerOwner = false, at = { x: 0, y: 0 }, roll = async () => [{ total: 10 }] } = {}) {
  const f = { "bg3-flow": { ...flags } };
  const doc = {
    id, name: id, uuid: `Scene.scene.Token.${id}`, isOwner: owner, hidden, flags: f, actorId: `act-${id}`,
    parent: { id: "scene" },
    getCenterPoint: () => at,
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

const { markEncounter, onSceneControls, hideToken, revealToken, onPostUseActivityReveal, onRenderTokenHUD, onMoveToken, startEncounter, onApplyDamage, onRollComplete, registerEncounters } = await import("../scripts/encounters.js");

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

// ---- Detection ----
// 100 px per 5 ft square. Enemies at x=400 are 20 ft from a player at x=0.
function scene(tokens, { darkness = 0, wall = false } = {}) {
  globalThis.canvas = {
    ready: true, scene: { id: "scene", tokens: { contents: tokens } },
    grid: { measurePath: ([a, b]) => ({ distance: Math.hypot(b.x - a.x, b.y - a.y) / 100 * 5 }) },
    effects: { getDarknessLevel: () => darkness }
  };
  CONFIG.Canvas.polygonBackends.sight.testCollision = () => wall;
}
const enemy = (id, opts = {}) => tokenDoc(id, { flags: { encounter: { id: "g", radius: 30 } }, at: { x: 400, y: 0 }, ...opts });
const player = (id, opts = {}) => tokenDoc(id, { type: "character", playerOwner: true, ...opts });
let started = [];
const deps = () => ({ start: async (s, g) => started.push([s, g]), ask: async () => 11, roll: async () => 7 });
function reset() { started = []; calls.flags = []; calls.chat = []; game.user.isGM = true; game.combat = null; game.users = [{ id: "p1", active: true, isGM: false }]; game.users.activeGM = { isSelf: true }; }

test("an enemy in radius with line of sight spots an unobscured player and starts the encounter", async () => {
  reset(); const e = enemy("g1"); scene([e, player("pc")]);
  await onMoveToken(player("pc"), {}, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
  assert.equal(calls.chat.length, 1);
});

test("hidden player: passive Perception below Stealth and a failed Perception roll keep the encounter closed", async () => {
  reset(); const pc = player("pc", { flags: { stealth: { value: 15, hidden: true, checked: [] } } });
  scene([enemy("g1", { passive: 12, roll: async () => [{ total: 10 }] }), pc]);
  await onMoveToken(pc, {}, {}, null, deps());
  assert.deepEqual(started, []);
  assert.deepEqual(pc.getFlag("bg3-flow", "stealth").checked, ["g"]);
});

test("hidden player: passive Perception meeting Stealth starts the encounter", async () => {
  reset(); const pc = player("pc", { flags: { stealth: { value: 15, hidden: true, checked: [] } } });
  scene([enemy("g1", { passive: 15, roll: async () => [{ total: 1 }] }), pc]);
  await onMoveToken(pc, {}, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
});

test("hidden player: a Perception roll meeting Stealth starts the encounter", async () => {
  reset(); const pc = player("pc", { flags: { stealth: { value: 15, hidden: true, checked: ["g"] } } });
  scene([enemy("g1", { passive: 5, roll: async () => [{ total: 15 }] }), pc]);
  await onMoveToken(pc, {}, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
});

test("the passive check runs once per group: an already checked group only gets the active roll", async () => {
  reset(); const pc = player("pc", { flags: { stealth: { value: 15, hidden: true, checked: ["g"] } } });
  scene([enemy("g1", { passive: 20, roll: async () => [{ total: 3 }] }), pc]);
  await onMoveToken(pc, {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("a dark square asks the active owner for Stealth once and stores it with hidden:false", async () => {
  reset(); const pc = player("pc"); let asked = 0;
  scene([enemy("g1", { passive: 10, roll: async () => [{ total: 10 }] }), pc], { darkness: 0.6 });
  const d = { ...deps(), ask: async () => { asked++; return 11; } };
  await onMoveToken(pc, {}, {}, null, d);
  assert.equal(asked, 1);
  assert.deepEqual(pc.getFlag("bg3-flow", "stealth"), { value: 11, hidden: false, checked: ["g"] });
  assert.deepEqual(started, []);
  await onMoveToken(pc, {}, {}, null, d);
  assert.equal(asked, 1);
});

test("no active owner: the GM rolls or types instead", async () => {
  reset(); game.users = []; game.users.activeGM = { isSelf: true }; const pc = player("pc"); let gmRolled = 0;
  scene([enemy("g1", { passive: 1, roll: async () => [{ total: 1 }] }), pc], { darkness: 0.6 });
  await onMoveToken(pc, {}, {}, null, { ...deps(), roll: async () => { gmRolled++; return 18; } });
  assert.equal(gmRolled, 1);
  assert.equal(pc.getFlag("bg3-flow", "stealth").value, 18);
});

test("outside the radius, behind a wall, defeated or hidden enemies: nothing happens", async () => {
  reset(); const pc = player("pc");
  scene([enemy("far", { at: { x: 700, y: 0 } }), enemy("dead", { hp: 0 }), enemy("ghost", { hidden: true })]);
  await onMoveToken(pc, {}, {}, null, deps());
  scene([enemy("g1")], { wall: true });
  await onMoveToken(pc, {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("a token with a prompt still open is skipped", async () => {
  reset(); const pc = player("pc"); let asked = 0; let release;
  scene([enemy("g1", { passive: 1 }), pc], { darkness: 0.6 });
  const slow = { ...deps(), ask: () => { asked++; return new Promise((r) => { release = r; }); } };
  const first = onMoveToken(pc, {}, {}, null, slow);
  await new Promise((r) => setTimeout(r, 0));
  await onMoveToken(pc, {}, {}, null, slow);
  assert.equal(asked, 1);
  release(12); await first;
});

test("non-GM client, running combat, or NPC mover: ignored", async () => {
  reset(); scene([enemy("g1"), player("pc")]);
  game.users.activeGM = { isSelf: false }; await onMoveToken(player("pc"), {}, {}, null, deps());
  game.users.activeGM = { isSelf: true }; game.combat = { started: true }; await onMoveToken(player("pc"), {}, {}, null, deps());
  game.combat = null; await onMoveToken(tokenDoc("npc"), {}, {}, null, deps());
  assert.deepEqual(started, []);
});

// ---- Starting combat and triggers ----
function fakeCombat() {
  const combat = {
    combatants: [], init: [], npc: 0, started: 0,
    createEmbeddedDocuments: async (name, data) => { data.forEach((d, i) => combat.combatants.push({ id: `c${i}`, ...d })); return combat.combatants; },
    rollInitiative: async (ids) => combat.init.push(ids),
    rollNPC: async () => combat.npc++,
    startCombat: async () => combat.started++
  };
  return combat;
}
function world(tokens, { existing = [] } = {}) {
  game.scenes = new Map([["scene", { id: "scene", tokens: { contents: tokens } }]]);
  game.combats = existing;
  const combat = fakeCombat();
  globalThis.Combat = { create: async (d) => { combat.data = d; return combat; } };
  return combat;
}

test("startEncounter builds the combat from the group and the player characters, PCs roll on their clients, NPCs on the GM, reveals and starts", async () => {
  reset();
  const pc1 = player("pc1", { flags: { stealth: { value: 15, hidden: true, checked: [] } } });
  const pc2 = player("pc2"); pc2.testUserPermission = () => false; // owner offline
  const combat = world([enemy("g1"), enemy("g2"), pc1, pc2, tokenDoc("villager")]);
  const asked = [];
  calls.status = [];
  const out = await startEncounter("scene", "g", { askInit: async (u, cb, c) => { asked.push([u, cb, c]); combat.combatants.find((x) => x.id === c).initiative = 12; return 12; } });
  assert.equal(out, combat);
  assert.deepEqual(combat.data, { scene: "scene", active: true });
  assert.deepEqual(combat.combatants.map((c) => c.tokenId), ["g1", "g2", "pc1", "pc2"]);
  assert.deepEqual(combat.combatants.map((c) => [c.sceneId, c.actorId]), [["scene", "act-g1"], ["scene", "act-g2"], ["scene", "act-pc1"], ["scene", "act-pc2"]]);
  assert.deepEqual(asked, [["p1", combat.id, "c2"]]);
  assert.deepEqual(combat.init, [["c3"]]);
  assert.equal(combat.npc, 1);
  assert.equal(combat.started, 1);
  assert.equal(pc1.getFlag("bg3-flow", "stealth"), undefined);
  assert.deepEqual(calls.status, [["pc1", "hiding", false]]);
});

test("startEncounter is a no-op when a combat exists on the scene, while one is starting, or without live enemies", async () => {
  reset();
  world([enemy("g1"), player("pc")], { existing: [{ scene: { id: "scene" }, started: true }] });
  assert.equal(await startEncounter("scene", "g"), null);
  const combat = world([enemy("g1"), player("pc")]);
  let release;
  const first = startEncounter("scene", "g", { askInit: () => new Promise((r) => { release = r; }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await startEncounter("scene", "g"), null);
  release(9); assert.equal(await first, combat);
  world([enemy("dead", { hp: 0 }), enemy("ghost", { hidden: true }), player("pc")]);
  assert.equal(await startEncounter("scene", "g"), null);
});

test("applyDamage on an encounter enemy outside combat asks the GM to start that group", async () => {
  reset(); const told = [];
  const e = enemy("g1"); e.actor.token = e;
  await onApplyDamage(e.actor, 5, {}, { tell: async (s, g) => told.push([s, g]) });
  await onApplyDamage(e.actor, 0, {}, { tell: async (s, g) => told.push([s, g]) });
  game.combat = { started: true };
  await onApplyDamage(e.actor, 5, {}, { tell: async (s, g) => told.push([s, g]) });
  game.combat = null;
  await onApplyDamage(player("pc").actor, 5, {}, { tell: async (s, g) => told.push([s, g]) });
  assert.deepEqual(told, [["scene", "g"]]);
});

test("RollComplete by an encounter enemy with hits, or hitting one, starts; with no hits does nothing", async () => {
  reset(); const told = [];
  const tell = async (s, g) => told.push([s, g]);
  const e = enemy("g1"), pc = player("pc");
  await onRollComplete({ token: { document: e }, hitTargets: new Set([{ document: pc }]) }, { tell });
  await onRollComplete({ token: { document: pc }, hitTargets: new Set([{ document: e }]) }, { tell });
  await onRollComplete({ token: { document: e }, hitTargets: new Set() }, { tell });
  await onRollComplete({ token: { document: pc }, hitTargets: new Set([{ document: tokenDoc("villager") }]) }, { tell });
  assert.deepEqual(told, [["scene", "g"], ["scene", "g"]]);
});

test("registerEncounters hooks the events it needs", () => {
  const names = [];
  globalThis.Hooks.on = (n) => names.push(n);
  registerEncounters();
  for (const h of ["getSceneControlButtons", "renderTokenHUD", "moveToken", "dnd5e.postUseActivity", "dnd5e.applyDamage", "midi-qol.RollComplete", "combatStart", "canvasReady"]) assert.ok(names.includes(h), h);
  globalThis.Hooks.on = () => {};
});

test("a player whose client could not roll (null or error) is rolled by the GM, and the combat still starts", async () => {
  reset();
  const pc1 = player("pc1"), pc2 = player("pc2");
  const combat = world([enemy("g1"), pc1, pc2]);
  let n = 0;
  const out = await startEncounter("scene", "g", { askInit: async () => { n++; if (n === 1) return null; throw new Error("socket timeout"); } });
  assert.equal(out, combat);
  assert.deepEqual(combat.init, [["c1"], ["c2"]]);
  assert.equal(combat.started, 1);
});

test("the combat is deleted when starting it fails after creation, so the scene is not blocked", async () => {
  reset();
  const combat = world([enemy("g1"), player("pc")]);
  combat.rollNPC = async () => { throw new Error("boom"); };
  combat.delete = async () => { combat.deleted = true; };
  await assert.rejects(() => startEncounter("scene", "g", { askInit: async () => 10 }));
  assert.equal(combat.deleted, true);
});

test("only the lead GM detects and starts; an unstarted leftover combat does not block", async () => {
  reset(); game.users.activeGM = { isSelf: false };
  scene([enemy("g1"), player("pc")]);
  await onMoveToken(player("pc"), {}, {}, null, deps());
  assert.deepEqual(started, []);
  world([enemy("g1"), player("pc")]);
  assert.equal(await startEncounter("scene", "g"), null);
  reset();
  const combat = world([enemy("g1"), player("pc")], { existing: [{ scene: { id: "scene" }, started: false }] });
  assert.equal(await startEncounter("scene", "g", { askInit: async () => 10 }), combat);
});

test("a move on a scene the GM is not viewing is ignored", async () => {
  reset(); scene([enemy("g1")]);
  const pc = player("pc"); pc.parent = { id: "other" };
  await onMoveToken(pc, {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("a dismissed Stealth prompt is remembered per group: no re-prompt, seen on line of sight", async () => {
  reset(); const pc = player("pc"); let asked = 0;
  scene([enemy("g1", { passive: 1 })], { darkness: 0.6, wall: true });
  const d = { ...deps(), ask: async () => { asked++; return null; }, roll: async () => null };
  await onMoveToken(pc, {}, {}, null, d);
  await onMoveToken(pc, {}, {}, null, d);
  assert.equal(asked, 1);
  assert.deepEqual(pc.getFlag("bg3-flow", "stealth"), { value: null, hidden: false, checked: ["g"] });
  assert.deepEqual(started, []);
  CONFIG.Canvas.polygonBackends.sight.testCollision = () => false;
  await onMoveToken(pc, {}, {}, null, d);
  assert.deepEqual(started, [["scene", "g"]]);
});

test("a player-owned familiar (not a character) neither triggers detection nor joins the combat", async () => {
  reset(); scene([enemy("g1"), player("pc")]);
  await onMoveToken(tokenDoc("owl", { type: "npc", playerOwner: true }), {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("RollComplete copes with TokenDocuments in hitTargets", async () => {
  reset(); const told = [];
  await onRollComplete({ token: { document: player("pc") }, hitTargets: new Set([enemy("g1")]) }, { tell: async (s, g) => told.push([s, g]) });
  assert.deepEqual(told, [["scene", "g"]]);
});
