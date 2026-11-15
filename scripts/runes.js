// Rune Knight features nothing in the stack automates. Cloud Rune: when a creature within 30 ft of the holder is hit by an attack roll,
// the holder may use its reaction to move the attack to another creature within 30 ft of itself (not the attacker), with the same roll.
// The holder is whoever carries the rune: the Rune Knight's own feature, or an equipped item named Cloud Rune (a table rule). Giant's
// Might: Large for a minute, advantage on Strength checks and saves, and the table's "Strength twice" rule instead of the book's +1d6
// (Strength weapon attacks add the Strength modifier again, as Enlarge does here), the token grown to 2x2 and put back when it ends. ponytail: no room check for growing; the rune's uses are the item's own.
import { MODULE_ID, log, safe } from "./main.js";
import { sees, distanceFt } from "./encounters.js";
import { activeOwner, promptCloudRune } from "./prompts.js";
import { STRENGTH_TWICE } from "./houserules.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const on = () => game.settings.get(MODULE_ID, "runeFeatures") !== false;
const CLOUD = /^(cloud rune|runa de (las )?nubes)$/i;
const MIGHT = /^(giant[’']?s might|poder del? gigante)$/i;
export const isGiantsMight = (name) => MIGHT.test(String(name ?? "").trim());
const docOf = (t) => t?.document ?? t;
const hpOf = (d) => d?.actor?.system?.attributes?.hp?.value ?? 1;
const alive = (d) => d && !d.hidden && hpOf(d) > 0;
const sceneTokens = () => canvas?.scene?.tokens?.contents ?? [];
const centre = (d) => d.getCenterPoint?.() ?? d.object?.center ?? { x: d.x, y: d.y };
const defaultDist = (a, b) => distanceFt(centre(a), centre(b));

/** The Cloud Rune this actor can invoke now: the feature, or an equipped item so named, with a use left. */
export function cloudRuneOf(actor) {
  return [...(actor?.items ?? [])].find((i) => {
    if (!CLOUD.test(String(i.name ?? "").trim())) return false;
    if (i.type !== "feat" && i.system?.equipped !== true) return false;
    const u = i.system?.uses, max = parseInt(u?.max);
    return !(max > 0) || (u.spent ?? 0) < max;
  }) ?? null;
}

/** Who may react to `target` being hit by `attacker`: holders within 30 ft of it who see it and have their reaction. */
export function cloudRuneReactors(target, attacker, { see = sees, dist = defaultDist } = {}) {
  const out = [];
  for (const d of sceneTokens()) {
    if (d === attacker || !alive(d)) continue;
    const item = cloudRuneOf(d.actor);
    if (!item || globalThis.MidiQOL?.hasUsedReaction?.(d.actor)) continue;
    if (d !== target && (dist(d, target) > 30 || !see(d, target))) continue;
    out.push({ doc: d, item });
  }
  return out;
}

/** Where the attack may go: another creature within 30 ft of the holder (the holder included), not the attacker nor the one hit. */
export const redirectChoices = (reactor, target, attacker, { dist = defaultDist } = {}) =>
  sceneTokens().filter((d) => d !== attacker && d !== target && alive(d) && (d === reactor || dist(reactor, d) <= 30));

const defaultAsk = (r, data) => promptCloudRune(activeOwner(r.doc.actor)?.id ?? null, data);

/** midi-qol.hitsChecked (awaited, before the hits are shown and the damage rolled): offer the Cloud Rune for each creature hit. */
export async function onHitsChecked(workflow, deps = {}) {
  const { ask = defaultAsk, see = sees, dist = defaultDist } = deps;
  if (!on() || workflow?.activity?.type !== "attack" || !((workflow.hitTargets?.size ?? workflow.hitTargets?.count) > 0)) return;
  const attacker = docOf(workflow.token);
  for (const hitTok of [...workflow.hitTargets]) {
    const target = docOf(hitTok);
    for (const r of cloudRuneReactors(target, attacker, { see, dist })) {
      const choices = redirectChoices(r.doc, target, attacker, { dist });
      if (!choices.length) continue;
      const uuid = await ask(r, { reactor: r.doc.name, attacker: attacker?.name ?? "", target: target.name, choices: choices.map((d) => ({ uuid: d.uuid, name: d.name })) });
      const other = uuid && choices.find((d) => d.uuid === uuid);
      if (!other) continue;
      const hit = !!workflow.isCritical || (workflow.attackTotal ?? 0) >= (other.actor?.system?.attributes?.ac?.value ?? 10);
      const otherTok = other.object ?? other;
      for (const set of [workflow.hitTargets, workflow.hitTargetsEC, workflow.targets]) set?.delete?.(hitTok);
      workflow.targets?.add?.(otherTok);
      if (hit) workflow.hitTargets.add(otherTok);
      await globalThis.MidiQOL?.setReactionUsed?.(r.doc.actor);
      const max = parseInt(r.item.system?.uses?.max);
      if (max > 0) await r.item.update({ "system.uses.spent": (r.item.system.uses.spent ?? 0) + 1 });
      await ChatMessage.create({ content: L("Runes.Redirect", { reactor: r.doc.name, attacker: attacker?.name ?? "", target: target.name, other: other.name, result: L(hit ? "Runes.Hit" : "Runes.Miss") }) });
      log(`cloud rune: ${r.doc.name} moved ${attacker?.name}'s attack from ${target.name} to ${other.name} (${hit ? "hit" : "miss"})`);
      break; // one rune per creature hit
    }
  }
}

const GM_FLAG = "giantsMight";
/** midi-qol.RollComplete on the caster's client: Giant's Might, unless the item carries its own effect (configured by hand). */
export async function onRollCompleteGiant(workflow) {
  if (!on() || !workflow || workflow.aborted || !isGiantsMight(workflow.item?.name) || (workflow.item?.effects?.size ?? 0) > 0) return;
  const actor = workflow.actor, token = docOf(workflow.token);
  if (!actor) return;
  for (const e of [...(actor.effects ?? [])]) if (e.flags?.[MODULE_ID]?.[GM_FLAG]) await e.delete(); // a second use: refresh
  const grow = token && (token.width ?? 1) < 2;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: workflow.item.name, img: workflow.item.img, origin: workflow.item.uuid, transfer: false, duration: { rounds: 10 },
    changes: [
      { key: "flags.midi-qol.advantage.ability.check.str", mode: 5, value: "1" },
      { key: "flags.midi-qol.advantage.ability.save.str", mode: 5, value: "1" },
      { key: "system.traits.size", mode: 5, value: "lg" },
      { ...STRENGTH_TWICE } // the table's rule instead of the book's +1d6
    ],
    flags: { [MODULE_ID]: { [GM_FLAG]: { prev: grow ? { width: token.width ?? 1, height: token.height ?? 1 } : null } } }
  }]);
  if (grow) await token.update({ width: 2, height: 2 });
  log(`giant's might: ${actor.name}`);
}

/** deleteActiveEffect on the lead GM: Giant's Might ended, the token back to its size. */
export async function onDeleteEffectGiant(effect) {
  const prev = effect?.flags?.[MODULE_ID]?.[GM_FLAG]?.prev;
  if (!prev || !game.users.activeGM?.isSelf) return;
  for (const d of sceneTokens()) if (d.actor === effect.parent) await d.update({ width: prev.width, height: prev.height });
}

export function registerRunes() {
  Hooks.on("midi-qol.hitsChecked", safe((w) => onHitsChecked(w)));
  Hooks.on("midi-qol.RollComplete", safe((w) => onRollCompleteGiant(w)));
  Hooks.on("deleteActiveEffect", safe(onDeleteEffectGiant));
  log("rune features on");
}
