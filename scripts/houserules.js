// Table house rules, outside the autopilot. Pure decisions first, Foundry hooks last.
import { MODULE_ID, log, safeSync } from "./main.js";

const KEYS = {
  "system.bonuses.mwak.damage": "system.rolls.damage.mwak.bonus", "system.rolls.damage.mwak.bonus": "system.rolls.damage.mwak.bonus",
  "system.bonuses.rwak.damage": "system.rolls.damage.rwak.bonus", "system.rolls.damage.rwak.bonus": "system.rolls.damage.rwak.bonus"
};
const STR = JSON.stringify([{ k: "roll.ability", v: "str", o: "exact" }]);
const NOT_STR = JSON.stringify([{ o: "NOT", v: { k: "roll.ability", v: "str", o: "exact" } }]);
const bare = (conditions) => !conditions || ["{}", "[]"].includes(String(conditions).trim());
const isEnlargeBonus = (c) => c.key in KEYS && /^\+?\s*1d4\s*$/.test(String(c.value ?? "")) && bare(c.conditions);

/**
 * Enlarge (user house rule): an enlarged character adds its Strength modifier a second time instead of the 1d4 on Strength
 * attacks; other attacks keep the 1d4. The effect's 1d4 damage bonus (legacy or new key, melee or thrown) becomes two
 * conditional bonuses that dnd5e 6 applies by the attack's ability at roll time. Null when there is nothing to rewrite.
 */
export function enlargeChanges(name, changes) {
  if (!/enlarge|agrand/i.test(String(name ?? "")) || !changes.some(isEnlargeBonus)) return null;
  return changes.flatMap((c) => {
    if (!isEnlargeBonus(c)) return [c];
    const { _id, ...rest } = c;
    return [{ ...rest, key: KEYS[c.key], value: "@abilities.str.mod", conditions: STR }, { ...rest, key: KEYS[c.key], value: "1d4", conditions: NOT_STR }];
  });
}

export function registerHouseRules() {
  Hooks.on("preCreateActiveEffect", safeSync((effect) => {
    if (game.settings.get(MODULE_ID, "enlargeStrength") === false) return;
    const src = effect.toObject(); // the source form: conditions as strings, not dnd5e's Filter instances
    const changes = enlargeChanges(src.name, src.system?.changes ?? []);
    if (changes) effect.updateSource({ "system.changes": changes });
  }));
  log("house rules on");
}
