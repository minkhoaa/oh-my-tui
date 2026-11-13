import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { validateManifest, validateStoredScene, type DeclarativeScene } from "./manifest.ts";
import { getImageDimensions } from "@earendil-works/pi-tui";

export const ASSET_LIMITS = Object.freeze({ sourceBytes: 8 * 1024 * 1024, pixels: 16_000_000, dimension: 8192, count: 64, width: 320, height: 180, decodedBytes: 24 * 1024 * 1024 });
export type BackgroundFit = "cover" | "contain" | "center" | "tile";
export function backgroundError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 240);
}
export interface BackgroundAsset {
  version: 1;
  id: string;
  name: string;
  alias?: string;
  kind: "image" | "animation" | "scene" | "pack";
  scene?: DeclarativeScene;
  imageIds?: string[];
  format: string;
  sourceBytes: number;
  width: number;
  height: number;
  frameCount: number;
  frameMs: number;
  loops: number;
  importedAt: string;
}
export interface LoadedBackground { metadata: BackgroundAsset; pixels: Buffer }
const ID = /^[a-f0-9]{64}$/;
export function isAssetId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }

export interface BuiltinCatalogEntry {
  alias: string;
  source?: string;
  framesSha256: string;
  metadata: BackgroundAsset;
}

export interface BuiltinCatalog {
  version: 1;
  backgrounds: BuiltinCatalogEntry[];
}

const BUILTIN_DIR = fileURLToPath(new URL("../../../backgrounds", import.meta.url));
let builtinCatalogCache: BuiltinCatalog | null | undefined;

export function getBuiltinCatalog(): BuiltinCatalog | null {
  if (builtinCatalogCache !== undefined) return builtinCatalogCache;
  const catalogPath = join(BUILTIN_DIR, "catalog.json");
  try {
    if (existsSync(catalogPath)) {
      const parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as BuiltinCatalog;
      if (parsed.version === 1 && Array.isArray(parsed.backgrounds)) {
        for (const entry of parsed.backgrounds) {
          entry.metadata.alias = entry.alias;
        }
        return (builtinCatalogCache = parsed);
      }
    }
  } catch {}
  return (builtinCatalogCache = null);
}

export function resolveAssetId(idOrAlias: string): string | undefined {
  if (!idOrAlias || typeof idOrAlias !== "string") return undefined;
  const clean = idOrAlias.trim();
  if (ID.test(clean)) return clean;
  const cleanLower = clean.toLowerCase();
  const strippedLower = cleanLower.replace(/\.(gif|png|webp|jpg|jpeg)$/i, "");
  const catalog = getBuiltinCatalog();
  if (catalog) {
    const entry = catalog.backgrounds.find(b =>
      b.alias.toLowerCase() === cleanLower ||
      b.alias.toLowerCase() === strippedLower ||
      b.metadata.name.toLowerCase() === cleanLower ||
      b.metadata.name.toLowerCase() === strippedLower ||
      b.metadata.id === clean ||
      b.metadata.id.startsWith(clean)
    );
    if (entry) return entry.metadata.id;
  }
  return undefined;
}

function regularRead(path: string, max: number): Buffer {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Expected a regular file, not a link or device");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > max) throw new Error(`Expected a regular file of at most ${max} bytes`);
    const data = Buffer.alloc(stat.size + 1);
    let length = 0, count = 0;
    while (length < data.length && (count = readSync(fd, data, length, data.length - length, null)) > 0) length += count;
    if (length !== stat.size) throw new Error("File changed while being read");
    return data.subarray(0, length);
  } finally { closeSync(fd); }
}

