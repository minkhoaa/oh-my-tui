import type { PetStatus, PetDefinition, SidebarConfig } from "./types.ts";

export const ART_ROWS = 4;
export const SIDE_W = 34;
export const SIDE_INNER_W = 30;
export const DEFAULT_PET = "cat";
export const ANIM_CYCLE = 8;
export const ANIM_CYCLE_BUSY = 4;
export const ANIM_BLINK_FROM = 3;

export const SIDEBAR_CONFIG: SidebarConfig = {
  sideW: 34,
  sideInnerW: 30,
  artRows: 4,
  defaultPet: "cat",
  animCycle: 8,
  animCycleBusy: 4,
  animBlinkFrom: 3,
};

/** Style identifiers */
export const STYLE_ASCII = "ascii";
export const STYLE_CLASSIC = "classic";

/** Animation and rotation timing constants matching OMT */
export const PET_FLASH_DELAY = 4000;
export const PET_TICK_BUSY = 500;
export const PET_TICK_IDLE = 1000;
export const PET_ROTATE_EVERY = 20000;

/**
 * Normalizes an ASCII art frame:
 * 1. Clips to last ArtRows if taller.
 * 2. Trims trailing whitespace and tabs from each kept line.
 * 3. Pads blank lines on TOP so drawings are bottom-aligned to the ground row.
 */
export function normalize(lines: string[]): string[] {
  const keep = lines.length > ART_ROWS ? lines.slice(-ART_ROWS) : lines;
  const off = ART_ROWS - keep.length;
  const out = new Array<string>(ART_ROWS).fill("");
  for (let i = 0; i < keep.length; i++) {
    out[off + i] = keep[i].replace(/[ \t]+$/, "");
  }
  return out;
}

/**
 * Measures the maximum character/rune width across all lines in a frame.
 */
export function width(lines: string[]): number {
  let w = 0;
  for (const ln of lines) {
    const len = [...ln].length;
    if (len > w) w = len;
  }
  return w;
}

