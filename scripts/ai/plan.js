// Piece 4: monster autopilot planner. Pure functions, no Foundry globals.

const clamp = (p) => Math.min(0.95, Math.max(0.05, p));

/** Average of a dice formula: NdM counts (M + 1) / 2 each, integers add, anything else (an unresolved @ref) is 0. */
export function averageOf(formula) {
  let total = 0;
  for (const m of String(formula ?? "").matchAll(/([+-])?\s*(?:(\d+)d(\d+)|(\d+))/g)) {
    const sign = m[1] === "-" ? -1 : 1;
    total += sign * (m[2] !== undefined ? Number(m[2]) * (Number(m[3]) + 1) / 2 : Number(m[4]));
  }
  return total;
}

export const hitChance = ({ bonus, ac }) => clamp((21 + bonus - ac) / 20);
export const failChance = ({ dc, bonus }) => clamp((dc - 1 - bonus) / 20);

/** Expected damage (or healing, as damage avoided) of one activity against one target. Disadvantage squares the hit chance. */
export function expectedValue(activity, target, { disadvantage = false } = {}) {
  switch (activity.kind) {
    case "attack": { const p = hitChance({ bonus: activity.bonus ?? 0, ac: target.ac ?? 10 }); return (disadvantage ? p * p : p) * activity.damage; }
    case "save": {
      const fail = failChance({ dc: activity.dc ?? 10, bonus: target.saves?.[activity.saveAbility] ?? 0 });
      const onSave = activity.onSave === "half" ? 0.5 : activity.onSave === "full" ? 1 : 0;
      return fail * activity.damage + (1 - fail) * activity.damage * onSave;
    }
    case "damage": return activity.damage;
    case "heal": return Math.min(activity.healing, target.maxHp - target.hp);
    default: return 0;
  }
}

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const num = (w) => WORDS[w] ?? parseInt(w);

