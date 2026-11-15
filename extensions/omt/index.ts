// Oh My TUI: sole Pi entrypoint (presentation-only extension, zero core mutations).
// Runtime owns lifecycle; theme-tokens export Obsidian Studio contracts.
export { default } from "./integration/runtime.ts";
export * from "./core/theme-tokens.ts";
