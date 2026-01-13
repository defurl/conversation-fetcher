# check_chronology.py - Verify chronological order of processed messages
import json
import re
from pathlib import Path
from datetime import datetime, timedelta

ROOT = Path(__file__).resolve().parents[2]
DATA_PROCESSED = ROOT / "data" / "processed"
INPUT_FILE = DATA_PROCESSED / "v12_final_clean_rows.json"

# Helper to parse timestamp strings into datetime objects
def parse_timestamp(ts: str) -> datetime | None:
    if not ts or ts == "Unknown Time":
        return None
    ts = ts.strip()
    # Today/Yesterday patterns
    today_match = re.match(r"^(Today|Yesterday) at (\d{1,2}:\d{2})(?:\s*([AP]M))?", ts, re.IGNORECASE)
    if today_match:
        day_word, time_part, ampm = today_match.groups()
        hour_min = time_part
        if ampm:
            hour_min = f"{hour_min} {ampm.upper()}"
        dt = datetime.strptime(hour_min, "%I:%M %p" if ampm else "%H:%M")
        now = datetime.now()
        if day_word.lower() == "yesterday":
            dt = dt.replace(year=now.year, month=now.month, day=now.day) - timedelta(days=1)
        else:
            dt = dt.replace(year=now.year, month=now.month, day=now.day)
        return dt
    # Full date patterns like "11 December 2024, 21:45" or "11/12/2024, 21:45"
    full_match = re.search(r"(\d{1,2}[ /]\w+[ /]\d{4}|\d{1,2}/\d{1,2}/\d{4}),?\s+(\d{1,2}:\d{2})(?:\s*([AP]M))?", ts, re.IGNORECASE)
    if full_match:
        date_part, time_part, ampm = full_match.groups()
        # Normalize date format
        try:
            dt = datetime.strptime(f"{date_part} {time_part} {ampm or ''}".strip(), "%d %B %Y %H:%M %p")
        except ValueError:
            try:
                dt = datetime.strptime(f"{date_part} {time_part} {ampm or ''}".strip(), "%d/%m/%Y %H:%M %p")
            except ValueError:
                return None
        return dt
    # Fallback: try ISO format
    try:
        return datetime.fromisoformat(ts)
    except Exception:
        return None

def main():
    with INPUT_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    prev_dt = None
    out_of_order = []
    for idx, entry in enumerate(data):
        ts_str = entry.get("timestamp")
        dt = parse_timestamp(ts_str)
        if dt is None:
            continue
        if prev_dt and dt < prev_dt:
            out_of_order.append((idx, ts_str, prev_dt.isoformat()))
        prev_dt = dt
    print(f"Total messages: {len(data)}")
    print(f"Out-of-order entries found: {len(out_of_order)}")
    if out_of_order:
        print("First few out-of-order entries (index, timestamp, previous timestamp):")
        for item in out_of_order[:10]:
            print(item)

if __name__ == "__main__":
    main()
