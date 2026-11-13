/**
 * extensions/omt/features/sidebar/pet-anim.ts
 *
 * Sidebar pet state machine and animation renderer.
 *
 * Key Specifications:
 * - 6 states: idle, thinking, writing, working, success, error.
 * - Flash delay: petFlashDelay = 1200ms
 * - Idle rotation: petRotateEvery = 20s (anchored on pet.at)
 * - Cadence: 500ms (125ms when busy, flashing, or task active)
 * - Frame drawing: 4-row ASCII art with pet name on first inked row and timed status
 *   label on ground row; 1-row classic kaomoji face + label.
 * - Status styling: busy tints (ANSI text / white), green success (ANSI 32), red error (ANSI 31).
 * - Spacing, padding, and width containment (inner = 30).
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  PETS,
  PET_NAMES,
  getPet,
  rotatePet,
  normalize,
  width as petWidthRaw,
  isClassic as isClassicCheck,
  isStyle as isStyleCheck,
  ART_ROWS as ART_ROWS_BASE,
  DEFAULT_PET as DEFAULT_PET_BASE,
  SIDE_INNER_W as SIDE_INNER_W_BASE,
  ANIM_CYCLE as ANIM_CYCLE_BASE,
  ANIM_CYCLE_BUSY as ANIM_CYCLE_BUSY_BASE,
  ANIM_BLINK_FROM as ANIM_BLINK_FROM_BASE,
  petFrameFor as petFrameForBase,
  petEntries as petEntriesBase,
  petDemo as petDemoBase,
} from "./pet.ts";
import type { PetDefinition } from "./types.ts";

// -------------------------------------------------------------
// Constants (mandated specifications matching OMT)
// -------------------------------------------------------------

/** Height of ASCII art frames in rows (padded on top, ground row bottom) */
export const ART_ROWS = ART_ROWS_BASE; // 4
export const ArtRows = ART_ROWS;

/** Inner sidebar content width */
export const SIDE_INNER_W = SIDE_INNER_W_BASE; // 30
export const sideInnerW = SIDE_INNER_W;

/** Default pet when none is selected or resolving fallback */
export const DEFAULT_PET = DEFAULT_PET_BASE; // "cat"
export const DefaultName = DEFAULT_PET;

/** Look identifiers */
export const STYLE_ASCII = "ascii";
export const STYLE_CLASSIC = "classic";
export const StyleASCII = STYLE_ASCII;
export const StyleClassic = STYLE_CLASSIC;

/**
 * Flash delay: auto-decay timer for end-of-turn flashes (Success/Error).
 * Mandated: 1200ms.
 */
export const PET_FLASH_DELAY = 1200;
export const petFlashDelay = PET_FLASH_DELAY;

/**
 * Idle rotation interval: how long a pet keeps the sidebar before the next
 * one from the set takes its turn. Anchored on `at` timestamp.
 * Mandated: 20s (20000ms).
 */
export const PET_ROTATE_EVERY = 20000;
export const petRotateEvery = PET_ROTATE_EVERY;

/**
 * Slow cadence for idle pet animation (blink/sway and rotation checks).
 * Mandated: 500ms.
 */
export const PET_CADENCE_IDLE = 500;
export const petTickIdle = PET_CADENCE_IDLE;

/**
 * Fast cadence for busy turns (thinking/writing/working/flashing):
 * repaints the elapsed counter and blinks the pet at double rate.
 * Mandated: 125ms when busy.
 */
export const PET_CADENCE_BUSY = 125;
export const petTickEvery = PET_CADENCE_BUSY;

/** Animation cycles for ASCII blinking */
export const ANIM_CYCLE = ANIM_CYCLE_BASE; // 8 beats
export const animCycle = ANIM_CYCLE;
export const ANIM_CYCLE_BUSY = ANIM_CYCLE_BUSY_BASE; // 4 beats
export const animCycleBusy = ANIM_CYCLE_BUSY;
export const ANIM_BLINK_FROM = ANIM_BLINK_FROM_BASE; // 3 beats before cycle wraps
export const animBlinkFrom = ANIM_BLINK_FROM;

