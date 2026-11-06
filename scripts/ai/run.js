// Piece 4: monster autopilot execution. Lead GM only: the group moves together, then acts one monster at a time through Midi.
import { MODULE_ID, log, safe, safeSync } from "../main.js";
import { activeIds, lairTurn } from "../turns.js";
import { snapshot, lairOf } from "./board.js";
import { planTurn, pickTarget, splitAtTunnelFighter } from "./plan.js";
import { promptTunnelFighter, tunnelFighterAttack, activeOwner, awaitOrGm } from "../prompts.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const leadGm = () => !!game.users.activeGM?.isSelf;
const whisper = (content) => ChatMessage.create({ content, whisper: [game.user.id] });

/** On when the combatant flag says true; off when it says false, when a player owns the actor or, by default, when the monster has
 *  legendary actions (the DM plays those by hand: user decision; the robot button overrides). */
export const isAuto = (c) => {
  if (c.actor?.hasPlayerOwner) return false; // a player's creature is never the module's, whatever the flag says
  const flag = c.getFlag(MODULE_ID, "autopilot");
  if (flag === true || flag === false) return flag;
  return !((c.actor?.system?.resources?.legact?.max ?? 0) > 0);
};

/**
 * Place an area's template where the planner aimed it (a cone or line from the caster toward the aim, anything else centred on
 * the aim). The data is built here the way dnd5e's own placement builds it: dnd5e 6's TemplatePlacement.fromActivity is an
 * interactive preview and must not be called. Returns the document Midi should use (a Region in Foundry 14), or null.
 */
async function placeArea(activity, info, { origin, aim }) {
  const kind = CONFIG.DND5E?.areaTargetTypes?.[info.area.shape]?.template;
  if (!kind) return null;
  const tpl = activity.target?.template ?? {};
  const fromCaster = ["cone", "line"].includes(info.area.shape);
  const size = info.area.size, half = size / canvas.dimensions.distance * canvas.dimensions.size / 2;
  const dx = aim.cx - origin.cx, dy = aim.cy - origin.cy, len = Math.hypot(dx, dy) || 1;
  const edge = (origin.w ?? 1) * canvas.dimensions.size / 2; // the cone starts at the edge of the caster's space, as the planner measured it
  const data = {
    t: kind === "emanation" ? "circle" : kind, user: game.user.id, distance: size,
    direction: fromCaster ? Math.atan2(dy, dx) * 180 / Math.PI : 0,
    x: fromCaster ? origin.cx + dx / len * edge : aim.cx, y: fromCaster ? origin.cy + dy / len * edge : aim.cy, fillColor: game.user.color,
    flags: {
      dnd5e: { dimensions: { size, width: tpl.width, height: tpl.height }, item: activity.item?.uuid, origin: activity.uuid, spellLevel: activity.item?.system?.level },
      "midi-qol": { actorUuid: activity.actor?.uuid, itemUuid: activity.item?.uuid }
    }
  };
  if (data.t === "cone") data.angle = CONFIG.MeasuredTemplate?.defaults?.angle ?? 53.13;
  if (data.t === "rect") { // dnd5e draws cubes from a corner: along the diagonal when grid-aligned, else as a ray as wide as it is long
    data.width = size;
    if (game.settings.get("dnd5e", "gridAlignedSquareTemplates")) { data.distance = Math.hypot(size, size); data.direction = 45; data.x = aim.cx - half; data.y = aim.cy - half; }
    else { data.t = "ray"; data.direction = 0; data.x = aim.cx - half; data.y = aim.cy; }
  } else if (data.t === "ray") data.width = info.area.width || canvas.dimensions.distance;
  const [td] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  return { proxy: td, doc: canvas.scene.regions?.get?.(td._id ?? td.id) ?? td }; // Foundry 14 backs the template with a Region
}

const removeTemplate = async (uuid) => { const live = fromUuidSync(uuid); if (live?.delete) await live.delete(); };

/** A reaction may leave a token between squares: put it on the square under its centre. */
async function snapToGrid(doc) {
  const g = canvas.grid;
  if (!g?.getOffset || typeof doc.x !== "number" || !doc.update) return;
  const half = (g.size ?? canvas.dimensions?.size ?? 0) / 2;
  const tl = g.getTopLeftPoint(g.getOffset({ x: doc.x + half, y: doc.y + half }));
  if (Math.abs(tl.x - doc.x) > 1 || Math.abs(tl.y - doc.y) > 1) await doc.update({ x: tl.x, y: tl.y });
}

