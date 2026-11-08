// Table house rules, outside the autopilot. Pure decisions first, Foundry hooks last.
import { MODULE_ID, log, safeSync } from "./main.js";

const KEYS = new Set(["system.bonuses.mwak.damage", "system.rolls.damage.mwak.bonus", "system.bonuses.rwak.damage", "system.rolls.damage.rwak.bonus"]);
const WEAPON = { k: "roll.attack.classification", v: "weapon", o: "exact" }, STR = { k: "roll.ability", v: "str", o: "exact" };
// dnd5e 6 checks the conditions of an attribute change at data preparation, with no roll in sight: a per-roll condition needs a
// rule-type change (type "dnd5e.bonus", key "damage"), collected at every damage roll and filtered with that roll's data.
const PAIR = [
  { key: "damage", type: "dnd5e.bonus", value: "@abilities.str.mod", conditions: JSON.stringify([WEAPON, STR]) },
  { key: "damage", type: "dnd5e.bonus", value: "1d4", conditions: JSON.stringify([WEAPON, { o: "NOT", v: STR }]) }
];
const bare = (conditions) => !conditions || ["{}", "[]"].includes(String(conditions).trim());
const isEnlargeBonus = (c) => KEYS.has(c.key) && (c.type ?? "add") === "add" && /^\+?\s*1d4\s*$/.test(String(c.value ?? "")) && bare(c.conditions);

/**
 * Enlarge (user house rule): an enlarged character adds its Strength modifier a second time instead of the 1d4 on Strength
 * weapon attacks; other weapon attacks keep the 1d4. Every 1d4 weapon damage bonus of the effect (melee or thrown, legacy or
 * new key) is replaced by one rule pair. Null when there is nothing to rewrite, or when it was rewritten already.
 */
export function enlargeChanges(name, changes) {
  if (!/enlarge|agrand/i.test(String(name ?? "")) || !changes.some(isEnlargeBonus)) return null;
  if (changes.some((c) => c.key === "damage" && c.type === "dnd5e.bonus")) return null;
  return [...changes.filter((c) => !isEnlargeBonus(c)), ...PAIR.map((c) => ({ ...c }))];
}

/** A spell of the prepared kind created on a character arrives prepared: CPR's automation (applied at import by Coven's Automation
 *  Toolkit) leaves imported spells unprepared, and a spell nobody can cast is not "working as it comes". Other preparation modes
 *  (always, pact, at will, innate), NPCs and spells already prepared are left alone. Returns whether it changed the item. */
export function prepareOnCreate(item) {
  if (game.settings.get(MODULE_ID, "preparedSpells") === false) return false;
  const prep = item.system?.preparation;
  if (item.type !== "spell" || item.parent?.type !== "character" || prep?.mode !== "prepared" || prep.prepared) return false;
  item.updateSource({ "system.preparation.prepared": true });
  return true;
}

export function registerHouseRules() {
  Hooks.on("preCreateActiveEffect", safeSync((effect) => {
    if (game.settings.get(MODULE_ID, "enlargeStrength") === false) return;
    const src = effect.toObject(); // the source form: conditions as strings, not dnd5e's Filter instances
    const changes = enlargeChanges(src.name, src.system?.changes ?? []);
    if (changes) effect.updateSource({ "system.changes": changes });
  }));
  Hooks.on("preCreateItem", safeSync((item) => { prepareOnCreate(item); }));
  log("house rules on");
}
