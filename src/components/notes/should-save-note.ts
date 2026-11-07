/**
 * shouldSaveNoteOnBlur — the one blur predicate shared by the four note surfaces
 * that autosave on blur (StrategyNoteCard, HoldingNoteRow, BridgeOutcomeNoteSection
 * and HoldingDetail's Notes tab). Phase 193 (QUIETVIEW) D-09, TRUST-06.
 *
 * Save when the text changed. A blank draft saves only when it clears a note
 * that is persisted non-blank (founder override of D-09, 2026-11-07, "Allow
 * clearing"), so opening a note and leaving without typing never writes a row,
 * while a deliberate clear still reaches /api/notes.
 *
 * `persisted` is the last content known to be stored: the initial or fetched
 * content ("" when there is none), advanced only when a save reports "saved".
 */
export function shouldSaveNoteOnBlur(draft: string, persisted: string): boolean {
  return draft !== persisted && (draft.trim() !== "" || persisted.trim() !== "");
}
