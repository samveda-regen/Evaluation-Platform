"""
Compression preview tool — captures a short clip from YOUR webcam, re-encodes
it at several real bitrates using ffmpeg, and reports the actual resulting
file size next to what our bitrate x duration math predicted. Also saves one
frame from each version so you can visually compare quality side by side.

Run this on your own machine (needs a webcam) — NOT on the droplet, which
has no camera. Separate purpose from server.py/load_test.py in this same
folder: those measure server capacity, this previews compression quality/size.

Requires:
    pip install opencv-python
    ffmpeg installed and on PATH — check with: ffmpeg -version
    (Windows: winget install ffmpeg   or   choco install ffmpeg)

Usage:
    python compression_preview.py --duration 3 --fps 15
    python compression_preview.py --duration 3 --fps 15 --bitrates 128 200 400 800
"""
import argparse
import os
import subprocess
import time

import cv2


def capture_clip(duration_s: float, fps: int, out_path: str, width: int, height: int):
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_FPS, fps)

    if not cap.isOpened():
        raise RuntimeError("Could not open webcam (index 0) — check it's not in use by another app")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(out_path, fourcc, fps, (width, height))

    print(f"[CAPTURE] recording {duration_s}s from webcam at {fps}fps...")
    n_frames_target = int(duration_s * fps)
    frames_captured = 0
    first_frame = None
    t0 = time.time()
    while frames_captured < n_frames_target:
        ok, frame = cap.read()
        if not ok:
            break
        if first_frame is None:
            first_frame = frame.copy()
        writer.write(frame)
        frames_captured += 1
    writer.release()
    cap.release()

    elapsed = time.time() - t0
    print(f"[CAPTURE] got {frames_captured} frames in {elapsed:.1f}s -> {out_path}")
    return first_frame, frames_captured


def check_ffmpeg() -> bool:
    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False


def encode_at_bitrate(input_path: str, output_path: str, bitrate_kbps: int):
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-c:v", "libx264", "-b:v", f"{bitrate_kbps}k",
        "-maxrate", f"{bitrate_kbps}k", "-bufsize", f"{bitrate_kbps * 2}k",
        "-an",  # no audio — matches this test's scope (video chunk sizing only)
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[ERROR] ffmpeg failed for {bitrate_kbps}kbps:\n{result.stderr[-500:]}")
        return None
    return os.path.getsize(output_path)


def main():
    parser = argparse.ArgumentParser(description="Capture webcam video and compare real compression at several bitrates")
    parser.add_argument("--duration", type=float, default=3.0, help="seconds of video to capture (matches a real chunk interval)")
    parser.add_argument("--fps", type=int, default=15, help="capture frame rate")
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument(
        "--bitrates", type=int, nargs="+", default=[128, 200, 400, 800],
        help="kbps values to compare (400 = current production setting in useProctoring.ts)",
    )
    parser.add_argument("--outdir", default="compression_preview_output")
    args = parser.parse_args()

    if not check_ffmpeg():
        print("[ERROR] ffmpeg not found on PATH. Install it first:")
        print("        Windows: winget install ffmpeg   (or) choco install ffmpeg")
        print("        then re-open your terminal and confirm with: ffmpeg -version")
        return

    os.makedirs(args.outdir, exist_ok=True)
    raw_path = os.path.join(args.outdir, "raw_capture.mp4")

    first_frame, n_frames = capture_clip(args.duration, args.fps, raw_path, args.width, args.height)
    if first_frame is None:
        print("[ERROR] no frames captured — check your webcam isn't in use by another app (Camera app, Teams, etc.)")
        return

    raw_frame_path = os.path.join(args.outdir, "frame_original.png")
    cv2.imwrite(raw_frame_path, first_frame)  # true lossless PNG — the real "original" reference
    raw_size = os.path.getsize(raw_path)

    print(f"\n[RESULT] intermediate capture: {raw_size / 1024:.1f} KB for {n_frames} frames "
          f"({args.duration}s @ {args.fps}fps)")
    print(f"[RESULT] lossless reference frame saved: {raw_frame_path}")

    print(f"\n{'bitrate':>10} {'predicted size':>16} {'actual size':>14} {'diff':>10}")
    for kbps in args.bitrates:
        predicted_bytes = (kbps * 1000 / 8) * args.duration
        out_video = os.path.join(args.outdir, f"compressed_{kbps}kbps.mp4")
        actual_bytes = encode_at_bitrate(raw_path, out_video, kbps)
        if actual_bytes is None:
            continue

        # Extract a frame from the compressed video for visual side-by-side comparison
        cap = cv2.VideoCapture(out_video)
        ok, frame = cap.read()
        if ok:
            frame_path = os.path.join(args.outdir, f"frame_{kbps}kbps.png")
            cv2.imwrite(frame_path, frame)
        cap.release()

        diff_pct = ((actual_bytes - predicted_bytes) / predicted_bytes) * 100
        print(f"{kbps:>7}kbps {predicted_bytes / 1024:>13.1f}KB {actual_bytes / 1024:>11.1f}KB {diff_pct:>+8.1f}%")

    print(f"\n[DONE] open ./{args.outdir}/ and compare frame_original.png against "
          f"frame_<bitrate>kbps.png side by side to see the real visual quality tradeoff, "
          f"and compressed_<bitrate>kbps.mp4 to see the actual video result.")


if __name__ == "__main__":
    main()