/** Multiattack from the trait text: the attack count and the named attacks (lower-cased, repeated by their own count, in text order). */
export function parseMultiattack(text, names) {
  const t = String(text ?? "").toLowerCase();
  const known = names.map((n) => n.toLowerCase());
  const count = num(t.match(/makes (one|two|three|four|five|[0-9]+) [^.]*?attacks?/)?.[1] ?? "one") || 1;
  const out = [];
  for (const m of t.matchAll(/(one|two|three|four|five|\d+) with its ([a-z' -]+?)(?:,| and|\.|$)/g)) {
    const phrase = m[2].trim(), last = phrase.split(" ").at(-1);
    const hit = known.find((n) => phrase.includes(n) || n.includes(last));
    if (hit) for (let i = 0; i < num(m[1]); i++) out.push(hit);
  }
  return { count, names: out };
}

/** Creatures whose centre lies in an area: centred shapes around `aim`, cones and lines from `origin` toward `aim`. Pure geometry on centres.
 *  Cone and line lengths are grid distance (squares), like reach, so a breath aimed at a creature in reach always covers it. */
export function coverage({ area, origin, aim, creatures, grid }) {
  const ft = (px) => px / grid.px * grid.ft;
  const dx = aim.cx - origin.cx, dy = aim.cy - origin.cy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  return creatures.filter((c) => {
    const extra = ((c.w ?? 1) - 1) * grid.ft / 2; // a Large creature's centre sits half a square further in
    const vx = c.cx - origin.cx, vy = c.cy - origin.cy, squares = ft(Math.max(Math.abs(vx), Math.abs(vy)));
    switch (area.shape) {
      case "cube": case "square": return ft(Math.max(Math.abs(c.cx - aim.cx), Math.abs(c.cy - aim.cy))) <= area.size / 2 + extra;
      case "cone": { const d = Math.hypot(vx, vy); if (d === 0 || squares > area.size + extra) return false; return Math.acos(Math.min(1, (vx * ux + vy * uy) / d)) <= 26.57 * Math.PI / 180; }
      case "line": { const along = vx * ux + vy * uy; if (along <= 0 || squares > area.size + extra) return false; return ft(Math.abs(vx * uy - vy * ux)) <= (area.width || 5) / 2 + extra; }
      default: return ft(Math.hypot(c.cx - aim.cx, c.cy - aim.cy)) <= area.size + extra; // sphere, cylinder, circle, radius
    }
  });
}

const key = (s) => `${s.x},${s.y}`;
const xyz = (s) => ({ x: s.x, y: s.y, elevation: s.elevation });
const moveTo = (s) => ({ ...xyz(s), waypoints: s.waypoints ?? [xyz(s)] }); // the route to the square, for TokenDocument#move
const byValue = (a, b) => b.value - a.value;

/** Where an enemy stands relative to `from`: its own distance when the monster stays put, else the matching square of its path.
 *  ponytail: a square is only known along the paths that cross it; good enough for a Multiattack's follow-up attacks. */
function distanceFrom(board, from, enemy) {
  if (!from || from === board.me) return enemy.distance;
  if (from.distances) return from.distances[enemy.id] ?? Infinity; // a retreat square knows every enemy
  return (board.paths[enemy.id] ?? []).find((s) => s.x === from.x && s.y === from.y)?.distance ?? Infinity;
}

/** An area aimed at `enemy` from `square` (null: where the monster stands): everyone covered, value = enemies minus allies (the monster at the firing square). */
function areaFrom(board, activity, enemy, square) {
  const half = (board.me.w ?? 1) * board.grid.px / 2;
  const origin = square ? { cx: square.x + half, cy: square.y + half } : board.me;
  const live = board.enemies.filter((e) => e.hp > 0 && e.visible);
  const allies = (board.allies ?? []).map((a) => a.id === board.me.id ? { ...a, cx: origin.cx, cy: origin.cy } : a);
  const hit = coverage({ area: activity.area, origin, aim: enemy, creatures: [...live, ...allies], grid: board.grid });
  const value = hit.reduce((s, c) => s + (live.includes(c) ? 1 : -1) * expectedValue(activity, c), 0);
  return { square, value, targets: hit };
}

/** Who a heal may target: wounded allies, or only the monster itself (with the board's own hit points) for self heals. */
function healPool(board, activity) {
  const allies = board.allies ?? [];
  if (activity.affects === "self") { const me = allies.find((a) => a.id === board.me.id) ?? { ...board.me, distance: 0 }; return [{ ...me, hp: board.me.hp, maxHp: board.me.maxHp }]; }
  return allies.filter((a) => a.hp < a.maxHp);
}

/** Best target for one activity (an enemy, or a wounded ally for a heal): from where the monster stands or, without `from`, from the first path square in range. */
export function pickTarget(board, activity, from = null) {
  const smart = board.me.intelligence >= board.threshold;
  const heal = activity.kind === "heal";
  let best = null;
  for (const enemy of heal ? healPool(board, activity) : board.enemies) {
    if (heal ? enemy.hp >= enemy.maxHp : (!enemy.visible || enemy.hp <= 0)) continue;
    let square = null;
    const reachable = (board.paths[enemy.id] ?? []).filter((s) => s.distance <= activity.range && s.cost <= board.me.budget && !s.occupied && !board.reserved.has(key(s)));
    if (from) { if (distanceFrom(board, from, enemy) > activity.range) continue; }
    else if (enemy.distance > activity.range) {
      square = reachable[0];
      if (!square) continue;
    }
    // A ranged attack within 5 ft of its target is at disadvantage (5e); ponytail: only the target counts, not other adjacent enemies.
    const near = (square ? square.distance : from ? distanceFrom(board, from, enemy) : enemy.distance) <= 5;
    let value, targets = [enemy];
    if (activity.area) {
      // Aim at this enemy from every square in range (or from here): the firing square that covers the most wins.
      const candidates = from ? [null] : [...(enemy.distance <= activity.range ? [null] : []), ...reachable];
      let best = null;
      for (const s of candidates) { const r = areaFrom(board, activity, enemy, s); if (!best || r.value > best.value) best = r; }
      if (!best || best.value <= 0) continue;
      ({ square, value, targets } = best);
    } else {
      value = expectedValue(activity, enemy, { disadvantage: !!activity.ranged && near });
      // A clever archer next to an enemy looks at the free squares 10 ft from everyone before shooting.
      if (!from && smart && activity.ranged && near) for (const r of board.retreats ?? []) {
        const d = r.distances?.[enemy.id] ?? Infinity;
        if (r.cost > board.me.budget || d > activity.range || board.reserved.has(key(r))) continue;
        const v = expectedValue(activity, enemy, { disadvantage: d <= 5 });
        if (v > value) { value = v; square = r; }
      }
    }
    const pick = { enemy, square, value, targets };
    if (!best) { best = pick; continue; }
    const d = value - best.value;
    if (Math.abs(d) > 1e-9) { if (d > 0) best = pick; continue; }
    const tie = heal ? enemy.hp / enemy.maxHp - best.enemy.hp / best.enemy.maxHp : smart ? enemy.hp - best.enemy.hp : enemy.distance - best.enemy.distance;
    if (tie < 0 || (tie === 0 && enemy.distance < best.enemy.distance)) best = pick;
  }
  return best;
}

/** The turn: the option with the highest expected value (single activities and the Multiattack sequence), else approach.
 *  With `slot: "bonus"`: the best bonus-action activity from where the monster stands, or nothing. */
export function planTurn(board, { slot = "action" } = {}) {
  const actions = board.activities.filter((a) => a.slot === slot);
  const options = [];
  for (const a of actions) {
    const p = pickTarget(board, a);
    if (p && p.value > 0) options.push({ name: a.name, value: p.value, square: p.square, aimId: p.enemy.id, actions: [{ activityId: a.id, targetIds: p.targets.map((t) => t.id) }] });
  }
  if (board.multiattack && slot === "action") {
    const attacks = actions.filter((a) => a.kind === "attack");
    const { count, names } = parseMultiattack(board.multiattack, attacks.map((a) => a.name));
    let seq = names.map((n) => attacks.find((a) => a.name.toLowerCase() === n)).filter(Boolean);
    if (seq.length !== names.length) seq = [];
    if (!seq.length && count > 1) {
      const best = [...options].sort(byValue).map((o) => attacks.find((a) => a.id === o.actions[0].activityId)).find(Boolean);
      if (best) seq = Array(count).fill(best);
    }
    const first = seq.length ? pickTarget(board, seq[0]) : null;
    if (first && first.value > 0) {
      const from = first.square ?? board.me;
      let value = first.value;
      const acts = [{ activityId: seq[0].id, targetIds: [first.enemy.id] }];
      for (const a of seq.slice(1)) {
        const p = pickTarget(board, a, from);
        if (p) { value += p.value; acts.push({ activityId: a.id, targetIds: [p.enemy.id] }); }
      }
      options.push({ name: "Multiattack", value, square: first.square, aimId: first.enemy.id, actions: acts });
    }
  }
  options.sort(byValue);
  const nameOf = (id) => [...board.enemies, ...(board.allies ?? [])].find((e) => e.id === id)?.name ?? id;
  if (options.length) {
    const [w, ...rest] = options;
    const also = rest.slice(0, 3).map((o) => `${o.name} ${o.value.toFixed(1)}`).join(", ");
    return { move: w.square ? moveTo(w.square) : null, actions: w.actions, reason: `${w.name} vs ${nameOf(w.aimId)} (expected ${w.value.toFixed(1)})${also ? `; also: ${also}` : ""}` };
  }
  if (slot !== "action") return { move: null, actions: [], reason: "no bonus action" };
  const visible = board.enemies.filter((e) => e.visible && e.hp > 0).sort((a, b) => a.distance - b.distance);
  if (!visible.length) return { move: null, actions: [], reason: "no visible enemy" };
  const target = visible[0];
  const last = [...(board.paths[target.id] ?? [])].reverse().find((s) => s.cost <= board.me.budget && !s.occupied && !board.reserved.has(key(s)));
  return { move: last ? moveTo(last) : null, actions: [], reason: `approach ${target.name}` };
}
