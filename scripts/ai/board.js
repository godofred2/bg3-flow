// Piece 4: the board snapshot the autopilot plans on. Reads Foundry, never writes.
import { MODULE_ID } from "../main.js";
import { speedLimit } from "../rules.js";
import { sees, distanceFt } from "../encounters.js";
import { averageOf, hitChance, expectedValue } from "./plan.js";

const KINDS = new Set(["attack", "save", "damage", "heal"]);
const hasRecharge = (uses) => (uses?.recovery ?? []).some((r) => r.period === "recharge");
const SLOTS = new Set(["action", "bonus", "lair"]); // legendary and mythic actions stay the DM's (user decision)
const spent = (uses) => Number(uses?.max) > 0 && !(uses.value > 0);
// The share of a turn a condition takes away (lair actions are valued by the damage they deny; ponytail: a flat table, no duration).
const DENIAL = { paralyzed: 1, stunned: 1, incapacitated: 1, unconscious: 1, petrified: 1, restrained: 0.5, blinded: 0.5, frightened: 0.5, poisoned: 0.5, prone: 0.5, grappled: 0.1, deafened: 0.1 };

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

/** The planner's view of one activity, or null when the autopilot cannot use it (self emanations, legendary, spent, no slot).
 *  A lair activity with no range on its sheet (or the sheet's default "Self" with no area) reaches anywhere: the lair is the origin. */
