"""
v12_clean_rows.py - Clean and deduplicate captured Messenger rows.

Improvements over v11:
- Preserves intentionally repeated messages (same content at different times)
- Only removes capture artifacts (duplicates from scroll overlap within same batch)
- Passes batch info through pipeline for smarter deduplication
"""

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_PROCESSED = ROOT / "data" / "processed"
INPUT_CANDIDATES = [
    DATA_PROCESSED / "final_rows.json",
    DATA_PROCESSED / "v10_final_rows.json",
]
OUTPUT_FILE = DATA_PROCESSED / "v12_final_clean_rows.json"
PARTNER_NAME = "Bạn nhỏ Xoàii 🥭"

# Match timestamps like "18 Dec 2025, 16:19", "Today at 19:30", "Mon 12:00 PM"
TIMESTAMP_REGEX = re.compile(
    r"^(?:"  # start
    r"(?:\d{1,2}\s+[A-Za-z]+)"  # 18 Dec / 18 December
    r"|"  # or day words
    r"(?:Today|Yesterday|[A-Za-z]{3,})"  # Today / Mon / Friday
    r")"  # end day group
    r"(?:\s+\d{4})?"  # optional year
    r",?"  # optional comma
    r"\s+"  # space
    r"(?:at\s+)?"  # optional "at"
    r"\d{1,2}:\d{2}"  # time
    r"(?:\s?[AP]M)?"  # optional AM/PM
    r"$",
    re.IGNORECASE,
)
TIME_ONLY_REGEX = re.compile(r"^\d{1,2}:\d{2}$")

IGNORE_EXACT = {
    "Enter",
    "Seen",
    "Sent",
    "You sent",
    "You",
    "Media",
    "Double tap to like",
    PARTNER_NAME,
}
IGNORE_PREFIXES = (
    "You replied to",
    "You reacted to",
    "You unsent",
    "You removed",
    "You changed",
    "Partner replied to",
    "Bạn nhỏ Xoàii 🥭 replied to",
)
IGNORE_CONTAINS = (
    "replied to you",
    "Original message:",
)
META_NOISE_CONTAINS = (
    "Meta AI",
    "Use the Messenger mobile app to see it",
)


def strip_leading_label(line: str) -> str:
    # Remove leading "You sent" or sender name labels that get duplicated inside content.
    for prefix in ("You sent", "You", PARTNER_NAME):
        if line.startswith(prefix):
            return line[len(prefix):].strip()
    return line


def strip_leading_you_sent(line: str) -> str:
    lowered = line.lower()
    if lowered.startswith("you sent"):
        return line[len("you sent"):].strip()
    return line


NOISE_ATTACHMENT_THRESHOLD = 25


def normalize_url(url: str) -> str:
    """Keep full URL for validity; only strip query on static emoji assets."""
    u = url.strip()
    if "static.xx.fbcdn.net/images/emoji" in u:
        return u.split("?", 1)[0]
    return u


def noise_key(url: str) -> str:
    """Looser canon for noise counting (avatars), drops query so variants aggregate."""
    return url.split("?", 1)[0]


def is_timestamp(line: str) -> bool:
    return bool(TIMESTAMP_REGEX.match(line))


def collect_attachment_counts(rows):
    counts = Counter()
    for entry in rows:
        for url in entry.get("media_urls") or []:
            if not isinstance(url, str):
                continue
            if url.startswith("blob:"):
                continue
            if "static.xx.fbcdn.net/images/emoji" in url:
                continue
            if not url.startswith("http"):
                continue
            counts[noise_key(url)] += 1
    return counts


def filter_attachments(urls, noise_set):
    attachments = []
    seen = set()
    for url in urls or []:
        if not isinstance(url, str):
            continue
        if url.startswith("blob:"):
            continue
        if "static.xx.fbcdn.net/images/emoji" in url:
            continue
        if not url.startswith("http"):
            continue

        canon = normalize_url(url)
        if canon in noise_set:
            continue
        if canon in seen:
            continue
        seen.add(canon)
        attachments.append(canon)
    return attachments


def clean_entry(entry, current_ts, noise_set):
    new_ts = current_ts
    lines = []
    raw_content = entry.get("content", "")
    raw_content = raw_content.replace("Enter", "\n")
    for raw_line in raw_content.splitlines():
        line = strip_leading_label(raw_line.strip())
        if not line:
            continue
        if is_timestamp(line):
            new_ts = line
            continue
        if TIME_ONLY_REGEX.match(line):
            continue

        lower_line = line.lower()
        if line in IGNORE_EXACT:
            continue
        if any(lower_line.startswith(prefix.lower()) for prefix in IGNORE_PREFIXES):
            continue
        if any(token.lower() in lower_line for token in IGNORE_CONTAINS):
            continue
        if any(token.lower() in lower_line for token in META_NOISE_CONTAINS):
            continue

        lines.append(line)

    attachments = filter_attachments(entry.get("media_urls"), noise_set)

    if not lines and not attachments:
        return new_ts, None

    sender = entry.get("sender", "Unknown")
    if sender == "Partner":
        sender = PARTNER_NAME

    message = {
        "timestamp": new_ts or "Unknown Time",
        "sender": sender,
        "content": "\n".join(lines) if lines else "",
        "type": "text" if lines else "media",
        # Preserve source info for deduplication
        "_source_batch": entry.get("batch", "unknown"),
        "_source_part": entry.get("part", 0),
        "_source_index": entry.get("index", 0),
    }

    if attachments:
        message["attachments"] = attachments

    return new_ts, message


