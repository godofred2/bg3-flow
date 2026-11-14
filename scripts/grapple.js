// Grappling with the stack's grapple (CPR's generic grapple automation through CAT: the contest, the Grappled condition, the escape item).
// bg3-flow adds what the rules leave to the table: the Grapple action on every player character, the grappled creature dragged along when
// its grappler walks, and the grappler at half speed. CAT marks the grappler with a grappleSource effect (flags.cat.grapple.tokenId = the
// victim); the cube's engulfed victims (features.js, flags.bg3-flow.engulfedBy) count the same. ponytail: the held creature is placed by
// its top-left square (a Large victim may overlap); a boxed-in destination leaves it where it was.
import { MODULE_ID, log, safe } from "./main.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
export const GRAPPLE_UUID = "Compendium.chris-premades.CPRMisc2014.Item.9wbU6kYxfAaRFrbI";
const GRAPPLE_NAME = /^(grapple|agarr(e|ar|ón))$/i;
/** CPR's Grapple item (its compendium carries it from 2.1.8; the generic automation it binds is bundled since 2.1.7): the module's own copy. */
export const GRAPPLE_ITEM = Object.freeze({
  name: "Grapple", type: "feat", img: "icons/magic/control/buff-strength-muscle-damage-red.webp",
  system: {
    identifier: "grapple", type: { value: "", subtype: "" },
    description: { value: "<p>Grapple a creature within 5 feet, no more than one size larger than you: your Strength (Athletics) against its Strength (Athletics) or Dexterity (Acrobatics). On a win it is Grappled (speed 0) until it escapes with its own action, you let go, or you are parted. Chris's Premades runs the contest; bg3-flow drags the creature along when you walk and halves your speed.</p>" },
    activities: {
      GrappleAct000001: {
        _id: "GrappleAct000001", type: "utility", name: "Grapple", identifier: "grapple",
        activation: { type: "action", value: 1, condition: "", override: false },
        range: { value: "5", units: "ft", special: "", override: false },
        target: { template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "ft" }, affects: { count: "1", type: "creature", choice: false, special: "" }, prompt: true, override: false },
        duration: { concentration: false, value: "", units: "inst", special: "", override: false },
        consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: true },
        flags: { cat: { genericConfig: { "chris-premades": { grapple: { auto: false, checkSize: true, dc: "", conditions: [], useActivityInfo: true, replaceActivity: true } } }, macros: { roll: [{ source: "chris-premades", identifier: "grapple", rules: "all" }] } } }
      }
    }
  },
  flags: { cat: { automation: { source: "chris-premades", version: "2.1.8" } }, "bg3-flow": { grapple: true } } // the literal id: main.js imports this module, MODULE_ID is not set yet at load
});

const effectsOf = (actor) => [...(actor?.appliedEffects ?? actor?.effects ?? [])];
const tokensOf = (doc) => doc?.parent?.tokens?.contents ?? canvas?.scene?.tokens?.contents ?? [];
const sources = (doc) => effectsOf(doc?.actor).filter((e) => e.flags?.cat?.identifier === "grappleSource" && e.flags.cat.grapple?.tokenId);
const size = (doc) => Math.max(1, Math.round(doc?.width ?? 1));
const hasStatus = (e, s) => (e.statuses?.has ? e.statuses.has(s) : (e.statuses ?? []).includes(s));
/** An effect that binds its bearer to `doc`: bg3-flow's engulfed mark, or a Restrained/Grappled effect from one of doc's own items (the 2024 Engulf, a tentacle). */
const bindsTo = (e, doc) => e.flags?.[MODULE_ID]?.engulfedBy === doc.uuid
  || ((hasStatus(e, "restrained") || hasStatus(e, "grappled")) && [doc.actor?.uuid, doc.uuid].some((u) => u && String(e.origin ?? "").startsWith(u)));
const bound = (doc) => tokensOf(doc).filter((t) => t !== doc && effectsOf(t.actor).some((e) => bindsTo(e, doc)));

/** The tokens this one holds: CAT's grapples, bg3-flow's engulfed, and whoever its own effects restrain or grapple. */
export function heldBy(doc) {
  if (!doc) return [];
  const all = tokensOf(doc), ids = new Set(sources(doc).map((e) => e.flags.cat.grapple.tokenId));
  for (const t of bound(doc)) ids.add(t.id);
  return [...ids].map((id) => all.find((t) => t.id === id)).filter(Boolean);
}
/** Holding someone. */
export const isHolding = (doc) => !!doc && (sources(doc).length > 0 || bound(doc).length > 0);

