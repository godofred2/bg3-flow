// Piece 4: the board snapshot the autopilot plans on. Reads Foundry, never writes.
import { MODULE_ID } from "../main.js";
import { speedLimit } from "../rules.js";
import { sees, distanceFt } from "../encounters.js";
import { averageOf } from "./plan.js";

const KINDS = new Set(["attack", "save", "damage", "heal"]);
const hasRecharge = (uses) => (uses?.recovery ?? []).some((r) => r.period === "recharge");
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

/** The planner's view of one activity, or null when the autopilot cannot use it (self emanations, legendary, spent, no slot). */
export function activityInfo(activity) {
  if (!KINDS.has(activity.type) || !SLOTS.has(activity.activation?.type) || activity.canUse === false) return null;
  const affects = activity.target?.affects?.type ?? "", template = activity.target?.template;
  const area = template?.type ? { shape: template.type, size: Number(template.size) || 0, width: Number(template.width) || 5 } : null;
  if (affects === "self" && (activity.type !== "heal" || area)) return null; // self emanations (Spirit Guardians) are Midi regions, not uses
  if (area && ["wall", "ring"].includes(area.shape)) return null; // not blasts
  if (spent(activity.item?.system?.uses) || spent(activity.uses)) return null;
  if (activity.requiresSpellSlot && !(activity.actor?.system?.spells?.[`spell${activity.item?.system?.level}`]?.value > 0)) return null;
  // dnd5e gives every item's default activity the same id (dnd5eactivity000) and Midi names it "Midi Attack": the uuid is the identity, the item the name.
  const siblings = activity.item?.system?.activities?.size ?? activity.item?.system?.activities?.length ?? 1;
  const name = activity.item?.name ? (siblings > 1 && activity.name ? `${activity.item.name} (${activity.name})` : activity.item.name) : activity.name;
  const avg = averageDamage(activity), heal = activity.type === "heal";
  return {
    id: activity.uuid, uuid: activity.uuid, name, kind: activity.type, slot: activity.activation.type,
    range: area && activity.range?.units === "self" ? area.size : rangeOf(activity), bonus: parseInt(activity.labels?.toHit) || 0,
    dc: activity.save?.dc?.value, saveAbility: activity.save?.ability?.first?.() ?? [...(activity.save?.ability ?? [])][0], onSave: activity.damage?.onSave,
    damage: heal ? 0 : avg, healing: heal ? avg : 0,
    ranged: activity.attack?.type?.value === "ranged", area, affects,
    recharge: hasRecharge(activity.uses) || hasRecharge(activity.item?.system?.uses)
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
const chebyshev = (a, b) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j));
const parse = (k) => { const [i, j] = k.split(",").map(Number); return { i, j }; };
/** Top-left offsets from which a w x h mover touches the enemy's footprint without overlapping anyone. */
function goalsAround(enemyFoot, w, h, taken, start) {
  const cells = [...enemyFoot].map(parse);
  const is = cells.map((c) => c.i), js = cells.map((c) => c.j);
  const out = [];
  for (let i = Math.min(...is) - h; i <= Math.max(...is) + 1; i++) for (let j = Math.min(...js) - w; j <= Math.max(...js) + 1; j++) {
    if (i === start.i && j === start.j) continue;
    const tl = canvas.grid.getTopLeftPoint({ i, j }), r = canvas.dimensions.sceneRect;
    if (r && (tl.x < r.x || tl.y < r.y || tl.x >= r.x + r.width || tl.y >= r.y + r.height)) continue; // off the scene
    const foot = footprint({ i, j }, w, h);
    if (foot.some((k) => enemyFoot.has(k) || taken.has(k))) continue;
    if (foot.some((k) => cells.some((c) => chebyshev(parse(k), c) === 1))) out.push({ i, j });
  }
  return out;
}
/** Distance between two footprints in scene units: the fewest squares between any two of their squares (5/5/5, like reach at the table).
 *  measurePath would snap a Large token's centre (a grid vertex) to a whole square and put a diagonal neighbour out of reach. */
function reachFt(footA, footB) {
  let best = Infinity;
  for (const a of footA) for (const b of footB) best = Math.min(best, chebyshev(parse(a), parse(b)));
  return best * canvas.dimensions.distance;
}
const footOf = (t) => footprint(tlOffset(t), widthOf(t), Math.max(1, Math.round(t.height ?? 1)));

/**
 * Squares (top-left offsets of `me`) along Foundry's path to `enemy`, plus the free neighbours of the last one that still
 * touch the enemy (so group mates converging on one square spread around it). Each carries the route to reach it.
 * ponytail: branch squares assume a straight step from the last square; no second pathfinding call.
 */