function imageInfo(data: Buffer, extension: string): { format: string; width: number; height: number } {
  const format = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png"
    : data[0] === 255 && data[1] === 216 && data[2] === 255 ? "jpeg"
    : /^GIF8[79]a$/.test(data.toString("ascii", 0, 6)) ? "gif"
    : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" ? "webp" : undefined;
  if (!format || !({ png: [".png"], jpeg: [".jpg", ".jpeg"], webp: [".webp"], gif: [".gif"] }[format].includes(extension))) throw new Error("Use a PNG, JPG/JPEG, WebP or GIF file with matching contents");
  const parsed = getImageDimensions(data.toString("base64"), `image/${format}`);
  const dimensions = parsed ? { width: parsed.widthPx, height: parsed.heightPx } : null;
  if (!dimensions || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > ASSET_LIMITS.dimension || dimensions.height > ASSET_LIMITS.dimension || dimensions.width * dimensions.height > ASSET_LIMITS.pixels) throw new Error("Invalid or oversized image dimensions");
  return { format, ...dimensions };
}

interface AnimationInfo { frames: number; duration: number; loops: number }
/** Inspect container structure before decoding. GIF delays below 20ms follow the
 * common browser 100ms convention. Normalize variable timing to bounded 10fps. */
function inspectAnimation(data: Buffer, format: string): AnimationInfo {
  let frames = 0, duration = 0, loops = 1;
  const check = () => { if (frames > 300 || duration > 30_000) throw new Error("Animation limit: 300 source frames and 30 seconds per cycle"); };
  if (format === "gif") {
    let offset = 13 + ((data[10]! & 0x80) ? 3 * (1 << ((data[10]! & 7) + 1)) : 0), delay = 100;
    function blocks(): void {
      while (offset < data.length) { const length = data[offset++]!; if (!length) return; offset += length; if (offset > data.length) throw new Error("Truncated GIF block"); }
      throw new Error("Truncated GIF");
    }
    while (offset < data.length) {
      const marker = data[offset++]!;
      if (marker === 0x3b) break;
      if (marker === 0x21) {
        const label = data[offset++]!;
        if (label === 0xf9) {
          if (data[offset] !== 4 || offset + 6 > data.length) throw new Error("Invalid GIF control");
          const ms = data.readUInt16LE(offset + 2) * 10;
          delay = ms < 20 ? 100 : ms;
        } else if (label === 0xff && data[offset] === 11 && data.toString("ascii", offset + 1, offset + 12) === "NETSCAPE2.0" && data[offset + 12] === 3 && data[offset + 13] === 1 && offset + 16 <= data.length) {
          const repeats = data.readUInt16LE(offset + 14); loops = repeats === 0 ? 0 : repeats + 1;
        }
        blocks();
      } else if (marker === 0x2c) {
        if (offset + 9 >= data.length) throw new Error("Truncated GIF frame");
        const width = data.readUInt16LE(offset + 4), height = data.readUInt16LE(offset + 6);
        if (!width || !height || width > ASSET_LIMITS.dimension || height > ASSET_LIMITS.dimension || width * height > ASSET_LIMITS.pixels) throw new Error("Oversized GIF frame");
        const packed = data[offset + 8]!;
        offset += 9 + ((packed & 0x80) ? 3 * (1 << ((packed & 7) + 1)) : 0);
        offset++; // LZW minimum code size
        blocks(); frames++; duration += delay; delay = 100; check();
      } else throw new Error("Invalid GIF structure");
    }
    if (!frames) throw new Error("GIF has no frames");
  } else if (format === "webp") {
    if (data.length < 12 || data.readUInt32LE(4) + 8 !== data.length) throw new Error("Invalid WebP container");
    for (let offset = 12; offset < data.length;) {
      if (offset + 8 > data.length) throw new Error("Truncated WebP chunk");
      const name = data.toString("ascii", offset, offset + 4), size = data.readUInt32LE(offset + 4), start = offset + 8;
      if (start + size > data.length) throw new Error("Truncated WebP chunk");
      if (name === "ANIM") { if (size !== 6) throw new Error("Invalid WebP animation"); loops = data.readUInt16LE(start + 4); }
      if (name === "ANMF") {
        if (size < 16) throw new Error("Invalid WebP frame");
        const width = data.readUIntLE(start + 6, 3) + 1, height = data.readUIntLE(start + 9, 3) + 1;
        if (width > ASSET_LIMITS.dimension || height > ASSET_LIMITS.dimension || width * height > ASSET_LIMITS.pixels) throw new Error("Oversized WebP frame");
        frames++; const ms = data.readUIntLE(start + 12, 3); duration += ms < 20 ? 100 : ms; check();
      }
      offset = start + size + (size % 2);
    }
  }
  return { frames: Math.max(1, frames), duration, loops };
}

