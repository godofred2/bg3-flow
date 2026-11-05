// Piece 4: board snapshot against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} }, controls: { render() {} } };
globalThis.ChatMessage = { create: async () => {} };
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: class {} } }, utils: { escapeHTML: (s) => s, randomID: () => "id" } };
globalThis.Roll = { replaceFormulaData: (f, d) => f.replace(/@(\w+)/g, (_, k) => d[k] ?? 0) };
const settings = { obscuredDarkness: 0.5 };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: [], combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
// Square grid, 100 px = 5 ft, horizontal paths; a wall blocks anything below y = 300.
const SIZE = 100, FT = 5;
const off = (p) => ({ i: Math.floor(p.y / SIZE), j: Math.floor(p.x / SIZE) });
const center = (o) => ({ x: o.j * SIZE + SIZE / 2, y: o.i * SIZE + SIZE / 2 });
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / SIZE * FT;
globalThis.CONFIG = {
  DND5E: { movementTypes: { walk: {} }, abilities: {} },
  Token: { movement: { actions: { walk: {} } } },
  Canvas: { polygonBackends: { sight: { testCollision: (a, b) => b.y > 300 } } }
};
globalThis.canvas = {
  ready: true, dimensions: { size: SIZE, distance: FT },
  scene: { id: "scene", tokens: { contents: [] }, environment: { globalLight: { enabled: false } } },
  effects: { getDarknessLevel: () => 0, testInsideLight: () => false, testInsideDarkness: () => false },
  grid: {
    getOffset: (p) => off("i" in p ? center(p) : p),
    getCenterPoint: (p) => center("i" in p ? p : off(p)),
    getTopLeftPoint: (o) => ({ x: o.j * SIZE, y: o.i * SIZE }),
    getAdjacentOffsets: (o) => [-1, 0, 1].flatMap((di) => [-1, 0, 1].map((dj) => ({ i: o.i + di, j: o.j + dj }))).filter((n) => (n.i !== o.i || n.j !== o.j) && n.i >= 0 && n.j >= 0),
    getDirectPath: (points) => {
      const out = [];
      for (let k = 1; k < points.length; k++) {
        const a = off(points[k - 1]), b = off(points[k]);
        const n = Math.max(Math.abs(b.i - a.i), Math.abs(b.j - a.j));
        for (let s = k === 1 ? 0 : 1; s <= n; s++) out.push({ i: a.i + Math.sign(b.i - a.i) * s, j: a.j + Math.sign(b.j - a.j) * s });
      }
      return out;
    },
    measurePath: (points) => {
      let total = 0;
      const waypoints = points.map((p, k) => { if (k) total += dist(points[k - 1], p); return { distance: total }; });
      return { distance: total, waypoints };
    }
  }
};

let n = 0;
function act({ type, activation = "action", toHit = "+0", parts = [], item = {}, range = null, save = null, uses = null, spell = null, affects = "creature", template = null, canUse = true, name = "X" } = {}) {
  const id = `a${++n}`;
  const actor = { system: { spells: { spell1: { value: spell?.slots ?? 0 } } } };
  const it = { type: item.type ?? "feat", name, system: { range: item.range ?? {}, uses: { max: "", value: 0 }, level: spell?.level ?? 0 }, actor };
  return {
    id, uuid: `A.${id}`, name, type, item: it, actor, canUse,
    activation: { type: activation }, range: range ?? { value: null, units: "", override: false },
    target: { affects: { type: affects }, template: { type: template } },
    uses: { max: uses?.max ?? "", value: uses?.value ?? 0 },
    requiresSpellSlot: !!spell, labels: { toHit },
    save: save && { dc: { value: save.dc }, ability: new Set([save.ability]) }, damage: { onSave: save?.onSave },
    getDamageConfig: () => ({ rolls: parts.map(([f, d]) => ({ parts: [f], data: d })) })
  };
}