/** Where a dragged creature lands: the free square on the ring around the mover's footprint at `dest` nearest to where the creature stood;
 *  null when it already touches that footprint or every ring square is taken. */
export function dragSquare(mover, held, dest = { x: mover.x, y: mover.y }) {
  const s = canvas?.grid?.size ?? canvas?.dimensions?.size ?? 100, w = size(mover), h = Math.max(1, Math.round(mover?.height ?? w));
  const inside = (x, y) => x >= dest.x && x < dest.x + w * s && y >= dest.y && y < dest.y + h * s;
  const touching = held.x >= dest.x - s && held.x <= dest.x + w * s && held.y >= dest.y - s && held.y <= dest.y + h * s;
  if (touching && !inside(held.x, held.y)) return null;
  if (touching && inside(held.x, held.y) && dest.x === mover.x && dest.y === mover.y) return null; // engulfed inside the standing cube: fine where it is
  const taken = new Set();
  for (const t of tokensOf(mover)) if (t !== mover && t !== held) for (let i = 0; i < size(t); i++) for (let j = 0; j < Math.max(1, Math.round(t.height ?? 1)); j++) taken.add(`${t.x + i * s},${t.y + j * s}`);
  let best = null, dist = Infinity;
  for (let i = -1; i <= w; i++) for (let j = -1; j <= h; j++) {
    if (i >= 0 && i < w && j >= 0 && j < h) continue; // the footprint itself
    const x = dest.x + i * s, y = dest.y + j * s;
    if (taken.has(`${x},${y}`)) continue;
    const d = (x - held.x) ** 2 + (y - held.y) ** 2;
    if (d < dist) { dist = d; best = { x, y }; }
  }
  return best;
}

/** moveToken on the lead GM: a walking grappler drags what it holds with CAT's forced-movement action (catForce: no cost, no opportunity
 *  attack, and CAT keeps the hold while within reach; a teleport such as displace would break it), through other tokens' spaces. The
 *  movement's destination is read, not the document (which may still show the origin when the hook fires). */
export async function onMoveTokenGrapple(doc, movement) {
  if (!game.users.activeGM?.isSelf) return;
  const wps = [...(movement?.passed?.waypoints ?? []), ...(movement?.pending?.waypoints ?? [])];
  const action = wps.at(-1)?.action ?? doc.movementAction ?? "walk";
  if (CONFIG.Token.movement.actions[action]?.teleport) return; // shoved or teleported itself: CAT decides whether the hold survives
  const dest = movement?.destination ?? wps.at(-1) ?? doc;
  for (const held of heldBy(doc)) {
    const to = dragSquare(doc, held, { x: dest.x, y: dest.y });
    if (!to) continue;
    const forced = CONFIG.Token.movement.actions.catForce ? "catForce" : "displace";
    await held.move([{ ...to, elevation: held.elevation ?? 0, action: forced }], { showRuler: false, bg3Drag: true, constrainOptions: { ignoreTokens: true } });
    log(`${held.name} dragged along by ${doc.name}`);
  }
}

const hasGrapple = (actor) => [...(actor?.items ?? [])].some((i) => i.system?.identifier === "grapple" || GRAPPLE_NAME.test(String(i.name ?? "").trim()));
let warned = false;
/** The Grapple action on every player character that lacks it: CPR's compendium item, else the module's copy. GM only; needs CPR. */
export async function ensureGrapple(actors = game.actors) {
  if (!game.user.isGM || game.settings.get(MODULE_ID, "grappleAction") === false) return;
  const todo = [...(actors ?? [])].filter((a) => a?.type === "character" && a.hasPlayerOwner && !hasGrapple(a));
  if (!todo.length) return;
  if (!game.modules.get("chris-premades")?.active) { if (!warned) ui.notifications.warn(L("Grapple.Missing")); warned = true; return; }
  const src = await fromUuid(GRAPPLE_UUID);
  const data = src ? src.toObject() : structuredClone(GRAPPLE_ITEM); // a copy: Foundry writes into the data it is given
  for (const a of todo) { await a.createEmbeddedDocuments("Item", [data]); log(`Grapple added to ${a.name}${src ? "" : " (the module's copy)"}`); }
}

/** Called at ready: the start-up check runs at once. */
export function registerGrapple() {
  ensureGrapple().catch((err) => console.error(`[${MODULE_ID}]`, err));
  Hooks.on("createActor", safe((actor) => ensureGrapple([actor])));
  Hooks.on("updateActor", safe((actor, changes) => { if (changes?.ownership) return ensureGrapple([actor]); })); // handed to a player later
  Hooks.on("moveToken", safe((doc, movement) => onMoveTokenGrapple(doc, movement)));
  log("grapple on");
}
