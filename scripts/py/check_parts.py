import json
import re
from collections import Counter, defaultdict
from pathlib import Path

RAW_BASE = Path(__file__).resolve().parents[2] / "data" / "raw"
PROCESSED = Path(__file__).resolve().parents[2] / "data" / "processed" / "final_rows.json"

PART_RE = re.compile(r"messenger_row_part_(\d+)")


def raw_inventory():
    batches = defaultdict(set)
    for f in RAW_BASE.rglob("messenger_row_part*.json"):
        stem = f.stem
        m = PART_RE.search(stem)
        if not m:
            continue
        part = int(m.group(1))
        batches[f.parent.name].add(part)
    return {b: (min(s), max(s), len(s)) for b, s in batches.items()}


def processed_parts():
    data = json.load(PROCESSED.open("r", encoding="utf-8"))
    parts = Counter()
    batches = defaultdict(Counter)
    for row in data:
        part = row.get("part")
        batch = row.get("batch")
        if isinstance(part, int):
            parts[part] += 1
            if batch:
                batches[batch][part] += 1
        else:
            sf = row.get("source_file", "")
            m = PART_RE.search(sf)
            if m:
                p = int(m.group(1))
                parts[p] += 1
                if batch:
                    batches[batch][p] += 1
    return parts, batches


def main():
    inv = raw_inventory()
    print("Raw batches (min part, max part, count files):")
    for b in sorted(inv):
        mn, mx, cnt = inv[b]
        print(f"  {b}: min={mn} max={mx} files={cnt}")

    parts, batches = processed_parts()
    if not parts:
        print("No parts found in processed file")
        return
    print("\nProcessed final_rows parts:")
    print(f"  unique parts={len(parts)} min={min(parts)} max={max(parts)} total rows with part tag={sum(parts.values())}")
    print("  Top 15 parts by row count:")
    for part, cnt in parts.most_common(15):
        print(f"    part {part}: {cnt} rows")

    if batches:
        print("\nProcessed parts per batch (min/max/count of parts):")
        for b in sorted(batches):
            keys = list(batches[b].keys())
            print(f"  {b}: min={min(keys)} max={max(keys)} parts={len(keys)} rows={sum(batches[b].values())}")


if __name__ == "__main__":
    main()
