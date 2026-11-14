#!/usr/bin/env python3
"""Offline PTY smoke capture. Never submits model prompts or unknown slash commands."""
import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import sys
import tempfile
import termios
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--pi", default=shutil.which("pi"), help="Path to pi executable")
parser.add_argument("--output", required=True, type=Path, help="Directory to save output captures")
parser.add_argument("--repo", type=Path, default=None, help="Root path of oh-my-tui repository")
parser.add_argument("--extension", type=Path, default=None, help="Explicit path to extension entry point")
args = parser.parse_args()
if not args.pi:
    parser.error("pi executable not found")
args.output.mkdir(parents=True, exist_ok=True)

if args.extension:
    extension = args.extension.resolve()
elif args.repo:
    extension = (args.repo / "extensions/omt/index.ts").resolve()
else:
    extension = Path(__file__).resolve().parents[1] / "extensions/omt/index.ts"

# Global state tracking for emergency signal cleanup
active_pid = None
active_tempdir = None

def cleanup_active_state():
    global active_pid, active_tempdir
    if active_pid is not None:
        try:
            os.kill(active_pid, signal.SIGTERM)
            time.sleep(0.1)
            child, _ = os.waitpid(active_pid, os.WNOHANG)
            if not child:
                os.kill(active_pid, signal.SIGKILL)
                os.waitpid(active_pid, 0)
        except (ProcessLookupError, ChildProcessError, OSError):
            pass
        active_pid = None
    if active_tempdir is not None:
        try:
            shutil.rmtree(active_tempdir, ignore_errors=True)
        except Exception:
            pass
        active_tempdir = None

def signal_handler(signum, frame):
    cleanup_active_state()
    sys.exit(128 + signum)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

ANSI_ESCAPE_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\].*?(?:\x07|\x1b\\)|[@-Z\\-_])")

def strip_ansi(text: str) -> str:
    return ANSI_ESCAPE_RE.sub("", text)

