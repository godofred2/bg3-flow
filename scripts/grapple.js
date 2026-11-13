// Grappling with the stack's grapple (CPR's Grapple item, CAT's handler: the contest, the Grappled condition, the escape item). bg3-flow adds
// what the rules leave to the table: the Grapple action on every player character, the grappled creature dragged along when its grappler
// walks, and the grappler at half speed. CAT marks the grappler with a grappleSource effect (flags.cat.grapple.tokenId = the victim); the
// cube's engulfed victims (features.js, flags.bg3-flow.engulfedBy) count the same. ponytail: 1x1 squares for the drag (a Large grappler
// drags to the squares around its top-left corner); a boxed-in destination leaves the creature where it was.
import { MODULE_ID, log, safe } from "./main.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
export const GRAPPLE_UUID = "Compendium.chris-premades.CPRMisc2014.Item.9wbU6kYxfAaRFrbI";
const GRAPPLE_NAME = /^(grapple|agarr(e|ar|ón))$/i;

const effectsOf = (actor) => [...(actor?.appliedEffects ?? actor?.effects ?? [])];
const tokensOf = (doc) => doc?.parent?.tokens?.contents ?? canvas?.scene?.tokens?.contents ?? [];
const sources = (doc) => effectsOf(doc?.actor).filter((e) => e.flags?.cat?.identifier === "grappleSource" && e.flags.cat.grapple?.tokenId);

/** The tokens this one holds: CAT's grapples and bg3-flow's engulfed. */
export function heldBy(doc) {
  if (!doc) return [];
  const all = tokensOf(doc), ids = new Set(sources(doc).map((e) => e.flags.cat.grapple.tokenId));
  for (const t of all) if (t !== doc && effectsOf(t.actor).some((e) => e.flags?.[MODULE_ID]?.engulfedBy === doc.uuid)) ids.add(t.id);
  return [...ids].map((id) => all.find((t) => t.id === id)).filter(Boolean);
}
/** Holding someone (cheap: no token lookup for the grapples). */
export const isHolding = (doc) => !!doc && (sources(doc).length > 0 || tokensOf(doc).some((t) => t !== doc && effectsOf(t.actor).some((e) => e.flags?.[MODULE_ID]?.engulfedBy === doc.uuid)));

/** Where a dragged creature lands: the free square next to the mover nearest to where it stood; null when already adjacent or boxed in. */
export function dragSquare(mover, held) {
  const s = canvas?.grid?.size ?? canvas?.dimensions?.size ?? 100;
  if (Math.abs(held.x - mover.x) <= s && Math.abs(held.y - mover.y) <= s) return null;
  const taken = new Set(tokensOf(mover).filter((t) => t !== mover && t !== held).map((t) => `${t.x},${t.y}`));
  let best = null, dist = Infinity;
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    if (!dx && !dy) continue;
    const x = mover.x + dx * s, y = mover.y + dy * s;
    if (taken.has(`${x},${y}`)) continue;
    const d = (x - held.x) ** 2 + (y - held.y) ** 2;
    if (d < dist) { dist = d; best = { x, y }; }
  }
  return best;
}

/** moveToken on the lead GM: a walking grappler drags what it holds (a displace move: no opportunity attack, no budget, CAT keeps the hold). */
export async function onMoveTokenGrapple(doc, movement) {
  if (!game.users.activeGM?.isSelf) return;
  const wps = [...(movement?.passed?.waypoints ?? []), ...(movement?.pending?.waypoints ?? [])];
  const action = wps.at(-1)?.action ?? doc.movementAction ?? "walk";
  if (CONFIG.Token.movement.actions[action]?.teleport) return; // shoved or teleported itself: CAT decides whether the hold survives
  for (const held of heldBy(doc)) {
    const to = dragSquare(doc, held);
    if (!to) continue;
    await held.move([{ ...to, elevation: held.elevation ?? 0, action: "displace" }], { showRuler: false, bg3Drag: true });
    log(`${held.name} dragged along by ${doc.name}`);
  }
}

const hasGrapple = (actor) => [...(actor?.items ?? [])].some((i) => i.system?.identifier === "grapple" || GRAPPLE_NAME.test(String(i.name ?? "").trim()));
let warned = false;
/** The Grapple action (CPR's item) on every player character that lacks it. GM only; needs CPR. */
export async function ensureGrapple(actors = game.actors) {
  if (!game.user.isGM || game.settings.get(MODULE_ID, "grappleAction") === false || !game.modules.get("chris-premades")?.active) return;
  const todo = [...(actors ?? [])].filter((a) => a?.type === "character" && a.hasPlayerOwner && !hasGrapple(a));
  if (!todo.length) return;
  const src = await fromUuid(GRAPPLE_UUID);
  if (!src) { if (!warned) ui.notifications.warn(L("Grapple.Missing")); warned = true; return; }
  for (const a of todo) { await a.createEmbeddedDocuments("Item", [src.toObject()]); log(`Grapple added to ${a.name}`); }
}

export function registerGrapple() {
  Hooks.once("ready", safe(() => ensureGrapple()));
  Hooks.on("createActor", safe((actor) => ensureGrapple([actor])));
  Hooks.on("updateActor", safe((actor, changes) => { if (changes?.ownership) return ensureGrapple([actor]); })); // handed to a player later
  Hooks.on("moveToken", safe((doc, movement) => onMoveTokenGrapple(doc, movement)));
  log("grapple on");
}
