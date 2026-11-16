// Blood Hunter's Crimson Rite (the 2022 class, built on Eldemar as enchantments named "Rite of the ..."). When a rite's enchantment lands
// on a weapon, the client that applied it pays the blood cost: one roll of the hemocraft die (@scale.blood-hunter.hemocraft-die) as damage
// nothing reduces (hit points only). Rite of the Dawn also lights its wielder's token (bright 20 ft) until the rite ends, through the
// light layers of light.js, and gives the wielder resistance to necrotic damage for as long (dnd5e 6.0.6 does not create the enchantment's
// rider effect). ponytail: the Dawn's extra die against undead stays as text; two Dawn weapons share one light and one resistance.
import { MODULE_ID, log, safe } from "./main.js";
import { lightUp, extinguish } from "./light.js";
import { tokenUpdateAsGm } from "./prompts.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const RITE = /^(rite of|rito de)/i, DAWN = /dawn|alba|amanecer/i;
const DIE = "@scale.blood-hunter.hemocraft-die";
const DAWN_LIGHT = { light: { bright: 20, dim: 20, color: "#fff4d6", alpha: 0.15, animation: { type: null } } };
const actorOf = (effect) => (effect?.parent?.documentName === "Item" ? effect.parent.parent : null);
/** A Crimson Rite's enchantment on an item an actor carries. */
export const isRite = (effect) => effect?.type === "enchantment" && RITE.test(String(effect.name ?? "").trim()) && !!actorOf(effect);
const tokensOf = (actor) => (canvas?.scene?.tokens?.contents ?? []).filter((t) => t.actor === actor);
const dawnLayer = (actor) => (l) => l.key === "riteDawn" && l.casterUuid === actor.uuid;

/** createActiveEffect on the client that applied the rite: the blood cost, and the Dawn's light. */
export async function onCreateRite(effect, options, userId) {
  if (game.settings.get(MODULE_ID, "crimsonRite") === false || userId !== game.user.id || !isRite(effect)) return;
  const actor = actorOf(effect);
  if (!actor.getRollData?.()?.scale?.["blood-hunter"]?.["hemocraft-die"]) { log(`crimson rite: ${actor.name} has no hemocraft die on the sheet, no cost rolled`); return; }
  const roll = await new Roll(DIE, actor.getRollData()).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker?.({ actor }) ?? {}, flavor: L("Rites.Cost", { name: actor.name, rite: effect.name }) });
  await actor.applyDamage(roll.total, { ignore: true }); // can't be reduced in any way
  log(`crimson rite: ${actor.name} pays ${roll.total} for ${effect.name}`);
  if (!DAWN.test(effect.name)) return;
  for (const t of tokensOf(actor)) await lightUp(t, DAWN_LIGHT, { key: "riteDawn", casterUuid: actor.uuid, itemUuid: effect.parent?.uuid ?? "", concentration: false }, tokenUpdateAsGm);
  if (![...(actor.effects ?? [])].some((e) => e.flags?.[MODULE_ID]?.riteDawn)) await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: effect.name, img: effect.img, origin: effect.parent?.uuid, transfer: false,
    changes: [{ key: "system.traits.dr.value", mode: 2, type: "add", value: "necrotic" }], flags: { [MODULE_ID]: { riteDawn: true } }
  }]);
}

/** deleteActiveEffect on the client that ended the rite: the Dawn's light goes. */
export async function onDeleteRite(effect, options, userId) {
  if (userId !== game.user.id || !isRite(effect) || !DAWN.test(effect.name)) return;
  const actor = actorOf(effect);
  for (const t of tokensOf(actor)) await extinguish(t, dawnLayer(actor));
  for (const e of [...(actor.effects ?? [])]) if (e.flags?.[MODULE_ID]?.riteDawn) await e.delete();
}

export function registerRites() {
  Hooks.on("createActiveEffect", safe(onCreateRite));
  Hooks.on("deleteActiveEffect", safe(onDeleteRite));
  log("crimson rite on");
}