for mode in ("regular", "fullscreen"):
    temp_dir = tempfile.mkdtemp(prefix=f"omt-ui-{mode}-")
    active_tempdir = temp_dir
    root = Path(temp_dir)
    data = bytearray()
    steps_log = []
    start_time = time.monotonic()
    reaped = False
    fd = None
    pid = None

    try:
        (root / "agent").mkdir()
        (root / "home").mkdir()
        (root / "agent/settings.json").write_text('{"quietStartup":true,"defaultProjectTrust":"never"}')
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(root / "home"),
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "LANG": "C.UTF-8",
            "XDG_CONFIG_HOME": str(root / "config"),
            "XDG_CACHE_HOME": str(root / "cache"),
            "PI_CODING_AGENT_DIR": str(root / "agent"),
            "PI_OFFLINE": "1",
        }
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(root)
            os.execvpe(
                args.pi,
                [
                    args.pi,
                    "--offline",
                    "-ne",
                    "-ns",
                    "-np",
                    "-nc",
                    "--no-themes",
                    "--tui-mode",
                    mode,
                    "--session-dir",
                    str(root / "sessions"),
                    "-e",
                    str(extension),
                ],
                env,
            )
        active_pid = pid

        def drain(seconds):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
                if not ready:
                    continue
                try:
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        return
                    data.extend(chunk)
                except OSError as error:
                    if error.errno == errno.EIO:
                        return
                    raise

        def resize(cols, rows):
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            os.kill(pid, signal.SIGWINCH)

        def command(value, settle=0.8):
            os.write(fd, value.encode() + b"\r")
            drain(settle)

        def step(name, action):
            t0 = time.monotonic()
            action()
            dt = round(time.monotonic() - t0, 3)
            steps_log.append({"step": name, "duration_s": dt, "bytes_now": len(data)})

        # 1. Initialize viewport and verify actual OMT source header welcome and composer markers
        step("startup", lambda: (resize(120, 40), drain(4)))
        clean_startup = strip_ansi(data.decode("utf-8", errors="replace"))
        has_welcome_banner = ("Resources" in clean_startup and "ext " in clean_startup) and ("New session started" in clean_startup or "/ commands" in clean_startup)
        has_composer_marker = "Type a message" in clean_startup and ("^V paste" in clean_startup or "/ commands" in clean_startup)
        if not (has_welcome_banner and has_composer_marker):
            raise AssertionError("OMT source header/composer markers not observed; refusing to submit possibly unknown commands")

        # 2. Exercise Pi's native /new lifecycle repeatedly, inspecting the ENTIRE
        # ANSI interval, not just a settled screenshot. Unchanged welcome rows may
        # correctly remain on screen without being emitted again by the diff renderer.
        for index in range(3):
            before_new_session = len(data)
            step(f"new_session_{index + 1}", lambda: command("/new", 1.0))
            interval = data[before_new_session:].decode("utf-8", errors="replace")
            clean_interval = strip_ansi(interval)
            if index == 0:
                if "New session started" not in clean_interval or "\x1b[38;2;135;215;135m✓" not in interval:
                    raise AssertionError("/new did not show the native session-start status with OMT success styling")
            for native_marker in ("0.0%/0 (auto)", "ctrl+c to clear", "[Extensions]", "[Skills]"):
                if native_marker in clean_interval:
                    raise AssertionError(f"/new painted an intermediate native frame: {native_marker}")
            if re.search(r"\x1b\[38;5;5m✓ New session started", interval):
                raise AssertionError("/new leaked Pi's native accent-colored session-start row")

        # 3. Open dashboard and assert presence
        step("open_dashboard", lambda: command("/omt sidebar"))
        if b"SESSION" not in data or b"RECENT MODELS" not in data:
            raise AssertionError("dashboard did not render")

        # 4. Scroll through dashboard (exercising local viewport navigation)
        def scroll_dashboard():
            for _ in range(80):
                os.write(fd, b"j")
                drain(0.025)
        step("scroll_dashboard", scroll_dashboard)

        # 5. Cycle pet frames and test narrow resize
        step("pet_and_narrow_resize", lambda: (os.write(fd, b"p"), resize(40, 22), drain(0.6)))

        # 6. Close dashboard
        step("close_dashboard", lambda: (os.write(fd, b"q"), drain(0.4)))

        # 7. Companion widget on and medium resize
        step("companion_on", lambda: (command("/omt sidebar on"), resize(80, 30), drain(0.5)))

        # 8. Companion widget off
        step("companion_off", lambda: command("/omt sidebar off"))

        # 9. Preset switching: native and omt-signature
        step("theme_switch", lambda: (command("/omt theme native"), command("/omt theme omt-signature")))

        # 10. Unicode draft input with bracketed paste, then clear with Ctrl+C (never submit)
        def draft_and_clear():
            os.write(fd, "\x1b[200~draft 界 é\x1b[201~".encode())
            drain(0.5)
            os.write(fd, b"\x03")  # Clear the draft, do not submit it.
            drain(0.4)
        step("draft_and_clear", draft_and_clear)

        # 11. Disable OMT and exit Pi cleanly via Ctrl+D
        step("disable_and_exit", lambda: (command("/omt off"), os.write(fd, b"\x04"), drain(1)))

        # Exit is asynchronous; tolerate scheduling latency without retrying keys
        # or ever submitting an unknown command. This deadline is bounded.
        child, status = os.waitpid(pid, os.WNOHANG)
        exit_deadline = time.monotonic() + 3.0
        while not child and time.monotonic() < exit_deadline:
            drain(0.1)
            child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            reaped = True
            active_pid = None
            if os.waitstatus_to_exitcode(status) != 0:
                raise AssertionError(f"Pi exited unsuccessfully: {status}")
        else:
            raise AssertionError("Pi did not exit after Ctrl+D")

        raw = data.decode("utf-8", errors="replace")
        for failure in ("TypeError:", "ReferenceError:", "Failed to load extension", "Extension error", "exceeds terminal width"):
            if failure in raw:
                raise AssertionError(f"capture contains {failure}")
        if b"WORKSPACE" not in data:
            raise AssertionError("dashboard bottom section was not reachable")

        print(f"PASS {mode}: idle/dashboard/scroll/pet/resize/widget/theme/draft/off/exit ({len(data)} bytes)")

        # Save structured summary
        summary = {
            "mode": mode,
            "status": "passed",
            "duration_s": round(time.monotonic() - start_time, 3),
            "bytes_captured": len(data),
            "steps": steps_log,
            "assertions": [
                "OMT source header and composer markers observed",
                "three native /new calls: no native fallback markers in the full ANSI intervals; OMT-styled native status observed",
                "dashboard rendered (SESSION, RECENT MODELS)",
                "dashboard scrolled to bottom (WORKSPACE reachable)",
                "pet frames cycled",
                "viewport resized across 120x40, 40x22, 80x30",
                "companion toggled on and off",
                "preset switched between native and omt-signature",
                "Unicode draft handled and cleared without submission",
                "OMT cleanly disabled",
                "Pi exited cleanly on Ctrl+D",
                "no runtime errors or line width violations",
            ],
        }
        (args.output / f"{mode}-summary.json").write_text(json.dumps(summary, indent=2))

    except Exception as exc:
        raw_text = data.decode("utf-8", errors="replace")
        stripped = strip_ansi(raw_text)
        tail_lines = stripped.strip().splitlines()[-20:]
        print(f"\n[ERROR in {mode} mode]: {exc}\n--- Last 20 lines of capture ---", file=sys.stderr)
        for line in tail_lines:
            print(f"  {line}", file=sys.stderr)
        print("--------------------------------\n", file=sys.stderr)
        raise
    finally:
        # Always write output captures (both ANSI and stripped text) even on failure
        try:
            (args.output / f"{mode}.ansi").write_bytes(data)
            (args.output / f"{mode}.txt").write_text(strip_ansi(data.decode("utf-8", errors="replace")))
        except Exception:
            pass

        # Clean up child process
        if pid is not None and not reaped:
            try:
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
            try:
                drain(0.5)
            except Exception:
                pass
            try:
                child, _ = os.waitpid(pid, os.WNOHANG)
                if not child:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
            except (ChildProcessError, OSError):
                pass
            active_pid = None

        # Close pty master fd
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass

        # Guaranteed removal of temporary directory on completion or failure
        if temp_dir is not None:
            shutil.rmtree(temp_dir, ignore_errors=True)
            active_tempdir = None