/** Raw table of all 25 pets before normalization */
const RAW_PETS: Array<{ name: string; frames: [string[], string[]] }> = [
  {
    name: "duck",
    frames: [
      ["  ___", "<(· )__", "(  ·->", " `-´"],
      ["  ___", "<(- )__", "(  ·->", " `-´"],
    ],
  },
  {
    name: "goose",
    frames: [
      [" (:>", "  ||", " _(__)_", " ~~~~"],
      [" (->", "  ||", " _(__)_", " ~~~~"],
    ],
  },
  {
    name: "blob",
    frames: [
      [" .----.", "( :  : )", "(      )", " `----'"],
      [" .----.", "(-  -)", "(      )", " `----'"],
    ],
  },
  {
    name: "cat",
    frames: [
      [" /\\^/\\", " ( o.o )", " > ^ <"],
      [" /\\^/\\", " ( -.- )", " > ^ <"],
    ],
  },
  {
    name: "dragon",
    frames: [
      [" /\\^   /\\", "<  .  . >", "(  ~~  )", " `-vvvv-'"],
      [" /\\^   /\\", "<  -  - >", "(  ~~  )", " `-vvvv-'"],
    ],
  },
  {
    name: "octopus",
    frames: [
      [" .----.", "( :  : )", "(_____)", "/\\/\\/\\/\\"],
      [" .----.", "( -  - )", "(_____)", "/\\/\\/\\/\\"],
    ],
  },
  {
    name: "owl",
    frames: [
      [" /\\   /\\", "((·.)(·.))", "(  ><  )", " `----'"],
      [" /\\   /\\", "((-)(-))", "(  ><  )", " `----'"],
    ],
  },
  {
    name: "penguin",
    frames: [
      [" .----.", " (o::.)", " /(  )\\", "  `----'"],
      [" .----.", " (o--.)", " /(  )\\", "  `----'"],
    ],
  },
  {
    name: "turtle",
    frames: [
      [" _-'---`-_", "( :  : )", "/[_______]\\", " ``  ``"],
      [" _-'---`-_", "( -  - )", "/[_______]\\", " ``  ``"],
    ],
  },
  {
    name: "snail",
    frames: [
      [" .----.", " \\ (@)", " \\`--.-'", " ~~~~~~~"],
      [" .----.", " \\ (-)", " \\`--.-'", " ~~~~~~~"],
    ],
  },
  {
    name: "ghost",
    frames: [
      [" .----.", " / : : \\", " |     |", " `~^.~^~`"],
      [" .----.", " / : : \\", " |     |", " `~^~^~`"],
    ],
  },
  {
    name: "axolotl",
    frames: [
      [" }~{_______}~{", "}~( : .. : )~{", "(  .---.  )", "(_/     \\_)"],
      [" }~{_______}~{", "}~( - .. - )~{", "(  .---.  )", "(_/     \\_)"],
    ],
  },
  {
    name: "capybara",
    frames: [
      [" n_______n", "(  ·  ·  )", "(   oo   )", " `-------'"],
      [" n_______n", "(  -  -  )", "(   -   )", " `-------'"],
    ],
  },
  {
    name: "cactus",
    frames: [
      [" n       n", " |  ___  |", " | |·  ·| |", " |_|____|_|"],
      ["  n       n", "  |  ___  |", "  | |·  ·| |", "  |_|____|_|"],
    ],
  },
  {
    name: "robot",
    frames: [
      [" .[|||].", " [ ·  · ]", " [====]", " `-----'"],
      [" .[|||].", " [ -  - ]", " [====]", " `-----'"],
    ],
  },
  {
    name: "rabbit",
    frames: [
      [" (\\___/)", " ( ·  · )", "=(  ..  )=", " (\")__(\")"],
      [" (\\___/)", " ( -  - )", "=(  --  )=", " (\")__(\")"],
    ],
  },
  {
    name: "mushroom",
    frames: [
      [" .-0-00-0-.", "(__________)", " |·    ·|", " |_____|"],
      [" .-0-0-00-.", "(__________)", " |·    ·|", " |_____|"],
    ],
  },
  {
    name: "chonk",
    frames: [
      [" /\\   /\\", "( ·   · )", "(  ..  )", " `------'"],
      [" /\\   /\\", "( -   - )", "(  --  )", " `------'"],
    ],
  },
  {
    name: "px-cat",
    frames: [
      ["  ▄█    █▄", "  █▀█▀▀█▀█", "  ▀█▀▀▀▀█▀", "  █▀▀██▀▀█"],
      ["  ▄█    █▄", "  ████████", "  ▀█▀▀▀▀█▀", "  █▀▀██▀▀█"],
    ],
  },
  {
    name: "px-frog",
    frames: [
      ["  ▄▄    ▄▄", " █▀▄    ▄▀█", " █▀██████▀█", " ▀▀▀▀▀▀▀▀▀▀"],
      ["  ▄▄    ▄▄", " █▀      ▀█", " █▀██████▀█", " ▀▀▀▀▀▀▀▀▀▀"],
    ],
  },
  {
    name: "px-bee",
    frames: [
      [" ▄▄      ▄▄", "█  █ ██ █  █", "█  █▀██▀█  █", "▀▄▄▀ ▀▀ ▀▄▄▀"],
      [" ▄  ▄  ▄  ▄", "█  █ ██ █  █", "█  █▀██▀█  █", "▀▄ ▀▄▀▀▄▀ ▄▀"],
    ],
  },
  {
    name: "px-crab",
    frames: [
      ["  ██        ██", "   █▄▄▄▄▄▄▄▄█", "  ███▄▄██▄▄███", " ▄█▀  ▀██▀  ▀█▄"],
      ["  ██        ██", "   █▄▄▄▄▄▄▄▄█", "  ████████████", " ▄█▀  ▀██▀  ▀█▄"],
    ],
  },
  {
    name: "px-capybara",
    frames: [
      ["     ▄███▄", " ▄████████████▄", " █▄████████████", "  ██  ██  ██"],
      ["     ▄███▄", " ▄████████████▄", " ██████████████", "  ██  ██  ██"],
    ],
  },
  {
    name: "px-slime",
    frames: [
      ["  ▄██████▄  ", " ███▄▄▄▄███ ", " ██████████ ", " ▀███▀▀███▀ "],
      ["  ▄██████▄  ", " █▄██▄▄██▄█ ", " ██████████ ", " ▀███▀▀███▀ "],
    ],
  },
  {
    name: "px-ghost",
    frames: [
      [" ▄████████▄ ", " ██▄████▄██ ", " ██████████ ", " ██▀██▀██▀█▄"],
      [" ▄████████▄ ", " ██████████ ", " ██████████ ", " ██▀██▀██▀█▄"],
    ],
  },
];

