import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarControl, SidebarState, SidebarOptions } from "./types.ts";
import { SIDE_W, renderSidepanels, fmtNum, DEFAULT_PET, createPetPureState, stepPetState, classicFace, petLabel } from "./sidepanels.ts";
import type { PetStatus } from "./types.ts";
import { extractSidebarState } from "./model.ts";
import { readSidebarMetadata } from "./observations.ts";
import { configStore } from "../../core/config.ts";
import { signatureTheme } from "../../presets/omt-signature/rendering.ts";
import { getActiveTheme } from "../../core/theme.ts";

export * from "./sidepanels.ts";
export * from "./tasks.ts";
export * from "./team.ts";
export {
  fmtDur,
  renderPetAnim,
  renderPetAnimToString,
  PetAnimComponent,
  createPetAnimState,
  stepPetAnim,
  petInterval,
  petSet,
  petAnchor,
  petSettled,
  petFlashMsg,
  petTick,
  setPet,
  isFlashingStatus,
  petRows,
  petArtColorAnsi,
  PET_CADENCE_IDLE,
  PET_CADENCE_BUSY,
  PET_FLASH_DELAY,
  type PetAnimState,
  type PetAnimAction,
  type RenderPetOptions,
} from "./pet-anim.ts";
export {
  extractSidebarState,
  renderPet,
  PETS,
  normalize,
  width,
  ANIM_CYCLE,
  ANIM_CYCLE_BUSY,
  ANIM_BLINK_FROM,
} from "./model.ts";
export type * from "./types.ts";

/**
 * Renders the 15-section OMT sidebar with full fidelity.
 * Preserves backward-compatible default commands visibility while strictly
 * following OMT sideOrder and sidepanels engine.
 */
export function renderSidebar(
  state: SidebarState = {},
  width = SIDE_W,
  theme?: any,
  options?: SidebarOptions,
): string[] {
  const mergedOptions: SidebarOptions = {
    ...options,
    visibleSections: {
      commands: options?.visibleSections?.commands ?? true,
      ...state.visible,
      ...options?.visibleSections,
    },
  };
  return renderSidepanels(state, width, theme, mergedOptions);
}