function token(id, { x, y = 0, disposition, hp = 10, maxHp = 10, ac = 15, int = 10, passive = 9, darkvision = 0, speed = 30, spent = 0, items = [], hidden = false, flags = {}, width = 1 } = {}) {
  const doc = {
    id, name: id, x, y, elevation: 0, hidden, disposition, parent: { id: "scene" }, uuid: `Scene.scene.Token.${id}`, width, height: width,
    flags: { "bg3-flow": flags }, getFlag: (m, k) => doc.flags[m]?.[k],
    getCenterPoint: (d) => ({ x: (d?.x ?? doc.x) + width * SIZE / 2, y: (d?.y ?? doc.y) + width * SIZE / 2 }),
    movementHistory: spent ? [{ cost: spent }] : [],
    object: { findMovementPath: (wps) => ({ promise: Promise.resolve(wps) }) }
  };
  doc.actor = {
    name: id, items, hasPlayerOwner: disposition > 0,
    system: {
      attributes: { hp: { value: hp, max: maxHp }, ac: { value: ac }, movement: { speeds: { walk: speed } }, senses: { ranges: { darkvision } } },
      abilities: { int: { value: int }, dex: { save: { value: 2 } } }, skills: { prc: { passive } }
    }
  };
  return doc;
}
const combatantOf = (doc, defeated = false) => ({ id: `c-${doc.id}`, token: doc, actor: doc.actor, isDefeated: defeated, flags: { "bg3-flow": {} }, getFlag: () => undefined });

const { activityInfo, snapshot } = await import("../scripts/ai/board.js");

test("activityInfo: a goblin's scimitar and shortbow as Plutonium imports them", () => {
  n = 0;
  const scimitar = act({ name: "Scimitar", type: "attack", toHit: "+4", parts: [["1d6 + @mod", { mod: 2 }]], item: { type: "weapon", range: { reach: 5, value: null } } });
  assert.deepEqual(activityInfo(scimitar), { id: "a1", uuid: "A.a1", name: "Scimitar", kind: "attack", slot: "action", range: 5, bonus: 4, dc: undefined, saveAbility: undefined, onSave: undefined, damage: 5.5, healing: 0 });
  const bow = act({ name: "Shortbow", type: "attack", toHit: "+4", parts: [["1d6 + 2", {}]], item: { type: "weapon", range: { reach: null, value: 80, long: 320 } } });
  assert.equal(activityInfo(bow).range, 80);
});

test("activityInfo: save activity, spell slot check, uses, self targets, areas, utility, legendary", () => {
  const save = activityInfo(act({ type: "save", save: { dc: 13, ability: "dex", onSave: "half" }, parts: [["2d6", {}]], range: { value: 60, units: "ft" } }));
  assert.deepEqual([save.kind, save.dc, save.saveAbility, save.onSave, save.damage, save.range], ["save", 13, "dex", "half", 7, 60]);
  assert.equal(activityInfo(act({ type: "attack", spell: { level: 1, slots: 0 } })), null);
  assert.equal(activityInfo(act({ type: "attack", spell: { level: 1, slots: 1 } })).kind, "attack");
  assert.equal(activityInfo(act({ type: "attack", uses: { max: 1, value: 0 } })), null);
  assert.equal(activityInfo(act({ type: "attack", uses: { max: 1, value: 1 } })).kind, "attack");
  assert.equal(activityInfo(act({ type: "heal", activation: "bonus", affects: "self" })), null);
  assert.equal(activityInfo(act({ type: "heal", activation: "bonus", parts: [["1d4 + 2", {}]] })), null); // heals aim at allies: 4b
  assert.equal(activityInfo(act({ type: "save", template: "cone" })), null);
  assert.equal(activityInfo(act({ type: "utility" })), null);
  assert.equal(activityInfo(act({ type: "attack", activation: "legendary" })), null);
  assert.equal(activityInfo(act({ type: "attack", canUse: false })), null);
  assert.equal(activityInfo(act({ type: "attack", range: { value: null, units: "touch" } })).range, 5);
});