/** Normalized pet definitions table */
export const PETS: PetDefinition[] = RAW_PETS.map((p) => ({
  name: p.name,
  frames: [normalize(p.frames[0]), normalize(p.frames[1])],
}));

/** Pet definitions map by name */
export const PETS_BY_NAME = new Map<string, PetDefinition>(
  PETS.map((p) => [p.name, p]),
);

/** List of all 25 pet names */
export const PET_NAMES: string[] = PETS.map((p) => p.name);

/** Get a pet definition by name with fallback to default "cat" */
export function getPet(name?: string): PetDefinition {
  if (name && PETS_BY_NAME.has(name)) {
    return PETS_BY_NAME.get(name)!;
  }
  return PETS_BY_NAME.get(DEFAULT_PET)!;
}

/**
 * Returns the active drawing frame for a given tick beat and busy status.
 * - Rest: cycle of 8 beats, blink shown at beat 5 (8 - 3 = 5).
 * - Busy: cycle of 4 beats, blink shown at beat 1 (4 - 3 = 1).
 */
export function petFrameFor(pet: PetDefinition, tick = 0, busy = false): string[] {
  const frames = pet.frames as string[][] | undefined;
  if (!frames || frames.length === 0) return [];
  if (frames.length === 1) return frames[0];
  const cycle = busy ? ANIM_CYCLE_BUSY : ANIM_CYCLE;
  const beat = ((tick % cycle) + cycle) % cycle;
  const blinkBeat = cycle - ANIM_BLINK_FROM;
  return beat === blinkBeat ? frames[1] : frames[0];
}

/** Reports whether status is an active streaming/working state */
export function isBusyStatus(status: PetStatus): boolean {
  return status === "thinking" || status === "writing" || status === "working";
}

/** Formats duration into compact human format: 5s, 2m37s, 1h12m */
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

/** Formats pet status label, appending elapsed duration if busy */
export function petLabel(status: PetStatus = "idle", since?: Date | number): string {
  let out: string;
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
  if (isBusyStatus(status) && since) {
    const startTime = typeof since === "number" ? since : since.getTime();
    const elapsed = Date.now() - startTime;
    out += " " + fmtDur(elapsed);
  }
  return out;
}

/**
 * Picks the row the pet name shares with the art: the first row with ink.
 * If that first inked line is the bottom line (length - 1), fallback to row 0.
 */
export function petNameRow(frame: string[]): number {
  for (let i = 0; i < frame.length; i++) {
    if (frame[i].trim() !== "") {
      if (i === frame.length - 1) return 0;
      return i;
    }
  }
  return 0;
}

/**
 * Classic kaomoji face sets per status.
 * All faces are ≤ 8 display columns wide.
 */
export const CLASSIC_FACES: Record<PetStatus, string[]> = {
  idle: ["(◉‿◉)", "(˘‿˘)", "(◉‿◉)", "(-‿-)"],
  thinking: ["(◔_◔)", "(◉_◔)", "(◔_◔)", "(¬_¬)", "(ᵕ_ᵕ)"],
  writing: ["(•‿•)✎", "(•o•)⋆", "(•‿•)✎", "(•o•)⋆", "(•ᴗ•)✎", "(•ᴗ•)⋆", "(ᵔᴗᵔ)✎"],
  working: ["(◉▿◉)⚙", "(◉▽◉)⋆", "(◉▿◉)⚙", "(●▿●)⋆", "(•ᴗ•)⚙", "(•_•)⋆", "(ᗒᴗᗕ)⚙", "(•̀ᴗ•́)⋆"],
  success: ["(ᵔᴥᵔ)", "(ᵔᴥᵔ)", "(ᵔᴥᵔ)", "(^‿^)", "(ᵔᴗᵔ)♡", "(•ᴗ•)✦", "(^ᴗ^)", "(ᵔ‿ᵔ)"],
  error: ["(ಠ_ಠ)", "()ಠ_ಠ)", "(T_T)", "(T_T)"],
};

