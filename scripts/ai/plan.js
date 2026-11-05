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
