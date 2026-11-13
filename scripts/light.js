// Light spells: the token's own light follows the cast (no Active Token Effects module needed). Light, Continual Flame and Daylight
// light the picked token (the picker asks within the spell's range); Daylight on a point (a template) becomes an ambient light there;
// Produce Flame lights the caster; Faerie Fire lights whoever failed. Lights stack on a token (a Light over a Continual Flame): each
// spell is a layer, the newest shows, and when it ends the one beneath comes back, the token's own light last. A light ends when the
// same caster casts a single-instance spell again (Light, Produce Flame), when Produce Flame is thrown, when the caster's concentration
// drops (Faerie Fire), or by hand (the HUD button puts out every layer). ponytail: durations are not tracked (the table's call).
import { MODULE_ID, log, safe, safeSync } from "./main.js";
import { tokenUpdateAsGm, ambientLightAsGm } from "./prompts.js";
import { payAction } from "./economy.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const FLAG = () => `flags.${MODULE_ID}.light`; // lazy: main.js imports this module, so MODULE_ID is not set yet at load
const SPELLS = [
  { re: /^(light|luz)$/i, key: "light", single: true, light: { bright: 20, dim: 40, color: "#ffe6b3", alpha: 0.15, animation: { type: null } } },
  { re: /^(produce flame|producir llama)$/i, key: "produceFlame", single: true, self: true, light: { bright: 10, dim: 20, color: "#ff9a3c", alpha: 0.25, animation: { type: "torch", speed: 2, intensity: 2 } } },
  { re: /^(continual flame|llama continua)$/i, key: "continualFlame", light: { bright: 20, dim: 40, color: "#ffb45a", alpha: 0.2, animation: { type: "torch", speed: 1, intensity: 1 } } },
  { re: /^(daylight|luz del d[ií]a)$/i, key: "daylight", point: true, light: { bright: 60, dim: 120, color: "#ffffff", alpha: 0.1, animation: { type: null } } },
  { re: /^(faerie fire|fuego fe?[eé]rico)$/i, key: "faerieFire", failed: true, light: { bright: 0, dim: 10, color: "#7fd4ff", alpha: 0.3, animation: { type: null } } }
];
/** The light spell an item name is, or null. */
export const lightSpell = (name) => SPELLS.find((s) => s.re.test(String(name ?? "").trim())) ?? null;

const flagOf = (doc) => doc?.getFlag?.(MODULE_ID, "light") ?? doc?.flags?.[MODULE_ID]?.light;
const layersOf = (doc) => flagOf(doc)?.layers ?? [];
const plain = (light) => light?.toObject ? light.toObject() : JSON.parse(JSON.stringify(light ?? {}));
const leadGm = () => !!game.users.activeGM?.isSelf;
const sceneTokens = () => canvas?.scene?.tokens?.contents ?? [];
/** A token update by this client when it may, else by the GM through the socket. */
const applyUpdate = async (doc, update, asGm) => (game.user.isGM || doc.isOwner ? doc.update(update) : asGm(doc.uuid, update));

async function lightUp(doc, spec, meta, asGm) {
  const f = flagOf(doc);
  const layers = [...(f?.layers ?? []), { ...meta, light: { ...spec.light } }];
  await applyUpdate(doc, { light: { ...spec.light }, [FLAG()]: { prev: f?.prev ?? plain(doc.light), layers } }, asGm); // the token's own light is kept beneath every layer
}

/** Put out the layers `pred` picks (all by default): the newest layer left shows, or the token's own light when none is left. */
export async function extinguish(doc, pred = () => true, asGm = tokenUpdateAsGm) {
  const f = flagOf(doc);
  if (!f) return;
  const layers = f.layers ?? [], left = layers.filter((l) => !pred(l));
  if (left.length === layers.length) return;
  const update = left.length ? { light: { ...left.at(-1).light }, [FLAG()]: { prev: f.prev, layers: left } } : { light: f.prev, [`flags.${MODULE_ID}.-=light`]: null };
  await applyUpdate(doc, update, asGm);
}

const ours = (pred) => sceneTokens().filter((t) => layersOf(t).some(pred));

/** Where a placed template is: a MeasuredTemplate's x/y, or (Foundry 14 backs Midi's templates with Regions) its first shape's centre. */
export function templateCenter(tpl) {
  if (typeof tpl?.x === "number" && typeof tpl?.y === "number") return { x: tpl.x, y: tpl.y };
  const s = tpl?.shapes?.[0];
  if (!s) return null;
  if (s.type === "rectangle") return { x: s.x + (s.width ?? 0) / 2, y: s.y + (s.height ?? 0) / 2 };
  if (s.type === "polygon" && s.points?.length >= 2) { const n = s.points.length / 2; let x = 0, y = 0; for (let i = 0; i < s.points.length; i += 2) { x += s.points[i]; y += s.points[i + 1]; } return { x: x / n, y: y / n }; }
  return typeof s.x === "number" ? { x: s.x, y: s.y } : null; // circle, ellipse
}

