import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const KITTY_SOCK = process.env.KITTY_SOCKET || (existsSync("/tmp/omt-real-kitty.sock") ? "/tmp/omt-real-kitty.sock" : "/tmp/omt-readme-kitty.sock");
const TARGET_WORKSPACE = process.env.TARGET_WORKSPACE || (existsSync("/tmp/omt-real-kitty.sock") ? "5" : "4");
const RETURN_WORKSPACE = process.env.RETURN_WORKSPACE || "2";
const OUTPUT_DIR = resolve("media");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function hypr(cmd) {
  return sh(`hyprctl dispatch "${cmd}"`);
}

function ensureFullscreen() {
  hypr(`hl.dsp.focus({ workspace = '${TARGET_WORKSPACE}' })`);
  try {
    const clients = JSON.parse(sh("hyprctl -j clients"));
    const win = clients.find((c) => c.workspace.name === TARGET_WORKSPACE);
    if (win && win.fullscreen === 0) {
      hypr("hl.dsp.window.fullscreen({ mode = 'fullscreen' })");
    }
  } catch {
    // fallback
  }
}

function returnFocus() {
  hypr(`hl.dsp.focus({ workspace = '${RETURN_WORKSPACE}' })`);
}

function sendKey(keys) {
  sh(`kitty @ --to unix:${KITTY_SOCK} send-text '${keys}'`);
}

async function captureScreen(outputPath, delayMs = 2000) {
  ensureFullscreen();
  await sleep(delayMs);
  sh(`grim "${outputPath}"`);
  console.log(`  ✓ Đã chụp (1920x1080): ${outputPath}`);
}

