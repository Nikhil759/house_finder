"""
Generate PWA icon PNGs (192x192 and 512x512) for FlatRadar.
Uses only Python stdlib — no dependencies needed.
Run from anywhere: python scripts/generate_icons.py
"""
import struct, zlib, math, os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "public")

BG      = (15,  15,  19)   # #0f0f13
ORANGE  = (245, 166, 35)   # #f5a623
ORANGE2 = (245, 166, 35, 128)  # semi-transparent rings — handled manually


def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def make_icon(size):
    """Return a flat list of (r,g,b) tuples for a size×size icon."""
    cx = cy = size / 2
    radius = size / 2        # circle boundary (we'll square-crop with rounded corners)
    corner_r = size * 0.195  # ~100px at 512

    # F letter geometry (relative to size)
    stem_x1 = size * 0.289
    stem_x2 = size * 0.422
    stem_y1 = size * 0.234
    stem_y2 = size * 0.766

    top_bar_x2 = size * 0.719
    top_bar_y2 = size * 0.367

    mid_bar_x2 = size * 0.586
    mid_bar_y1 = size * 0.434
    mid_bar_y2 = size * 0.551

    # Radar dot (bottom-right)
    dot_cx = size * 0.734
    dot_cy = size * 0.727
    dot_r  = size * 0.039
    ring1_r = size * 0.070
    ring2_r = size * 0.109

    pixels = []
    for y in range(size):
        for x in range(size):
            # ── Rounded-rect clip ──────────────────────────────────────────
            dx = max(corner_r - x, 0, x - (size - corner_r - 1))
            dy = max(corner_r - y, 0, y - (size - corner_r - 1))
            if dx * dx + dy * dy > corner_r * corner_r:
                pixels.append((0, 0, 0))  # outside → transparent (we'll use BG in PNG)
                continue

            # ── F letter ───────────────────────────────────────────────────
            in_stem    = stem_x1 <= x < stem_x2 and stem_y1 <= y < stem_y2
            in_top_bar = stem_x1 <= x < top_bar_x2 and stem_y1 <= y < top_bar_y2
            in_mid_bar = stem_x1 <= x < mid_bar_x2 and mid_bar_y1 <= y < mid_bar_y2

            if in_stem or in_top_bar or in_mid_bar:
                pixels.append(ORANGE)
                continue

            # ── Radar dot ──────────────────────────────────────────────────
            rdx = x - dot_cx
            rdy = y - dot_cy
            dist = math.sqrt(rdx * rdx + rdy * rdy)

            if dist <= dot_r:
                pixels.append(ORANGE)
                continue
            if dot_r < dist <= ring1_r:
                t = (dist - dot_r) / (ring1_r - dot_r)
                alpha = max(0.0, 0.5 * (1 - t))
                pixels.append(lerp_color(BG, ORANGE, alpha))
                continue
            if ring1_r < dist <= ring2_r:
                t = (dist - ring1_r) / (ring2_r - ring1_r)
                alpha = max(0.0, 0.25 * (1 - t))
                pixels.append(lerp_color(BG, ORANGE, alpha))
                continue

            pixels.append(BG)

    return pixels


def write_png(filepath, size, pixels):
    def chunk(tag, data):
        buf  = tag + data
        crc  = zlib.crc32(buf) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + buf + struct.pack(">I", crc)

    raw = b""
    for row in range(size):
        raw += b"\x00"  # filter None
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