/** Returns the classic animation frames for a status (defaults to idle) */
export function classicFaces(status: PetStatus = "idle"): string[] {
  return CLASSIC_FACES[status] ?? CLASSIC_FACES.idle;
}

/** Returns the active classic animation frame for a status and tick */
export function classicFace(status: PetStatus = "idle", tick = 0): string {
  const frames = classicFaces(status);
  if (!frames || frames.length === 0) return "";
  const idx = ((tick % frames.length) + frames.length) % frames.length;
  return frames[idx] ?? "";
}

/** Reports whether entry selects the classic kaomoji look */
export function isClassic(entry?: string): boolean {
  return typeof entry === "string" && entry.trim().toLowerCase() === STYLE_CLASSIC;
}

/** Reports whether entry selects a look style rather than an animal */
export function isStyle(entry?: string): boolean {
  if (typeof entry !== "string") return false;
  const s = entry.trim().toLowerCase();
  return s === STYLE_ASCII || s === STYLE_CLASSIC;
}

/**
 * Lists everything /pet can pick: all 25 animal names in table order,
 * followed by the two style selectors ("ascii", "classic").
 */
export function petEntries(): string[] {
  return [...PET_NAMES, STYLE_ASCII, STYLE_CLASSIC];
}

/**
 * Returns the pet step places after name in table order, wrapping.
 * An unknown name starts at DEFAULT_PET ("cat").
 */
export function rotatePet(name: string, step = 1): string {
  const names = PET_NAMES;
  let start = names.indexOf(name);
  if (start < 0) {
    start = names.indexOf(DEFAULT_PET);
    if (start < 0) start = 0;
  }
  const n = names.length;
  const normalizedStep = ((step % n) + n) % n;
  return names[(start + normalizedStep) % n] ?? DEFAULT_PET;
}

/**
 * Reports the block height in rows for the pet section:
 * classic = 2 rows (face+label row + separator)
 * ascii = 5 rows (ArtRows 4 + separator)
 */
export function petRows(style?: "ascii" | "classic"): number {
  return style === "classic" ? 2 : ART_ROWS + 1;
}

/**
 * Demo art for the /pet preview picker.
 * - Classic: sampler of idle, working, success faces
 * - "ascii": previews the pinned animal
 * - Animal: rest frame 0 (padded top blank lines trimmed)
 */
export function petDemo(entry: string, anchor = DEFAULT_PET): string[] | null {
  if (isClassic(entry)) {
    return [
      classicFace("idle", 0),
      classicFace("working", 0),
      classicFace("success", 0),
    ];
  }
  if (isStyle(entry)) {
    // "ascii" has no art of its own: it resolves to the pinned animal
    return petDemo(anchor, DEFAULT_PET);
  }
  const target = PETS_BY_NAME.has(entry) ? entry : DEFAULT_PET;
  const pet = PETS_BY_NAME.get(target);
  if (!pet || !(pet.frames as string[][] | undefined)?.length) return null;
  const raw = pet.frames[0];
  // Trim top blank lines for the preview pane
  let start = 0;
  while (start < raw.length - 1 && raw[start].trim() === "") {
    start++;
  }
  return raw.slice(start);
}

// -------------------------------------------------------------
// Pure Pet State Machine (no timers, 100% deterministic)
// -------------------------------------------------------------

export interface PetPureState {
  name: string;
  shownName: string;
  status: PetStatus;
  style: "ascii" | "classic";
  tick: number;
  since?: number;
  flashUntil?: number;
  lastRotatedAt?: number;
  sawStop?: boolean;
  inTurn?: boolean;
}

export type PetAction =
  | { type: "turn_start"; reasoningObserved?: boolean }
  | { type: "reasoning_chunk" }
  | { type: "text_chunk" }
  | { type: "tool_start" }
  | { type: "turn_settled"; isError?: boolean; sawStop?: boolean }
  | { type: "tick"; tickDelta?: number; now?: number }
  | { type: "set_pet"; entry: string; now?: number }
  | { type: "cycle_pet"; step?: number; now?: number };

