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

/** One use through Midi with the targets fixed (every covered creature for an area, no template placed): resolves when the workflow is done, `undefined` when Midi refused it. */
export async function useActivity(info, targetUuids) {
  const activity = fromUuidSync(info.uuid);
  if (!activity) throw new Error(`activity ${info.uuid} not found`);
  return MidiQOL.completeActivityUse(activity, { create: { measuredTemplate: false }, midiOptions: { targetUuids, ignoreUserTargets: true } });
}

const rechargeable = (uses) => (uses?.recovery ?? []).some((r) => r.period === "recharge") && uses.spent > 0;
/** Roll recharge (5-6) for the monster's spent recharge abilities, unless dnd5e's own NPC auto recharge already does it at turn start. */
export async function rollRecharge(combatant) {
  if (game.settings.get("dnd5e", "autoRecharge") !== "no") return;
  for (const item of combatant.actor?.items ?? []) {
    if (rechargeable(item.system?.uses)) await item.system.uses.rollRecharge();
    for (const a of item.system?.activities ?? []) if (rechargeable(a.uses)) await a.uses.rollRecharge();
  }
}

/** While `movers` walk: a reaction hit by someone with Sentinel stops the hit monster where it is. Returns the unregister function. */
export function sentinelWatch(movers) {
  const ids = new Map(movers.map((c) => [c.token.id, c]));
  const fn = (workflow) => {
    if (![...(workflow?.actor?.items ?? [])].some((i) => String(i.name).trim().toLowerCase() === "sentinel")) return;
    for (const t of workflow.hitTargets ?? []) ids.get(t.document?.id ?? t.id)?.token.stopMovement?.();
  };
  const id = Hooks.on("midi-qol.RollComplete", fn);
  return () => Hooks.off("midi-qol.RollComplete", id);
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

/** move() resolves when the server applied the move; the sprite may still be animating (Token#x is the document's x, so watch the animation promise). */
export async function arrive(doc, { poll = 100, cap = 45000 } = {}) {
  const obj = doc.object;
  const t0 = Date.now();
  await sleep(poll); // let the animation start
  while (obj?.movementAnimationPromise && Date.now() - t0 < cap) await Promise.race([obj.movementAnimationPromise, sleep(poll)]);
}

const brief = (b) => `${b.me.name} hp ${b.me.hp} budget ${b.me.budget}; activities: ${b.activities.map((a) => `${a.name}[${a.kind}${a.slot === "bonus" ? " bonus" : ""} r${a.range} +${a.bonus ?? 0} ${a.kind === "heal" ? `heal${(a.healing ?? 0).toFixed(1)}` : `dmg${(a.damage ?? 0).toFixed(1)}`}${a.area ? ` ${a.area.shape}${a.area.size}` : ""}${a.ranged ? " ranged" : ""}${a.recharge ? " recharge" : ""}]`).join(" ") || "none"}; enemies: ${b.enemies.map((e) => `${e.name}[d${e.distance} ac${e.ac} hp${e.hp}${e.visible ? "" : " unseen"} path${(b.paths[e.id] ?? []).length}]`).join(" ") || "none"}; allies: ${(b.allies ?? []).filter((a) => a.id !== b.me.id).map((a) => `${a.name}[hp${a.hp}/${a.maxHp}]`).join(" ") || "none"}; retreats ${(b.retreats ?? []).length}`;

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
    for (const c of members) { try { await rollRecharge(c); } catch (err) { await failed(c, err); } }
    await Promise.all(members.map((c) => c.token.clearMovementHistory?.())); // piece 2 clears without awaiting: do it ourselves
    const reserved = new Set(), plans = [];
    for (const c of members) {
      try {
        const board = await snap(combat, c, reserved);
        log(brief(board)); // what the planner saw: the first thing to read when a monster does something odd
        if (board.me.hp <= 0) continue; // down before its turn: nothing to play
        const p = plan(board);
        if (p.move) reserved.add(`${p.move.x},${p.move.y}`);
        plans.push([c, p]);
      } catch (err) { await failed(c, err); }
    }
    if (stale()) return;
    const walk = (m) => (m.waypoints ?? [m]).map((w) => ({ x: w.x, y: w.y, elevation: w.elevation, action: "walk" }));
    const movers = plans.filter(([, p]) => p.move).map(([c]) => c);
    const unwatch = sentinelWatch(movers);
    try {
      await Promise.all(plans.map(([c, p]) => p.move && c.token.move(walk(p.move), { autoRotate: true, showRuler: false, bg3Autopilot: true })));
      await Promise.all(plans.map(([c, p]) => p.move && arrive(c.token, { poll })));
    } finally { unwatch(); }
    // Run one plan's uses from where the monster stands. Returns false when the GM took the monster over.
    const act = async (c, board, p) => {
      await whisper(L("Autopilot.Decision", { name: c.token.name, reason: p.reason }));
      for (const a of p.actions) {
        if (stale()) return null;
        const activity = board.activities.find((x) => x.id === a.activityId);
        if (!activity) continue;
        const live = (t) => t && t.hp > 0 && (activity.kind === "heal" || t.visible);
        const pool = activity.kind === "heal" ? board.allies ?? [] : board.enemies;
        let targets = (a.targetIds ?? []).map((id) => pool.find((t) => t.id === id)).filter(live);
        if (!targets.length) { const t = pick(board, activity, board.me)?.enemy; targets = t ? [t] : []; } // re-pick: the planned target died or vanished
        if (!targets.length) continue;
        if (game.settings.get(MODULE_ID, "pauseBeforeAttack")) {
          const choice = await pause({ name: c.token.name, reason: `${activity.name} vs ${targets.map((t) => t.name).join(", ")}` });
          if (choice === "skip") continue;
          if (choice === "manual") { await c.setFlag(MODULE_ID, "autopilot", false); return false; }
          if (stale()) return null; // the GM moved on while the dialog was open
        }
        if ((await use(activity, targets.map((t) => t.uuid))) === undefined) throw new Error("Midi refused the use");
        board = await snap(combat, c, reserved); // fresh hit points and sight for the next use
      }
      return true;
    };
    for (const [c] of plans) {
      if (stale()) return;
      try {
        const board = await snap(combat, c, reserved);
        if (board.me.hp <= 0) continue; // dropped on the way (an opportunity attack): no action
        const still = { ...board, me: { ...board.me, budget: 0 } }; // act from where it stands: a move that fell short never fires out of reach
        const done = await act(c, still, plan(still));
        if (done === null) return;
        if (done === false) { clean = false; continue; }
        const after = await snap(combat, c, reserved);
        if (after.me.hp <= 0) continue;
        const bonusBoard = { ...after, me: { ...after.me, budget: 0 } };
        const bonus = plan(bonusBoard, { slot: "bonus" });
        if (bonus.actions.length) { const r = await act(c, bonusBoard, bonus); if (r === null) return; if (r === false) clean = false; }
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
