// Feature 3: encounters and stealth. Marked enemy groups watch for player tokens; a spot or a hit starts combat.
import { MODULE_ID, log, safe, safeSync } from "./main.js";
import { encounterGroups, obscurity, spotsBg3, withinRadius } from "./rules.js";
import { rollOrType, promptInitiative, askGmToStart, activeOwner, awaitOrGm } from "./prompts.js";
import { hideCost, affordAction, payAction } from "./economy.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const encounterOf = (doc) => doc.getFlag(MODULE_ID, "encounter");
const stealthOf = (doc) => doc.getFlag(MODULE_ID, "stealth");
const leadGm = () => !!game.users.activeGM?.isSelf; // one GM acts, however many are connected
const isPc = (t) => t.actor?.type === "character" && !!t.actor.hasPlayerOwner;

// ---- Marking ----

/** Mark the tokens as one encounter group with a detection radius; when all are already marked, clear them. */
export async function markEncounter(docs, radius) {
  if (!docs.length) return;
  if (docs.every(encounterOf)) {
    for (const d of docs) await d.unsetFlag(MODULE_ID, "encounter");
    log(`encounter cleared: ${docs.map((d) => d.name).join(", ")}`);
    return;
  }
  const id = foundry.utils.randomID();
  for (const d of docs) await d.setFlag(MODULE_ID, "encounter", { id, radius });
  log(`encounter ${id}: ${docs.map((d) => d.name).join(", ")}, radius ${radius} ft`);
}

async function askAndMark() {
  const docs = canvas.tokens.controlled.map((t) => t.document);
  if (!docs.length) return ui.notifications.warn(L("Encounter.NoTokens"));
  let radius = 0;
  if (!docs.every(encounterOf)) {
    const def = game.settings.get(MODULE_ID, "defaultEncounterRadius");
    radius = await foundry.applications.api.DialogV2.prompt({
      window: { title: L("Encounter.Mark") },
      content: `<label>${L("Encounter.Radius")} <input type="number" name="radius" value="${def}" min="5" step="5" autofocus></label>`,
      ok: { callback: (ev, button) => Number(button.form.elements.radius.value) || def },
      rejectClose: false
    });
    if (typeof radius !== "number") return;
  }
  await markEncounter(docs, radius);
  drawEncounters();
}

/** getSceneControlButtons: a GM button in the token controls. */
export function onSceneControls(controls) {
  const tools = controls.tokens?.tools;
  if (!tools) return;
  tools.bg3Encounter = {
    name: "bg3Encounter", title: "BG3FLOW.Encounter.Mark", icon: "fa-solid fa-skull-crossbones", order: 100,
    button: true, visible: game.user.isGM, onChange: () => askAndMark()
  };
}

// ---- Hide ----

const ADVANTAGE = { key: "flags.midi-qol.advantage.attack.all", mode: 5, value: "1" }; // Midi's flag: the hidden attacker rolls with advantage (Sneak Attack asks for it)

/** Token HUD Hide: roll or type Stealth, store it, show dnd5e's hiding status with Midi's attack-advantage flag on its effect (Midi
 *  14.6.8's hidden-advantage rule only reads vision, and the goblins' tokens have none). Pressing it while hidden reveals. */
export async function hideToken(doc, roll = rollOrType) {
  if (stealthOf(doc)?.hidden) return revealToken(doc);
  const cost = hideCost(doc.actor); // BG3: hiding is the action, the bonus action with Cunning Action; free out of combat and off turn
  if (affordAction(doc.actor, cost) === false) return;
  const value = await roll({ actor: doc.actor, skill: "ste" });
  if (value === null || value === undefined) return;
  await payAction(doc.actor, cost);
  await doc.setFlag(MODULE_ID, "stealth", { value, hidden: true });
  const effect = await doc.actor?.toggleStatusEffect("hiding", { active: true });
  if (effect?.update && !effect.changes?.some((c) => c.key === ADVANTAGE.key)) await effect.update({ changes: [...(effect.changes ?? []), { ...ADVANTAGE }] });
}

export async function revealToken(doc) {
  if (!stealthOf(doc)) return;
  await doc.unsetFlag(MODULE_ID, "stealth");
  await doc.actor?.toggleStatusEffect("hiding", { active: false });
}

/** renderTokenHUD: an eye-slash button on the left column for owned tokens. */
export function onRenderTokenHUD(app, html) {
  const root = html?.querySelector ? html : html?.[0];
  const doc = app.object?.document ?? app.document;
  const col = root?.querySelector(".col.left");
  if (!doc?.isOwner || !col) return;
  col.insertAdjacentHTML("beforeend", `<button type="button" class="control-icon bg3-hide" data-tooltip="${L("Hide.Button")}"><i class="fa-solid fa-eye-slash"></i></button>`);
  col.querySelector(".bg3-hide")?.addEventListener("click", safe(() => hideToken(doc)));
}