/** Fixed demuxer, pipe-only input, one decoder thread, bounded output and lifetime.
 * No shell, filenames, URLs, delegates, uploaded code or background decoder process. */
async function decode(data: Buffer, format: string, width: number, height: number, animation: AnimationInfo, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const animated = animation.frames > 1;
  const demuxer = animated && format === "webp" ? "webp_anim" : { png: "png_pipe", jpeg: "jpeg_pipe", webp: "webp_pipe", gif: "gif" }[format]!;
  const maxFrames = animated ? Math.max(1, Math.ceil(animation.duration / 100)) : 1;
  const outputLimit = width * height * 4 * maxFrames;
  if (outputLimit > ASSET_LIMITS.decodedBytes) throw new Error("Decoded animation exceeds memory limit");
  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", "-protocol_whitelist", "pipe", "-f", demuxer, ...(format === "gif" ? ["-ignore_loop", "1"] : []), "-i", "pipe:0", "-an", "-sn", "-vf", `scale=${width}:${height}${animated ? ",fps=10:round=up" : ""}`, "-frames:v", String(maxFrames), "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const abort = () => process.kill("SIGKILL");
    signal.addEventListener("abort", abort, { once: true });
    const chunks: Buffer[] = [];
    let size = 0, error = "", failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error("Image decoding timed out"); process.kill("SIGKILL"); }, 8000);
    process.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > outputLimit) { failure = new Error("Decoded image exceeds limit"); process.kill("SIGKILL"); }
      else chunks.push(chunk);
    });
    process.stderr.on("data", (chunk: Buffer) => { if (error.length < 1024) error += chunk.toString().slice(0, 1024 - error.length); });
    process.stdin.on("error", () => {});
    process.once("error", () => { clearTimeout(timer); reject(new Error("Image import needs FFmpeg on PATH; built-in scenes remain available")); });
    process.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (signal.aborted) { reject(new Error("Background import cancelled")); return; }
      if (failure || code !== 0 || size < width * height * 4 || size % (width * height * 4) !== 0) reject(failure ?? new Error(`Invalid or unsupported image (${backgroundError(error).slice(0, 160)})`));
      else resolve(Buffer.concat(chunks));
    });
    process.stdin.end(data);
  });
}

