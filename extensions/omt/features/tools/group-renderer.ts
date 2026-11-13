import type { ToolRenderers, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { isSignatureTheme } from "../../presets/shared/style.ts";
import { signatureFg } from "../../presets/omt-signature/rendering.ts";
import { ToolGroups, toolGroupSummary, type ToolGroup } from "./groups.ts";

const BASE = Symbol("omt.group.base-component");
type Wrapped = Component & { [BASE]?: Component };
function summary(group: ToolGroup, theme: Theme, width: number): string {
  // Share Signature's one-cell inset, independent of native outputPad.
  const pad = Math.min(1, Math.max(0, Math.floor((width - 4) / 2)));
  const inner = Math.max(1, width - 2 * pad);
  const { text, running, failed } = toolGroupSummary(group);
  const hint = group.open ? " (click to collapse)" : " (click to expand)";
  const available = Math.max(8, inner - 2 - visibleWidth(hint));
  const label = theme.bold(signatureFg(theme, "text", truncateToWidth(text, available, "…")));
  const dot = signatureFg(theme, running ? "muted" : failed ? "red" : "green", "●");
  const suffix = visibleWidth(text) <= available ? signatureFg(theme, "muted", hint) : "";
  return " ".repeat(pad) + truncateToWidth(`${dot} ${label}${suffix}`, inner, "");
}

/** Public renderer composition only: native self-shell removes empty follower rows. */
export function createGroupedToolRenderer(name: string, base: ToolRenderers, groups: ToolGroups): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      const previous = (context.lastComponent as Wrapped | undefined)?.[BASE];
      const child = base.renderCall!(args, theme, previous ? { ...context, lastComponent: previous } : context);
      groups.register(context.toolCallId, name, context.isPartial ? "running" : context.isError ? "failure" : "success", context.invalidate);
      const current = () => isSignatureTheme() ? groups.view(context.toolCallId) : undefined;
      const component: Wrapped = {
        [BASE]: child,
        invalidate() { child.invalidate(); },
        render(width) {
          groups.register(context.toolCallId, name, context.isPartial ? "running" : context.isError ? "failure" : "success", context.invalidate);
          const group = current();
          if (!group) return child.render(width);
          const head = group.head === context.toolCallId;
          if (!group.open) return head ? [summary(group, theme, width)] : [];
          return head ? [summary(group, theme, width), ...child.render(width)] : child.render(width);
        },
        handleMouse(event: TuiMouseEvent) {
          const group = current();
          const head = group?.head === context.toolCallId;
          if (head && event.y === 0) {
            if (event.type === "click" && event.button === "left") { groups.toggle(group!.head); return { handled: true, render: true }; }
            return undefined;
          }
          return child.handleMouse?.(head && group?.open ? { ...event, y: event.y - 1 } : event);
        },
      };
      return component;
    },
    renderResult(result, options, theme, context) {
      const previous = (context.lastComponent as Wrapped | undefined)?.[BASE];
      const child = base.renderResult!(result, options, theme, previous ? { ...context, lastComponent: previous } : context);
      const interrupted = !!result.details && typeof result.details === "object" && (result.details as { interrupted?: boolean }).interrupted === true;
      groups.result(context.toolCallId, options.isPartial ? "running" : context.isError || interrupted ? "failure" : "success",
        result.content.some(item => item.type === "image"));
      return {
        [BASE]: child,
        invalidate() { child.invalidate(); },
        render(width: number) {
          const group = isSignatureTheme() ? groups.view(context.toolCallId) : undefined;
          return group && !group.open ? [] : child.render(width);
        },
        handleMouse(event: TuiMouseEvent) { return child.handleMouse?.(event); },
      } as Wrapped;
    },
  };
}
