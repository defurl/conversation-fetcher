import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
OUTPUT_FILE = DATA_PROCESSED / "final_rows.json"
DEDUP = False  # set True to drop exact duplicates (per sender/text/media) across all files


def part_number(path: Path) -> int:
    try:
        # handle names like messenger_row_part_123.json or messenger_row_part_123 (1).json
        stem = path.stem
        for token in reversed(stem.split('_')):
            if token.isdigit():
                return int(token)
        # fallback: strip any trailing parenthetical copy marker
        import re

        m = re.search(r"(\d+)", stem)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 0


def load_parts():
    parts = []
    for path in sorted(DATA_RAW.rglob("messenger_row_part*.json"), key=lambda p: (p.parent.as_posix(), part_number(p))):
        try:
            with path.open('r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    parts.append((path, data))
                else:
                    print(f"⚠️ Skipping non-list file: {path}")
        except Exception as e:
            print(f"❌ Error reading {path}: {e}")
    return parts


def stitch():
    DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
    parts = load_parts()
    print(f"Found {len(parts)} part files")

    dedup = set()
    stitched = []
    for path, entries in parts:
        batch = path.parent.name
        part = part_number(path)
        for i, row in enumerate(entries):
            sender = row.get('sender', 'Unknown')
            text = row.get('raw_text', '')
            media_urls = row.get('media_urls', []) or []
            if DEDUP:
                key_src = f"{sender}|{text}|{'|'.join(media_urls)}|{batch}|{part}|{i}"
                key = hashlib.md5(key_src.encode('utf-8', errors='ignore')).hexdigest()
                if key in dedup:
                    continue
                dedup.add(key)
            stitched.append({
                "sender": sender,
                "content": text,
                "media_urls": media_urls,
                "source_file": str(path.relative_to(DATA_RAW)),
                "batch": batch,
                "part": part,
                "index": i,
            })

    with OUTPUT_FILE.open('w', encoding='utf-8') as f:
        json.dump(stitched, f, ensure_ascii=False, indent=2)

    print(f"✅ Wrote {len(stitched)} messages to {OUTPUT_FILE}")


if __name__ == "__main__":
    stitch()
