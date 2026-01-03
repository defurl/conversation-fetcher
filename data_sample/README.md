# Sample Data Structure

This directory contains sample files to illustrate the expected data format at each stage of the pipeline.

## Directory Structure

```
data_sample/
├── raw/
│   └── batch1/
│       ├── messenger_row_part_1.json    # Raw capture from JS collector
│       └── messenger_row_part_2.json    # Another part from same session
└── processed/
    ├── final_rows.json                  # After v10_stitch_rows.py
    └── v12_final_clean_rows.json        # After v12_clean_rows.py
```

## Data Flow

```
Browser (JS Collector)
    ↓ Downloads messenger_row_part_*.json files
data/raw/batchN/
    ↓ Run: python scripts/py/v10_stitch_rows.py
data/processed/final_rows.json
    ↓ Run: python scripts/py/v12_clean_rows.py
data/processed/v12_final_clean_rows.json
```

## File Formats

### Raw Part Files (`messenger_row_part_*.json`)

Each entry captured from the browser DOM:

```json
{
  "y": 133, // Y position in viewport (for ordering)
  "sender": "Partner", // "You" or "Partner" (detected by position/text)
  "raw_text": "Partner Name\nMessage content\nEnter", // Raw innerText
  "media_urls": [], // Captured image/video URLs
  "ts": 1767387670451 // JavaScript timestamp (ms)
}
```

### Stitched File (`final_rows.json`)

After combining all parts with source tracking:

```json
{
  "sender": "Partner",
  "content": "Partner Name\nMessage content\nEnter",
  "media_urls": [],
  "source_file": "batch1\\messenger_row_part_1.json",
  "batch": "batch1",
  "part": 1,
  "index": 0
}
```

### Clean Output (`v12_final_clean_rows.json`)

Final cleaned and deduplicated messages:

```json
{
  "timestamp": "27 Dec 2025, 15:30", // Extracted from raw_text
  "sender": "Partner Name", // Resolved sender name
  "content": "Message content", // Cleaned text (no noise)
  "type": "text", // "text" or "media"
  "attachments": [
    // Optional, if media present
    "https://example.com/image.jpg"
  ]
}
```

## Usage

1. Copy `data_sample/` structure to `data/`
2. Place your captured files in `data/raw/batchN/`
3. Run the pipeline as documented in README.md

## Notes

- Part numbers increment as you scroll back in time (part 1 = most recent)
- Batch folders separate different scraping sessions
- The `Enter` markers in raw_text are converted to newlines during cleaning
- Emoji URLs from `static.xx.fbcdn.net/images/emoji` are filtered out
- Avatar URLs are filtered by frequency (appearing 25+ times = noise)
