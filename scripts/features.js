// Monster features the SRD import leaves to the table. Engulf (the Gelatinous Cube): the SRD item is a save at reach with no target type
// and no effect, so Midi aims it at the monster itself and nothing marks the victim. The target picker asks for the creature (targeting.js)
// and, on a failed save, the victim gets an Engulfed effect (Restrained, the cube's item as origin) with the escape in its description; the
// table rolls the acid and the escape. ponytail: no release when the cube dies or moves away (the DM removes the effect).
import { MODULE_ID, log, safe } from "./main.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const ENGULF = /^(engulf|engullir)$/i;
export const isEngulf = (name) => ENGULF.test(String(name ?? "").trim());

/** An effect on a victim: by this client when it may, else through Midi's GM socket. */
async function applyEffect(actor, data) {
  if (game.user.isGM || actor.isOwner) return actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return MidiQOL.socket().executeAsGM("createEffects", { actorUuid: actor.uuid, effects: [data] });
}

/** midi-qol.RollComplete: Engulf's failed saves. */
export async function onRollCompleteFeatures(workflow) {
  if (!workflow || workflow.aborted || !isEngulf(workflow.item?.name) || (workflow.item?.effects?.size ?? 0) > 0) return; // an automated item (2024, CPR) carries its own effect
  const by = workflow.token?.document ?? workflow.token, byName = by?.name ?? workflow.actor?.name, byUuid = by?.uuid ?? "";
  const dc = workflow.activity?.save?.dc?.value ?? null, origin = workflow.item?.uuid ?? "";
  const done = [];
  for (const t of workflow.failedSaves ?? []) {
    const actor = (t.document ?? t)?.actor;
    if (!actor || [...(actor.effects ?? [])].some((e) => e.flags?.[MODULE_ID]?.engulfedBy === byUuid)) continue;
    await applyEffect(actor, {
      name: L("Features.Engulfed", { name: byName }), img: workflow.item?.img, origin, statuses: ["restrained"], transfer: false,
      description: L("Features.EngulfedHint", { by: byName, dc: dc ?? "?" }), flags: { [MODULE_ID]: { engulfedBy: byUuid } }
    });
    done.push((t.document ?? t)?.name ?? actor.name);
  }
  if (!done.length) return;
  await ChatMessage.create({ content: L("Features.EngulfedLine", { names: done.join(", "), by: byName, dc: dc ?? "?" }) });
  log(`engulf: ${done.join(", ")} by ${byName}`);
}

export function registerFeatures() {
  Hooks.on("midi-qol.RollComplete", safe((w) => onRollCompleteFeatures(w)));
  log("monster features on");
}
