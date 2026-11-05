// Piece 4: the board snapshot the autopilot plans on. Reads Foundry, never writes.
import { MODULE_ID } from "../main.js";
import { speedLimit } from "../rules.js";
import { sees, distanceFt } from "../encounters.js";
import { averageOf } from "./plan.js";

const KINDS = new Set(["attack", "save", "damage"]); // heals aim at allies: 4b
const SLOTS = new Set(["action", "bonus"]);
const spent = (uses) => Number(uses?.max) > 0 && !(uses.value > 0);

/** Average of every damage roll of an activity, roll data resolved. */
function averageDamage(activity) {
  const rolls = activity.getDamageConfig?.()?.rolls ?? [];
  return rolls.reduce((sum, r) => sum + averageOf(Roll.replaceFormulaData((r.parts ?? []).join(" + "), r.data ?? {})), 0);
}

/** Reach or range in scene units: a weapon's own reach/range unless the activity overrides it. */
function rangeOf(activity) {
  const item = activity.item;
  if (item?.type === "weapon" && !activity.range?.override) return item.system.range?.reach ?? item.system.range?.value ?? 5;
  const units = activity.range?.units;
  if (units === "touch") return 5;
  if (units === "self") return 0;
  return activity.range?.value ?? 5;
}

/** The planner's view of one activity, or null when 4a cannot use it (areas, self, heals, legendary, spent, no slot). */
export function activityInfo(activity) {
  if (!KINDS.has(activity.type) || !SLOTS.has(activity.activation?.type) || activity.canUse === false) return null;
  if (activity.target?.affects?.type === "self" || activity.target?.template?.type) return null;
  if (spent(activity.item?.system?.uses) || spent(activity.uses)) return null;
  if (activity.requiresSpellSlot && !(activity.actor?.system?.spells?.[`spell${activity.item?.system?.level}`]?.value > 0)) return null;
  return {
    id: activity.id, uuid: activity.uuid, name: activity.name, kind: activity.type, slot: activity.activation.type,
    range: rangeOf(activity), bonus: parseInt(activity.labels?.toHit) || 0,
    dc: activity.save?.dc?.value, saveAbility: activity.save?.ability?.first?.() ?? [...(activity.save?.ability ?? [])][0], onSave: activity.damage?.onSave,
    damage: averageDamage(activity), healing: 0
  };
}

const stripHtml = (s) => foundry.utils.stripHTML?.(s) ?? String(s ?? "").replace(/<[^>]*>/g, "").trim();
const hpOf = (doc) => doc.actor?.system?.attributes?.hp ?? {};
const widthOf = (t) => Math.max(1, Math.round(t.width ?? 1));
const key = (o) => `${o.i},${o.j}`;
/** Grid squares a token of w x h squares covers from top-left offset `o`. */
function footprint(o, w, h) {
  const out = [];
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) out.push(key({ i: o.i + i, j: o.j + j }));
  return out;
}
const tlOffset = (t) => canvas.grid.getOffset({ x: t.x, y: t.y });
/** Distance between two tokens' edges: centre to centre minus half of each one's extra width (a Large creature reaches from its border). */
const reachFt = (a, b) => Math.max(0, distanceFt(a.center, b.center) - ((a.w - 1) / 2 + (b.w - 1) / 2) * canvas.dimensions.distance);
const chebyshev = (a, b) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j));

/**
 * Squares (top-left offsets of `me`) along Foundry's path to `enemy`, plus the free neighbours of the last one that still
 * touch the enemy (so group mates converging on one square spread around it). Each carries the route to reach it.
 * ponytail: branch squares assume a straight step from the last square; no second pathfinding call.
 */