async function run() {
  if (!existsSync(KITTY_SOCK)) {
    console.error(`Lỗi: Không tìm thấy Kitty socket tại ${KITTY_SOCK}`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const tmpFrames = "/tmp/omt_gif_frames";
  const paletteFramesDir = "/tmp/omt_palette_frames";
  rmSync(tmpFrames, { recursive: true, force: true });
  rmSync(paletteFramesDir, { recursive: true, force: true });
  mkdirSync(tmpFrames, { recursive: true });
  mkdirSync(paletteFramesDir, { recursive: true });

  console.log("==================================================");
  console.log("  Oh My TUI - Chụp ảnh Fullscreen (1920x1080) & GIF");
  console.log("==================================================");
  console.log(`Workspace: ${TARGET_WORKSPACE} | Output: ${OUTPUT_DIR}\n`);

  try {
    console.log("⚙ Kích hoạt Fullscreen và đợi 2s...");
    ensureFullscreen();
    await sleep(2000);

    // 1. Chụp Hero Signature Default Screen
    console.log("\n[1/10] Chụp Hero Signature Interface (Right Dock, Pet, Composer, Background)...");
    sendKey("\\e\\e\\e");
    await sleep(200);
    sendKey("/omt theme omt-signature\\r");
    await sleep(400);
    sendKey("/new\\r");
    await captureScreen(join(OUTPUT_DIR, "01-hero-signature.png"), 2000);

    // 2. Chụp Settings Hub (Section Plugins 3 cột đầy đủ chi tiết)
    console.log("\n[2/10] Chụp Settings Hub (3 cột: Sections, Plugins, Details)...");
    sendKey("/omt settings\\r");
    await sleep(600);
    sendKey("\\e[B\\e[B\\e[B\\e[B\\e[B\\e[B"); // Chuyển xuống Plugins
    await captureScreen(join(OUTPUT_DIR, "02-settings-hub.png"), 2000);

    // 3. Chụp Theme & Surface Palettes Catalog (25 theme palettes + 32 surface backgrounds)
    console.log("\n[3/10] Chụp Theme & Surface Palettes Catalog...");
    sendKey("\\e[B\\e[B\\e[B\\e[B\\e[B\\e[B"); // Xuống Theme section
    await sleep(300);
    sendKey("\\e[C\\e[B\\e[B\\e[B\\e[B"); // Cột Theme, chọn tokyo-night
    await captureScreen(join(OUTPUT_DIR, "03-settings-palettes.png"), 2000);

    // 4. Quay GIF duyệt qua các Palette màu sắc trực tiếp trong Settings Hub
    console.log("\n[4/10] Quay ảnh động GIF duyệt Live Palettes trong Settings Hub...");
    for (let pFrame = 1; pFrame <= 6; pFrame++) {
      ensureFullscreen();
      await sleep(400);
      sh(`grim "${paletteFramesDir}/frame_${pFrame}.png"`);
      sendKey("\\e[B"); // Chuyển sang palette tiếp theo
    }
    const paletteGifPath = join(OUTPUT_DIR, "omt-palette-browsing.gif");
    sh(`ffmpeg -v error -y -framerate 1.8 -i "${paletteFramesDir}/frame_%d.png" -vf "fps=1.8,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${paletteGifPath}"`);
    console.log(`  ✓ Đã tạo file GIF: ${paletteGifPath}`);
    sendKey("\\e"); // Đóng Settings Hub
    await sleep(400);

    // 5. Chụp Sidebar Dashboard Modal (Toàn màn hình, modal ở giữa)
    console.log("\n[5/10] Chụp Sidebar Dashboard Modal (/omt sidebar)...");
    sendKey("/omt sidebar\\r");
    await captureScreen(join(OUTPUT_DIR, "04-sidebar-dashboard.png"), 2000);

    // 6. Quay GIF Virtual Pet Animation trong Sidebar Dashboard Modal
    console.log("\n[6/10] Quay ảnh động GIF Virtual Pet cycling trong Sidebar Dashboard...");
    for (let frame = 1; frame <= 8; frame++) {
      ensureFullscreen();
      await sleep(400);
      sh(`grim "${tmpFrames}/frame_${frame}.png"`);
      sendKey("p"); // Đổi loại thú cưng
    }
    sendKey("q"); // Đóng sidebar modal
    await sleep(400);

    const petGifPath = join(OUTPUT_DIR, "omt-pet-animation.gif");
    sh(`ffmpeg -v error -y -framerate 2 -i "${tmpFrames}/frame_%d.png" -vf "fps=2,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${petGifPath}"`);
    console.log(`  ✓ Đã tạo file GIF: ${petGifPath}`);

    // 7. Chụp Command Palette (/omt palette)
    console.log("\n[7/10] Chụp Command Palette (/omt palette)...");
    sendKey("/omt palette\\r");
    await captureScreen(join(OUTPUT_DIR, "05-command-palette.png"), 2000);
    sendKey("\\e"); // Đóng Command Palette
    await sleep(400);

    // 8. Chụp Git Explorer (/omt git)
    console.log("\n[8/10] Chụp Git Explorer (/omt git)...");
    sendKey("/omt git\\r");
    await captureScreen(join(OUTPUT_DIR, "06-git-explorer.png"), 2000);
    sendKey("\\e"); // Đóng Git Explorer
    await sleep(400);

    // 9. Chụp các Presets sạch (OMT Clean, OMT Ember, OMT Rail)
    console.log("\n[9/10] Chụp các Presets giao diện sạch (Clean, Ember, Rail)...");

    // OMT Clean
    sendKey("/omt theme clean\\r");
    await sleep(400);
    sendKey("/new\\r");
    await captureScreen(join(OUTPUT_DIR, "07-preset-clean.png"), 2000);

    // OMT Ember
    sendKey("/omt theme ember\\r");
    await sleep(400);
    sendKey("/new\\r");
    await captureScreen(join(OUTPUT_DIR, "08-preset-ember.png"), 2000);

    // OMT Rail
    sendKey("/omt theme rail\\r");
    await sleep(400);
    sendKey("/new\\r");
    await captureScreen(join(OUTPUT_DIR, "09-preset-rail.png"), 2000);

    // Trả lại theme omt-signature và tạo session sạch
    sendKey("/omt theme omt-signature\\r");
    await sleep(400);
    sendKey("/new\\r");
    await sleep(500);

    // Dọn dẹp thư mục tạm
    rmSync(tmpFrames, { recursive: true, force: true });
    rmSync(paletteFramesDir, { recursive: true, force: true });

    console.log("\n✨ HOÀN THÀNH TẤT CẢ! Đầy đủ 9 ảnh Fullscreen và 2 file GIF tại:", OUTPUT_DIR);

  } finally {
    returnFocus();
  }
}

run().catch((err) => {
  returnFocus();
  console.error("Lỗi:", err);
  process.exit(1);
});
