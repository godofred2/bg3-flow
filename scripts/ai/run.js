// Piece 4: monster autopilot execution. Lead GM only: the group moves together, then acts one monster at a time through Midi.
import { MODULE_ID, log, safe, safeSync } from "../main.js";
import { activeIds } from "../turns.js";
import { snapshot } from "./board.js";
import { planTurn, pickTarget } from "./plan.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const leadGm = () => !!game.users.activeGM?.isSelf;
const whisper = (content) => ChatMessage.create({ content, whisper: [game.user.id] });

/** On unless the combatant flag says false or a player owns the actor. */
export const isAuto = (c) => c.getFlag(MODULE_ID, "autopilot") !== false && !c.actor?.hasPlayerOwner;

/** One use through Midi with the targets fixed: resolves when the workflow is done, `undefined` when Midi refused it. */
export async function useActivity(info, targetUuid) {
  const activity = fromUuidSync(info.uuid);
  if (!activity) throw new Error(`activity ${info.uuid} not found`);
  return MidiQOL.completeActivityUse(activity, { midiOptions: { targetUuids: [targetUuid], ignoreUserTargets: true } });
}

/** GM dialog before a use: "execute", "skip" (also when closed) or "manual". */
export async function pauseDialog({ name, reason }) {
  const r = await foundry.applications.api.DialogV2.wait({
    window: { title: L("Autopilot.Pause.Title", { name }) }, content: `<p>${foundry.utils.escapeHTML(reason)}</p>`,
    buttons: [
      { action: "execute", label: L("Autopilot.Pause.Execute"), default: true },
      { action: "skip", label: L("Autopilot.Pause.Skip") },
      { action: "manual", label: L("Autopilot.Pause.Manual") }
    ],
    rejectClose: false
  });
  return r ?? "skip";
}

let running = false;

/** Play the active group's automatic members: all moves at once, then actions in initiative order. */
export async function runTurn(combat, deps = {}) {
  const { snap = snapshot, plan = planTurn, pick = pickTarget, use = useActivity, pause = pauseDialog } = deps;
  const ids = activeIds(combat);
  const active = combat.turns.filter((c) => ids.has(c.id) && !c.isDefeated);
  const members = active.filter((c) => isAuto(c) && c.token && c.token.parent?.id === canvas.scene?.id);
  if (!members.length) return;
  const mark = { id: combat.id, round: combat.round, turn: combat.turn };
  const stale = () => game.combat?.id !== mark.id || game.combat.round !== mark.round || game.combat.turn !== mark.turn;
  let clean = active.every(isAuto);
  running = true;
  try {
    await Promise.all(members.map((c) => c.token.clearMovementHistory?.())); // piece 2 clears without awaiting: do it ourselves
    const reserved = new Set(), plans = [];
    for (const c of members) {
      const p = plan(await snap(combat, c, reserved));
      if (p.move) reserved.add(`${p.move.x},${p.move.y}`);
      plans.push([c, p]);
    }
    if (stale()) return;
    await Promise.all(plans.map(([c, p]) => p.move && c.token.move({ ...p.move, action: "walk" }, { autoRotate: true, showRuler: false, bg3Autopilot: true })));
    for (const c of members) {
      if (stale()) return;
      try {
        let board = await snap(combat, c, reserved);
        const p = plan(board);
        await whisper(L("Autopilot.Decision", { name: c.token.name, reason: p.reason }));
        for (const a of p.actions) {
          if (stale()) return;
          const activity = board.activities.find((x) => x.id === a.activityId);
          if (!activity) continue;
          let target = board.enemies.find((e) => e.id === a.targetId);
          if (!target || target.hp <= 0 || !target.visible) target = pick(board, activity, board.me)?.enemy; // re-pick: the planned target died or vanished
          if (!target) continue;
          if (game.settings.get(MODULE_ID, "pauseBeforeAttack")) {
            const choice = await pause({ name: c.token.name, reason: `${activity.name} vs ${target.name}` });
            if (choice === "skip") continue;
            if (choice === "manual") { await c.setFlag(MODULE_ID, "autopilot", false); clean = false; break; }
          }
          if ((await use(activity, target.uuid)) === undefined) throw new Error("Midi refused the use");
          board = await snap(combat, c, reserved); // fresh hit points and sight for the next use
        }
      } catch (err) {
        console.error(`[${MODULE_ID}]`, err);
        clean = false;
        await whisper(L("Autopilot.Error", { name: c.token.name, error: err?.message ?? String(err) }));
      }
    }
    if (clean && !stale() && game.settings.get(MODULE_ID, "autoNextTurn")) await combat.nextTurn();
  } finally { running = false; }
}

/** combatTurnChange: the lead GM plays the new turn's automatic members. */
export async function onCombatTurnChange(combat, deps) {
  if (!leadGm() || !combat?.started || running) return;
  await runTurn(combat, deps);
}

/** renderCombatTracker: a robot button per NPC row that switches its autopilot. */
export function onRenderCombatTracker(app, html) {
  const root = typeof html?.querySelectorAll === "function" ? html : html?.[0] ?? html; // HTMLElement in v13+, jQuery before
  const combat = app?.viewed ?? game.combat;
  for (const li of root?.querySelectorAll?.("li.combatant[data-combatant-id]") ?? []) {
    const c = combat?.combatants?.get?.(li.dataset.combatantId);
    if (!c || c.actor?.hasPlayerOwner) continue;
    const btn = document.createElement("button");
    btn.setAttribute("type", "button");
    btn.classList.add("inline-control", "combatant-control", "icon", "fa-solid", "fa-robot");
    btn.classList.toggle("active", isAuto(c));
    btn.dataset.tooltip = L("Autopilot.Toggle");
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (c.getFlag(MODULE_ID, "autopilot") === false) await c.unsetFlag(MODULE_ID, "autopilot");
      else await c.setFlag(MODULE_ID, "autopilot", false);
    });
    (li.querySelector(".combatant-controls") ?? li).append(btn);
  }
}

export function registerAutopilot() {
  Hooks.on("combatTurnChange", safe((combat) => onCombatTurnChange(combat)));
  Hooks.on("renderCombatTracker", safeSync(onRenderCombatTracker));
  ui.combat?.render();
  log("autopilot on");
}