def group_messages(messages):
    """Merge consecutive same-sender messages."""
    if not messages:
        return []

    grouped = [messages[0]]
    for msg in messages[1:]:
        last = grouped[-1]
        if msg["sender"] == last["sender"]:
            if msg["content"]:
                if last["content"]:
                    last["content"] += "\n" + msg["content"]
                else:
                    last["content"] = msg["content"]
            if msg.get("attachments"):
                existing = set(last.get("attachments", []))
                for att in msg["attachments"]:
                    if att not in existing:
                        last.setdefault("attachments", []).append(att)
                        existing.add(att)
            # Prefer a real timestamp if previous was Unknown Time
            if last.get("timestamp") == "Unknown Time" and msg.get("timestamp") != "Unknown Time":
                last["timestamp"] = msg["timestamp"]
            # Preserve earliest source for dedup tracking
            continue

        grouped.append(msg)

    return grouped


def dedupe_consecutive(messages):
    """Remove exact consecutive duplicates."""
    if not messages:
        return []
    out = [messages[0]]
    for msg in messages[1:]:
        prev = out[-1]
        if (
            msg["sender"] == prev.get("sender")
            and (msg.get("content") or "") == (prev.get("content") or "")
            and sorted(msg.get("attachments") or []) == sorted(prev.get("attachments") or [])
        ):
            continue
        out.append(msg)
    return out


def dedupe_capture_artifacts(messages):
    """
    Remove duplicate messages that are capture artifacts (same message captured
    multiple times due to scroll overlap), while PRESERVING intentionally 
    repeated messages.
    
    A capture artifact is identified by:
    - Same sender, same normalized content
    - From the same batch (scroll overlap within one session)
    
    Intentionally repeated messages (sent at different times) are preserved
    because they come from different parts of the conversation.
    """
    if not messages:
        return []

    def norm_text(t: str) -> str:
        # Collapse whitespace and strip repeated sender labels inside the text.
        t = t.replace(PARTNER_NAME, "").strip()
        return " ".join(t.split())

    out = []
    # Track (sender, content) -> (message, batch, part) for recent messages
    # We use a sliding window approach: only dedupe within same batch
    batch_seen = {}  # batch -> {(sender, content) -> message}
    
    for msg in messages:
        sender = msg.get("sender")
        text_key = norm_text(msg.get("content") or "")
        batch = msg.get("_source_batch", "unknown")
        attachments = msg.get("attachments") or []
        
        key = (sender, text_key)
        
        # Get or create batch tracking dict
        if batch not in batch_seen:
            batch_seen[batch] = {}
        
        # Check if this is a capture artifact (same message in same batch)
        if key in batch_seen[batch]:
            prev_msg = batch_seen[batch][key]
            # This is a capture artifact - merge attachments and skip
            if attachments:
                existing_atts = set(prev_msg.get("attachments", []))
                for att in attachments:
                    if att not in existing_atts:
                        prev_msg.setdefault("attachments", []).append(att)
                        existing_atts.add(att)
            continue  # Skip this duplicate
        
        # New unique message in this batch
        # (Could be repeated from another batch - that's intentional repetition)
        out.append(msg)
        batch_seen[batch][key] = msg
    
    return out


def strip_internal_fields(messages):
    """Remove internal tracking fields before final output."""
    for msg in messages:
        msg.pop("_source_batch", None)
        msg.pop("_source_part", None)
        msg.pop("_source_index", None)
    return messages


def main():
    input_file = None
    for candidate in INPUT_CANDIDATES:
        if candidate.exists():
            input_file = candidate
            break

    if input_file is None:
        raise FileNotFoundError(
            f"Input file not found. Checked: {[str(p) for p in INPUT_CANDIDATES]}"
        )

    print(f"📂 Loading from: {input_file}")
    with input_file.open("r", encoding="utf-8") as f:
        raw_rows = json.load(f)

    print(f"📊 Loaded {len(raw_rows)} raw rows")

    # Identify very frequent attachment URLs (likely avatars) and drop them globally.
    noise_counts = collect_attachment_counts(raw_rows)
    noise_set = {url for url, count in noise_counts.items() if count >= NOISE_ATTACHMENT_THRESHOLD}
    print(f"🔇 Identified {len(noise_set)} noise URLs (appearing {NOISE_ATTACHMENT_THRESHOLD}+ times)")

    cleaned = []
    current_ts = None
    for entry in raw_rows:
        current_ts, msg = clean_entry(entry, current_ts, noise_set)
        if msg:
            cleaned.append(msg)

    print(f"🧹 Cleaned to {len(cleaned)} rows")

    grouped = group_messages(cleaned)
    print(f"📦 Grouped to {len(grouped)} messages")

    grouped = dedupe_consecutive(grouped)
    print(f"🔄 After consecutive dedup: {len(grouped)} messages")

    grouped = dedupe_capture_artifacts(grouped)
    print(f"✨ After capture artifact dedup: {len(grouped)} messages")

    # Strip internal fields before output
    grouped = strip_internal_fields(grouped)

    DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(grouped, f, ensure_ascii=False, indent=4)

    print(
        f"✅ Cleaned {len(raw_rows)} raw rows -> {len(grouped)} grouped messages. "
        f"Output: {OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()