/**
 * One use through Midi with the targets fixed, no configuration dialog and no dnd5e template placement. An area gets its
 * template from `placeArea` and Midi targets from it; an instantaneous area's template is removed afterwards.
 * Resolves when the workflow is done, `undefined` when Midi refused it.
 */
export async function useActivity(info, targetUuids, place = null, { timeout = 60000 } = {}) {
  const activity = fromUuidSync(info.uuid);
  if (!activity) throw new Error(`activity ${info.uuid} not found`);
  const template = info.area && place ? await placeArea(activity, info, place) : null;
  const midiOptions = { targetUuids, ignoreUserTargets: true, proceedChecks: { checkAoO: false } }; // never a reaction in Midi's eyes: a lair action comes off-turn
  let timer, hook;
  if (template) {
    midiOptions.workflowOptions = { templateUuid: template.doc.uuid };
    // Midi runs the use on a clone of the item's activity and reads `templates` on it (what dnd5e's own "Place Measured
    // Template" produces): dnd5e announces that clone through dnd5e.preUseActivity, so the template is attached there.
    hook = Hooks.on("dnd5e.preUseActivity", (used) => { if (used?.uuid === activity.uuid) used.templates = [template.proxy]; });
  }
  try {
    return await Promise.race([
      MidiQOL.completeActivityUse(activity, { create: { measuredTemplate: false }, midiOptions }, { configure: false }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Midi did not finish the use in ${timeout / 1000} s`)), timeout); })
    ]);
  } finally {
    clearTimeout(timer);
    if (hook) Hooks.off("dnd5e.preUseActivity", hook);
    if (template && activity.duration?.units === "inst") await removeTemplate(template.doc.uuid);
  }
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

/**
 * While `movers` walk: a reaction hit by someone with Sentinel stops the hit monster where it is. Two routes, because Midi's
 * hooks are client-local: the workflow when the GM rolled it, and a drop in the monster's hit points (documents replicate to
 * every client) when it set off next to a Sentinel wielder. Returns the unregister function.
 */
export function sentinelWatch(movers, boards = {}) {
  const ids = new Map(movers.map((c) => [c.token.id, c]));
  const onRoll = (workflow) => {
    if (![...(workflow?.actor?.items ?? [])].some((i) => String(i.name).trim().toLowerCase() === "sentinel")) return;
    for (const t of workflow.hitTargets ?? []) ids.get(t.document?.id ?? t.id)?.token.stopMovement?.();
  };
  const threatened = movers.filter((c) => (boards[c.id]?.enemies ?? []).some((e) => e.visible && e.distance <= 5 && e.sentinel)).map((c) => ({ c, hp: boards[c.id].me.hp, temp: boards[c.id].me.temp ?? c.actor?.system?.attributes?.hp?.temp ?? 0 }));
  const onUpdate = (actor, changes) => {
    const m = threatened.find((t) => t.c.actor === actor || (actor?.uuid && t.c.actor?.uuid === actor.uuid));
    if (!m) return;
    const { value: hp, temp } = changes?.system?.attributes?.hp ?? {};
    if ((typeof hp === "number" && hp < m.hp) || (typeof temp === "number" && temp < m.temp)) m.c.token.stopMovement?.(); // a hit: real or temporary hit points went down
    if (typeof hp === "number") m.hp = hp;
    if (typeof temp === "number") m.temp = temp;
  };
  const a = Hooks.on("midi-qol.RollComplete", onRoll), b = Hooks.on("updateActor", onUpdate);
  return () => { Hooks.off("midi-qol.RollComplete", a); Hooks.off("updateActor", b); };
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

let running = false, pending = null; // a turn change that arrives while a run is busy (a Midi dialog pending) waits for it
const replay = async () => { const p = pending; pending = null; if (!p) return false; await onCombatTurnChange(...p); return true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** move() resolves when the server applied the move; the sprite may still be animating (Token#x is the document's x, so watch the animation promise). */
export async function arrive(doc, { poll = 100, cap = 45000 } = {}) {
  const obj = doc.object;
  const t0 = Date.now();
  await sleep(poll); // let the animation start
  while (obj?.movementAnimationPromise && Date.now() - t0 < cap) await Promise.race([obj.movementAnimationPromise, sleep(poll)]);
}

const oaBrief = (e) => e.oa ? `oa{r${e.oa.reach} dmg${e.oa.damage.toFixed(1)} hit${e.oa.hit.toFixed(2)}${e.oa.reaction ? " reaction" : ""}${e.oa.tunnelFighter ? " tf" : ""}}` : "oa-";
const brief = (b) => `${b.me.name} hp ${b.me.hp}/${b.me.maxHp} budget ${b.me.budget} speed ${b.me.speed ?? "?"}${b.me.alone ? " alone" : ""}${b.me.lair ? " lair" : ""}${b.me.lairLast ? " lair-last" : ""}; escape ${b.escape ? `${b.escape.name} (${b.escape.squares.length} squares)` : "none"}, away ${(b.away ?? []).length}; activities: ${b.activities.map((a) => `${a.name}[${a.kind}${a.slot === "bonus" ? " bonus" : a.slot === "lair" ? " lair" : ""} r${a.range} +${a.bonus ?? 0} ${a.kind === "heal" ? `heal${(a.healing ?? 0).toFixed(1)}` : `dmg${(a.damage ?? 0).toFixed(1)}`}${a.area ? ` ${a.area.shape}${a.area.size}` : ""}${a.ranged ? " ranged" : ""}${a.recharge ? " recharge" : ""}]`).join(" ") || "none"}; enemies: ${b.enemies.map((e) => `${e.name}[d${e.distance} ac${e.ac} hp${e.hp}${e.visible ? "" : " unseen"} path${(b.paths[e.id] ?? []).length} ${oaBrief(e)}${e.sentinel ? " sentinel" : ""}${e.threat != null ? ` threat${e.threat.toFixed(1)}` : ""}]`).join(" ") || "none"}; allies: ${(b.allies ?? []).filter((a) => a.id !== b.me.id).map((a) => `${a.name}[hp${a.hp}/${a.maxHp}]`).join(" ") || "none"}; retreats ${(b.retreats ?? []).length}`;

const sig = (p) => JSON.stringify(p.actions.map((a) => [a.activityId, a.targetIds ?? []]));
/** "Act from here": run one plan's uses from where the monster stands. Returns true, false (the GM took the monster over) or null (stale). */
const actWith = ({ combat, reserved, stale, snap, pick, use, pause }) => async (c, board, p, said) => {
    if (!said || sig(p) !== sig(said)) await whisper(L("Autopilot.Decision", { name: c.token.name, reason: p.reason })); // only a changed mind is said twice
    for (const a of p.actions) {
      if (stale()) return null;
      const activity = board.activities.find((x) => x.id === a.activityId);
      if (!activity) continue;
      const allies = board.allies ?? [];
      const live = (t) => t && (allies.includes(t) ? activity.kind !== "heal" || t.hp < t.maxHp : t.hp > 0 && t.visible);
      const pool = activity.kind === "heal" ? allies : activity.area ? [...board.enemies, ...allies] : board.enemies; // an area hits covered allies too
      let targets = (a.targetIds ?? []).map((id) => pool.find((t) => t.id === id)).filter(live);
      if (!targets.length) { const t = pick(board, activity, board.me)?.enemy; targets = t ? [t] : []; } // re-pick: the planned target died or vanished
      if (!targets.length) continue;
      if (game.settings.get(MODULE_ID, "pauseBeforeAttack")) {
        const choice = await pause({ name: c.token.name, reason: `${activity.name} vs ${targets.map((t) => t.name).join(", ")}` });
        if (choice === "skip") continue;
        if (choice === "manual") { await c.setFlag(MODULE_ID, "autopilot", false); return false; }
        if (stale()) return null; // the GM moved on while the dialog was open
      }
      const aim = pool.find((t) => t.id === a.aimId) ?? targets[0];
      const place = activity.area ? { origin: { cx: board.me.cx, cy: board.me.cy, w: board.me.w }, aim: { cx: aim.cx, cy: aim.cy } } : null;
      if ((await use(activity, targets.map((t) => t.uuid), place)) === undefined) throw new Error("Midi refused the use");
      board = await snap(combat, c, reserved); // fresh hit points and sight for the next use
    }
    return true;
};

/** Play the active group's automatic members: all moves at once, then actions in initiative order. */
export async function runTurn(combat, deps = {}) {
  const { snap = snapshot, plan = planTurn, pick = pickTarget, use = useActivity, pause = pauseDialog, poll = 100,
    split = splitAtTunnelFighter, ask = promptTunnelFighter, gmAttack = tunnelFighterAttack, owner = activeOwner, wait = awaitOrGm } = deps;
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
    // Piece 2 clears the movement history and the Dash flag on the same hook without awaiting: do both ourselves before reading the board.
    await Promise.all(members.map(async (c) => { await c.token.clearMovementHistory?.(); if (c.getFlag(MODULE_ID, "dash")) await c.unsetFlag(MODULE_ID, "dash"); }));
    const queues = new Map(); // one Tunnel Fighter prompt at a time per PC: two monsters passing the same Fighter ask one after the other
    const serial = (id, fn) => { const next = (queues.get(id) ?? Promise.resolve()).then(fn, fn); queues.set(id, next.catch(() => {})); return next; };
    const reserved = new Set(), plans = [], boards = {};
    for (const c of members) {
      try {
        const board = await snap(combat, c, reserved);
        boards[c.id] = board;
        log(brief(board)); // what the planner saw: the first thing to read when a monster does something odd
        if (board.me.hp <= 0) continue; // down before its turn: nothing to play
        const p = plan(board);
        if (p.move) reserved.add(`${p.move.x},${p.move.y}`);
        await whisper(L("Autopilot.Decision", { name: c.token.name, reason: p.reason })); // the decision (toll and alternatives included) is said before it runs
        plans.push([c, p]);
      } catch (err) { await failed(c, err); }
    }
    if (stale()) return;
    const walk = (m) => (m.waypoints ?? [m]).map((w) => ({ x: w.x, y: w.y, elevation: w.elevation, action: "walk" }));
    // One monster's move: Dash flag for a flight, then the route segment by segment, stopping after each Tunnel Fighter trigger for the PC's reaction.
    const moveOne = async (c, p) => {
      if (p.dash) await c.setFlag(MODULE_ID, "dash", true);
      const board = boards[c.id];
      const tol = (canvas.dimensions?.size ?? canvas.grid?.size ?? 100) / 2;
      for (const seg of split(board, p.move)) {
        await c.token.move(walk(seg), { autoRotate: true, showRuler: false, bg3Autopilot: true });
        await arrive(c.token, { poll });
        const end = seg.waypoints.at(-1);
        if (typeof c.token.x === "number" && (Math.abs(c.token.x - end.x) > tol || Math.abs(c.token.y - end.y) > tol)) break; // stopped short (a Sentinel reaction): the move is over
        const enemy = seg.trigger && board.enemies.find((e) => e.id === seg.trigger.enemyId);
        if (!enemy?.oa) continue;
        let hit = false;
        try {
          const gm = () => gmAttack(enemy.oa.activityUuid, c.token.uuid);
          const u = owner(fromUuidSync(enemy.uuid));
          const r = await serial(enemy.id, () => u ? wait(ask(u.id, enemy.actorUuid, enemy.oa.activityUuid, c.token.uuid), { title: L("Autopilot.TunnelFighter.Waiting", { name: enemy.name }), label: L("Prompt.RollForThem") }, gm) : gm());
          hit = !!r?.hit;
        } catch (err) { log(`Tunnel Fighter reaction of ${enemy.name} failed`, err); }
        const hp = c.actor?.system?.attributes?.hp?.value;
        if ((hit && enemy.sentinel) || (typeof hp === "number" && hp <= 0)) break; // a Sentinel hit ends the move; so does dropping
      }
    };
    const moveAll = async (list) => { // [combatant, plan] pairs: move together, wait for every sprite, snap what a reaction left between squares
      const movers = list.filter(([, p]) => p.move).map(([c]) => c);
      if (!movers.length) return;
      const unwatch = sentinelWatch(movers, boards);
      try { await Promise.all(list.map(([c, p]) => p.move && moveOne(c, p))); } finally { unwatch(); }
      for (const c of movers) await snapToGrid(c.token);
    };
    const escaped = new Set();
    const checkEscapes = async (list) => { // a fleeing monster standing inside its escape region leaves the fight: defeated, hidden, one public line
      for (const [c, p] of list) {
        if (!p.escape || !p.move) continue;
        const region = fromUuidSync(p.escape), centre = c.token.getCenterPoint?.();
        if (!region?.testPoint || !centre || !region.testPoint({ x: centre.x, y: centre.y, elevation: c.token.elevation ?? 0 })) continue;
        escaped.add(c.id);
        await c.update({ defeated: true });
        await c.token.update({ hidden: true });
        await ChatMessage.create({ content: L("Autopilot.Escaped", { name: c.token.name }) });
      }
    };
    await moveAll(plans);
    await checkEscapes(plans);
    const act = actWith({ combat, reserved, stale, snap, pick, use, pause });
    for (let [c, first] of plans) {
      if (stale()) return;
      if (escaped.has(c.id)) continue;
      try {
        let board = await snap(combat, c, reserved);
        if (board.me.hp <= 0) continue; // dropped on the way (an opportunity attack): no action
        let fled = !!first.dash;
        if (!first.move) { // it stayed put while the others moved: the board changed under it (an ally walked off), so it may still walk now
          const again = plan(board);
          if (again.move) {
            await whisper(L("Autopilot.Decision", { name: c.token.name, reason: again.reason }));
            boards[c.id] = board; await moveAll([[c, again]]); await checkEscapes([[c, again]]);
            if (stale()) return; if (escaped.has(c.id)) continue;
            fled = !!again.dash; first = again;
            board = await snap(combat, c, reserved); if (board.me.hp <= 0) continue;
          }
        }
        const still = { ...board, me: { ...board.me, budget: 0 } }; // act from where it stands: a move that fell short never fires out of reach
        const done = fled ? true : await act(c, still, plan(still), first); // the flight (already whispered) was the action: nothing else this turn but the bonus action
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
  if (await replay()) return; // the GM moved on meanwhile: that change plays now (its lair, its monsters); this run is stale
  if (pass) await combat.nextTurn(); // after `running` clears: the turn-change hook fires inside the update and must be able to play the next monsters
}

/**
 * Top of the round: every monster in its lair (on the autopilot or not: the DM may play the dragon, the module plays the lair) takes
 * its best lair action from where it stands, never the one it used last round; the GM hears what it did and what is left for their
 * hands. Lead GM only, at initiative count 20 losing ties: before the first group that starts below 20 (see lairTurn).
 */
export async function runLair(combat, deps = {}) {
  if (game.settings.get(MODULE_ID, "lairActions") === false) return;
  const { snap = snapshot, plan = planTurn, pick = pickTarget, use = useActivity, pause = pauseDialog } = deps;
  const mark = { id: combat.id, round: combat.round, turn: combat.turn };
  const stale = () => game.combat?.id !== mark.id || game.combat.round !== mark.round || game.combat.turn !== mark.turn;
  const reserved = new Set();
  // "Take over" here only skips the lair action: the monster's own autopilot (it may not even be on it) is not the lair's business.
  let used = false; // a skipped lair action was not used: nothing to remember, the no-repeat rule lifts
  const act = actWith({ combat, reserved, stale, snap, pick, use: async (...a) => { used = true; return use(...a); }, pause: async (o) => { const r = await pause(o); return r === "manual" ? "skip" : r; } });
  const members = combat.turns.filter((c) => c.token && c.token.parent?.id === canvas.scene?.id && !c.actor?.hasPlayerOwner && !c.isDefeated
    && (c.actor?.system?.attributes?.hp?.value ?? 0) > 0 && lairOf(c.actor)); // read from the sheet: no snapshot for a monster without a lair
  for (const c of members) {
    if (stale()) return;
    try {
      const board = await snap(combat, c, reserved);
      log(brief(board));
      const still = { ...board, me: { ...board.me, budget: 0 } }; // the lair acts where the monster stands
      const p = plan(still, { slot: "lair" });
      if (!p.actions.length) { // nothing to score: the GM hears what is left by hand, and the "not twice in a row" rule lifts
        await whisper(L("Autopilot.Decision", { name: c.token.name, reason: p.reason }));
        if (c.getFlag(MODULE_ID, "lairLast")) await c.unsetFlag(MODULE_ID, "lairLast");
        continue;
      }
      used = false;
      const r = await act(c, still, p);
      if (r === null) return;
      if (used) await c.setFlag(MODULE_ID, "lairLast", p.actions[0].activityId);
      else if (c.getFlag(MODULE_ID, "lairLast")) await c.unsetFlag(MODULE_ID, "lairLast");
    } catch (err) { console.error(`[${MODULE_ID}]`, err); await whisper(L("Autopilot.Error", { name: c.token.name, error: err?.message ?? String(err) })); }
  }
}

/** combatTurnChange: the lead GM plays the new turn's automatic members (after the lair, at its place in the round). Only on a step forward: "previous turn" never replays a group. */
export async function onCombatTurnChange(combat, prior, current, deps) {
  if (!leadGm() || !combat?.started) return;
  const r0 = prior?.round ?? 0, r1 = current?.round ?? 0, t0 = prior?.turn ?? -1, t1 = current?.turn ?? 0;
  if (r1 < r0 || (r1 === r0 && t1 <= t0)) return;
  if (running) { pending = [combat, prior, current, deps]; return; } // busy (a use waiting on Midi): replayed when the run ends, never dropped
  const lt = lairTurn(combat, game.settings.get(MODULE_ID, "enableTurns") !== false); // initiative count 20, losing ties
  if (t1 >= lt && (r1 > r0 || t0 < lt)) { // stepping onto (or past) the lair's place in the round, once per round
    running = true;
    try { await runLair(combat, deps); } finally { running = false; }
    if (await replay()) return;
  }
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
      await c.setFlag(MODULE_ID, "autopilot", !isAuto(c));
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
