"""
Generate PWA icon PNGs (192x192 and 512x512) for NestIQ.
Uses only Python stdlib — no dependencies needed.
Run from anywhere: python scripts/generate_icons.py
"""
import struct, zlib, math, os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "public")

BG     = (15,  15,  19)   # #0f0f13
ORANGE = (245, 166, 35)   # #f5a623


def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def point_to_segment_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    len2 = dx * dx + dy * dy
    if len2 == 0:
        return math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / len2))
    return math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2)


def make_icon(size):
    """Return a flat list of (r,g,b) tuples for a size×size NestIQ radar icon."""
    cx = cy = size / 2
    corner_r = size * 0.195

    # Radar geometry — proportions match icon.svg (512px reference)
    outer_r  = size * 0.4375   # 224 / 512
    outer_hw = size * 0.016    # stroke-width 16 → half = 8
    mid_r    = size * 0.25     # 128 / 512
    mid_hw   = size * 0.012    # stroke-width 12 → half = 6
    dot_r    = size * 0.078    # 40 / 512
    arm_hw   = size * 0.014    # stroke-width 14 → half = 7
    # arm endpoint: (448, 96) in 512px space → offsets from center (256, 256)
    arm_x2   = cx + size * 0.375   # +192 / 512
    arm_y2   = cy - size * 0.3125  # -160 / 512

    pixels = []
    for y in range(size):
        for x in range(size):
            # ── Rounded-rect clip ──────────────────────────────────────────
            dx = max(corner_r - x, 0, x - (size - corner_r - 1))
            dy = max(corner_r - y, 0, y - (size - corner_r - 1))
            if dx * dx + dy * dy > corner_r * corner_r:
                pixels.append(BG)
                continue

            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)

            # ── Center dot ─────────────────────────────────────────────────
            if dist <= dot_r:
                pixels.append(ORANGE)
                continue

            # ── Outer ring ─────────────────────────────────────────────────
            if abs(dist - outer_r) <= outer_hw:
                pixels.append(ORANGE)
                continue

            # ── Middle ring (60 % opacity blend) ───────────────────────────
            if abs(dist - mid_r) <= mid_hw:
                pixels.append(lerp_color(BG, ORANGE, 0.6))
                continue

            # ── Arm (80 % opacity blend) ────────────────────────────────────
            if point_to_segment_dist(x, y, cx, cy, arm_x2, arm_y2) <= arm_hw:
                pixels.append(lerp_color(BG, ORANGE, 0.85))
                continue

            pixels.append(BG)

    return pixels


def write_png(filepath, size, pixels):
    def chunk(tag, data):
        buf = tag + data
        crc = zlib.crc32(buf) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + buf + struct.pack(">I", crc)

    raw = b""
    for row in range(size):
        raw += b"\x00"
        for col in range(size):
            r, g, b = pixels[row * size + col]
            raw += bytes([r, g, b])

    compressed = zlib.compress(raw, 9)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png  = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")

    with open(filepath, "wb") as f:
        f.write(png)
    print(f"  wrote {filepath}  ({len(png):,} bytes)")


if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for size, name in [(192, "icon-192.png"), (512, "icon-512.png")]:
        print(f"Generating {name} ({size}×{size})...")
        pixels = make_icon(size)
        write_png(os.path.join(OUTPUT_DIR, name), size, pixels)
    print("Done. Icons saved to frontend/public/")