// -------------------------------------------------------------
// Pet Statuses (6 states matching OMT pet.Status)
// -------------------------------------------------------------

export type PetStatus = "idle" | "thinking" | "writing" | "working" | "success" | "error";

export const petIdle: PetStatus = "idle";
export const petThinking: PetStatus = "thinking";
export const petWriting: PetStatus = "writing";
export const petWorking: PetStatus = "working";
export const petSuccess: PetStatus = "success";
export const petError: PetStatus = "error";

export const PET_STATUSES: readonly PetStatus[] = [
  "idle",
  "thinking",
  "writing",
  "working",
  "success",
  "error",
] as const;

/** Busy reports streaming/working states (timed per cycle). */
export function isBusyStatus(s: PetStatus): boolean {
  return s === "thinking" || s === "writing" || s === "working";
}

/** Flashing reports end-of-turn states (auto-decay via flash timer). */
export function isFlashingStatus(s: PetStatus): boolean {
  return s === "success" || s === "error";
}

// -------------------------------------------------------------
// Classic Kaomoji Faces
// -------------------------------------------------------------

export const CLASSIC_FACES: Record<PetStatus, readonly string[]> = {
  idle: ["(◉‿◉)", "(˘‿˘)", "(◉‿◉)", "(-‿-)"],
  thinking: ["(◔_◔)", "(◉_◔)", "(◔_◔)", "(¬_¬)", "(ᵕ_ᵕ)"],
  writing: ["(•‿•)✎", "(•o•)⋆", "(•‿•)✎", "(•o•)⋆", "(•ᴗ•)✎", "(•ᴗ•)⋆", "(ᵔᴗᵔ)✎"],
  working: ["(◉▿◉)⚙", "(◉▽◉)⋆", "(◉▿◉)⚙", "(●▿●)⋆", "(•ᴗ•)⚙", "(•_•)⋆", "(ᗒᴗᗕ)⚙", "(•̀ᴗ•́)⋆"],
  success: ["(ᵔᴥᵔ)", "(ᵔᴥᵔ)", "(ᵔᴥᵔ)", "(^‿^)", "(ᵔᴗᵔ)♡", "(•ᴗ•)✦", "(^ᴗ^)", "(ᵔ‿ᵔ)"],
  error: ["(ಠ_ಠ)", "()ಠ_ಠ)", "(T_T)", "(T_T)"],
};

/** ClassicFaces returns the classic frames for a status ("" reads as idle). */
export function classicFaces(s: PetStatus): readonly string[] {
  return CLASSIC_FACES[s] ?? CLASSIC_FACES.idle;
}

/** ClassicFace picks the classic animation frame for tick. */
export function classicFace(s: PetStatus, tick = 0): string {
  const frames = classicFaces(s);
  if (!frames.length) return "";
  const idx = ((tick % frames.length) + frames.length) % frames.length;
  return frames[idx] ?? "";
}

/** IsStyle reports whether a /pet entry selects a look rather than an animal. */
export function isStyle(entry: string): boolean {
  return isStyleCheck(entry);
}

/** IsClassic reports whether an entry selects the classic kaomoji look. */
export function isClassic(entry: string): boolean {
  return isClassicCheck(entry);
}

// -------------------------------------------------------------
// ASCII Pet Re-exports & Drawing Helpers
// -------------------------------------------------------------

export {
  PETS,
  PET_NAMES,
  getPet,
  rotatePet,
  normalize,
  petEntriesBase as petEntries,
  petDemoBase as petDemo,
};

export const petWidth = petWidthRaw;
export const width = petWidthRaw;

/**
 * FrameFor returns the drawing to show at tick. A two-frame pet shows frame
 * 1 for a single beat per cycle (the blink) and rests on frame 0 the rest of
 * the time; busy halves the cycle so a working pet moves more often.
 */
export function petFrameFor(pet: PetDefinition, tick = 0, busy = false): string[] {
  return petFrameForBase(pet, tick, busy);
}