export function activityInfo(activity) {
  if (!KINDS.has(activity.type) || !SLOTS.has(activity.activation?.type) || activity.canUse === false) return null;
  const affects = activity.target?.affects?.type ?? "", template = activity.target?.template;
  const area = template?.type ? { shape: template.type, size: Number(template.size) || 0, width: Number(template.width) || 5 } : null;
  if (affects === "self" && (activity.type !== "heal" || area)) return null; // self emanations (Spirit Guardians) are Midi regions, not uses
  if (area && ["wall", "ring"].includes(area.shape)) return null; // not blasts
  if (area && activity.type === "attack") return null; // a template on an attack places something (Spiritual Weapon): no blast
  if (spent(activity.item?.system?.uses) || spent(activity.uses)) return null;
  if (activity.requiresSpellSlot && !(activity.actor?.system?.spells?.[`spell${activity.item?.system?.level}`]?.value > 0)) return null;
  // dnd5e gives every item's default activity the same id (dnd5eactivity000) and Midi names it "Midi Attack": the uuid is the identity, the item the name.
  const siblings = activity.item?.system?.activities?.size ?? activity.item?.system?.activities?.length ?? 1;
  const name = activity.item?.name ? (siblings > 1 && activity.name ? `${activity.item.name} (${activity.name})` : activity.item.name) : activity.name;
  const avg = averageDamage(activity), heal = activity.type === "heal";
  const statuses = (activity.effects ?? []).flatMap((e) => [...(e.effect?.statuses ?? [])]).filter((s) => s in DENIAL);
  return {
    ...(statuses.length ? { denial: Math.max(...statuses.map((s) => DENIAL[s])) } : {}),
    id: activity.uuid, uuid: activity.uuid, name, kind: activity.type, slot: activity.activation.type,
    range: area && activity.range?.units === "self" ? area.size : activity.activation.type === "lair" && !area && activity.range?.value == null ? Infinity : rangeOf(activity), bonus: parseInt(activity.labels?.toHit) || 0,
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

/** Top-left offsets of a route (start excluded, `exclude` squares dropped) turned into planner squares with cost, distances and the route so far. */
function squaresAlong(me, found, { taken, budget, foots, exclude = new Set(), branchesTo = null }) {
  const w = widthOf(me), h = Math.max(1, Math.round(me.height ?? 1));
  const start = tlOffset(me);
  const offsets = canvas.grid.getDirectPath(found.map((p) => ({ x: p.x, y: p.y })));
  const overlaps = (o) => footprint(o, w, h).some((k) => exclude.has(k));
  const main = offsets.filter((o) => !(o.i === start.i && o.j === start.j) && !overlaps(o));
  const last = main.at(-1);
  const branches = last && branchesTo ? canvas.grid.getAdjacentOffsets(last).filter((o) => !main.some((m) => m.i === o.i && m.j === o.j) && !(o.i === start.i && o.j === start.j)
    && !overlaps(o) && footprint(o, w, h).some((k) => [...branchesTo].some((e) => chebyshev(parse(k), parse(e)) === 1))) : [];
  const square = (o, cost, route) => {
    const tl = canvas.grid.getTopLeftPoint(o), foot = footprint(o, w, h);
    return { x: tl.x, y: tl.y, elevation: me.elevation ?? 0, cost, distance: branchesTo ? reachFt(foot, branchesTo) : Infinity, occupied: foot.some((k) => taken.has(k)),
      distances: Object.fromEntries(foots.map(([id, f]) => [id, reachFt(foot, f)])), waypoints: [...route, { x: tl.x, y: tl.y, elevation: me.elevation ?? 0 }] };
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

const findPath = async (me, goal) => (await me.object?.findMovementPath?.([{ x: me.x, y: me.y, elevation: me.elevation }, goal])?.promise) ?? null;

/**
 * Squares (top-left offsets of `me`) along Foundry's path to `enemy`, plus the free neighbours of the last one that still
 * touch the enemy (so group mates converging on one square spread around it). Each carries the route to reach it.
 * ponytail: branch squares assume a straight step from the last square; no second pathfinding call.
 */
async function pathTo(me, enemy, taken, budget, foots) {
  const w = widthOf(me), h = Math.max(1, Math.round(me.height ?? 1));
  const goal = { x: enemy.x, y: enemy.y, elevation: enemy.elevation };
  const start = tlOffset(me), enemyFoot = new Set(footOf(enemy));
  let found = await findPath(me, goal);
  if (!found || found.length < 2) {
    // The enemy's own square is no goal for a Large mover, or something stands in the only corridor: route to the free squares touching the enemy instead.
    const tries = await Promise.all(goalsAround(enemyFoot, w, h, taken, start).map(async (o) => {
      const tl = canvas.grid.getTopLeftPoint(o);
      const p = await findPath(me, { x: tl.x, y: tl.y, elevation: me.elevation });
      return p && p.length >= 2 ? { p, cost: canvas.grid.measurePath(p.map((q) => me.getCenterPoint(q))).distance } : null;
    }));
    found = tries.filter(Boolean).sort((a, b) => a.cost - b.cost)[0]?.p ?? [{ x: me.x, y: me.y, elevation: me.elevation }, goal];
  }
  return squaresAlong(me, found, { taken, budget, foots, exclude: enemyFoot, branchesTo: enemyFoot });
}

/** Squares along Foundry's path to a point (a region square, the away point); empty when there is no path. */
async function pathToPoint(me, goal, taken, budget, foots) {
  const found = await findPath(me, goal);
  return found && found.length >= 2 ? squaresAlong(me, found, { taken, budget, foots }) : [];
}

function budgetOf(combatant, doc) {
  const type = CONFIG.DND5E?.movementTypes?.walk;
  const dash = !!combatant.getFlag(MODULE_ID, "dash");
  const args = { speeds: doc.actor?.system?.attributes?.movement?.speeds, action: "walk", walkFallback: !type || !!type.walkFallback };
  const used = (doc.movementHistory ?? []).reduce((s, w) => s + (w.cost ?? 0), 0);
  return { budget: Math.max(0, speedLimit({ ...args, dash }) - used), speed: speedLimit({ ...args, dash: false }), dash };
}

const named = (name, what) => String(name ?? "").trim().toLowerCase() === what;
/** The PC's opportunity attack against a monster of `ac`: its best melee attack (expected damage, hit chance, uuid), its reach, reaction and stance. */
function oaOf(actor, ac, tunnelFighter) {
  let best = null, reach = 0;
  for (const item of actor?.items ?? []) for (const a of item.system?.activities ?? []) {
    const info = activityInfo(a);
    if (!info || info.kind !== "attack" || info.ranged) continue;
    reach = Math.max(reach, info.range);
    const hit = hitChance({ bonus: info.bonus, ac }), damage = hit * info.damage;
    if (!best || damage > best.damage) best = { damage, hit, activityUuid: info.uuid };
  }
  if (!best) return null;
  return { ...best, reach, reaction: !(globalThis.MidiQOL?.hasUsedReaction?.(actor) ?? false), tunnelFighter };
}

const inRect = (tl, r) => !r || (tl.x >= r.x && tl.y >= r.y && tl.x < r.x + r.width && tl.y < r.y + r.height);

/** How dangerous a PC is to `me` per turn: its best action against me (Extra Attack doubles it) plus its best heal. Used by lair actions only. */
function threatOf(actor, me) {
  let damage = 0, heal = 0;
  for (const item of actor?.items ?? []) for (const a of item.system?.activities ?? []) {
    const info = activityInfo(a);
    if (!info) continue;
    heal = Math.max(heal, info.healing ?? 0);
    if (info.slot === "action" && ["attack", "save", "damage"].includes(info.kind)) damage = Math.max(damage, expectedValue(info, me));
  }
  if ([...(actor?.items ?? [])].some((i) => /^(extra attack|ataque (extra|adicional))/i.test(String(i.name ?? "").trim()))) damage *= 2;
  return damage + heal;
}

/** In its lair, as the NPC sheet shows it (the world's rules version, whatever the statblock's own): modern rules need the
 *  sheet's "inside lair" switch; legacy rules a lair initiative (or the flag). */
export function lairOf(actor) {
  const lair = actor?.system?.resources?.lair ?? {};
  return game.settings.get("dnd5e", "rulesVersion") === "modern" ? !!(lair.value && lair.inside) : lair.initiative > 0 || !!lair.value;
}
const lairNamesOf = (actor) => [...(actor?.items ?? [])].filter((i) => [...(i.system?.activities ?? [])].some((a) => a.activation?.type === "lair")).map((i) => i.name);

/** The board for one combatant's turn. `reserved`: "x,y" destinations its group mates already took. */
export async function snapshot(combat, combatant, reserved = new Set()) {
  const doc = combatant.token, actor = doc.actor;
  const mine = doc.disposition ?? 0;
  const onScene = (t) => t && t.parent?.id === canvas.scene?.id;
  // Every visible token on the scene occupies its squares, in the combat or not.
  const taken = new Set((canvas.scene?.tokens?.contents ?? []).filter((t) => t !== doc && !t.hidden).flatMap((t) => footprint(tlOffset(t), widthOf(t), Math.max(1, Math.round(t.height ?? 1)))));
  const { budget, speed, dash } = budgetOf(combatant, doc);
  const myFoot = footOf(doc), myCentre = doc.getCenterPoint();
  const grid = { px: canvas.dimensions.size, ft: canvas.dimensions.distance };
  const creature = (t) => {
    const saves = Object.fromEntries(Object.entries(t.actor?.system?.abilities ?? {}).map(([k, a]) => [k, a?.save?.value ?? (typeof a?.save === "number" ? a.save : 0)]));
    const c = t.getCenterPoint();
    const sentinel = [...(t.actor?.items ?? [])].some((i) => named(i.name, "sentinel"));
    const effects = t.actor?.appliedEffects ?? [...(t.actor?.effects ?? [])].filter((e) => !e.disabled);
    const tunnelFighter = [...effects].some((e) => named(e.name, "tunnel fighter"));
    return { id: t.id, uuid: t.uuid, actorUuid: t.actor?.uuid, name: t.name, x: t.x, y: t.y, elevation: t.elevation ?? 0, cx: c.x, cy: c.y, w: widthOf(t), hp: hpOf(t).value, maxHp: hpOf(t).max ?? hpOf(t).value, temp: hpOf(t).temp ?? 0, ac: t.actor?.system?.attributes?.ac?.value ?? 10, saves, distance: t === doc ? 0 : reachFt(myFoot, footOf(t)), sentinel, tunnelFighter };
  };
  const alone = ![...combat.combatants].some((c) => c !== combatant && c.token && c.token !== doc && (c.token.disposition ?? 0) === mine);
  const me = { ...creature(doc), intelligence: actor?.system?.abilities?.int?.value ?? 10, hp: hpOf(doc).value ?? 0, maxHp: hpOf(doc).max ?? 0, budget, speed, dash, alone,
    lair: lairOf(actor), lairLast: combatant.getFlag(MODULE_ID, "lairLast") ?? null, lairNames: lairNamesOf(actor) };
  const enemies = [], allies = [me], paths = {}, tokensById = {};
  for (const c of combat.combatants) {
    const t = c.token;
    if (!onScene(t) || t === doc || t.hidden || c.isDefeated) continue;
    tokensById[t.id] = t;
    if ((t.disposition ?? 0) === mine) { allies.push(creature(t)); continue; } // an ally, downed ones included (heals)
    if ((t.disposition ?? 0) * mine >= 0 || !((hpOf(t).value ?? 0) > 0)) continue; // neutral: nobody is its enemy; downed: no target
    const e = creature(t);
    enemies.push({ ...e, visible: sees(doc, t), oa: oaOf(t.actor, me.ac, e.tunnelFighter), ...(me.lair ? { threat: threatOf(t.actor, me) } : {}) }); // threat is read by the lair slot only: no walk for the rest
  }
  const foots = enemies.map((e) => [e.id, new Set(footOf(tokensById[e.id]))]); // every square measures its distance to every enemy
  for (const e of enemies) if (e.visible) paths[e.id] = await pathTo(doc, tokensById[e.id], taken, budget, foots);
  for (const a of allies) if (a.id !== me.id && a.hp < a.maxHp) paths[a.id] = await pathTo(doc, tokensById[a.id], taken, budget, foots); // a path only to the wounded
  // Retreat squares: free neighbours of the monster that keep 10 ft from every visible enemy (a clever archer steps back there).
  const w = widthOf(doc), h = Math.max(1, Math.round(doc.height ?? 1)), rect = canvas.dimensions.sceneRect, seen = enemies.filter((e) => e.visible);
  const retreats = [];
  for (const o of canvas.grid.getAdjacentOffsets(tlOffset(doc))) {
    const tl = canvas.grid.getTopLeftPoint(o);
    if (!inRect(tl, rect)) continue;
    const foot = footprint(o, w, h);
    if (foot.some((k) => taken.has(k))) continue;
    const distances = Object.fromEntries(foots.map(([id, f]) => [id, reachFt(foot, f)]));
    if (seen.some((e) => distances[e.id] < 2 * grid.ft)) continue;
    retreats.push({ x: tl.x, y: tl.y, elevation: doc.elevation ?? 0, cost: distanceFt(myCentre, doc.getCenterPoint(tl)), waypoints: [{ x: tl.x, y: tl.y, elevation: doc.elevation ?? 0 }], distances });
  }
  // Flight: the nearest escape region's squares (route uncut: the planner cuts at the Dash budget), else a route straight away from the visible enemies.
  const fleeBudget = dash ? budget : budget + speed, elevation = doc.elevation ?? 0;
  const word = String(game.settings.get(MODULE_ID, "escapeRegionName") ?? "").trim().toLowerCase();
  const regions = word ? (canvas.scene?.regions?.contents ?? []).filter((r) => String(r.name ?? "").toLowerCase().includes(word)) : [];
  const goals = [];
  for (const r of regions) {
    const b = r.bounds; if (!b) continue;
    const a = canvas.grid.getOffset({ x: b.x, y: b.y }), z = canvas.grid.getOffset({ x: b.x + b.width, y: b.y + b.height });
    for (let i = a.i; i <= z.i; i++) for (let j = a.j; j <= z.j; j++) {
      const c = canvas.grid.getCenterPoint({ i, j });
      if (r.testPoint({ x: c.x, y: c.y, elevation })) goals.push({ r, tl: canvas.grid.getTopLeftPoint({ i, j }), d: Math.hypot(c.x - myCentre.x, c.y - myCentre.y) });
    }
  }
  let escape = null;
  for (const g of goals.sort((p, q) => p.d - q.d).slice(0, 3)) {
    const squares = await pathToPoint(doc, { x: g.tl.x, y: g.tl.y, elevation }, taken, Infinity, foots);
    if (!squares.length || (escape && squares.at(-1).cost >= escape.squares.at(-1).cost)) continue;
    for (const s of squares) { const c = doc.getCenterPoint(s); s.inside = !!g.r.testPoint({ x: c.x, y: c.y, elevation }); }
    escape = { uuid: g.r.uuid, name: g.r.name, squares };
  }
  let away = [];
  if (!escape && seen.length) {
    const cx = seen.reduce((s, e) => s + e.cx, 0) / seen.length, cy = seen.reduce((s, e) => s + e.cy, 0) / seen.length;
    const dx = myCentre.x - cx, dy = myCentre.y - cy, len = Math.hypot(dx, dy), reach = fleeBudget / grid.ft * grid.px;
    const dirs = len ? [[dx / len, dy / len]] : [];
    for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) dirs.push([Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)]);
    const byAngle = (u) => (len ? -(u[0] * dx + u[1] * dy) / len : 0);
    for (const u of dirs.sort((p, q) => byAngle(p) - byAngle(q))) {
      const tl = { x: myCentre.x + u[0] * reach - w * grid.px / 2, y: myCentre.y + u[1] * reach - h * grid.px / 2 };
      if (rect) { tl.x = Math.min(Math.max(tl.x, rect.x), rect.x + rect.width - w * grid.px); tl.y = Math.min(Math.max(tl.y, rect.y), rect.y + rect.height - h * grid.px); }
      const o = canvas.grid.getOffset(tl), snapped = canvas.grid.getTopLeftPoint(o);
      away = await pathToPoint(doc, { x: snapped.x, y: snapped.y, elevation }, taken, Infinity, foots);
      if (away.length) break;
    }
  }
  const activities = [];
  for (const item of actor?.items ?? []) for (const a of item.system?.activities ?? []) { const info = activityInfo(a); if (info) activities.push(info); }
  const multi = [...(actor?.items ?? [])].find((i) => named(i.name, "multiattack"));
  return {
    me, enemies, allies, activities, multiattack: multi ? stripHtml(multi.system?.description?.value) : null, paths, retreats, grid, reserved,
    threshold: game.settings.get(MODULE_ID, "intelligenceThreshold") ?? 6,
    flee: { enabled: game.settings.get(MODULE_ID, "fleeEnabled") !== false, threshold: Number(game.settings.get(MODULE_ID, "fleeThreshold") ?? 25) }, escape, away
  };
}