test("snapshot: enemies, visibility through walls, paths cut at the budget, occupied squares, Multiattack text, budget", async () => {
  const items = [
    { name: "Scimitar", type: "weapon", system: { activities: [act({ name: "Scimitar", type: "attack", toHit: "+4", parts: [["1d6 + 2", {}]], item: { type: "weapon", range: { reach: 5 } } })] } },
    { name: "Shortbow", type: "weapon", system: { activities: [act({ name: "Shortbow", type: "attack", toHit: "+4", parts: [["1d6 + 2", {}]], item: { type: "weapon", range: { value: 80 } } })] } },
    { name: "Multiattack", type: "feat", system: { activities: [], description: { value: "<p>The goblin makes two attacks: one with its scimitar and one with its shortbow.</p>" } } },
    { name: "Nimble Escape", type: "feat", system: { activities: [act({ type: "utility", activation: "bonus" })] } }
  ];
  const goblin = token("goblin", { x: 0, disposition: -1, int: 10, speed: 30, spent: 10, items });
  const goblin2 = token("goblin2", { x: 200, disposition: -1 });
  const rogue = token("rogue", { x: 400, disposition: 1, hp: 6, maxHp: 20, ac: 14 });
  const wizard = token("wizard", { x: 0, y: 400, disposition: 1 });
  const fighter = token("fighter", { x: 100, y: 100, disposition: 1, hp: 0 });
  canvas.scene.tokens.contents = [goblin, goblin2, rogue, wizard, fighter];
  const combat = { combatants: [goblin, goblin2, rogue, wizard, fighter].map((t) => combatantOf(t)) };
  settings.intelligenceThreshold = 6;
  const b = await snapshot(combat, combat.combatants[0], new Set(["9,9"]));
  assert.deepEqual([b.me.id, b.me.name, b.me.intelligence, b.me.budget, b.me.x, b.me.y, b.threshold], ["goblin", "goblin", 10, 20, 0, 0, 6]);
  assert.deepEqual(b.enemies.map((e) => [e.id, e.visible, e.distance, e.hp, e.maxHp, e.ac, e.saves.dex]), [["rogue", true, 20, 6, 20, 14, 2], ["wizard", false, 20, 10, 10, 15, 2]]);
  assert.deepEqual(b.paths.rogue.slice(0, 3).map((s) => [s.x, s.y, s.cost, s.distance, s.occupied]), [[100, 0, 5, 15, false], [200, 0, 10, 10, true], [300, 0, 15, 5, false]]);
  assert.deepEqual(b.paths.rogue[2].waypoints, [{ x: 100, y: 0, elevation: 0 }, { x: 200, y: 0, elevation: 0 }, { x: 300, y: 0, elevation: 0 }]);
  // branch squares: free neighbours of the last path square that still touch the enemy (row 1 only: row -1 is off the map)
  assert.deepEqual(b.paths.rogue.slice(3).map((s) => [s.x, s.y, s.cost, s.distance]), [[300, 100, 20, 5], [400, 100, 20, 5]]);
  assert.deepEqual(b.paths.rogue[4].waypoints, [{ x: 100, y: 0, elevation: 0 }, { x: 200, y: 0, elevation: 0 }, { x: 300, y: 0, elevation: 0 }, { x: 400, y: 100, elevation: 0 }]);
  assert.equal(b.paths.wizard, undefined);
  assert.equal(b.multiattack, "The goblin makes two attacks: one with its scimitar and one with its shortbow.");
  assert.deepEqual(b.activities.map((a) => [a.name, a.slot]), [["Scimitar", "action"], ["Shortbow", "action"]]);
  assert.deepEqual([...b.reserved], ["9,9"]);
});

test("snapshot: a hidden rogue in the dark beating passive Perception is an enemy that is not visible", async () => {
  const goblin = token("goblin", { x: 0, disposition: -1 });
  const rogue = token("rogue", { x: 400, disposition: 1, flags: { stealth: { value: 25, hidden: true } } });
  canvas.effects.getDarknessLevel = () => 0.7;
  canvas.scene.tokens.contents = [goblin, rogue];
  const combat = { combatants: [combatantOf(goblin), combatantOf(rogue)] };
  const b = await snapshot(combat, combat.combatants[0]);
  assert.deepEqual(b.enemies.map((e) => [e.id, e.visible]), [["rogue", false]]);
  assert.deepEqual(b.paths, {});
  canvas.effects.getDarknessLevel = () => 0;
});

test("snapshot: a villager outside the combat still occupies its square", async () => {
  const goblin = token("goblin", { x: 0, disposition: -1 });
  const rogue = token("rogue", { x: 400, disposition: 1 });
  const villager = token("villager", { x: 300, disposition: 0 });
  canvas.scene.tokens.contents = [goblin, rogue, villager];
  const b = await snapshot({ combatants: [combatantOf(goblin), combatantOf(rogue)] }, combatantOf(goblin));
  assert.deepEqual(b.paths.rogue.slice(0, 3).map((s) => [s.x, s.occupied]), [[100, false], [200, false], [300, true]]);
});

test("snapshot: a Large monster is placed by its top-left, measures reach from its edge and cannot overlap anyone", async () => {
  const ogre = token("ogre", { x: 0, disposition: -1, width: 2 });
  const rogue = token("rogue", { x: 400, disposition: 1 });
  canvas.scene.tokens.contents = [ogre, rogue];
  const b = await snapshot({ combatants: [combatantOf(ogre), combatantOf(rogue)] }, combatantOf(ogre));
  assert.equal(b.enemies[0].distance, 15); // centres 17.5 ft apart, minus half the ogre's extra width
  const main = b.paths.rogue.filter((s) => s.y === 0);
  assert.deepEqual(main.map((s) => [s.x, s.cost, s.distance, s.occupied]), [[100, 5, 10, false], [200, 10, 5, false]]); // 300 would overlap the rogue: dropped
});
