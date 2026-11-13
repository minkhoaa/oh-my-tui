export const KindRead = "read" as const;
export const KindWrite = "write" as const;
export const KindEdit = "edit" as const;
export const KindShell = "shell" as const;
export const KindDir = "cd" as const;
export const KindSearch = "search" as const;
export const KindOther = "other" as const;

export type ToolKind =
  | typeof KindRead
  | typeof KindWrite
  | typeof KindEdit
  | typeof KindShell
  | typeof KindDir
  | typeof KindSearch
  | typeof KindOther;

export const StatusRunning = "running" as const;
export const StatusSuccess = "success" as const;
export const StatusError = "error" as const;
export const StatusNeutral = "neutral" as const;

export type ToolStatus =
  | typeof StatusRunning
  | typeof StatusSuccess
  | typeof StatusError
  | typeof StatusNeutral;

export interface PaletteSpec {
  rgb: [number, number, number];
  ansi256: number;
  raw: string;
  hex: string;
}

export interface ToolPaletteSlots {
  frame?: string;
  running?: string;
  error?: string;
  read?: string;
  write?: string;
  edit?: string;
  shell?: string;
  dir?: string;
  search?: string;
  other?: string;
}

export interface RawTheme {
  name: string;
  accent: string;
  border: string;
  muted: string;
  text: string;
  code: string;
  green: string;
  red: string;
  yellow: string;
  cyan: string;
  plan?: string;
  input: string;
  inputDim: string;
  toolPending: string;
  toolSuccess: string;
  toolError: string;
  toolNeutral?: string;
  tool?: ToolPaletteSlots;
  hiBg: string;
  hiFg: string;
  light?: boolean;
}

export interface ResolvedToolPalette {
  frame: PaletteSpec;
  running: PaletteSpec;
  error: PaletteSpec;
  read: PaletteSpec;
  write: PaletteSpec;
  edit: PaletteSpec;
  shell: PaletteSpec;
  dir: PaletteSpec;
  search: PaletteSpec;
  other: PaletteSpec;
}

export interface ResolvedPalette {
  name: string;
  light: boolean;
  accent: PaletteSpec;
  border: PaletteSpec;
  muted: PaletteSpec;
  text: PaletteSpec;
  code: PaletteSpec;
  green: PaletteSpec;
  red: PaletteSpec;
  yellow: PaletteSpec;
  cyan: PaletteSpec;
  plan: PaletteSpec;
  input: PaletteSpec;
  inputDim: PaletteSpec;
  toolPending: PaletteSpec;
  toolSuccess: PaletteSpec;
  toolError: PaletteSpec;
  toolNeutral: PaletteSpec;
  tool: ResolvedToolPalette;
  hiBg: PaletteSpec;
  hiFg: PaletteSpec;
  // Aliases and semantic roles matching SignatureColorRole
  shell: PaletteSpec;
  dim: PaletteSpec;
  teal: PaletteSpec;
  indigo: PaletteSpec;
  success: PaletteSpec;
  warning: PaletteSpec;
  error: PaletteSpec;
  surface: PaletteSpec;
  toolFrame: PaletteSpec;
  toolFrameRun: PaletteSpec;
  toolFrameErr: PaletteSpec;
  toolRead: PaletteSpec;
  toolWrite: PaletteSpec;
  toolEdit: PaletteSpec;
  toolShell: PaletteSpec;
  toolDir: PaletteSpec;
  toolSearch: PaletteSpec;
  toolOther: PaletteSpec;
  rawSlots: Record<string, string>;
}

export interface Background {
  name: string;
  dark: string;
  light: string;
}

