// Feature 3: encounters and stealth. Marked enemy groups watch for player tokens; a spot or a hit starts combat.
import { MODULE_ID, log, safe, safeSync } from "./main.js";
import { encounterGroups, isObscured, passiveSpots, activeSpots, withinRadius } from "./rules.js";
import { rollOrType, promptSkill, promptInitiative, askGmToStart, activeOwner, awaitOrGm } from "./prompts.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const encounterOf = (doc) => doc.getFlag(MODULE_ID, "encounter");
const stealthOf = (doc) => doc.getFlag(MODULE_ID, "stealth");

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

/** Token HUD Hide: roll or type Stealth, store it, show dnd5e's hiding status. Pressing it while hidden reveals. */
export async function hideToken(doc, roll = rollOrType) {
  if (stealthOf(doc)?.hidden) return revealToken(doc);
  const value = await roll({ actor: doc.actor, skill: "ste" });
  if (value === null || value === undefined) return;
  await doc.setFlag(MODULE_ID, "stealth", { value, hidden: true, checked: [] });
  await doc.actor?.toggleStatusEffect("hiding", { active: true });
}

export async function revealToken(doc) {
  if (!stealthOf(doc)) return;
  await doc.unsetFlag(MODULE_ID, "stealth");
  await doc.actor?.toggleStatusEffect("hiding", { active: false });
}

/** dnd5e.postUseActivity: attacking or forcing a save gives the actor away. */
export async function onPostUseActivityReveal(activity) {
  if (!["attack", "save"].includes(activity?.type)) return;
  for (const t of activity.actor?.getActiveTokens?.(false, true) ?? []) await revealToken(t);
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
const distanceFt = (a, b) => canvas.grid.measurePath([a, b]).distance;
const hasLineOfSight = (a, b) => !CONFIG.Canvas.polygonBackends.sight.testCollision(a, b, { type: "sight", mode: "any" });
const rollPerception = async (enemy) => (await enemy.actor.rollSkill({ skill: "prc" }, { configure: false }, { rollMode: "publicroll" }))?.[0]?.total ?? 0;

/** The token's stored Stealth value, else ask its owner (GM can take over), else the GM rolls. null when nobody answered. */
async function stealthFor(doc, { ask, roll }) {
  const existing = stealthOf(doc);
  if (typeof existing?.value === "number") return existing.value;
  const owner = activeOwner(doc);
  const title = L("Prompt.Waiting", { name: doc.name, skill: CONFIG.DND5E?.skills?.ste?.label ?? "Stealth" });
  const value = owner
    ? await awaitOrGm(ask(owner.id, { tokenUuid: doc.uuid, skill: "ste" }), { title, label: L("Prompt.RollForThem") }, () => roll({ actor: doc.actor, skill: "ste" }))
    : await roll({ actor: doc.actor, skill: "ste" });
  if (typeof value !== "number") return null;
  await doc.setFlag(MODULE_ID, "stealth", { value, hidden: false, checked: [] });
  return value;
}

const busy = new Set();
/** moveToken: enemies of each group near the moved player token try to spot it. First spotter starts the encounter. */
export async function onMoveToken(doc, movement, operation, user, deps = {}) {
  const { start = startEncounter, ask = promptSkill, roll = rollOrType } = deps;
  if (!game.user.isGM || game.combat?.started || !doc.actor?.hasPlayerOwner || busy.has(doc.id)) return;
  busy.add(doc.id);
  try {
    const center = doc.getCenterPoint();
    const obscured = isObscured({
      hidden: !!stealthOf(doc)?.hidden, darkness: canvas.effects.getDarknessLevel(center),
      threshold: game.settings.get(MODULE_ID, "obscuredDarkness")
    });
    for (const [groupId, members] of encounterGroups(canvas.scene.tokens.contents)) {
      const near = members.filter((e) => isLive(e) && withinRadius(distanceFt(e.getCenterPoint(), center), encounterOf(e).radius));
      if (!near.length) continue;
      let stealth = stealthOf(doc)?.value ?? null;
      let spotter = null;
      if (obscured && !stealthOf(doc)?.checked?.includes(groupId)) {
        stealth = await stealthFor(doc, { ask, roll });
        const cur = stealthOf(doc);
        if (cur) await doc.setFlag(MODULE_ID, "stealth", { ...cur, checked: [...(cur.checked ?? []), groupId] });
        if (stealth !== null) spotter = near.find((e) => passiveSpots({ obscured, passive: e.actor?.system?.skills?.prc?.passive ?? 10, stealth }));
      }
      for (const e of near) {
        if (spotter) break;
        if (!hasLineOfSight(e.getCenterPoint(), center)) continue;
        // ponytail: nobody answered the Stealth prompt → the player is simply seen
        if (!obscured || stealth === null) { spotter = e; break; }
        if (activeSpots({ obscured, los: true, perception: await rollPerception(e), stealth })) spotter = e;
      }
      if (!spotter) { log(`${doc.name} unseen by group ${groupId}`); continue; }
      await ChatMessage.create({ content: L("Encounter.Spotted", { enemy: spotter.name, name: doc.name }) });
      await start(canvas.scene.id, groupId);
      return;
    }
  } finally { busy.delete(doc.id); }
}

export async function startEncounter() { return null; }
