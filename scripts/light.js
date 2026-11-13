// Light spells: the token's own light follows the cast (no Active Token Effects module needed). Light, Continual Flame and Daylight
// light the picked token (the picker asks within the spell's range); Produce Flame lights the caster; Faerie Fire lights whoever failed.
// The light ends when the same caster casts a single-instance spell again (Light, Produce Flame), when Produce Flame is thrown, when the
// caster's concentration drops (Faerie Fire), or by hand (the HUD button). ponytail: durations are not tracked (the table's call).
import { MODULE_ID, log, safe, safeSync } from "./main.js";
import { tokenUpdateAsGm } from "./prompts.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const FLAG = () => `flags.${MODULE_ID}.light`; // lazy: main.js imports this module, so MODULE_ID is not set yet at load
const SPELLS = [
  { re: /^(light|luz)$/i, key: "light", single: true, light: { bright: 20, dim: 40, color: "#ffe6b3", alpha: 0.15, animation: { type: null } } },
  { re: /^(produce flame|producir llama)$/i, key: "produceFlame", single: true, self: true, light: { bright: 10, dim: 20, color: "#ff9a3c", alpha: 0.25, animation: { type: "torch", speed: 2, intensity: 2 } } },
  { re: /^(continual flame|llama continua)$/i, key: "continualFlame", light: { bright: 20, dim: 40, color: "#ffb45a", alpha: 0.2, animation: { type: "torch", speed: 1, intensity: 1 } } },
  { re: /^(daylight|luz del d[ií]a)$/i, key: "daylight", light: { bright: 60, dim: 120, color: "#ffffff", alpha: 0.1, animation: { type: null } } },
  { re: /^(faerie fire|fuego fe?[eé]rico)$/i, key: "faerieFire", failed: true, light: { bright: 0, dim: 10, color: "#7fd4ff", alpha: 0.3, animation: { type: null } } }
];
/** The light spell an item name is, or null. */
export const lightSpell = (name) => SPELLS.find((s) => s.re.test(String(name ?? "").trim())) ?? null;

const flagOf = (doc) => doc?.getFlag?.(MODULE_ID, "light") ?? doc?.flags?.[MODULE_ID]?.light;
const plain = (light) => light?.toObject ? light.toObject() : JSON.parse(JSON.stringify(light ?? {}));
const leadGm = () => !!game.users.activeGM?.isSelf;
const sceneTokens = () => canvas?.scene?.tokens?.contents ?? [];
/** A token update by this client when it may, else by the GM through the socket. */
const applyUpdate = async (doc, update, asGm) => (game.user.isGM || doc.isOwner ? doc.update(update) : asGm(doc.uuid, update));

async function lightUp(doc, spec, meta, asGm) {
  const had = flagOf(doc);
  await applyUpdate(doc, { light: { ...spec.light }, [FLAG()]: { prev: had?.prev ?? plain(doc.light), ...meta } }, asGm); // a light over ours keeps the original to come back to
}

/** Put a token's old light back, if the light is ours. */
export async function extinguish(doc, asGm = tokenUpdateAsGm) {
  const f = flagOf(doc);
  if (!f) return;
  await applyUpdate(doc, { light: f.prev, [`flags.${MODULE_ID}.-=light`]: null }, asGm);
}

const ours = (pred) => sceneTokens().filter((t) => { const f = flagOf(t); return f && pred(f); });

/** midi-qol.RollComplete on the caster's client: light the spell's targets, after ending the caster's previous instance of a single-cast spell. */
export async function onRollComplete(workflow, deps = {}) {
  const { asGm = tokenUpdateAsGm } = deps;
  if (game.settings.get(MODULE_ID, "lightSpells") === false || !workflow || workflow.aborted) return;
  const spec = lightSpell(workflow.item?.name);
  if (!spec) return;
  const casterUuid = workflow.actor?.uuid ?? "", mine = (f) => f.key === spec.key && f.casterUuid === casterUuid;
  if (spec.self && workflow.activity?.type === "attack") { for (const t of ours(mine)) await extinguish(t, asGm); return; } // the flame is thrown
  const docs = (set) => [...(set ?? [])].map((t) => t.document ?? t).filter(Boolean);
  const targets = spec.self ? [workflow.token?.document].filter(Boolean) : docs(spec.failed ? workflow.failedSaves : workflow.targets);
  if (!targets.length) return; // Esc on the picker, or nobody failed: nothing to light
  if (spec.single) for (const t of ours(mine)) await extinguish(t, asGm); // the spell ends when cast again
  const concentration = !!(workflow.item?.system?.properties?.has?.("concentration") || workflow.item?.requiresConcentration);
  for (const t of targets) await lightUp(t, spec, { key: spec.key, casterUuid, itemUuid: workflow.item?.uuid ?? "", concentration }, asGm);
  log(`${spec.key}: ${targets.map((t) => t.name).join(", ")} lit by ${workflow.actor?.name}`);
}

/** deleteActiveEffect on the lead GM: the caster's concentration dropping puts out the lights it held. */
export async function onDeleteEffect(effect) {
  if (!leadGm() || !effect?.statuses?.has?.("concentrating")) return;
  const uuid = effect.parent?.uuid;
  for (const t of ours((f) => f.concentration && f.casterUuid === uuid)) await extinguish(t);
}

/** renderTokenHUD: a put-out button on a token we lit, for its owner or the GM. */
export function onRenderTokenHUD(app, html) {
  const root = html?.querySelector ? html : html?.[0];
  const doc = app.object?.document ?? app.document;
  const col = root?.querySelector(".col.left");
  if (!doc || !flagOf(doc) || !(doc.isOwner || game.user.isGM) || !col) return;
  col.insertAdjacentHTML("beforeend", `<button type="button" class="control-icon bg3-light-off" data-tooltip="${L("Light.Off")}"><i class="fa-solid fa-lightbulb-slash"></i></button>`);
  col.querySelector(".bg3-light-off")?.addEventListener("click", safe(() => extinguish(doc)));
}

export function registerLight() {
  Hooks.on("midi-qol.RollComplete", safe((w) => onRollComplete(w)));
  Hooks.on("deleteActiveEffect", safe(onDeleteEffect));
  Hooks.on("renderTokenHUD", safeSync(onRenderTokenHUD));
  log("light spells on");
}
