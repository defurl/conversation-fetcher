import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable, Tuple

DATE_PATTERN = re.compile(
    r"(?:\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|"
    r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?,?\s+\d{1,2}|"
    r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))",
    re.IGNORECASE,
)


def extract_date_markers(text: str) -> Iterable[str]:
    if not text:
        return []
    return [m.group(0) for m in DATE_PATTERN.finditer(text)]


def load_messages(base: Path) -> Tuple[Counter, dict, Counter, dict, Counter, dict]:
    files = sorted(base.glob("batch*/messenger_row_part*.json"))
    per_batch_counts = Counter()
    per_file_counts = {}
    date_counts_global = Counter()
    date_counts_per_batch = defaultdict(Counter)
    first_marker_per_batch = {}
    last_marker_per_batch = {}
    dup_batches = defaultdict(set)
    total_messages = 0

    for f in files:
        batch = f.parent.name
        try:
            data = json.load(open(f, "r", encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"Failed to load {f}: {exc}")
            continue

        per_file_counts[str(f.relative_to(base))] = len(data)
        for msg in data:
            sender = msg.get("sender")
            raw_text = (msg.get("raw_text") or "").strip()
            media_urls = tuple(sorted(msg.get("media_urls") or []))
            key = (sender, raw_text, media_urls)
            dup_batches[key].add(batch)
            per_batch_counts[batch] += 1
            total_messages += 1

            for marker in extract_date_markers(raw_text):
                date_counts_global[marker] += 1
                date_counts_per_batch[batch][marker] += 1
                if batch not in first_marker_per_batch:
                    first_marker_per_batch[batch] = marker
                last_marker_per_batch[batch] = marker

    return (
        per_batch_counts,
        per_file_counts,
        date_counts_global,
        date_counts_per_batch,
        dup_batches,
        total_messages,
        first_marker_per_batch,
        last_marker_per_batch,
    )


def main():
    parser = argparse.ArgumentParser(description="Report coverage/duplication across batch JSONs")
    parser.add_argument("--base", default="data/raw", help="Base directory containing batch*/messenger_row_part*.json")
    parser.add_argument("--top", type=int, default=20, help="Top N date markers to display")
    parser.add_argument("--dupes", type=int, default=20, help="Sample count of duplicate keys to show")
    args = parser.parse_args()

    base = Path(args.base).resolve()
    (
        per_batch_counts,
        per_file_counts,
        date_counts_global,
        date_counts_per_batch,
        dup_batches,
        total_messages,
        first_marker_per_batch,
        last_marker_per_batch,
    ) = load_messages(base)

    files_total = len(per_file_counts)
    print(f"Base: {base}")
    print(f"Total files: {files_total}")
    print(f"Total messages: {total_messages}")

    print("\nMessages per batch:")
    for batch, count in sorted(per_batch_counts.items()):
        print(f"  {batch}: {count}")

    print("\nTop date markers (global):")
    for marker, count in date_counts_global.most_common(args.top):
        print(f"  {marker}: {count}")

    print("\nTop date markers per batch:")
    for batch in sorted(per_batch_counts):
        top_dates = date_counts_per_batch[batch].most_common(5)
        top_str = ", ".join([f"{d}:{c}" for d, c in top_dates]) or "none"
        print(f"  {batch}: {top_str}")

    print("\nFirst/last date-like markers per batch (order of appearance in files):")
    for batch in sorted(per_batch_counts):
        first = first_marker_per_batch.get(batch, "none")
        last = last_marker_per_batch.get(batch, "none")
        print(f"  {batch}: first={first} | last={last}")

    dup_keys = [k for k, v in dup_batches.items() if len(v) > 1]
    print(f"\nDuplicate message keys spanning batches: {len(dup_keys)}")
    for sample in dup_keys[: args.dupes]:
        sender, text, media = sample
        batches = sorted(dup_batches[sample])
        text_preview = (text[:80] + "…") if len(text) > 80 else text
        media_preview = list(media)
        print(f"  Sender={sender} | Batches={batches} | Text='{text_preview}' | Media={media_preview}")

    if not date_counts_global:
        print("\nNo date-like markers found. To detect missing days reliably, capture actual message timestamps.")
    else:
        print("\nDate markers are heuristic. To detect missing days accurately, capture per-message timestamps from UI.")


if __name__ == "__main__":
    main()
