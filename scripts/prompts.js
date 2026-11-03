// Feature 3 prompts: a player's own client rolls (so 3D dice show); the GM can take over with "Roll for them".
import { MODULE_ID } from "./main.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);

let socket = null;

/** Called from main.js on socketlib.ready. `startEncounter` is passed in to avoid a circular import. */
export function registerSockets(s, { startEncounter }) {
  socket = s;
  s.register("promptSkill", ({ tokenUuid, skill }) => rollOrType({ actor: fromUuidSync(tokenUuid)?.actor, skill }));
  s.register("promptInitiative", async (combatantId) => {
    const c = game.combat?.combatants.get(combatantId);
    await c?.actor?.rollInitiative({ createCombatants: false, initiativeOptions: { messageMode: "publicroll" } });
    return c?.initiative ?? null;
  });
  s.register("startEncounter", (sceneId, groupId) => startEncounter(sceneId, groupId));
}

export const promptSkill = (userId, args) => socket.executeAsUser("promptSkill", userId, args);
export const promptInitiative = (userId, combatantId) => socket.executeAsUser("promptInitiative", userId, combatantId);
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

/** Wait for a player's answer while the GM sees a dialog whose single button runs `fallback` instead. */
export async function awaitOrGm(promise, { title, label }, fallback) {
  let dialog;
  const gm = new Promise((resolve) => {
    dialog = new foundry.applications.api.DialogV2({
      window: { title }, content: `<p>${title}</p>`,
      buttons: [{ action: "gm", label, callback: () => resolve(fallback()) }]
    });
  });
  dialog.render({ force: true });
  try { return await Promise.race([promise, gm]); }
  finally { await dialog.close(); }
}