async function pathTo(me, enemy, taken, budget) {
  const w = widthOf(me), h = Math.max(1, Math.round(me.height ?? 1));
  const wps = [{ x: me.x, y: me.y, elevation: me.elevation }, { x: enemy.x, y: enemy.y, elevation: enemy.elevation }];
  const start = tlOffset(me), enemyFoot = new Set(footOf(enemy));
  const find = async (goal) => (await me.object?.findMovementPath?.([wps[0], goal])?.promise) ?? null;
  let found = await find(wps[1]);
  if (!found || found.length < 2) {
    // The enemy's own square is no goal for a Large mover, or something stands in the only corridor: route to the free squares touching the enemy instead.
    const tries = await Promise.all(goalsAround(enemyFoot, w, h, taken, start).map(async (o) => {
      const tl = canvas.grid.getTopLeftPoint(o);
      const p = await find({ x: tl.x, y: tl.y, elevation: me.elevation });
      return p && p.length >= 2 ? { p, cost: canvas.grid.measurePath(p.map((q) => me.getCenterPoint(q))).distance } : null;
    }));
    found = tries.filter(Boolean).sort((a, b) => a.cost - b.cost)[0]?.p ?? wps;
  }
  const offsets = canvas.grid.getDirectPath(found.map((p) => ({ x: p.x, y: p.y })));
  const overlapsEnemy = (o) => footprint(o, w, h).some((k) => enemyFoot.has(k));
  const main = offsets.filter((o) => !(o.i === start.i && o.j === start.j) && !overlapsEnemy(o));
  const last = main.at(-1);
  const branches = last ? canvas.grid.getAdjacentOffsets(last).filter((o) => !main.some((m) => m.i === o.i && m.j === o.j) && !(o.i === start.i && o.j === start.j)
    && !overlapsEnemy(o) && footprint(o, w, h).some((k) => [...enemyFoot].some((e) => chebyshev(parse(k), parse(e)) === 1))) : [];
  const square = (o, cost, route) => {
    const tl = canvas.grid.getTopLeftPoint(o);
    return { x: tl.x, y: tl.y, elevation: me.elevation ?? 0, cost, distance: reachFt(footprint(o, w, h), enemyFoot), occupied: footprint(o, w, h).some((k) => taken.has(k)), waypoints: [...route, { x: tl.x, y: tl.y, elevation: me.elevation ?? 0 }] };
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
  const myFoot = footOf(doc), myCentre = doc.getCenterPoint();
  const grid = { px: canvas.dimensions.size, ft: canvas.dimensions.distance };
  const creature = (t) => {
    const saves = Object.fromEntries(Object.entries(t.actor?.system?.abilities ?? {}).map(([k, a]) => [k, a?.save?.value ?? (typeof a?.save === "number" ? a.save : 0)]));
    const c = t.getCenterPoint();
    const sentinel = [...(t.actor?.items ?? [])].some((i) => String(i.name).trim().toLowerCase() === "sentinel");
    return { id: t.id, uuid: t.uuid, name: t.name, x: t.x, y: t.y, elevation: t.elevation ?? 0, cx: c.x, cy: c.y, w: widthOf(t), hp: hpOf(t).value, maxHp: hpOf(t).max ?? hpOf(t).value, ac: t.actor?.system?.attributes?.ac?.value ?? 10, saves, distance: t === doc ? 0 : reachFt(myFoot, footOf(t)), sentinel };
  };
  const me = { ...creature(doc), intelligence: actor?.system?.abilities?.int?.value ?? 10, hp: hpOf(doc).value ?? 0, maxHp: hpOf(doc).max ?? 0, budget };
  const enemies = [], allies = [me], paths = {}, tokensById = {};
  for (const c of combat.combatants) {
    const t = c.token;
    if (!onScene(t) || t === doc || t.hidden || c.isDefeated) continue;
    tokensById[t.id] = t;
    if ((t.disposition ?? 0) === mine) { // an ally, downed ones included (heals): a path only when it is wounded
      const a = creature(t);
      allies.push(a);
      if (a.hp < a.maxHp) paths[t.id] = await pathTo(doc, t, taken, budget);
      continue;
    }
    if ((t.disposition ?? 0) * mine >= 0 || !((hpOf(t).value ?? 0) > 0)) continue; // neutral: nobody is its enemy; downed: no target
    const e = { ...creature(t), visible: sees(doc, t) };
    enemies.push(e);
    if (e.visible) paths[t.id] = await pathTo(doc, t, taken, budget);
  }
  // Retreat squares: free neighbours of the monster that keep 10 ft from every visible enemy (a clever archer steps back there).
  const w = widthOf(doc), h = Math.max(1, Math.round(doc.height ?? 1)), rect = canvas.dimensions.sceneRect, seen = enemies.filter((e) => e.visible);
  const retreats = [];
  for (const o of canvas.grid.getAdjacentOffsets(tlOffset(doc))) {
    const tl = canvas.grid.getTopLeftPoint(o);
    if (rect && (tl.x < rect.x || tl.y < rect.y || tl.x >= rect.x + rect.width || tl.y >= rect.y + rect.height)) continue;
    const foot = footprint(o, w, h);
    if (foot.some((k) => taken.has(k))) continue;
    const distances = Object.fromEntries(enemies.map((e) => [e.id, reachFt(foot, footOf(tokensById[e.id]))]));
    if (seen.some((e) => distances[e.id] < 2 * grid.ft)) continue;
    retreats.push({ x: tl.x, y: tl.y, elevation: doc.elevation ?? 0, cost: distanceFt(myCentre, doc.getCenterPoint(tl)), waypoints: [{ x: tl.x, y: tl.y, elevation: doc.elevation ?? 0 }], distances });
  }
  const activities = [];
  for (const item of actor?.items ?? []) for (const a of item.system?.activities ?? []) { const info = activityInfo(a); if (info) activities.push(info); }
  const multi = [...(actor?.items ?? [])].find((i) => String(i.name).trim().toLowerCase() === "multiattack");
  return { me, enemies, allies, activities, multiattack: multi ? stripHtml(multi.system?.description?.value) : null, paths, retreats, grid, reserved, threshold: game.settings.get(MODULE_ID, "intelligenceThreshold") ?? 6 };
}