/** One managed store. Only canonical hashes become paths; metadata never supplies paths. */
export class BackgroundAssetStore {
  readonly root: string;
  private cached = new Map<string, LoadedBackground>();
  private remember(asset: LoadedBackground): LoadedBackground {
    this.cached.set(asset.metadata.id, asset);
    let bytes = [...this.cached.values()].reduce((sum, item) => sum + item.pixels.length, 0);
    while (this.cached.size > 6 || bytes > ASSET_LIMITS.decodedBytes) {
      const first = this.cached.keys().next().value!;
      bytes -= this.cached.get(first)!.pixels.length;
      this.cached.delete(first);
    }
    return asset;
  }
  private importing = false;
  private importAbort?: AbortController;
  constructor(agentDir: string) { this.root = join(agentDir, "omt-assets"); }
  private checkRoot(create = false): boolean {
    if (create) mkdirSync(dirname(this.root), { recursive: true });
    try { const stat = lstatSync(this.root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe managed asset directory"); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; if (!create) return false; mkdirSync(this.root, { mode: 0o700 }); }
    return true;
  }
  private assetPath(id: string): string {
    if (!isAssetId(id)) throw new Error("Invalid background ID");
    if (!this.checkRoot()) throw new Error("Background asset is missing");
    const path = join(this.root, id);
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe asset path");
    return path;
  }
  list(): BackgroundAsset[] {
    let ids: string[];
    try { if (!this.checkRoot()) return []; ids = readdirSync(this.root).filter(isAssetId).sort().slice(0, ASSET_LIMITS.count); }
    catch { return []; }
    const assets: BackgroundAsset[] = [];
    for (const id of ids) {
      try { assets.push(this.metadata(id)); } catch { /* Corrupt/missing assets never affect Pi startup. */ }
    }
    return assets;
  }
  listLibrary(): BackgroundAsset[] {
    return getBuiltinCatalog()?.backgrounds.map(b => b.metadata) ?? [];
  }
  listAll(): BackgroundAsset[] {
    return [...this.list(), ...this.listLibrary()];
  }
  resolveId(idOrAlias: string): string | undefined {
    if (!idOrAlias || typeof idOrAlias !== "string") return undefined;
    const clean = idOrAlias.trim();
    if (ID.test(clean) && this.has(clean)) return clean;
    const cleanLower = clean.toLowerCase();
    const strippedLower = cleanLower.replace(/\.(gif|png|webp|jpg|jpeg)$/i, "");
    const catalog = getBuiltinCatalog();
    if (catalog) {
      const entry = catalog.backgrounds.find(b =>
        b.alias.toLowerCase() === cleanLower ||
        b.alias.toLowerCase() === strippedLower ||
        b.metadata.name.toLowerCase() === cleanLower ||
        b.metadata.name.toLowerCase() === strippedLower ||
        b.metadata.id === clean ||
        b.metadata.id.startsWith(clean)
      );
      if (entry) return entry.metadata.id;
    }
    const match = this.list().find(a => {
      const aLower = a.name.toLowerCase();
      const aStripped = aLower.replace(/\.(gif|png|webp|jpg|jpeg)$/i, "");
      return (
        a.id === clean ||
        a.id.startsWith(clean) ||
        aLower === cleanLower ||
        aStripped === strippedLower ||
        aLower === strippedLower ||
        aStripped === cleanLower
      );
    });
    if (match) return match.id;
    return ID.test(clean) ? clean : undefined;
  }
  has(id: string): boolean {
    if (getBuiltinCatalog()?.backgrounds.some(b => b.metadata.id === id)) return true;
    try { return existsSync(this.assetPath(id)); } catch { return false; }
  }
  getFriendlyName(id: string): string | undefined {
    if (!id || id === "built-in") return undefined;
    const catalogEntry = getBuiltinCatalog()?.backgrounds.find(b => b.metadata.id === id || b.alias.toLowerCase() === id.toLowerCase());
    if (catalogEntry) return catalogEntry.metadata.name;
    const match = this.list().find(a => a.id === id);
    if (match) return match.name;
    return undefined;
  }
  metadata(id: string): BackgroundAsset {
    const catalogEntry = getBuiltinCatalog()?.backgrounds.find(b => b.metadata.id === id || b.alias.toLowerCase() === id.toLowerCase());
    if (catalogEntry) return catalogEntry.metadata;
    const value = JSON.parse(regularRead(join(this.assetPath(id), "asset.json"), 16_384).toString()) as BackgroundAsset;
    if (value.version !== 1 || value.id !== id || !["image", "animation", "scene", "pack"].includes(value.kind) || typeof value.name !== "string" || value.name.length > 100 || /[\x00-\x1f\x7f-\x9f]/.test(value.name) || !Number.isInteger(value.width) || value.width < 1 || value.width > ASSET_LIMITS.width || !Number.isInteger(value.height) || value.height < 1 || value.height > ASSET_LIMITS.height || !Number.isInteger(value.frameCount) || value.frameCount < 1 || value.frameCount > 300 || value.width * value.height * 4 * value.frameCount > ASSET_LIMITS.decodedBytes || !Number.isFinite(value.frameMs) || (value.frameCount > 1 && value.frameMs !== 100) || !Number.isInteger(value.loops) || value.loops < 0 || value.loops > 65536) throw new Error("Invalid background metadata");
    if (value.kind === "scene" || value.kind === "pack") {
      value.scene = validateStoredScene(value.scene!);
      if (!Array.isArray(value.imageIds) || value.imageIds.length > 4 || !value.imageIds.every(isAssetId) || value.imageIds.includes(id)) throw new Error("Invalid pack assets");
    } else if (value.scene !== undefined || value.imageIds !== undefined) throw new Error("Unexpected scene data in raster metadata");
    return value;
  }
  load(id: string, catalogMetadataOnly = false): LoadedBackground {
    const resolved = this.resolveId(id) ?? id;
    // Procedural adapters need catalog identity, not the legacy raster frames.
    const entry = catalogMetadataOnly && getBuiltinCatalog()?.backgrounds.find(b => b.metadata.id === resolved);
    if (entry) return { metadata: entry.metadata, pixels: Buffer.alloc(0) };
    const cached = this.cached.get(resolved);
    if (cached) { this.cached.delete(resolved); this.cached.set(resolved, cached); return cached; }
    const catalogEntry = getBuiltinCatalog()?.backgrounds.find(b => b.metadata.id === resolved);
    if (catalogEntry) {
      const gzPath = join(BUILTIN_DIR, `${catalogEntry.metadata.id}.rgba.gz`);
      const pixels = gunzipSync(readFileSync(gzPath), { maxOutputLength: ASSET_LIMITS.decodedBytes });
      if (pixels.length !== catalogEntry.metadata.width * catalogEntry.metadata.height * 4 * catalogEntry.metadata.frameCount) {
        throw new Error("Corrupt library background frame");
      }
      return this.remember({ metadata: catalogEntry.metadata, pixels });
    }
    const metadata = this.metadata(resolved);
    if (metadata.kind === "scene" || metadata.kind === "pack") return this.remember({ metadata, pixels: Buffer.alloc(0) });
    const pixels = regularRead(join(this.assetPath(resolved), "frames.rgba"), ASSET_LIMITS.decodedBytes);
    if (pixels.length !== metadata.width * metadata.height * 4 * metadata.frameCount) throw new Error("Corrupt background frame");
    return this.remember({ metadata, pixels });
  }
  clear(): void { this.cached.clear(); }
  dispose(): void { this.importAbort?.abort(); this.clear(); }
  remove(id: string): void {
    const isLibrary = getBuiltinCatalog()?.backgrounds.some(b => b.metadata.id === id || b.alias.toLowerCase() === id.toLowerCase());
    if (isLibrary) throw new Error("Built-in library backgrounds cannot be deleted; use /omt background reset to deselect");
    const path = this.assetPath(id);
    this.clear();
    rmSync(path, { recursive: true });
  }
  async importFile(inputPath: string): Promise<BackgroundAsset> {
    if (this.importing) throw new Error("Another background import is running");
    this.importing = true;
    this.importAbort = new AbortController();
    try { return await this.importAssetFile(inputPath); }
    finally { this.importing = false; this.importAbort = undefined; }
  }
  private async importManifest(source: string, data: Buffer): Promise<BackgroundAsset> {
    const manifest = validateManifest(JSON.parse(data.toString("utf8")));
    this.checkRoot(true);
    const previous = new Set(this.list().map(asset => asset.id));
    const imageIds: string[] = [];
    let temporary: string | undefined;
    try {
      let total = data.length;
      for (const relative of manifest.images) {
        const parts = relative.split("/");
        let parent = dirname(source);
        for (const part of parts.slice(0, -1)) {
          parent = join(parent, part);
          const stat = lstatSync(parent);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe theme pack image directory");
        }
        const path = join(parent, parts.at(-1)!);
        const bytes = regularRead(path, ASSET_LIMITS.sourceBytes);
        total += bytes.length;
        if (total > ASSET_LIMITS.sourceBytes) throw new Error("Theme pack source limit is 8 MiB total");
        imageIds.push((await this.importAssetFile(path, true, bytes)).id);
      }
      this.importAbort!.signal.throwIfAborted();
      const id = createHash("sha256").update(JSON.stringify([manifest, imageIds])).digest("hex");
      if (previous.has(id)) return this.metadata(id);
      if (readdirSync(this.root).filter(isAssetId).length >= ASSET_LIMITS.count) throw new Error("Background asset limit reached");
      const metadata: BackgroundAsset = { version: 1, id, name: manifest.name, kind: manifest.type === "scene" ? "scene" : "pack", format: "json", sourceBytes: total, width: 1, height: 1, frameCount: 1, frameMs: 0, loops: 0, importedAt: new Date().toISOString(), scene: manifest.scene, imageIds };
      temporary = join(this.root, `.import-${randomUUID()}`);
      mkdirSync(temporary, { mode: 0o700 });
      writeFileSync(join(temporary, "asset.json"), JSON.stringify(metadata), { mode: 0o600, flag: "wx" });
      renameSync(temporary, join(this.root, id)); temporary = undefined;
      return metadata;
    } catch (error) {
      for (const id of new Set(imageIds)) if (!previous.has(id)) this.remove(id);
      throw error;
    } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
  }
  private async importAssetFile(inputPath: string, rasterOnly = false, sourceData?: Buffer): Promise<BackgroundAsset> {
    let temporary: string | undefined;
    try {
      if (!inputPath || /[\x00-\x1f\x7f-\x9f]/.test(inputPath)) throw new Error("Invalid file path");
      const source = resolve(inputPath);
      const data = sourceData ?? regularRead(source, ASSET_LIMITS.sourceBytes);
      if (extname(source).toLowerCase() === ".json") {
        if (rasterOnly) throw new Error("Theme pack images must be raster files");
        if (data.length > 65_536) throw new Error("Scene manifest limit is 64 KiB");
        return await this.importManifest(source, data);
      }
      const info = imageInfo(data, extname(source).toLowerCase());
      const id = createHash("sha256").update(data).digest("hex");
      this.checkRoot(true);
      if (this.list().some(asset => asset.id === id)) return this.metadata(id);
      if (readdirSync(this.root).filter(isAssetId).length >= ASSET_LIMITS.count) throw new Error("Background asset limit reached; remove an asset first");
      const animation = inspectAnimation(data, info.format);
      const animated = animation.frames > 1;
      const budgetScale = animated ? Math.sqrt(ASSET_LIMITS.decodedBytes / (Math.ceil(animation.duration / 100) * 4 * info.width * info.height)) : 1;
      const scale = Math.min(1, animated ? budgetScale * 0.99 : 1, ASSET_LIMITS.width / info.width, ASSET_LIMITS.height / info.height);
      const width = Math.max(1, Math.round(info.width * scale)), height = Math.max(1, Math.round(info.height * scale));
      const pixels = await decode(data, info.format, width, height, animation, this.importAbort!.signal);
      this.importAbort!.signal.throwIfAborted();
      const diskBytes = this.list().reduce((sum, asset) => sum + asset.width * asset.height * 4 * asset.frameCount, 0);
      if (diskBytes + pixels.length > 256 * 1024 * 1024) throw new Error("Managed backgrounds exceed the 256 MiB storage limit");
      const metadata: BackgroundAsset = { version: 1, id, name: basename(source).replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 100), kind: animated ? "animation" : "image", format: info.format, sourceBytes: data.length, width, height, frameCount: pixels.length / (width * height * 4), frameMs: animated ? 100 : 0, loops: animation.loops, importedAt: new Date().toISOString() };
      temporary = join(this.root, `.import-${randomUUID()}`);
      mkdirSync(temporary, { mode: 0o700 });
      writeFileSync(join(temporary, "frames.rgba"), pixels, { mode: 0o600, flag: "wx" });
      writeFileSync(join(temporary, "asset.json"), JSON.stringify(metadata), { mode: 0o600, flag: "wx" });
      renameSync(temporary, join(this.root, id));
      temporary = undefined;
      return metadata;
    } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
  }
}