// ---- GM overlay ----

let marks = null;
/** GM-only circles around marked tokens on the current scene. */
export function drawEncounters() {
  if (!canvas?.ready || !game.user.isGM) return;
  if (marks && !marks.destroyed) marks.destroy();
  marks = null;
  const g = new PIXI.Graphics();
  for (const token of canvas.tokens.placeables) {
    const enc = encounterOf(token.document);
    if (!enc) continue;
    const px = enc.radius / canvas.dimensions.distance * canvas.dimensions.size;
    const { x, y } = token.center;
    if (typeof g.circle === "function") g.circle(x, y, px).stroke({ width: 2, color: 0xff5555, alpha: 0.6 }); // PIXI 8
    else g.lineStyle(2, 0xff5555, 0.6).drawCircle(x, y, px); // PIXI 7
  }
  canvas.interface.addChild(g);
  marks = g;
}

// ---- Detection (GM client, outside combat) ----

const isLive = (t) => !t.hidden && (t.actor?.system?.attributes?.hp?.value ?? 1) > 0;
export const distanceFt = (a, b) => canvas.grid.measurePath([a, b]).distance;
const hasLineOfSight = (a, b) => !CONFIG.Canvas.polygonBackends.sight.testCollision(a, b, { type: "sight", mode: "any" });
/** The scene's global illumination at this darkness: "bright", "dim" or null (off, or outside its darkness range). */
function globalLight(darkness) {
  const g = canvas.scene?.environment?.globalLight;
  if (!g?.enabled || darkness < (g.darkness?.min ?? 0) || darkness > (g.darkness?.max ?? 1)) return null;
  return g.bright ? "bright" : "dim";
}

/** Light at a point: inside a light's bright radius or bright global illumination, inside any light (dim), inside a darkness source. */
function lightAt(p, darkness) {
  const global = globalLight(darkness);
  const bright = global === "bright" || canvas.effects.testInsideLight(p, { condition: (s) => Math.hypot(s.x - p.x, s.y - p.y) <= s.data.bright });
  return { bright, dim: bright || !!global || canvas.effects.testInsideLight(p), darknessSource: canvas.effects.testInsideDarkness(p) };
}

/** Does `spotter` (a token doc) see `target` (a token doc) standing at `center` (default: where it is)? BG3 sight rules. */
export function sees(spotter, target, center = target.getCenterPoint()) {
  const p = { x: center.x, y: center.y, elevation: target.elevation ?? 0 };
  const darkness = canvas.effects.getDarknessLevel(p);
  const level = obscurity({ dark: darkness >= game.settings.get(MODULE_ID, "obscuredDarkness"), ...lightAt(p, darkness) });
  const stealth = stealthOf(target), from = spotter.getCenterPoint();
  return spotsBg3({
    hidden: !!stealth?.hidden, stealth: stealth?.value ?? 0, level,
    los: hasLineOfSight(from, center),
    passive: spotter.actor?.system?.skills?.prc?.passive ?? 10,
    darkvision: distanceFt(from, center) <= (spotter.actor?.system?.attributes?.senses?.ranges?.darkvision ?? 0) // dnd5e 6: senses.ranges
  });
}

/** moveToken: enemies of each group near the moved player token try to spot it (BG3 sight rules). First spotter starts the encounter. */
export async function onMoveToken(doc, movement, operation, user, deps = {}) {
  const { start = startEncounter } = deps;
  if (!leadGm() || starting || game.combat?.started || !isPc(doc)) return;
  if (doc.parent?.id !== canvas?.scene?.id) return; // measured against the GM's canvas: only its scene
  // The hook fires before the document position changes: measure where the token is going.
  const center = doc.getCenterPoint(movement?.destination ?? {});
  for (const [groupId, members] of encounterGroups(canvas.scene.tokens.contents)) {
    const near = members.filter((e) => isLive(e) && withinRadius(distanceFt(e.getCenterPoint(), center), encounterOf(e).radius));
    if (!near.length) continue;
    const spotter = near.find((e) => sees(e, doc, center));
    if (!spotter) { log(`${doc.name} unseen by group ${groupId}`); continue; }
    const go = start(canvas.scene.id, groupId); // called before the first await: a second move in the same tick sees `starting`
    await ChatMessage.create({ content: L("Encounter.Spotted", { enemy: spotter.name, name: doc.name }) });
    await go;
    return;
  }
}