/** One-column companion. A widget reserves native rows; it never pretends an overlay is a dock. */
export function createSidebarControl(pi?: ExtensionAPI): SidebarControl {
  let enabled = false;
  let docked = false;
  let mountedContext: ExtensionContext | undefined;
  const key = "omt-sidebar";
  const compatible = (ctx: ExtensionContext) =>
    ctx.mode === "tui" && ctx.hasUI && typeof ctx.ui?.setWidget === "function";
  let pet = createPetPureState();
  let lastError = false;
  let openedAt = Date.now();

  const getState = (ctx: ExtensionContext): SidebarState => {
    // Decay flash state if expired
    if (pet.flashUntil && Date.now() >= pet.flashUntil) {
      pet = stepPetState(pet, { type: "tick", now: Date.now() });
    }
    const state = extractSidebarState(ctx, readSidebarMetadata(pi, ctx));
    const prefs = configStore.getSignature();
    const visible = {
      commands: false,
      plugins: false,
      mcp: false,
      cost: true,
      subagents: !!state.subagents?.length,
      ...prefs.visible,
    };
    return {
      ...state,
      stats: state.stats ? { ...state.stats, elapsedMs: Math.max(0, Date.now() - openedAt) } : undefined,
      model: state.model
        ? {
            ...state.model,
            thinkLevel: pi?.getThinkingLevel?.() ?? state.model.thinkLevel,
          }
        : undefined,
      pet: {
        ...pet,
        name: prefs.pet ?? pet.name ?? DEFAULT_PET,
        style: prefs.petStyle ?? pet.style ?? "ascii",
      },
      visible,
      folds: { ...prefs.folds },
    };
  };

  function unmount(): void {
    const ctx = mountedContext;
    mountedContext = undefined; // Retained components become inert before host callbacks run.
    if (ctx) ctx.ui.setWidget(key, undefined);
  }

  return {
    on(ctx) {
      if (!compatible(ctx)) return "OMT sidebar unavailable: TUI widget API required.";
      if (enabled && mountedContext === ctx) return "OMT sidebar on (compact one-column companion).";
      unmount();
      enabled = true;
      mountedContext = ctx;
      ctx.ui.setWidget(key, (_tui, theme) => {
        const colors = getActiveTheme().id === "omt-signature" ? signatureTheme(theme) : theme;
        return {
          invalidate() {},
          render(width) {
            if (!enabled || docked || mountedContext !== ctx || width <= 0) return [];
            const state = getState(ctx);
            const pct = state.context?.percent;
            const context = typeof pct === "number" ? `${Math.round(pct)}% ctx` : "ctx ?";
            const usage = state.stats ? `${fmtNum(state.stats.totalTokens)} tokens` : "usage ?";
            const cost = state.stats?.cost !== undefined ? ` · $${state.stats.cost.toFixed(2)}` : "";
            const petState = state.pet;
            const status = (petState?.status as PetStatus) ?? "idle";
            const face = classicFace(status, petState?.tick ?? 0);
            const pLabel = petLabel(status, petState?.since);
            const petPart = `${colors.fg("accent", face)} ${colors.fg("muted", pLabel)}`;
            const modelPart = colors.fg("text", state.model?.label ?? "no model");
            const metricsPart = colors.fg("dim", `${context} · ${usage}${cost}`);
            const row1 = `${petPart}  ·  ${modelPart}  ·  ${metricsPart}`;
            const row2 = `${colors.fg("dim", "╭─ ")}${colors.fg("muted", "/omt sidebar")}${colors.fg("dim", " — full dashboard · ")}${colors.fg("muted", "/omt settings")}${colors.fg("dim", " · p: pet · m: model")}${colors.fg("dim", " ─╮")}`;
            return [
              truncateToWidth(row1, width, ""),
              truncateToWidth(row2, width, ""),
            ];
          },
        };
      });
      return "OMT sidebar on (compact one-column companion).";
    },
    off(_ctx) {
      enabled = false;
      unmount();
      return "OMT sidebar off.";
    },
    toggle(ctx) {
      return enabled ? this.off(ctx) : this.on(ctx);
    },
    isEnabled: () => enabled,
    getState,
    observe(type, event) {
      const e = event as any;
      if (["session_start", "session_switch", "session_shutdown"].includes(type)) openedAt = Date.now();
      if (["session_start", "session_switch", "session_tree", "session_shutdown"].includes(type)) {
        pet = createPetPureState();
        lastError = false;
        return;
      }
      if (type === "agent_start") {
        const reasoning = pi?.getThinkingLevel?.() && pi.getThinkingLevel() !== "off";
        pet = stepPetState(pet, { type: "turn_start", reasoningObserved: !!reasoning });
        lastError = false;
      }
      if (type === "tool_execution_start") {
        pet = stepPetState(pet, { type: "tool_start" });
      }
      if (type === "tool_execution_end" && e?.isError) {
        lastError = true;
      }
      if (type === "message_update") {
        const kind = e?.assistantMessageEvent?.type;
        if (kind === "thinking_start" || kind === "thinking_delta") {
          pet = stepPetState(pet, { type: "reasoning_chunk" });
        }
        if (kind === "text_start" || kind === "text_delta") {
          pet = stepPetState(pet, { type: "text_chunk" });
        }
        if (kind === "toolcall_start" || kind === "toolcall_delta") {
          pet = stepPetState(pet, { type: "tool_start" });
        }
      }
      if (type === "message_end") {
        if (e?.message?.role === "assistant") {
          const stop = e.message.stopReason;
          if (stop === "stop") {
            pet = { ...pet, sawStop: true };
          } else if (stop === "error") {
            lastError = true;
          }
        }
        if (e?.isError || e?.error) {
          lastError = true;
        }
      }
      if (type === "agent_settled") {
        const isError = lastError || !!e?.isError || !!e?.error;
        pet = stepPetState(pet, { type: "turn_settled", isError, sawStop: pet.sawStop });
      }
    },
    render(state = {}, width = SIDE_W, theme, options) {
      return renderSidebar(state, width, theme, options);
    },
    setDocked(isDocked: boolean, ctx?: ExtensionContext): void {
      docked = isDocked;
      const targetCtx = ctx ?? mountedContext;
      if (targetCtx?.ui && typeof (targetCtx.ui as any).requestRender === "function") {
        (targetCtx.ui as any).requestRender();
      }
    },
    cleanup() {
      enabled = false;
      docked = false;
      unmount();
    },
  };
}
