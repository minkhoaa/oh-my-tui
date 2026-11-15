import type { ThemeBg, ThemeColor } from "@earendil-works/pi-coding-agent";
import type {
  RailGlyphsContract,
  BadgeStylesContract,
  GaugeTokensContract,
  ReasoningTokensContract,
  ObsidianBrandContract,
  RailGlyphSet,
  RailState,
  RailGlyphVariant,
  BadgeVariant,
  DegradationLevel,
} from "../../core/theme-tokens.ts";

export type {
  RailGlyphsContract,
  BadgeStylesContract,
  GaugeTokensContract,
  ReasoningTokensContract,
  ObsidianBrandContract,
  RailGlyphSet,
  RailState,
  RailGlyphVariant,
  BadgeVariant,
  DegradationLevel,
};

export type ThemeName = "omt-signature" | "omt-obsidian" | "omt-clean" | "omt-ember" | "omt-rail" | "minimal" | "native";
export interface ThemePreset {
  readonly id: ThemeName;
  readonly label: string;
  readonly color: {
    readonly text: ThemeColor;
    readonly secondary: ThemeColor;
    readonly quiet: ThemeColor;
    readonly prompt: ThemeColor;
    readonly panel: ThemeBg;
    readonly success: ThemeColor;
    readonly warning: ThemeColor;
    readonly error: ThemeColor;
    readonly border: ThemeColor;
  };
  readonly spacing: {
    readonly content: number;
    readonly inset: number;
    readonly gap: string;
    readonly separator: string;
  };
  readonly glyph: {
    readonly prompt: string;
    readonly running: string;
    readonly success: string;
    readonly failure: string;
    readonly interrupted: string;
    readonly branch?: string;
  };
  readonly thinking: {
    readonly indicator: string;
    readonly label: string;
  };
  readonly editor: {
    readonly frame: "blank" | "line" | "native";
  };
  readonly panelBg: boolean;
  readonly tokens?: {
    readonly rail?: RailGlyphSet;
    readonly badge?: BadgeVariant;
    readonly brand?: ObsidianBrandContract;
  };
}


export interface AssistantHost {
  hasToolCalls?: boolean;
  isStreaming?: boolean;
  hiddenThinkingLabel?: string;
  lastMessage?: { stopReason?: string; errorMessage?: string; model?: string; provider?: string; content?: { type: string }[] };
}
export interface EditorRenderData {
  lines: string[];
  width: number;
  boxHeight: number;
  padding: number;
  text: string;
  metadata: string;
}