const ANSI16_RGB: [number, number, number][] = [
  [0, 0, 0],
  [205, 0, 0],
  [0, 205, 0],
  [205, 205, 0],
  [0, 0, 238],
  [205, 0, 205],
  [0, 205, 205],
  [229, 229, 229],
  [127, 127, 127],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [92, 92, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

export function ansi256ToRgb(i: number): [number, number, number] {
  if (i < 0) return [0, 0, 0];
  if (i < 16) return ANSI16_RGB[i] ?? [0, 0, 0];
  if (i >= 232) {
    const v = Math.min(255, (i - 232) * 10 + 8);
    return [v, v, v];
  }
  const idx = i - 16;
  const b = idx % 6;
  const g = Math.floor(idx / 6) % 6;
  const r = Math.floor(idx / 36);
  const cv = (n: number) => (n === 0 ? 0 : 55 + 40 * n);
  return [cv(r), cv(g), cv(b)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return [r, g, b];
  }
  const num = parseInt(clean, 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToAnsi256(r: number, g: number, b: number): number {
  const v2ci = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const cr = v2ci(r);
  const cg = v2ci(g);
  const cb = v2ci(b);
  const ci = 36 * cr + 6 * cg + cb;

  const i2cv = [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  const rColor = i2cv[cr];
  const gColor = i2cv[cg];
  const bColor = i2cv[cb];

  const avg = (r + g + b) / 3;
  let grayIdx = 0;
  if (avg > 238) {
    grayIdx = 23;
  } else {
    grayIdx = Math.max(0, Math.floor((avg - 3) / 10));
  }
  const gv = 8 + 10 * grayIdx;

  const colorDist = (r - rColor) ** 2 + (g - gColor) ** 2 + (b - bColor) ** 2;
  const grayDist = (r - gv) ** 2 + (g - gv) ** 2 + (b - gv) ** 2;
  if (colorDist <= grayDist) {
    return 16 + ci;
  }
  return 232 + grayIdx;
}

export function parseColorSpec(raw: string, explicitAnsi256?: number): PaletteSpec {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { rgb: [0, 0, 0], ansi256: 0, raw: "", hex: "#000000" };
  }
  if (/^\d+$/.test(trimmed)) {
    const ansi = parseInt(trimmed, 10);
    const rgb = ansi256ToRgb(ansi);
    return {
      rgb,
      ansi256: explicitAnsi256 !== undefined ? explicitAnsi256 : ansi,
      raw: trimmed,
      hex: rgbToHex(...rgb),
    };
  }
  const rgb = hexToRgb(trimmed);
  const ansi256 = explicitAnsi256 !== undefined ? explicitAnsi256 : rgbToAnsi256(...rgb);
  return {
    rgb,
    ansi256,
    raw: trimmed,
    hex: rgbToHex(...rgb),
  };
}

export const BUILTIN_THEMES: readonly RawTheme[] = [
  {
    name: "default",
    accent: "15",
    border: "240",
    muted: "243",
    text: "252",
    code: "250",
    green: "114",
    red: "203",
    yellow: "11",
    cyan: "6",
    input: "252",
    inputDim: "240",
    toolPending: "#282832",
    toolSuccess: "#283228",
    toolError: "#3c2828",
    toolNeutral: "#2b2b33",
    hiBg: "238",
    hiFg: "15",
    plan: "13",
  },
  {
    name: "one-dark",
    accent: "#61AFEF",
    border: "#3E4451",
    muted: "#5C6370",
    text: "#ABB2BF",
    code: "#ABB2BF",
    green: "#98C379",
    red: "#E06C75",
    yellow: "#E5C07B",
    cyan: "#56B6C2",
    input: "#61AFEF",
    inputDim: "#5C6370",
    toolPending: "#2C323C",
    toolSuccess: "#2C3A2E",
    toolError: "#3E2C2C",
    hiBg: "#3E4451",
    hiFg: "#ABB2BF",
    plan: "#C678DD",
  },
  {
    name: "gruvbox",
    accent: "#FABD2F",
    border: "#504945",
    muted: "#928374",
    text: "#EBDBB2",
    code: "#EBDBB2",
    green: "#B8BB26",
    red: "#FB4934",
    yellow: "#FABD2F",
    cyan: "#83A598",
    input: "#FABD2F",
    inputDim: "#928374",
    toolPending: "#3C3836",
    toolSuccess: "#32361A",
    toolError: "#3C1F1A",
    hiBg: "#3C3836",
    hiFg: "#EBDBB2",
    plan: "#B16286",
  },
  {
    name: "dracula",
    accent: "#BD93F9",
    border: "#44475A",
    muted: "#6272A4",
    text: "#F8F8F2",
    code: "#F8F8F2",
    green: "#50FA7B",
    red: "#FF5555",
    yellow: "#F1FA8C",
    cyan: "#8BE9FD",
    input: "#BD93F9",
    inputDim: "#6272A4",
    toolPending: "#343746",
    toolSuccess: "#2C3E35",
    toolError: "#422C33",
    hiBg: "#44475A",
    hiFg: "#F8F8F2",
    plan: "#BD93F9",
  },
  {
    name: "tokyo-night",
    accent: "#7AA2F7",
    border: "#414868",
    muted: "#565F89",
    text: "#C0CAF5",
    code: "#C0CAF5",
    green: "#9ECE6A",
    red: "#F7768E",
    yellow: "#E0AF68",
    cyan: "#7DCFFF",
    input: "#7AA2F7",
    inputDim: "#565F89",
    toolPending: "#24283B",
    toolSuccess: "#26332A",
    toolError: "#3A2733",
    hiBg: "#414868",
    hiFg: "#C0CAF5",
    plan: "#BB9AF7",
  },
  {
    name: "nord",
    accent: "#88C0D0",
    border: "#3B4252",
    muted: "#616E88",
    text: "#ECEFF4",
    code: "#D8DEE9",
    green: "#A3BE8C",
    red: "#BF616A",
    yellow: "#EBCB8B",
    cyan: "#88C0D0",
    input: "#88C0D0",
    inputDim: "#616E88",
    toolPending: "#3B4252",
    toolSuccess: "#39452F",
    toolError: "#463039",
    hiBg: "#434C5E",
    hiFg: "#ECEFF4",
    plan: "#B48EAD",
  },
  {
    name: "catppuccin-mocha",
    accent: "#CBA6F7",
    border: "#313244",
    muted: "#6C7086",
    text: "#CDD6F4",
    code: "#BAC2DE",
    green: "#A6E3A1",
    red: "#F38BA8",
    yellow: "#F9E2AF",
    cyan: "#89DCEB",
    input: "#CBA6F7",
    inputDim: "#6C7086",
    toolPending: "#313244",
    toolSuccess: "#24382C",
    toolError: "#3D2A35",
    hiBg: "#45475A",
    hiFg: "#CDD6F4",
    plan: "#CBA6F7",
  },
  {
    name: "catppuccin-latte",
    accent: "#8839EF",
    border: "#CCD0DA",
    muted: "#9CA0B0",
    text: "#4C4F69",
    code: "#5C5F77",
    green: "#40A02B",
    red: "#D20F39",
    yellow: "#DF8E1D",
    cyan: "#04A5E5",
    input: "#8839EF",
    inputDim: "#9CA0B0",
    toolPending: "#E6E9EF",
    toolSuccess: "#DCEBDA",
    toolError: "#F3DCE0",
    toolNeutral: "#EFF1F5",
    hiBg: "#BCC0CC",
    hiFg: "#4C4F69",
    plan: "#8839EF",
    light: true,
  },
  {
    name: "solarized-dark",
    accent: "#268BD2",
    border: "#073642",
    muted: "#586E75",
    text: "#839496",
    code: "#93A1A1",
    green: "#859900",
    red: "#DC322F",
    yellow: "#B58900",
    cyan: "#2AA198",
    input: "#268BD2",
    inputDim: "#586E75",
    toolPending: "#073642",
    toolSuccess: "#0F2F1E",
    toolError: "#331313",
    hiBg: "#073642",
    hiFg: "#93A1A1",
    plan: "#6C71C4",
  },
  {
    name: "solarized-light",
    accent: "#268BD2",
    border: "#EEE8D5",
    muted: "#93A1A1",
    text: "#657B83",
    code: "#586E75",
    green: "#859900",
    red: "#DC322F",
    yellow: "#B58900",
    cyan: "#2AA198",
    input: "#268BD2",
    inputDim: "#93A1A1",
    toolPending: "#EEE8D5",
    toolSuccess: "#E6EBD3",
    toolError: "#F0D9D2",
    hiBg: "#EEE8D5",
    hiFg: "#586E75",
    plan: "#6C71C4",
    light: true,
  },
  {
    name: "monokai",
    accent: "#AB9DF2",
    border: "#403E41",
    muted: "#727072",
    text: "#FCFCFA",
    code: "#F8F8F2",
    green: "#A9DC76",
    red: "#FF6188",
    yellow: "#FFD866",
    cyan: "#78DCE8",
    input: "#AB9DF2",
    inputDim: "#727072",
    toolPending: "#383733",
    toolSuccess: "#2E3A24",
    toolError: "#3E242C",
    hiBg: "#403E41",
    hiFg: "#FCFCFA",
    plan: "#AB9DF2",
  },
  {
    name: "github-dark",
    accent: "#4493F8",
    border: "#30363D",
    muted: "#7D8590",
    text: "#E6EDF3",
    code: "#E6EDF3",
    green: "#3FB950",
    red: "#F85149",
    yellow: "#D29922",
    cyan: "#39C5CF",
    input: "#4493F8",
    inputDim: "#7D8590",
    toolPending: "#161B22",
    toolSuccess: "#12261A",
    toolError: "#2E1517",
    hiBg: "#21262D",
    hiFg: "#E6EDF3",
    plan: "#D2A8FF",
  },
  {
    name: "github-light",
    accent: "#0969DA",
    border: "#D1D9E0",
    muted: "#59636E",
    text: "#1F2328",
    code: "#1F2328",
    green: "#1A7F37",
    red: "#D1242F",
    yellow: "#9A6700",
    cyan: "#0A7EA4",
    input: "#0969DA",
    inputDim: "#59636E",
    toolPending: "#EAEEF2",
    toolSuccess: "#DAFBE1",
    toolError: "#FFEBE9",
    hiBg: "#E3E8EE",
    hiFg: "#1F2328",
    plan: "#8250DF",
    light: true,
  },
  {
    name: "ayu-dark",
    accent: "#FF8F40",
    border: "#1F2733",
    muted: "#626A73",
    text: "#B3B1AD",
    code: "#B3B1AD",
    green: "#AAD94C",
    red: "#F26D78",
    yellow: "#E6B450",
    cyan: "#39BAE6",
    input: "#FF8F40",
    inputDim: "#626A73",
    toolPending: "#131721",
    toolSuccess: "#1D2B1A",
    toolError: "#2E1B1E",
    hiBg: "#1F2733",
    hiFg: "#B3B1AD",
    plan: "#D2A6FF",
  },
  {
    name: "palenight",
    accent: "#C792EA",
    border: "#3A3F58",
    muted: "#676E95",
    text: "#A6ACCD",
    code: "#A6ACCD",
    green: "#C3E88D",
    red: "#F07178",
    yellow: "#FFCB6B",
    cyan: "#89DDFF",
    input: "#C792EA",
    inputDim: "#676E95",
    toolPending: "#333747",
    toolSuccess: "#2B3A28",
    toolError: "#3D2A33",
    hiBg: "#3A3F58",
    hiFg: "#A6ACCD",
    plan: "#C792EA",
  },
  {
    name: "material-darker",
    accent: "#82AAFF",
    border: "#2A2A2A",
    muted: "#545454",
    text: "#EEFFFF",
    code: "#B2CCD6",
    green: "#C3E88D",
    red: "#F07178",
    yellow: "#FFCB6B",
    cyan: "#89DDFF",
    input: "#82AAFF",
    inputDim: "#545454",
    toolPending: "#2A2A2A",
    toolSuccess: "#243026",
    toolError: "#332527",
    tool: { other: "#8A8A8A" },
    hiBg: "#303030",
    hiFg: "#EEFFFF",
    plan: "#C792EA",
  },
  {
    name: "everforest",
    accent: "#D699B6",
    border: "#3D484D",
    muted: "#859289",
    text: "#D3C6AA",
    code: "#D3C6AA",
    green: "#A7C080",
    red: "#E67E80",
    yellow: "#DBBC7F",
    cyan: "#7FBBB3",
    input: "#D699B6",
    inputDim: "#859289",
    toolPending: "#343F44",
    toolSuccess: "#333D2A",
    toolError: "#3E2F33",
    hiBg: "#3D484D",
    hiFg: "#D3C6AA",
    plan: "#D699B6",
  },
  {
    name: "kanagawa",
    accent: "#7E9CD8",
    border: "#2A2A37",
    muted: "#727169",
    text: "#DCD7BA",
    code: "#DCD7BA",
    green: "#98BB6C",
    red: "#E46876",
    yellow: "#E6C384",
    cyan: "#7FB4CA",
    input: "#7E9CD8",
    inputDim: "#727169",
    toolPending: "#23232D",
    toolSuccess: "#263020",
    toolError: "#332026",
    hiBg: "#2A2A37",
    hiFg: "#DCD7BA",
    plan: "#957FB8",
  },
  {
    name: "rose-pine",
    accent: "#C4A7E7",
    border: "#26233A",
    muted: "#6E6A86",
    text: "#E0DEF4",
    code: "#908CAA",
    green: "#9CCFD8",
    red: "#EB6F92",
    yellow: "#F6C177",
    cyan: "#31748F",
    input: "#C4A7E7",
    inputDim: "#6E6A86",
    toolPending: "#1F1D2E",
    toolSuccess: "#1E2E2C",
    toolError: "#2E222E",
    hiBg: "#26233A",
    hiFg: "#E0DEF4",
    plan: "#C4A7E7",
  },
  {
    name: "rose-pine-dawn",
    accent: "#907AA9",
    border: "#DFDAD9",
    muted: "#797593",
    text: "#575279",
    code: "#575279",
    green: "#56949F",
    red: "#B4637A",
    yellow: "#EA9D34",
    cyan: "#286983",
    input: "#907AA9",
    inputDim: "#797593",
    toolPending: "#F2E9DE",
    toolSuccess: "#DDE8D5",
    toolError: "#EAD9DB",
    hiBg: "#DFDAD9",
    hiFg: "#575279",
    plan: "#907AA9",
    light: true,
  },
  {
    name: "gruvbox-light",
    accent: "#AF3A03",
    border: "#D5C4A1",
    muted: "#928374",
    text: "#3C3836",
    code: "#3C3836",
    green: "#79740E",
    red: "#9D0006",
    yellow: "#B57614",
    cyan: "#076678",
    input: "#AF3A03",
    inputDim: "#928374",
    toolPending: "#EBDBB2",
    toolSuccess: "#DEE3C0",
    toolError: "#EACFC4",
    hiBg: "#D5C4A1",
    hiFg: "#3C3836",
    plan: "#8F3F71",
    light: true,
  },
  {
    name: "one-light",
    accent: "#4078F2",
    border: "#E5E5E6",
    muted: "#A0A1A7",
    text: "#383A42",
    code: "#383A42",
    green: "#50A14F",
    red: "#E45649",
    yellow: "#C18401",
    cyan: "#0184BC",
    input: "#4078F2",
    inputDim: "#A0A1A7",
    toolPending: "#ECECEC",
    toolSuccess: "#DCEBDA",
    toolError: "#F2DADA",
    hiBg: "#E5E5E6",
    hiFg: "#383A42",
    plan: "#A626A4",
    light: true,
  },
  {
    name: "zenburn",
    accent: "#8CD0D3",
    border: "#4F4F4F",
    muted: "#7F7F7F",
    text: "#DCDCCC",
    code: "#DCDCCC",
    green: "#7F9F7F",
    red: "#CC9393",
    yellow: "#E0CF9F",
    cyan: "#93E0E3",
    input: "#8CD0D3",
    inputDim: "#7F7F7F",
    toolPending: "#4A4A4A",
    toolSuccess: "#43513F",
    toolError: "#524242",
    tool: { other: "#BFBFBF" },
    hiBg: "#4F4F4F",
    hiFg: "#DCDCCC",
    plan: "#DC8CC3",
  },
  {
    name: "tomorrow-night",
    accent: "#81A2BE",
    border: "#282A2E",
    muted: "#969896",
    text: "#C5C8C6",
    code: "#C5C8C6",
    green: "#B5BD68",
    red: "#CC6666",
    yellow: "#F0C674",
    cyan: "#8ABEB7",
    input: "#81A2BE",
    inputDim: "#969896",
    toolPending: "#282A2E",
    toolSuccess: "#232B20",
    toolError: "#2E1F20",
    hiBg: "#373B41",
    hiFg: "#C5C8C6",
    plan: "#B294BB",
  },
  {
    name: "tokyo-storm",
    accent: "#7AA2F7",
    border: "#24283B",
    muted: "#565F89",
    text: "#C0CAF5",
    code: "#C0CAF5",
    green: "#9ECE6A",
    red: "#F7768E",
    yellow: "#E0AF68",
    cyan: "#7DCFFF",
    input: "#7AA2F7",
    inputDim: "#565F89",
    toolPending: "#1F2335",
    toolSuccess: "#222B1F",
    toolError: "#2F2129",
    hiBg: "#292E42",
    hiFg: "#C0CAF5",
    plan: "#BB9AF7",
  },
];

export const TRANSPARENT_BACKGROUND = "transparent" as const;

export const BACKGROUNDS: readonly Background[] = [
  { name: "aura", dark: "#0f0f0f", light: "#0f0f0f" },
  { name: "ayu", dark: "#0B0E14", light: "#0B0E14" },
  { name: "carbonfox", dark: "#161616", light: "#ffffff" },
  { name: "catppuccin", dark: "#1e1e2e", light: "#eff1f5" },
  { name: "catppuccin-frappe", dark: "#303446", light: "#303446" },
  { name: "catppuccin-macchiato", dark: "#24273a", light: "#24273a" },
  { name: "cobalt2", dark: "#193549", light: "#ffffff" },
  { name: "cursor", dark: "#181818", light: "#fcfcfc" },
  { name: "dracula", dark: "#282a36", light: "#f8f8f2" },
  { name: "everforest", dark: "#2d353b", light: "#fdf6e3" },
  { name: "flexoki", dark: "#100F0F", light: "#FFFCF0" },
  { name: "github", dark: "#0d1117", light: "#ffffff" },
  { name: "gruvbox", dark: "#282828", light: "#fbf1c7" },
  { name: "kanagawa", dark: "#1F1F28", light: "#F2E9DE" },
  { name: "material", dark: "#263238", light: "#fafafa" },
  { name: "matrix", dark: "#0a0e0a", light: "#eef3ea" },
  { name: "mercury", dark: "#171721", light: "#ffffff" },
  { name: "monokai", dark: "#272822", light: "#fafafa" },
  { name: "nightowl", dark: "#011627", light: "#011627" },
  { name: "nord", dark: "#2E3440", light: "#ECEFF4" },
  { name: "one-dark", dark: "#282c34", light: "#fafafa" },
  { name: "rail", dark: "#0a0a0a", light: "#ffffff" },
  { name: "osaka-jade", dark: "#111c18", light: "#F6F5DD" },
  { name: "palenight", dark: "#292d3e", light: "#fafafa" },
  { name: "rosepine", dark: "#191724", light: "#faf4ed" },
  { name: "solarized", dark: "#002b36", light: "#fdf6e3" },
  { name: "synthwave84", dark: "#262335", light: "#fafafa" },
  { name: "tokyonight", dark: "#1a1b26", light: "#e1e2e7" },
  { name: "vercel", dark: "#000000", light: "#FFFFFF" },
  { name: "vesper", dark: "#101010", light: "#FFFFFF" },
  { name: "zenburn", dark: "#3f3f3f", light: "#ffffef" },
];

export function getBackgroundNames(): string[] {
  return [TRANSPARENT_BACKGROUND, ...BACKGROUNDS.map((b) => b.name)];
}

export function getBackgroundHex(name: string, light: boolean): string {
  if (!name) return "";
  const n = normalizePaletteName(name);
  if (n === TRANSPARENT_BACKGROUND) return "";
  const bg = BACKGROUNDS.find((b) => b.name === n);
  if (bg) return light ? bg.light : bg.dark;
  const noDash = n.replaceAll("-", "");
  const fuzzy = BACKGROUNDS.find((b) => b.name.replaceAll("-", "") === noDash);
  if (fuzzy) return light ? fuzzy.light : fuzzy.dark;
  return "";
}

export function normalizePaletteName(s: string): string {
  let norm = s.toLowerCase().trim();
  norm = norm.replaceAll("_", "-");
  norm = norm.replaceAll(" ", "-");
  return norm;
}

export function getPaletteNames(): string[] {
  return BUILTIN_THEMES.map((t) => t.name);
}

export function isValidPaletteName(name: string): boolean {
  const norm = normalizePaletteName(name);
  if (BUILTIN_THEMES.some((t) => t.name === norm)) return true;
  const noDash = norm.replaceAll("-", "");
  return BUILTIN_THEMES.some((t) => t.name.replaceAll("-", "") === noDash);
}

export function getRawPalette(name: string): RawTheme {
  const norm = normalizePaletteName(name);
  const exact = BUILTIN_THEMES.find((t) => t.name === norm);
  if (exact) return exact;
  const noDash = norm.replaceAll("-", "");
  const fuzzy = BUILTIN_THEMES.find((t) => t.name.replaceAll("-", "") === noDash);
  if (fuzzy) return fuzzy;
  return BUILTIN_THEMES[0]!;
}

// Explicit overrides to ensure 100% exact numerical match with legacy specs
const DEFAULT_SPEC_EXACT: Record<string, number> = {
  accent: 15,
  border: 240,
  muted: 243,
  text: 252,
  code: 250,
  green: 114,
  red: 203,
  yellow: 11,
  cyan: 6,
  plan: 13,
  input: 252,
  inputDim: 240,
  toolPending: 236,
  toolSuccess: 236,
  toolError: 237,
  toolNeutral: 236,
  hiBg: 238,
  hiFg: 15,
};

const ONE_DARK_SPEC_EXACT: Record<string, number> = {
  accent: 75,
  border: 238,
  muted: 241,
  text: 249,
  code: 249,
  green: 114,
  red: 168,
  yellow: 180,
  cyan: 73,
  plan: 176,
  input: 75,
  inputDim: 241,
  toolPending: 237,
  toolSuccess: 237,
  toolError: 237,
  hiBg: 238,
  hiFg: 249,
};

const LATTE_SPEC_EXACT: Record<string, number> = {
  accent: 99,
  border: 251,
  muted: 247,
  text: 239,
  code: 60,
  green: 28,
  red: 160,
  yellow: 172,
  cyan: 38,
  plan: 99,
  input: 99,
  inputDim: 247,
  toolPending: 254,
  toolSuccess: 253,
  toolError: 253,
  toolNeutral: 255,
  hiBg: 250,
  hiFg: 239,
};

export function resolvePalette(raw: RawTheme): ResolvedPalette {
  const planVal = raw.plan && raw.plan !== "" ? raw.plan : "13";
  const toolNeutralVal = raw.toolNeutral && raw.toolNeutral !== "" ? raw.toolNeutral : raw.toolPending;

  const toolRaw = raw.tool ?? {};
  const frameVal = toolRaw.frame && toolRaw.frame !== "" ? toolRaw.frame : raw.border;
  const runningVal = toolRaw.running && toolRaw.running !== "" ? toolRaw.running : raw.muted;
  const errorVal = toolRaw.error && toolRaw.error !== "" ? toolRaw.error : raw.red;
  const readVal = toolRaw.read && toolRaw.read !== "" ? toolRaw.read : raw.cyan;
  const writeVal = toolRaw.write && toolRaw.write !== "" ? toolRaw.write : raw.green;
  const editVal = toolRaw.edit && toolRaw.edit !== "" ? toolRaw.edit : raw.yellow;
  const shellVal = toolRaw.shell && toolRaw.shell !== "" ? toolRaw.shell : raw.accent;
  const dirVal = toolRaw.dir && toolRaw.dir !== "" ? toolRaw.dir : raw.code;
  const searchVal = toolRaw.search && toolRaw.search !== "" ? toolRaw.search : raw.text;
  const otherVal = toolRaw.other && toolRaw.other !== "" ? toolRaw.other : raw.muted;

  const overrides =
    raw.name === "default"
      ? DEFAULT_SPEC_EXACT
      : raw.name === "one-dark"
        ? ONE_DARK_SPEC_EXACT
        : raw.name === "catppuccin-latte"
          ? LATTE_SPEC_EXACT
          : {};

  const makeSpec = (val: string, key?: string) => parseColorSpec(val, key ? overrides[key] : undefined);

  const accent = makeSpec(raw.accent, "accent");
  const border = makeSpec(raw.border, "border");
  const muted = makeSpec(raw.muted, "muted");
  const text = makeSpec(raw.text, "text");
  const code = makeSpec(raw.code, "code");
  const green = makeSpec(raw.green, "green");
  const red = makeSpec(raw.red, "red");
  const yellow = makeSpec(raw.yellow, "yellow");
  const cyan = makeSpec(raw.cyan, "cyan");
  const plan = makeSpec(planVal, "plan");
  const input = makeSpec(raw.input, "input");
  const inputDim = makeSpec(raw.inputDim, "inputDim");
  const toolPending = makeSpec(raw.toolPending, "toolPending");
  const toolSuccess = makeSpec(raw.toolSuccess, "toolSuccess");
  const toolError = makeSpec(raw.toolError, "toolError");
  const toolNeutral = makeSpec(toolNeutralVal, "toolNeutral");
  const hiBg = makeSpec(raw.hiBg, "hiBg");
  const hiFg = makeSpec(raw.hiFg, "hiFg");

  const tool: ResolvedToolPalette = {
    frame: makeSpec(frameVal),
    running: makeSpec(runningVal),
    error: makeSpec(errorVal),
    read: makeSpec(readVal),
    write: makeSpec(writeVal),
    edit: makeSpec(editVal),
    shell: makeSpec(shellVal),
    dir: makeSpec(dirVal),
    search: makeSpec(searchVal),
    other: makeSpec(otherVal),
  };

  const rawSlots: Record<string, string> = {
    accent: raw.accent,
    border: raw.border,
    muted: raw.muted,
    text: raw.text,
    code: raw.code,
    green: raw.green,
    red: raw.red,
    yellow: raw.yellow,
    cyan: raw.cyan,
    plan: planVal,
    input: raw.input,
    inputDim: raw.inputDim,
    toolPending: raw.toolPending,
    toolSuccess: raw.toolSuccess,
    toolError: raw.toolError,
    toolNeutral: toolNeutralVal,
    hiBg: raw.hiBg,
    hiFg: raw.hiFg,
    "tool.frame": frameVal,
    "tool.running": runningVal,
    "tool.error": errorVal,
    "tool.read": readVal,
    "tool.write": writeVal,
    "tool.edit": editVal,
    "tool.shell": shellVal,
    "tool.dir": dirVal,
    "tool.search": searchVal,
    "tool.other": otherVal,
  };

  return {
    name: raw.name,
    light: Boolean(raw.light),
    accent,
    border,
    muted,
    text,
    code,
    green,
    red,
    yellow,
    cyan,
    plan,
    input,
    inputDim,
    toolPending,
    toolSuccess,
    toolError,
    toolNeutral,
    tool,
    hiBg,
    hiFg,
    // Aliases
    shell: cyan,
    dim: muted,
    teal: cyan,
    indigo: plan,
    success: green,
    warning: yellow,
    error: red,
    surface: hiBg,
    toolFrame: tool.frame,
    toolFrameRun: tool.running,
    toolFrameErr: tool.error,
    toolRead: tool.read,
    toolWrite: tool.write,
    toolEdit: tool.edit,
    toolShell: tool.shell,
    toolDir: tool.dir,
    toolSearch: tool.search,
    toolOther: tool.other,
    rawSlots,
  };
}

export function getPalette(name?: string): ResolvedPalette {
  const raw = getRawPalette(name ?? "");
  return resolvePalette(raw);
}

export function normTool(tool: string): string {
  const t = tool.toLowerCase().trim();
  const i = Math.max(t.lastIndexOf("."), t.lastIndexOf(":"), t.lastIndexOf("/"));
  if (i >= 0 && i + 1 < t.length) {
    return t.slice(i + 1);
  }
  return t;
}

export function toolKind(tool: string): ToolKind {
  switch (normTool(tool)) {
    case "read":
    case "view":
    case "cat":
    case "readfile":
    case "readmanyfiles":
    case "notebookread":
      return KindRead;
    case "write":
    case "create":
    case "new":
    case "createfile":
    case "writefile":
    case "mkdir":
      return KindWrite;
    case "edit":
    case "multiedit":
    case "patch":
    case "replace":
    case "strreplace":
    case "strreplaceeditor":
      return KindEdit;
    case "bash":
    case "powershell":
    case "shell":
    case "sh":
    case "zsh":
    case "run":
    case "runcommand":
    case "exec":
    case "terminal":
    case "bashoutput":
      return KindShell;
    case "cd":
    case "chdir":
    case "changedir":
    case "workdir":
      return KindDir;
    case "grep":
    case "ffgrep":
    case "search":
    case "glob":
    case "fffind":
    case "find":
    case "ls":
    case "list":
    case "listdir":
    case "tree":
      return KindSearch;
    default:
      return KindOther;
  }
}

export function toolStatusClass(status: string): ToolStatus {
  switch (status.toLowerCase().trim()) {
    case "done":
    case "ok":
    case "success":
    case "succeeded":
    case "complete":
    case "completed":
      return StatusSuccess;
    case "error":
    case "failed":
    case "failure":
    case "fail":
      return StatusError;
    case "":
    case "running":
    case "pending":
    case "queued":
    case "started":
    case "streaming":
    case "in_progress":
    case "inprogress":
      return StatusRunning;
    default:
      return StatusNeutral;
  }
}

function resolvePal(palette?: string | ResolvedPalette): ResolvedPalette {
  if (typeof palette === "string") return getPalette(palette);
  if (palette && typeof palette === "object" && "tool" in palette) return palette;
  return getPalette("default");
}

export function toolAccent(tool: string, palette?: string | ResolvedPalette): PaletteSpec {
  const p = resolvePal(palette);
  const k = toolKind(tool);
  switch (k) {
    case KindRead:
      return p.tool.read;
    case KindWrite:
      return p.tool.write;
    case KindEdit:
      return p.tool.edit;
    case KindShell:
      return p.tool.shell;
    case KindDir:
      return p.tool.dir;
    case KindSearch:
      return p.tool.search;
    case KindOther:
    default:
      return p.tool.other;
  }
}

export function toolFrame(status: string, palette?: string | ResolvedPalette): PaletteSpec {
  const p = resolvePal(palette);
  const cls = toolStatusClass(status);
  switch (cls) {
    case StatusError:
      return p.tool.error;
    case StatusRunning:
      return p.tool.running;
    case StatusSuccess:
    case StatusNeutral:
    default:
      return p.tool.frame;
  }
}

export function toolFill(status: string, palette?: string | ResolvedPalette): PaletteSpec {
  const p = resolvePal(palette);
  const cls = toolStatusClass(status);
  switch (cls) {
    case StatusSuccess:
      return p.toolSuccess;
    case StatusError:
      return p.toolError;
    case StatusRunning:
      return p.toolPending;
    case StatusNeutral:
    default:
      return p.toolNeutral;
  }
}

export function blockThemeFor(
  status: string,
  palette?: string | ResolvedPalette,
): { frame: PaletteSpec; fill: PaletteSpec } {
  return {
    frame: toolFrame(status, palette),
    fill: toolFill(status, palette),
  };
}

export function toolBorder(status: string, palette?: string | ResolvedPalette): PaletteSpec {
  return toolFrame(status, palette);
}
