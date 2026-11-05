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

/** Expected damage (or healing, as damage avoided) of one activity against one target. */
export function expectedValue(activity, target) {
  switch (activity.kind) {
    case "attack": return hitChance({ bonus: activity.bonus ?? 0, ac: target.ac ?? 10 }) * activity.damage;
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

const key = (s) => `${s.x},${s.y}`;
const xyz = (s) => ({ x: s.x, y: s.y, elevation: s.elevation });
const moveTo = (s) => ({ ...xyz(s), waypoints: s.waypoints ?? [xyz(s)] }); // the route to the square, for TokenDocument#move
const byValue = (a, b) => b.value - a.value;

/** Where an enemy stands relative to `from`: its own distance when the monster stays put, else the matching square of its path.
 *  ponytail: a square is only known along the paths that cross it; good enough for a Multiattack's follow-up attacks. */
function distanceFrom(board, from, enemy) {
  if (!from || from === board.me) return enemy.distance;
  return (board.paths[enemy.id] ?? []).find((s) => s.x === from.x && s.y === from.y)?.distance ?? Infinity;
}

/** Best visible, living enemy for one activity: from where the monster stands or, without `from`, from the first path square in range. */
export function pickTarget(board, activity, from = null) {
  const smart = board.me.intelligence >= board.threshold;
  let best = null;
  for (const enemy of board.enemies) {
    if (!enemy.visible || enemy.hp <= 0) continue;
    let square = null;
    if (from) { if (distanceFrom(board, from, enemy) > activity.range) continue; }
    else if (enemy.distance > activity.range) {
      square = (board.paths[enemy.id] ?? []).find((s) => s.distance <= activity.range && s.cost <= board.me.budget && !s.occupied && !board.reserved.has(key(s)));
      if (!square) continue;
    }
    const value = expectedValue(activity, enemy);
    const pick = { enemy, square, value };
    if (!best) { best = pick; continue; }
    const d = value - best.value;
    if (Math.abs(d) > 1e-9) { if (d > 0) best = pick; continue; }
    const tie = smart ? enemy.hp - best.enemy.hp : enemy.distance - best.enemy.distance;
    if (tie < 0 || (tie === 0 && enemy.distance < best.enemy.distance)) best = pick;
  }
  return best;
}

/** The turn: the option with the highest expected value (single activities and the Multiattack sequence), else approach. */
export function planTurn(board) {
  const actions = board.activities.filter((a) => a.slot === "action");
  const options = [];
  for (const a of actions) {
    const p = pickTarget(board, a);
    if (p && p.value > 0) options.push({ name: a.name, value: p.value, square: p.square, actions: [{ activityId: a.id, targetId: p.enemy.id }] });
  }
  if (board.multiattack) {
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
      const acts = [{ activityId: seq[0].id, targetId: first.enemy.id }];
      for (const a of seq.slice(1)) {
        const p = pickTarget(board, a, from);
        if (p) { value += p.value; acts.push({ activityId: a.id, targetId: p.enemy.id }); }
      }
      options.push({ name: "Multiattack", value, square: first.square, actions: acts });
    }
  }
  options.sort(byValue);
  const nameOf = (id) => board.enemies.find((e) => e.id === id)?.name ?? id;
  if (options.length) {
    const [w, ...rest] = options;
    const also = rest.slice(0, 3).map((o) => `${o.name} ${o.value.toFixed(1)}`).join(", ");
    return { move: w.square ? moveTo(w.square) : null, actions: w.actions, reason: `${w.name} vs ${nameOf(w.actions[0].targetId)} (expected ${w.value.toFixed(1)})${also ? `; also: ${also}` : ""}` };
  }
  const visible = board.enemies.filter((e) => e.visible && e.hp > 0).sort((a, b) => a.distance - b.distance);
  if (!visible.length) return { move: null, actions: [], reason: "no visible enemy" };
  const target = visible[0];
  const last = [...(board.paths[target.id] ?? [])].reverse().find((s) => s.cost <= board.me.budget && !s.occupied && !board.reserved.has(key(s)));
  return { move: last ? moveTo(last) : null, actions: [], reason: `approach ${target.name}` };
}
