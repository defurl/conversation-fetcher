import json
import re
from pathlib import Path

# --- PATHS ---
ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"

# --- CONFIG ---
INPUT_FILE = DATA_RAW / 'messenger_raw_snapshots.json'
OUTPUT_FILE = DATA_PROCESSED / 'final_clean_chat_chronological.json'
PARTNER_NAME = "Bạn nhỏ Xoàii 🥭" 

# Regex to detect timestamps (19:30, Today at...)
TIME_PATTERN = re.compile(r'^(?:Today|Yesterday|[A-Za-z]{3})?\s?(?:at)?\s?\d{1,2}:\d{2}(?:\s?[AP]M)?$')

def stitch_chronological():
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            snapshots = json.load(f)
    except FileNotFoundError:
        print("❌ File not found.")
        return

    print(f"Loading {len(snapshots)} snapshots...")

    # --- STEP 1: SORT SNAPSHOTS ---
    # Snapshots were captured Newest -> Oldest (Scrolling Up).
    # We simply reverse the LIST of snapshots to get Oldest -> Newest.
    snapshots.reverse() 

    raw_items = []
    seen_hashes = set()

    # --- STEP 2: FLATTEN ---
    # Now we iterate through the snapshots in chronological order.
    # Inside each snapshot, items are ALREADY Top->Bottom (Old->New).
    # So we just append them.
    for snapshot in snapshots:
        for item in snapshot:
            text = item['text']
            sender = item['sender']

            # Deduplication key (Sender + Text)
            unique_key = f"{sender}|{text}"
            
            if unique_key not in seen_hashes:
                seen_hashes.add(unique_key)
                raw_items.append(item)

    final_messages = []
    current_time_label = "Unknown Time"
    
    # Noise filters
    ignore_exact = {
        "Enter", "Seen", "You sent", "Double tap to like", "Sent", "Media", 
        PARTNER_NAME, "Original message:"
    }

    i = 0
    while i < len(raw_items):
        item = raw_items[i]
        text = item['text']
        sender = item['sender']

        # 1. Update Time Label (and skip the line)
        if TIME_PATTERN.match(text) or text.startswith("Today at") or text.startswith("Yesterday at"):
            current_time_label = text
            i += 1
            continue

        # 2. Filter Noise
        if text in ignore_exact or text.startswith("Reacted ") or text == "You":
            i += 1
            continue

        # 3. Handle "Reply" Junk Text
        # Example: "Bạn nhỏ Xoàii 🥭 replied to you" -> We skip this line.
        if "replied to you" in text or "replied to them" in text:
            i += 1
            continue

        # 4. Normalize Sender Name
        if sender == "Partner":
            sender = PARTNER_NAME

        # 5. Add to List
        final_messages.append({
            "timestamp": current_time_label,
            "sender": sender,
            "content": text
        })
        i += 1

    # --- STEP 3: GROUPING (Chronological) ---
    grouped_chat = []
    if final_messages:
        curr_msg = final_messages[0]
        # Start the block with the first line
        block_lines = [curr_msg['content']]
        
        for msg in final_messages[1:]:
            # If same sender and same time (approx), group them
            if msg['sender'] == curr_msg['sender']:
                block_lines.append(msg['content'])
            else:
                # 1. Save the finished block
                curr_msg['content'] = "\n".join(block_lines)
                grouped_chat.append(curr_msg)
                
                # 2. Start new block
                curr_msg = msg
                block_lines = [curr_msg['content']]
        
        # Save the very last block
        curr_msg['content'] = "\n".join(block_lines)
        grouped_chat.append(curr_msg)

    # Save
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(grouped_chat, f, indent=4, ensure_ascii=False)
    
    print(f"✅ Success! Corrected order: Oldest -> Newest.")
    print(f"📁 Saved to {OUTPUT_FILE}")

stitch_chronological()