// ---- Starting combat ----

let starting = false;
/** GM: one combat with the group's live enemies and every player character on the scene; PCs roll on their own clients. */
export async function startEncounter(sceneId, groupId, deps = {}) {
  const { askInit = promptInitiative } = deps;
  if (!leadGm() || starting || game.combats.find((c) => c.scene?.id === sceneId && c.started)) return null;
  starting = true;
  let combat = null;
  try {
    const tokens = game.scenes.get(sceneId)?.tokens?.contents ?? [];
    const enemies = tokens.filter((t) => encounterOf(t)?.id === groupId && isLive(t));
    const pcs = tokens.filter(isPc);
    if (!enemies.length) return null;
    combat = await Combat.create({ scene: sceneId, active: true });
    await combat.createEmbeddedDocuments("Combatant", [...enemies, ...pcs].map((t) => ({ tokenId: t.id, sceneId, actorId: t.actorId })));
    const gmRoll = (c) => combat.rollInitiative([c.id], { messageMode: "publicroll" });
    for (const t of pcs) {
      const c = combat.combatants.find((c) => c.tokenId === t.id);
      if (!c) continue;
      const owner = activeOwner(t);
      const title = L("Prompt.Waiting", { name: t.name, skill: L("Prompt.Initiative") });
      if (owner) {
        try { await awaitOrGm(askInit(owner.id, combat.id, c.id), { title, label: L("Prompt.RollForThem") }, () => gmRoll(c)); }
        catch (err) { log(`initiative prompt for ${t.name} failed, GM rolls`, err); }
      }
      if (c.initiative == null) await gmRoll(c); // the player's client could not roll (other scene, disconnect)
    }
    await combat.rollNPC();
    for (const t of pcs) await revealToken(t);
    await combat.startCombat();
    log(`encounter ${groupId} started: ${[...enemies, ...pcs].map((t) => t.name).join(", ")}`);
    return combat;
  } catch (err) {
    await combat?.delete?.(); // never leave a half-built combat behind
    throw err;
  } finally { starting = false; }
}

// ---- Damage triggers (any client; the GM starts) ----

/** dnd5e.applyDamage: hurting an encounter enemy outside combat starts its group. */
export async function onApplyDamage(actor, amount, options, deps = {}) {
  const { tell = askGmToStart } = deps;
  if (!(amount > 0) || game.combat?.started) return;
  const token = actor?.token ?? actor?.getActiveTokens?.(true, true)?.[0];
  const enc = token ? encounterOf(token) : null;
  if (enc) await tell(token.parent?.id ?? canvas.scene.id, enc.id);
}

/** midi-qol.RollComplete: an encounter enemy that hits, or is hit, starts its group. */
export async function onRollComplete(workflow, deps = {}) {
  const { tell = askGmToStart } = deps;
  if (!workflow || workflow.aborted) return; // a use Midi refused (total cover, no reaction...) gives nothing away
  // Attacking or forcing a save gives the actor away, hit or miss.
  if (["attack", "save"].includes(workflow.activity?.type)) for (const t of workflow.actor?.getActiveTokens?.(false, true) ?? []) await revealToken(t);
  if (game.combat?.started || !(workflow.hitTargets?.size > 0)) return;
  const docs = [workflow.token?.document, ...[...workflow.hitTargets].map((t) => t.document ?? t)].filter(Boolean);
  const hit = docs.find((d) => encounterOf(d));
  if (hit) await tell(hit.parent?.id ?? canvas.scene.id, encounterOf(hit).id);
}

async function revealAll() {
  if (!leadGm()) return;
  for (const t of canvas?.scene?.tokens?.contents ?? []) await revealToken(t);
}

export function registerEncounters() {
  Hooks.on("getSceneControlButtons", safeSync(onSceneControls));
  Hooks.on("renderTokenHUD", safeSync(onRenderTokenHUD));
  Hooks.on("moveToken", safe((doc, movement, operation, user) => onMoveToken(doc, movement, operation, user)));
  Hooks.on("dnd5e.applyDamage", safe((actor, amount, options) => onApplyDamage(actor, amount, options)));
  Hooks.on("midi-qol.RollComplete", safe((workflow) => onRollComplete(workflow)));
  Hooks.on("combatStart", safe(revealAll));
  for (const h of ["canvasReady", "createToken", "updateToken", "deleteToken"]) Hooks.on(h, safe(drawEncounters));
  ui.controls?.render({ reset: true }); // the controls were drawn before this hook existed: add the skull button now
  log("encounters on");
}
