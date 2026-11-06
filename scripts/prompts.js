// Feature 3 prompts: a player's own client rolls (so 3D dice show); the GM can take over with "Roll for them".
import { MODULE_ID } from "./main.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);

let socket = null;

/** Called from main.js on socketlib.ready. `startEncounter` is passed in to avoid a circular import. */
export function registerSockets(s, { startEncounter }) {
  socket = s;
  s.register("promptInitiative", async (combatId, combatantId) => {
    // By id, not game.combat: the player may be viewing another scene or combat.
    const combat = game.combats.get(combatId), c = combat?.combatants.get(combatantId);
    if (!c) return null;
    await combat.rollInitiative([combatantId], { messageMode: "publicroll", messageOptions: { rollMode: "publicroll" } });
    return c.initiative ?? null;
  });
  s.register("startEncounter", (sceneId, groupId) => startEncounter(sceneId, groupId));
  // Piece 4c: the Tunnel Fighter stance's reaction at the triggers Gambit does not cover, on the PC owner's client (3D dice show there). 30 s, then Pass.
  s.register("tunnelFighter", async (actorUuid, activityUuid, targetUuid) => {
    const activity = fromUuidSync(activityUuid);
    if (!activity) return { hit: false };
    const title = L("Autopilot.TunnelFighter.Title", { name: activity.actor?.name ?? fromUuidSync(actorUuid)?.name ?? "", target: fromUuidSync(targetUuid)?.name ?? "" });
    let timer;
    const r = await foundry.applications.api.DialogV2.wait({
      window: { title }, content: `<p>${foundry.utils.escapeHTML(title)}</p>`,
      buttons: [
        { action: "attack", label: L("Autopilot.TunnelFighter.Attack"), default: true, callback: () => "attack" },
        { action: "pass", label: L("Autopilot.TunnelFighter.Pass"), callback: () => "pass" }
      ],
      rejectClose: false,
      render: (ev, dialog) => { timer = setTimeout(() => dialog.close(), 30000); }
    });
    clearTimeout(timer);
    return r === "attack" ? tunnelFighterAttack(activityUuid, targetUuid) : { hit: false };
  });
}

/** One melee attack of the PC on the monster through Midi, with no reaction check (the stance needs none). `{ hit }` from the workflow. */
export async function tunnelFighterAttack(activityUuid, targetUuid) {
  const activity = fromUuidSync(activityUuid);
  if (!activity) return { hit: false };
  const wf = await MidiQOL.completeActivityUse(activity, { midiOptions: { targetUuids: [targetUuid], ignoreUserTargets: true, proceedChecks: { checkAoO: false } } }, { configure: false });
  return { hit: (wf?.hitTargets?.size ?? 0) > 0 };
}
export const promptTunnelFighter = (userId, actorUuid, activityUuid, targetUuid) => socket.executeAsUser("tunnelFighter", userId, actorUuid, activityUuid, targetUuid);

export const promptInitiative = (userId, combatId, combatantId) => socket.executeAsUser("promptInitiative", userId, combatId, combatantId);
export const askGmToStart = (sceneId, groupId) => socket.executeAsGM("startEncounter", sceneId, groupId);

/** First connected non-GM owner of a document, or null. */
export const activeOwner = (doc) => game.users.find((u) => u.active && !u.isGM && doc.testUserPermission(u, "OWNER")) ?? null;

/** Local dialog: roll the skill publicly, or type a value. null when closed or left empty. */
export async function rollOrType({ actor, skill }) {
  if (!actor) return null;
  const label = CONFIG.DND5E?.skills?.[skill]?.label ?? skill;
  const r = await foundry.applications.api.DialogV2.wait({
    window: { title: `${L("Hide.Title")}: ${label}` },
    content: `<p>${L("Hide.Value")}</p><input type="number" name="value" autofocus>`,
    buttons: [
      { action: "roll", label: L("Hide.Roll"), default: true,
        callback: async () => (await actor.rollSkill({ skill }, { configure: false }, { rollMode: "publicroll" }))?.[0]?.total ?? null },
      { action: "use", label: L("Hide.Use"),
        callback: (ev, button) => { const raw = button.form.elements.value.value; return raw === "" ? null : Number(raw); } }
    ],
    rejectClose: false
  });
  return typeof r === "number" && Number.isFinite(r) ? r : null;
}

/** Wait for a player's answer while the GM sees a dialog whose single button runs `fallback` instead. Dismissing it (X) also falls back. */
export async function awaitOrGm(promise, { title, label }, fallback) {
  let dialog, done = false, taken = false;
  const gm = new Promise((resolve) => {
    const take = () => { if (done) return; done = taken = true; resolve(fallback()); }; // button and close both land here: once
    dialog = new foundry.applications.api.DialogV2({
      window: { title }, content: `<p>${title}</p>`,
      buttons: [{ action: "gm", label, callback: take }]
    });
    dialog.addEventListener("close", take);
  });
  dialog.render({ force: true });
  // Once the GM took over, the player's prompt is closed and resolves null: that answer is not the one we want.
  try { return await Promise.race([promise.then((v) => (taken ? gm : v)), gm]); }
  finally { done = true; await dialog.close(); }
}