/**
 * petNameRow picks the row the name shares with the art: the first row that
 * actually has ink. Frames are padded on TOP to a fixed height, so a pet
 * drawn shorter than ArtRows (cat) would otherwise get its name stranded on
 * a blank line — a title row all over again, the very row this layout just
 * saved. The label keeps the ground row; if a drawing were a single row the
 * label wins it and the name falls back to the first one.
 */
export function petNameRow(frame: string[]): number {
  for (let i = 0; i < frame.length; i++) {
    if ((frame[i] ?? "").trim() !== "") {
      if (i === frame.length - 1) {
        return 0;
      }
      return i;
    }
  }
  return 0;
}

/**
 * petRows is the sidebar block height in content rows, per look.
 * ascii = ArtRows art + separator (5 rows)
 * classic = 1 face+label row + separator (2 rows)
 */
export function petRows(style: "ascii" | "classic" = "ascii"): number {
  return style === "classic" ? 2 : ART_ROWS + 1;
}

// -------------------------------------------------------------
// Duration & Label Formatting (matching OMT format.FmtDur & pet.Label)
// -------------------------------------------------------------

/**
 * FmtDur formats durations like pi/OMT: 2m37s, 3m0s, 5s.
 */
export function fmtDur(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${mm}m`;
  if (mm > 0) return `${mm}m${s}s`;
  return `${s}s`;
}

/**
 * Short flattens newlines to ' ⏎ ' and clamps string width to at most n cells,
 * reserving one cell for '…' if truncated.
 */
export function short(s: string, n: number): string {
  const flattened = s.replace(/\r?\n/g, " ⏎ ");
  if (visibleWidth(flattened) <= n) return flattened;
  if (n <= 0) return "";
  if (n === 1) return "…";

  let out = "";
  let width = 0;
  for (const ch of flattened) {
    const w = visibleWidth(ch);
    if (width + w > n - 1) break;
    out += ch;
    width += w;
  }
  return out + "…";
}

/**
 * Label renders the status line, appending elapsed time for busy states.
 * Busy states are TIMED per cycle: "Thinking... 7s".
 */
export function petLabel(status: PetStatus = "idle", since?: Date | number, now = Date.now()): string {
  let out = "Ready";
  switch (status) {
    case "thinking":
      out = "Thinking...";
      break;
    case "writing":
      out = "Writing...";
      break;
    case "working":
      out = "Working...";
      break;
    case "success":
      out = "Done!";
      break;
    case "error":
      out = "Error";
      break;
    default:
      out = "Ready";
      break;
  }
  if (isBusyStatus(status) && since !== undefined) {
    const sinceMs = typeof since === "number" ? since : since.getTime();
    if (sinceMs > 0) {
      out += " " + fmtDur(Math.max(0, now - sinceMs));
    }
  }
  return out;
}

// -------------------------------------------------------------
// ANSI Styling & Themes (matching OMT petArtStyle & status colors)
// -------------------------------------------------------------

export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  muted: "\x1b[90m", // cMuted: statusBarStyle
  green: "\x1b[32m", // cGreen: okStyle
  red: "\x1b[31m",   // cRed: errStyle
  text: "\x1b[37m",  // cText: foreground busy tints
  border: "\x1b[90m",// cBorder: separator
} as const;

/**
 * Returns ANSI foreground color escape code for art style per pet status.
 * - Busy (thinking/writing/working): cText (bright white/text)
 * - Success: cGreen (green)
 * - Error: cRed (red)
 * - Idle: cMuted (muted gray)
 */
export function petArtColorAnsi(status: PetStatus): string {
  switch (status) {
    case "thinking":
    case "writing":
    case "working":
      return ANSI.text;
    case "success":
      return ANSI.green;
    case "error":
      return ANSI.red;
    default:
      return ANSI.muted;
  }
}

function styleArt(text: string, status: PetStatus, theme?: Theme): string {
  if (theme && typeof theme.fg === "function") {
    try {
      if (isBusyStatus(status)) return theme.fg("text" as any, text);
      if (status === "success") return theme.fg("success" as any, text);
      if (status === "error") return theme.fg("error" as any, text);
      return theme.fg("dim" as any, text);
    } catch {}
  }
  const color = petArtColorAnsi(status);
  return `${color}${text}${ANSI.reset}`;
}

function styleName(text: string, theme?: Theme): string {
  if (theme && typeof theme.bold === "function") {
    try {
      const bolded = theme.bold(text);
      if (typeof theme.fg === "function") {
        return theme.fg("text" as any, bolded);
      }
      return bolded;
    } catch {}
  }
  return `${ANSI.bold}${ANSI.text}${text}${ANSI.reset}`;
}

function styleLabel(text: string, theme?: Theme): string {
  if (theme && typeof theme.fg === "function") {
    try {
      return theme.fg("dim" as any, text);
    } catch {}
  }
  return `${ANSI.muted}${text}${ANSI.reset}`;
}

function styleDivider(text: string, theme?: Theme): string {
  if (theme && typeof theme.fg === "function") {
    try {
      return theme.fg("border" as any, text);
    } catch {}
  }
  return `${ANSI.border}${text}${ANSI.reset}`;
}

// -------------------------------------------------------------
// State Machine
// -------------------------------------------------------------

export interface PetAnimState {
  status: PetStatus;
  since?: number;          // timestamp when current busy period began
  tick: number;            // current animation frame tick
  gen: number;             // transition generation; stale flash timers check it
  ticking: boolean;        // whether loop cadence is actively scheduled
  inTurn: boolean;         // between agent_start and agent_settled
  sawStop: boolean;        // a done(stop) closed a round (gates Done! flash)
  shown: string;           // pet actually drawn right now (the wandering one)
  at: number;              // when shown took the sidebar; drives rotation clock
  style: "ascii" | "classic"; // pet visual look
  petName: string;         // persisted anchor pet name
  flashUntil?: number;     // timestamp when active flash decays to idle
}

export function createPetAnimState(init?: Partial<PetAnimState>): PetAnimState {
  const petName = init?.petName ?? DEFAULT_PET;
  return {
    status: init?.status ?? "idle",
    since: init?.since,
    tick: init?.tick ?? 0,
    gen: init?.gen ?? 0,
    ticking: init?.ticking ?? false,
    inTurn: init?.inTurn ?? false,
    sawStop: init?.sawStop ?? false,
    shown: init?.shown ?? petName,
    at: init?.at ?? 0,
    style: init?.style ?? "ascii",
    petName,
    flashUntil: init?.flashUntil,
  };
}

/**
 * petInterval decides the cadence:
 * - 125ms fast cadence while busy, flashing, or task is active.
 * - 500ms slow cadence when idle animating or awaiting rotation.
 */
export function petInterval(state: PetAnimState, taskActive = false): number {
  if (isBusyStatus(state.status) || isFlashingStatus(state.status) || taskActive) {
    return PET_CADENCE_BUSY; // 125ms
  }
  return PET_CADENCE_IDLE; // 500ms
}

/**
 * petSet transitions the pet. Same-status calls are no-ops so stream deltas
 * never restart the elapsed timer. Generates fresh generation number and
 * sets busy 'since' or flash expiration.
 */
export function petSet(state: PetAnimState, next: PetStatus, now = Date.now()): PetAnimState {
  if (state.status === next) {
    return state;
  }
  const nextGen = state.gen + 1;
  const isBusy = isBusyStatus(next);
  const isFlashing = isFlashingStatus(next);

  return {
    ...state,
    status: next,
    gen: nextGen,
    since: isBusy ? now : (next === "idle" ? undefined : state.since),
    flashUntil: isFlashing ? now + PET_FLASH_DELAY : undefined,
    ticking: (isBusy || isFlashing) ? true : state.ticking,
  };
}

/**
 * petAnchor runs on agent_start: a fresh run anchors as working, but
 * re-issued starts between rounds must not override thinking/writing, and a
 * queued follow-up must not wipe the Done flash.
 */
export function petAnchor(state: PetAnimState, now = Date.now()): PetAnimState {
  const nextState: PetAnimState = {
    ...state,
    inTurn: true,
    sawStop: false,
  };
  if (isFlashingStatus(state.status) || isBusyStatus(state.status)) {
    return nextState;
  }
  return petSet(nextState, "working", now);
}

/**
 * petSettled runs on agent_settled: pi will not continue automatically.
 * Without a preceding done(stop) (e.g. Esc-abort) it decays quietly to idle.
 * With done(stop) it flashes success ("Done!").
 * With error flag it flashes error ("Error").
 */
export function petSettled(state: PetAnimState, isError = false, now = Date.now()): PetAnimState {
  const nextState: PetAnimState = {
    ...state,
    inTurn: false,
  };
  if (isFlashingStatus(state.status)) {
    return nextState;
  }
  if (isError) {
    return petSet(nextState, "error", now);
  }
  if (state.sawStop) {
    return petSet(nextState, "success", now);
  }
  return petSet(nextState, "idle", now);
}

/**
 * petFlashMsg handles flash expiration timer: verifies generation token
 * so stale timers from previous transitions cannot cut short a new status.
 */
export function petFlashMsg(state: PetAnimState, gen: number, now = Date.now()): PetAnimState {
  if (state.gen !== gen || !isFlashingStatus(state.status)) {
    return state;
  }
  return petSet(state, "idle", now);
}

/**
 * petTick advances the tick animation counter, decays expired flashes,
 * and performs idle rotation every petRotateEvery (20s) anchored on state.at.
 */
export function petTick(state: PetAnimState, now = Date.now()): PetAnimState {
  let cur = state;

  // Auto-decay flash when flash timer elapses
  if (cur.flashUntil !== undefined && now >= cur.flashUntil) {
    cur = {
      ...cur,
      status: "idle",
      flashUntil: undefined,
      since: undefined,
    };
  }

  // Idle rotation anchored on state.at
  let nextShown = cur.shown;
  let nextAt = cur.at || now;
  if (cur.style !== "classic" && now - nextAt >= PET_ROTATE_EVERY) {
    nextShown = rotatePet(cur.shown, 1);
    nextAt = now;
  }

  return {
    ...cur,
    tick: cur.tick + 1,
    shown: nextShown,
    at: nextAt,
  };
}

/**
 * setPet applies one /pet entry: an animal name, or the "ascii"/"classic"
 * look. Animal choice updates shown immediately and stamps at=now so rotation
 * starts fresh. Unknown names are rejected safely.
 */
export function setPet(
  state: PetAnimState,
  entry: string,
  now = Date.now(),
): { state: PetAnimState; success: boolean } {
  const clean = entry.trim();
  if (isClassic(clean)) {
    return {
      state: { ...state, style: "classic" },
      success: true,
    };
  }
  if (isStyle(clean)) {
    return {
      state: { ...state, style: "ascii" },
      success: true,
    };
  }
  const found = getPet(clean);
  if (found && found.name) {
    return {
      state: {
        ...state,
        style: "ascii",
        petName: found.name,
        shown: found.name,
        at: now,
      },
      success: true,
    };
  }
  return { state, success: false };
}

// -------------------------------------------------------------
// Pure Reducer Action Dispatcher
// -------------------------------------------------------------

export type PetAnimAction =
  | { type: "agent_start" }
  | { type: "thinking_delta" }
  | { type: "text_delta" }
  | { type: "tool_start" }
  | { type: "done"; reason: "stop" | "toolUse" }
  | { type: "error" }
  | { type: "agent_settled"; isError?: boolean }
  | { type: "flash_msg"; gen: number }
  | { type: "tick" }
  | { type: "set_pet"; entry: string }
  | { type: "cycle_pet"; step?: number };

export function stepPetAnim(state: PetAnimState, action: PetAnimAction, now = Date.now()): PetAnimState {
  switch (action.type) {
    case "agent_start":
      return petAnchor(state, now);
    case "thinking_delta":
      if (!state.inTurn) return state;
      return petSet(state, "thinking", now);
    case "text_delta":
      if (!state.inTurn) return state;
      return petSet(state, "writing", now);
    case "tool_start":
      if (!state.inTurn) return state;
      return petSet(state, "working", now);
    case "done":
      if (action.reason === "stop") {
        return petSet({ ...state, sawStop: true }, "success", now);
      }
      return state;
    case "error":
      return petSet(state, "error", now);
    case "agent_settled":
      return petSettled(state, action.isError, now);
    case "flash_msg":
      return petFlashMsg(state, action.gen, now);
    case "tick":
      return petTick(state, now);
    case "set_pet":
      return setPet(state, action.entry, now).state;
    case "cycle_pet": {
      const step = action.step ?? 1;
      const nextName = rotatePet(state.shown, step);
      return {
        ...state,
        style: "ascii",
        shown: nextName,
        petName: nextName,
        at: now,
        tick: 0,
      };
    }
    default:
      return state;
  }
}

// -------------------------------------------------------------
// Frame Drawing & Rendering (matching OMT renderPet)
// -------------------------------------------------------------

export interface RenderPetOptions {
  inner?: number;
  theme?: Theme;
  plainAscii?: boolean;
  now?: number;
}

/**
 * renderPet draws the sidebar pet section in the look the user picked.
 *
 * ascii: the drawing with its name on the first INKED row and the timed
 * status label on the ground row — ArtRows art + separator (5 rows). Both labels
 * sit in a column just past the drawing's widest line, measured from the raw
 * (unstyled) frame and padded with plain spaces BEFORE any styling: ANSI
 * escapes must never enter the width math.
 *
 * classic: the original compact row — animated face and status label on ONE
 * line, then the separator (2 rows). No "PET" title, no name: the look is the face.
 *
 * Height is petRows(style); width strictly contained within inner (default 30).
 */
export function renderPetAnim(state: PetAnimState, options?: RenderPetOptions): string[] {
  const inner = options?.inner ?? SIDE_INNER_W;
  const theme = options?.theme;
  const plainAscii = options?.plainAscii ?? false;
  const now = options?.now ?? Date.now();
  const sepChar = plainAscii ? "-" : "─";

  const status = state.status;
  const tick = state.tick;
  const isBusy = isBusyStatus(status);
  const isClassicMode = state.style === "classic";

  if (isClassicMode) {
    const face = classicFace(status, tick);
    const faceW = visibleWidth(face);
    const labelW = Math.max(0, inner - faceW - 1);
    const statusLabel = short(petLabel(status, state.since, now), labelW);
    const row = styleArt(face, status, theme) + " " + styleLabel(statusLabel, theme);
    const divider = styleDivider(sepChar.repeat(inner), theme);
    return [row, divider];
  }

  const p = getPet(state.shown || state.petName || DEFAULT_PET);
  const frame = petFrameFor(p, tick, isBusy);
  const petW = petWidth(frame);

  // Label budget: whatever is left of sidebar width past drawing and 2-space gutter
  const labelW = Math.max(0, inner - petW - 2);
  const nameStr = styleName(short(p.name, labelW), theme);
  const labelStr = styleLabel(short(petLabel(status, state.since, now), labelW), theme);

  const nameRowIdx = petNameRow(frame);
  const groundRowIdx = frame.length - 1;

  const rows: string[] = [];
  for (let i = 0; i < frame.length; i++) {
    // Pad on the RAW line, then style the whole row, so colored name and label
    // never shift the art or each other between frames.
    const rawLine = frame[i] ?? "";
    const rawLen = [...rawLine].length;
    const pad = " ".repeat(Math.max(0, petW - rawLen));
    const paddedLine = rawLine + pad;
    const styledArt = styleArt(paddedLine, status, theme);

    let row = styledArt;
    if (i === nameRowIdx) {
      row += "  " + nameStr;
    } else if (i === groundRowIdx) {
      row += "  " + labelStr;
    }
    rows.push(row);
  }

  rows.push(styleDivider(sepChar.repeat(inner), theme));
  return rows;
}

/**
 * Renders the pet component and joins with newlines, including trailing newline,
 * matching OMT Model.renderPet() byte layout.
 */
export function renderPetAnimToString(state: PetAnimState, options?: RenderPetOptions): string {
  const rows = renderPetAnim(state, options);
  return rows.join("\n") + "\n";
}

// -------------------------------------------------------------
// Component Wrapper (Full lifecycle & timer runner)
// -------------------------------------------------------------

export class PetAnimComponent {
  private state: PetAnimState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentCadence: number = PET_CADENCE_IDLE;
  private onRepaint?: () => void;

  constructor(init?: Partial<PetAnimState>, onRepaint?: () => void) {
    this.state = createPetAnimState(init);
    this.onRepaint = onRepaint;
  }

  public getState(): Readonly<PetAnimState> {
    return this.state;
  }

  public setState(partial: Partial<PetAnimState>): void {
    this.state = { ...this.state, ...partial };
    this.syncCadence();
    this.onRepaint?.();
  }

  public getStatus(): PetStatus {
    return this.state.status;
  }

  public getStyle(): "ascii" | "classic" {
    return this.state.style;
  }

  public getPetName(): string {
    return this.state.shown;
  }

  public getTick(): number {
    return this.state.tick;
  }

  public isBusy(): boolean {
    return isBusyStatus(this.state.status);
  }

  public isFlashing(): boolean {
    return isFlashingStatus(this.state.status);
  }

  public getInterval(taskActive = false): number {
    return petInterval(this.state, taskActive);
  }

  public dispatch(action: PetAnimAction, now = Date.now()): void {
    this.state = stepPetAnim(this.state, action, now);
    this.syncCadence();
    this.onRepaint?.();
  }

  public anchor(now = Date.now()): void {
    this.dispatch({ type: "agent_start" }, now);
  }

  public thinking(now = Date.now()): void {
    this.dispatch({ type: "thinking_delta" }, now);
  }

  public writing(now = Date.now()): void {
    this.dispatch({ type: "text_delta" }, now);
  }

  public working(now = Date.now()): void {
    this.dispatch({ type: "tool_start" }, now);
  }

  public stopDone(now = Date.now()): void {
    this.dispatch({ type: "done", reason: "stop" }, now);
  }

  public error(now = Date.now()): void {
    this.dispatch({ type: "error" }, now);
  }

  public settle(isError = false, now = Date.now()): void {
    this.dispatch({ type: "agent_settled", isError }, now);
  }

  public tick(now = Date.now()): void {
    this.dispatch({ type: "tick" }, now);
  }

  public setPet(entry: string, now = Date.now()): boolean {
    const res = setPet(this.state, entry, now);
    if (res.success) {
      this.state = res.state;
      this.onRepaint?.();
      return true;
    }
    return false;
  }

  public cyclePet(step = 1, now = Date.now()): void {
    this.dispatch({ type: "cycle_pet", step }, now);
  }

  public toggleStyle(): "ascii" | "classic" {
    const nextStyle = this.state.style === "classic" ? "ascii" : "classic";
    this.setState({ style: nextStyle });
    return nextStyle;
  }

  public render(options?: RenderPetOptions): string[] {
    return renderPetAnim(this.state, options);
  }

  public renderToString(options?: RenderPetOptions): string {
    return renderPetAnimToString(this.state, options);
  }

  public startTimer(): void {
    if (this.timer !== null) return;
    this.currentCadence = petInterval(this.state);
    this.timer = setInterval(() => {
      this.tick();
    }, this.currentCadence);
  }

  public stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private syncCadence(): void {
    const needed = petInterval(this.state);
    if (needed !== this.currentCadence && this.timer !== null) {
      this.stopTimer();
      this.startTimer();
    }
  }

  public dispose(): void {
    this.stopTimer();
  }
}