export function createPetPureState(init?: Partial<PetPureState>): PetPureState {
  const name = init?.name ?? DEFAULT_PET;
  return {
    name,
    shownName: init?.shownName ?? name,
    status: init?.status ?? "idle",
    style: init?.style ?? "ascii",
    tick: init?.tick ?? 0,
    since: init?.since,
    flashUntil: init?.flashUntil,
    lastRotatedAt: init?.lastRotatedAt ?? 0,
    sawStop: init?.sawStop ?? false,
    inTurn: init?.inTurn ?? false,
  };
}

/**
 * Pure state reducer for pet transitions. Driven exclusively by supplied observations.
 * No fake thinking inferred from busy alone.
 */
export function stepPetState(state: PetPureState, action: PetAction, now = Date.now()): PetPureState {
  switch (action.type) {
    case "turn_start": {
      const isBusyOrFlashing =
        state.status === "thinking" ||
        state.status === "writing" ||
        state.status === "working" ||
        state.status === "success" ||
        state.status === "error";
      if (isBusyOrFlashing) {
        return { ...state, inTurn: true, sawStop: false };
      }
      const status: PetStatus = action.reasoningObserved ? "thinking" : "working";
      return {
        ...state,
        status,
        since: now,
        flashUntil: undefined,
        inTurn: true,
        sawStop: false,
      };
    }

    case "reasoning_chunk": {
      if (state.status === "thinking") return state;
      return {
        ...state,
        status: "thinking",
        since: now,
        flashUntil: undefined,
      };
    }

    case "text_chunk": {
      if (state.status === "writing") return state;
      return {
        ...state,
        status: "writing",
        since: now,
        flashUntil: undefined,
      };
    }

    case "tool_start": {
      if (state.status === "working") return state;
      return {
        ...state,
        status: "working",
        since: now,
        flashUntil: undefined,
      };
    }

    case "turn_settled": {
      const sawStop = action.sawStop ?? state.sawStop;
      if (action.isError) {
        return {
          ...state,
          status: "error",
          flashUntil: now + PET_FLASH_DELAY,
          inTurn: false,
          sawStop,
        };
      }
      if (sawStop) {
        return {
          ...state,
          status: "success",
          flashUntil: now + PET_FLASH_DELAY,
          inTurn: false,
          sawStop,
        };
      }
      return {
        ...state,
        status: "idle",
        flashUntil: undefined,
        inTurn: false,
        since: undefined,
      };
    }

    case "tick": {
      const tickDelta = action.tickDelta ?? 1;
      const nextTick = state.tick + tickDelta;
      const currentTime = action.now ?? now;

      let nextStatus = state.status;
      let nextFlashUntil = state.flashUntil;
      let nextSince = state.since;
      if (nextFlashUntil !== undefined && currentTime >= nextFlashUntil) {
        nextStatus = "idle";
        nextFlashUntil = undefined;
        nextSince = undefined;
      }

      let nextShown = state.shownName;
      let nextRotatedAt = state.lastRotatedAt ?? currentTime;
      if (state.style !== "classic" && currentTime - nextRotatedAt >= PET_ROTATE_EVERY) {
        nextShown = rotatePet(state.shownName, 1);
        nextRotatedAt = currentTime;
      }

      return {
        ...state,
        tick: nextTick,
        status: nextStatus,
        flashUntil: nextFlashUntil,
        since: nextSince,
        shownName: nextShown,
        lastRotatedAt: nextRotatedAt,
      };
    }

    case "set_pet": {
      const currentTime = action.now ?? now;
      const entry = action.entry.trim();
      if (isClassic(entry)) {
        return { ...state, style: "classic" };
      }
      if (isStyle(entry)) {
        return { ...state, style: "ascii" };
      }
      if (PETS_BY_NAME.has(entry)) {
        return {
          ...state,
          style: "ascii",
          name: entry,
          shownName: entry,
          lastRotatedAt: currentTime,
        };
      }
      return state;
    }

    case "cycle_pet": {
      const currentTime = action.now ?? now;
      const step = action.step ?? 1;
      const nextName = rotatePet(state.shownName, step);
      return {
        ...state,
        shownName: nextName,
        name: nextName,
        style: "ascii",
        lastRotatedAt: currentTime,
        tick: 0,
      };
    }

    default:
      return state;
  }
}