async function pathTo(me, enemy, taken, budget) {
  const w = widthOf(me), h = Math.max(1, Math.round(me.height ?? 1)), ew = widthOf(enemy);
  const wps = [{ x: me.x, y: me.y, elevation: me.elevation }, { x: enemy.x, y: enemy.y, elevation: enemy.elevation }];
  const found = (await me.object?.findMovementPath?.(wps)?.promise) ?? wps;
  const offsets = canvas.grid.getDirectPath((found.length ? found : wps).map((p) => ({ x: p.x, y: p.y })));
  const start = tlOffset(me), enemyFoot = new Set(footprint(tlOffset(enemy), ew, Math.max(1, Math.round(enemy.height ?? 1))));
  const enemyInfo = { center: enemy.getCenterPoint(), w: ew };
  const overlapsEnemy = (o) => footprint(o, w, h).some((k) => enemyFoot.has(k));
  const main = offsets.filter((o) => !(o.i === start.i && o.j === start.j) && !overlapsEnemy(o));
  const last = main.at(-1);
  const branches = last ? canvas.grid.getAdjacentOffsets(last).filter((o) => !main.some((m) => m.i === o.i && m.j === o.j) && !(o.i === start.i && o.j === start.j)
    && !overlapsEnemy(o) && footprint(o, w, h).some((k) => [...enemyFoot].some((e) => chebyshev(parse(k), parse(e)) === 1))) : [];
  const square = (o, cost, route) => {
    const tl = canvas.grid.getTopLeftPoint(o), center = me.getCenterPoint(tl);
    return { x: tl.x, y: tl.y, elevation: me.elevation ?? 0, cost, distance: reachFt({ center, w }, enemyInfo), occupied: footprint(o, w, h).some((k) => taken.has(k)), waypoints: [...route, { x: tl.x, y: tl.y, elevation: me.elevation ?? 0 }] };
  };
  const centers = main.map((o) => me.getCenterPoint(canvas.grid.getTopLeftPoint(o)));
  const costs = canvas.grid.measurePath([me.getCenterPoint(), ...centers]).waypoints;
  const out = [];
  for (const [k, o] of main.entries()) {
    const cost = costs[k + 1]?.distance ?? Infinity;
    if (cost > budget) break;
    out.push(square(o, cost, out.at(-1)?.waypoints ?? []));
  }
  if (out.length === main.length && last) {
    const base = out.at(-1), lastCenter = centers.at(-1);
    for (const o of branches) {
      const cost = base.cost + distanceFt(lastCenter, me.getCenterPoint(canvas.grid.getTopLeftPoint(o)));
      if (cost <= budget) out.push(square(o, cost, base.waypoints));
    }
  }
  return out;
}
const parse = (k) => { const [i, j] = k.split(",").map(Number); return { i, j }; };

function budgetOf(combatant, doc) {
  const type = CONFIG.DND5E?.movementTypes?.walk;
  const limit = speedLimit({ speeds: doc.actor?.system?.attributes?.movement?.speeds, action: "walk", walkFallback: !type || !!type.walkFallback, dash: !!combatant.getFlag(MODULE_ID, "dash") });
  const used = (doc.movementHistory ?? []).reduce((s, w) => s + (w.cost ?? 0), 0);
  return Math.max(0, limit - used);
}

/** The board for one combatant's turn. `reserved`: "x,y" destinations its group mates already took. */
export async function snapshot(combat, combatant, reserved = new Set()) {
  const doc = combatant.token, actor = doc.actor;
  const mine = doc.disposition ?? 0;
  const onScene = (t) => t && t.parent?.id === canvas.scene?.id;
  // Every visible token on the scene occupies its squares, in the combat or not.
  const taken = new Set((canvas.scene?.tokens?.contents ?? []).filter((t) => t !== doc && !t.hidden).flatMap((t) => footprint(tlOffset(t), widthOf(t), Math.max(1, Math.round(t.height ?? 1)))));
  const budget = budgetOf(combatant, doc);
  const meInfo = { center: doc.getCenterPoint(), w: widthOf(doc) };
  const me = { id: doc.id, name: doc.name, intelligence: actor?.system?.abilities?.int?.value ?? 10, hp: hpOf(doc).value ?? 0, maxHp: hpOf(doc).max ?? 0, x: doc.x, y: doc.y, elevation: doc.elevation ?? 0, budget };
  const enemies = [], paths = {};
  for (const c of combat.combatants) {
    const t = c.token;
    if (!onScene(t) || t === doc || t.hidden || c.isDefeated || (t.disposition ?? 0) * mine >= 0 || !((hpOf(t).value ?? 0) > 0)) continue;
    const saves = Object.fromEntries(Object.entries(t.actor?.system?.abilities ?? {}).map(([k, a]) => [k, a?.save?.value ?? (typeof a?.save === "number" ? a.save : 0)]));
    const e = { id: t.id, uuid: t.uuid, name: t.name, x: t.x, y: t.y, elevation: t.elevation ?? 0, hp: hpOf(t).value, maxHp: hpOf(t).max ?? hpOf(t).value, ac: t.actor?.system?.attributes?.ac?.value ?? 10, saves, distance: reachFt(meInfo, { center: t.getCenterPoint(), w: widthOf(t) }), visible: sees(doc, t) };
    enemies.push(e);
    if (e.visible) paths[t.id] = await pathTo(doc, t, taken, budget);
  }
  const activities = [];
  for (const item of actor?.items ?? []) for (const a of item.system?.activities ?? []) { const info = activityInfo(a); if (info) activities.push(info); }
  const multi = [...(actor?.items ?? [])].find((i) => String(i.name).trim().toLowerCase() === "multiattack");
  return { me, enemies, activities, multiattack: multi ? stripHtml(multi.system?.description?.value) : null, paths, reserved, threshold: game.settings.get(MODULE_ID, "intelligenceThreshold") ?? 6 };
}