/** Daylight on a point: Midi placed a template, the spell's light is an ambient light there (the DM deletes it when the spell ends). */
async function ambientAt(at, spec, meta) {
  const data = { x: at.x, y: at.y, config: { ...spec.light }, flags: { [MODULE_ID]: { light: meta } } };
  if (game.user.isGM) await canvas.scene.createEmbeddedDocuments("AmbientLight", [data]);
  else await ambientLightAsGm(canvas.scene.id, data);
}

/** midi-qol.RollComplete on the caster's client: light the spell's targets, after ending the caster's previous instance of a single-cast spell. */
export async function onRollComplete(workflow, deps = {}) {
  const { asGm = tokenUpdateAsGm } = deps;
  if (game.settings.get(MODULE_ID, "lightSpells") === false || !workflow || workflow.aborted) return;
  const spec = lightSpell(workflow.item?.name);
  if (!spec) return;
  const casterUuid = workflow.actor?.uuid ?? "", mine = (l) => l.key === spec.key && l.casterUuid === casterUuid;
  const docs = (set) => [...(set ?? [])].map((t) => t.document ?? t).filter(Boolean);
  const concentration = !!(workflow.item?.system?.properties?.has?.("concentration") || workflow.item?.requiresConcentration);
  const meta = { key: spec.key, casterUuid, itemUuid: workflow.item?.uuid ?? "", concentration };
  let targets;
  const self = workflow.token?.document;
  if (spec.self) { // the flame in hand: the SRD item's only activity is the attack (and it targets the caster itself), so an attack on nobody else is the cast; thrown at someone it goes out
    const others = [...docs(workflow.targets), ...docs(workflow.hitTargets)].filter((t) => t !== self && t.id !== self?.id);
    if (workflow.activity?.type === "attack" && others.length) { for (const t of ours(mine)) await extinguish(t, mine, asGm); return; }
    targets = [self].filter(Boolean);
  } else {
    const at = spec.point ? templateCenter(workflow.templateUuid ? globalThis.fromUuidSync?.(workflow.templateUuid) : workflow.template) : null;
    if (at) { await ambientAt(at, spec, meta); log(`${spec.key}: ambient light at ${at.x},${at.y} by ${workflow.actor?.name}`); return; }
    targets = docs(spec.failed ? workflow.failedSaves : workflow.targets);
  }
  if (!targets.length) return; // Esc on the picker, or nobody failed: nothing to light
  if (spec.single) for (const t of ours(mine)) await extinguish(t, mine, asGm); // the spell ends when cast again
  for (const t of targets) await lightUp(t, spec, meta, asGm);
  log(`${spec.key}: ${targets.map((t) => t.name).join(", ")} lit by ${workflow.actor?.name}`);
}

/** midi-qol.preTargetingV2: the SRD Produce Flame's attack targets the caster itself (the item affects self) and would hit it. With nobody
 *  else targeted the use is the cast: the flame is lit, the action paid, and Midi's attack stopped. Targeting a creature throws it. */
export async function onPreTargetingLight({ workflow }, deps = {}) {
  const { pay = payAction } = deps;
  if (game.settings.get(MODULE_ID, "lightSpells") === false) return;
  const spec = lightSpell(workflow?.item?.name);
  if (!spec?.self || workflow.activity?.type !== "attack") return;
  const self = workflow.token?.document ?? workflow.token;
  if ([...(game.user.targets ?? [])].some((t) => (t.document ?? t) !== self && (t.document ?? t).id !== self?.id)) return; // the throw
  const casterUuid = workflow.actor?.uuid ?? "", mine = (l) => l.key === spec.key && l.casterUuid === casterUuid;
  for (const t of ours(mine)) await extinguish(t, mine);
  if (self) await lightUp(self, spec, { key: spec.key, casterUuid, itemUuid: workflow.item?.uuid ?? "", concentration: false }, tokenUpdateAsGm);
  await pay(workflow.actor, "action");
  ui.notifications.info(L("Light.Flame"));
  return false;
}

/** deleteActiveEffect on the lead GM: the caster's concentration dropping puts out the lights it held, on tokens and ambient ones. */
export async function onDeleteEffect(effect) {
  if (!leadGm() || !effect?.statuses?.has?.("concentrating")) return;
  const uuid = effect.parent?.uuid, held = (l) => l.concentration && l.casterUuid === uuid;
  for (const t of ours(held)) await extinguish(t, held);
  for (const l of canvas?.scene?.lights?.contents ?? []) if (held(l.flags?.[MODULE_ID]?.light ?? {})) await l.delete();
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
  Hooks.on("midi-qol.preTargetingV2", safe((o) => onPreTargetingLight(o))); // a `false` reaches Midi
  Hooks.on("deleteActiveEffect", safe(onDeleteEffect));
  Hooks.on("renderTokenHUD", safeSync(onRenderTokenHUD));
  log("light spells on");
}
