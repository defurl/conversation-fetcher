# convo-fetcher

Tools to scrape a Messenger thread in the browser, keep memory in check, and produce a cleaned conversation JSON with usable media URLs.

## Quick start

1. Open the target Messenger thread in a desktop browser. Open DevTools Console and paste the contents of `scripts/js/v12_adaptive_collector.js` (recommended) or `scripts/js/v10_row_prune_collector.js`, then click inside the message pane. Batches (`messenger_row_part_*.json`) will auto-download as you scroll.
2. Place downloaded parts under `data/raw/batchN/` (one folder per run). See `data_sample/` for expected structure.
3. From repo root, stitch and clean:

- Windows: `./.venv/Scripts/python.exe scripts/py/v10_stitch_rows.py` then `./.venv/Scripts/python.exe scripts/py/v12_clean_rows.py`
- macOS/Linux: `python3 scripts/py/v10_stitch_rows.py` then `python3 scripts/py/v12_clean_rows.py`

4. Stitched rows land at `data/processed/final_rows.json`; cleaned, grouped chat at `data/processed/v12_final_clean_rows.json`.

## How the JS collector works

- **Container detection**: Finds the scrollable message list from the click target (or the Messenger pagelet) and records its bounding box.
- **Capture loop**: On each cycle, grabs rows in view, infers sender (left/right heuristic plus text cues), captures `raw_text`, and extracts media URLs from `src`, `srcset`, multiple `data-*` attributes, inline/computed backgrounds, and parent styles. Blob URLs and avatar-like URLs are skipped.
- **Memory control**: Strips blob sources after capture. A pruning pass replaces far-off rows with zero-opacity placeholders to preserve scroll height but release DOM/memory, letting lazy-load continue without blowing heap.
- **Batch save**: Every 50 rows (configurable), serializes the batch and forces a download link. Diagnostics are logged every few cycles.

## How the Python pipeline works

- **Stitch (`v10_stitch_rows.py`)**: Scans `data/raw/batch*/messenger_row_part*.json`, orders by batch and part number, and emits `final_rows.json` with `sender`, `content`, `media_urls`, `batch`, `part`, and `index`. Dedup across batches is intentionally off to avoid dropping late coverage.
- **Clean (`v11_clean_rows.py`)**:
  - Drops service noise (timestamps-as-lines, system prompts, Meta AI notices, repeated sender labels, emoji image URLs, blobs).
  - Normalizes `Enter` markers to newlines and strips leading "You sent" / sender labels inside text.
  - Filters frequent avatar URLs via global frequency.
  - Merges consecutive same-sender messages, dedupes attachments, and removes duplicates within the same timestamp/sender/content (merging attachments into the first hit).
  - Outputs grouped messages with `timestamp`, `sender`, `content`, and optional `attachments`.
- **Reports**: `scripts/py/report_batches.py` gives batch coverage and duplicate stats; `scripts/py/check_parts.py` compares raw batch files against processed parts.

## Files of interest

- `scripts/js/v10_row_prune_collector.js` — in-browser collector with pruning and media capture.
- `scripts/js/v12_adaptive_collector.js` — **v12**: adaptive scroll timing + duplicate row skip.
- `scripts/py/v10_stitch_rows.py` — stitches all batch parts into one rows file.
- `scripts/py/v11_clean_rows.py` — cleans, groups, and dedupes rows into the final convo.
- `scripts/py/v12_clean_rows.py` — **v12**: improved dedup that preserves intentional repeated messages.
- `scripts/py/report_batches.py`, `scripts/py/check_parts.py` — diagnostics for coverage and parts sanity.

## v12 Improvements

The v12 scripts address RAM consumption and data integrity issues:

### JS Collector (`v12_adaptive_collector.js`)

- **Adaptive scroll timing**: Starts fast (800ms), slows down (up to 5s) when content takes time to load, speeds back up when flowing.
- **Duplicate row skip**: Tracks captured row signatures to prevent the same message from being captured multiple times due to scroll overlap.
- **More aggressive pruning**: Prunes rows 300px from viewport (vs 500px in v10).

### Python Cleaner (`v12_clean_rows.py`)

- **Preserves intentional repeats**: Only removes capture artifacts (same message in same batch), not messages intentionally sent multiple times.
- **Batch-aware deduplication**: Tracks source batch to distinguish between scroll overlap duplicates and legitimate repeated messages.

### Usage

```bash
# Use v12 collector in browser console (same workflow as v10)
# Then stitch and clean:
./.venv/Scripts/python.exe scripts/py/v10_stitch_rows.py
./.venv/Scripts/python.exe scripts/py/v12_clean_rows.py
# Output: data/processed/v12_final_clean_rows.json
```

## Notes

- Run in a clean browser tab; leave DevTools console open. The collector pauses only if you click STOP or the tab is force-paused for memory. Placeholder pruning keeps scroll height so older history can continue loading.
- Media URLs are preserved with query strings to keep signatures valid.
- If you need to re-run cleaning after adjusting rules, just rerun `v11_clean_rows.py`; it reads `data/processed/final_rows.json`.
