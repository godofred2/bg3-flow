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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** move() resolves when the server applied the move; the sprite (and a Gambit reaction hold) may still be on its way. */
export async function arrive(doc, { poll = 100, cap = 45000 } = {}) {
  const obj = doc.object;
  const t0 = Date.now();
  while (obj && (Math.abs(obj.x - doc.x) > 1 || Math.abs(obj.y - doc.y) > 1) && Date.now() - t0 < cap) await sleep(poll);
}

/** Play the active group's automatic members: all moves at once, then actions in initiative order. */
export async function runTurn(combat, deps = {}) {
  const { snap = snapshot, plan = planTurn, pick = pickTarget, use = useActivity, pause = pauseDialog, poll = 100 } = deps;
  const ids = game.settings.get(MODULE_ID, "enableTurns") === false ? new Set([combat.combatant?.id]) : activeIds(combat); // groups only exist with piece 2
  const active = combat.turns.filter((c) => ids.has(c.id) && !c.isDefeated);
  const members = active.filter((c) => isAuto(c) && c.token && c.token.parent?.id === canvas.scene?.id);
  if (!members.length) return;
  const mark = { id: combat.id, round: combat.round, turn: combat.turn };
  const stale = () => game.combat?.id !== mark.id || game.combat.round !== mark.round || game.combat.turn !== mark.turn;
  let clean = active.every(isAuto), pass = false;
  const failed = async (c, err) => { console.error(`[${MODULE_ID}]`, err); clean = false; await whisper(L("Autopilot.Error", { name: c.token.name, error: err?.message ?? String(err) })); };
  running = true;
  try {
    await Promise.all(members.map((c) => c.token.clearMovementHistory?.())); // piece 2 clears without awaiting: do it ourselves
    const reserved = new Set(), plans = [];
    for (const c of members) {
      try {
        const p = plan(await snap(combat, c, reserved));
        if (p.move) reserved.add(`${p.move.x},${p.move.y}`);
        plans.push([c, p]);
      } catch (err) { await failed(c, err); }
    }
    if (stale()) return;
    const walk = (m) => (m.waypoints ?? [m]).map((w) => ({ x: w.x, y: w.y, elevation: w.elevation, action: "walk" }));
    await Promise.all(plans.map(([c, p]) => p.move && c.token.move(walk(p.move), { autoRotate: true, showRuler: false, bg3Autopilot: true })));
    await Promise.all(plans.map(([c, p]) => p.move && arrive(c.token, { poll })));
    for (const [c] of plans) {
      if (stale()) return;
      try {
        let board = await snap(combat, c, reserved);
        const p = plan({ ...board, me: { ...board.me, budget: 0 } }); // act from where it stands: a move that fell short never fires out of reach
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
            if (stale()) return; // the GM moved on while the dialog was open
          }
          if ((await use(activity, target.uuid)) === undefined) throw new Error("Midi refused the use");
          board = await snap(combat, c, reserved); // fresh hit points and sight for the next use
        }
      } catch (err) { await failed(c, err); }
    }
    pass = clean && !stale() && game.settings.get(MODULE_ID, "autoNextTurn");
  } finally { running = false; }
  if (pass) await combat.nextTurn(); // after `running` clears: the turn-change hook fires inside the update and must be able to play the next monsters
}

/** combatTurnChange: the lead GM plays the new turn's automatic members. Only on a step forward: "previous turn" never replays a group. */
export async function onCombatTurnChange(combat, prior, current, deps) {
  if (!leadGm() || !combat?.started || running) return;
  const r0 = prior?.round ?? 0, r1 = current?.round ?? 0, t0 = prior?.turn ?? -1, t1 = current?.turn ?? 0;
  if (r1 < r0 || (r1 === r0 && t1 <= t0)) return;
  await runTurn(combat, deps);
}

/** renderCombatTracker: a robot button per NPC row that switches its autopilot. */
export function onRenderCombatTracker(app, html) {
  if (!game.user.isGM) return; // players cannot update combatants
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
  Hooks.on("combatTurnChange", safe((combat, prior, current) => onCombatTurnChange(combat, prior, current)));
  Hooks.on("renderCombatTracker", safeSync(onRenderCombatTracker));
  ui.combat?.render();
  log("autopilot on");
}
