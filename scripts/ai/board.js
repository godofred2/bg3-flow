// Piece 4: the board snapshot the autopilot plans on. Reads Foundry, never writes.
import { MODULE_ID } from "../main.js";
import { speedLimit } from "../rules.js";
import { sees, distanceFt } from "../encounters.js";
import { averageOf } from "./plan.js";

const KINDS = new Set(["attack", "save", "damage", "heal"]);
const SLOTS = new Set(["action", "bonus"]);
const spent = (uses) => Number(uses?.max) > 0 && !(uses.value > 0);

/** Average of every damage (or healing) roll of an activity, roll data resolved. */
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

/** The planner's view of one activity, or null when 4a cannot use it (areas, self, legendary, spent, no slot). */
export function activityInfo(activity) {
  if (!KINDS.has(activity.type) || !SLOTS.has(activity.activation?.type) || activity.canUse === false) return null;
  if (activity.target?.affects?.type === "self" || activity.target?.template?.type) return null;
  if (spent(activity.item?.system?.uses) || spent(activity.uses)) return null;
  if (activity.requiresSpellSlot && !(activity.actor?.system?.spells?.[`spell${activity.item?.system?.level}`]?.value > 0)) return null;
  const avg = averageDamage(activity);
  return {
    id: activity.id, uuid: activity.uuid, name: activity.name, kind: activity.type, slot: activity.activation.type,
    range: rangeOf(activity), bonus: parseInt(activity.labels?.toHit) || 0,
    dc: activity.save?.dc?.value, saveAbility: activity.save?.ability?.first?.() ?? [...(activity.save?.ability ?? [])][0], onSave: activity.damage?.onSave,
    damage: activity.type === "heal" ? 0 : avg, healing: activity.type === "heal" ? avg : 0
  };
}

const stripHtml = (s) => foundry.utils.stripHTML?.(s) ?? String(s ?? "").replace(/<[^>]*>/g, "").trim();
const hpOf = (doc) => doc.actor?.system?.attributes?.hp ?? {};
const sameSquare = (a, b) => a.i === b.i && a.j === b.j;

/** Squares along Foundry's path from `me` to `enemy` (start square dropped, the enemy's own square dropped), with cumulative cost and distance to the enemy. */
async function pathTo(me, enemy, others, budget) {
  const wps = [{ x: me.x, y: me.y, elevation: me.elevation }, { x: enemy.x, y: enemy.y, elevation: enemy.elevation }];
  const found = (await me.object?.findMovementPath?.(wps)?.promise) ?? wps;
  const start = me.getCenterPoint(), end = enemy.getCenterPoint();
  const offsets = canvas.grid.getDirectPath((found.length ? found : wps).map((w) => me.getCenterPoint(w)));
  const endOffset = canvas.grid.getOffset(end), startOffset = canvas.grid.getOffset(start);
  const taken = others.map((t) => canvas.grid.getOffset(t.getCenterPoint()));
  const squares = offsets.filter((o) => !sameSquare(o, startOffset) && !sameSquare(o, endOffset));
  const costs = canvas.grid.measurePath([start, ...squares.map((o) => canvas.grid.getCenterPoint(o))]).waypoints;
  const out = [];
  for (const [k, o] of squares.entries()) {
    const cost = costs[k + 1]?.distance ?? Infinity;
    if (cost > budget) break;
    const c = canvas.grid.getCenterPoint(o), tl = canvas.grid.getTopLeftPoint(o);
    out.push({ x: tl.x, y: tl.y, elevation: me.elevation ?? 0, cost, distance: distanceFt(c, end), occupied: taken.some((t) => sameSquare(t, o)) });
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
  const onScene = (c) => c.token && c.token.parent?.id === canvas.scene?.id;
  const others = [...combat.combatants].filter((c) => onScene(c) && c.token !== doc && !c.token.hidden).map((c) => c.token);
  const budget = budgetOf(combatant, doc);
  const me = { id: doc.id, name: doc.name, intelligence: actor?.system?.abilities?.int?.value ?? 10, hp: hpOf(doc).value ?? 0, maxHp: hpOf(doc).max ?? 0, x: doc.x, y: doc.y, elevation: doc.elevation ?? 0, budget };
  const enemies = [], paths = {};
  for (const c of combat.combatants) {
    const t = c.token;
    if (!onScene(c) || t === doc || t.hidden || c.isDefeated || (t.disposition ?? 0) * mine >= 0 || !((hpOf(t).value ?? 0) > 0)) continue;
    const saves = Object.fromEntries(Object.entries(t.actor?.system?.abilities ?? {}).map(([k, a]) => [k, a?.save?.value ?? (typeof a?.save === "number" ? a.save : 0)]));
    const e = { id: t.id, uuid: t.uuid, name: t.name, x: t.x, y: t.y, elevation: t.elevation ?? 0, hp: hpOf(t).value, maxHp: hpOf(t).max ?? hpOf(t).value, ac: t.actor?.system?.attributes?.ac?.value ?? 10, saves, distance: distanceFt(doc.getCenterPoint(), t.getCenterPoint()), visible: sees(doc, t) };
    enemies.push(e);
    if (e.visible) paths[t.id] = await pathTo(doc, t, others.filter((o) => o !== t), budget);
  }
  const activities = [];
  for (const item of actor?.items ?? []) for (const a of item.system?.activities ?? []) { const info = activityInfo(a); if (info) activities.push(info); }
  const multi = [...(actor?.items ?? [])].find((i) => String(i.name).trim().toLowerCase() === "multiattack");
  return { me, enemies, activities, multiattack: multi ? stripHtml(multi.system?.description?.value) : null, paths, reserved, threshold: game.settings.get(MODULE_ID, "intelligenceThreshold") ?? 6 };
}
