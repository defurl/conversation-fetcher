import json
import re
import base64
import os
import hashlib
import glob
from pathlib import Path

# --- PATHS ---
ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / 'data' / 'raw'
DATA_PROCESSED = ROOT / 'data' / 'processed'
MEDIA_FOLDER = ROOT / 'downloaded_media'

# --- CONFIG ---
OUTPUT_FILE = DATA_PROCESSED / 'final_complete_history.json'
PARTNER_NAME = "Bạn nhỏ Xoàii 🥭"

# Create media folder
MEDIA_FOLDER.mkdir(parents=True, exist_ok=True)

# REGEX & HELPERS (Same as before)
TIMESTAMP_REGEX = re.compile(r'^(?:(?:\d{1,2}\s+[A-Za-z]+)|(?:Today|Yesterday|[A-Za-z]{3,}))(?:\s+\d{4})?,?\s+(?:at\s+)?\d{1,2}:\d{2}(?:\s?[AP]M)?$', re.IGNORECASE)
MIN_IMAGE_SIZE = 20 * 1024 

def save_base64_image(b64_string, sender):
    try:
        if ',' in b64_string: header, encoded = b64_string.split(',', 1)
        else: return None
        
        ext = 'png'
        if 'image/jpeg' in header: ext = 'jpg'
        elif 'image/webp' in header: ext = 'webp'
        elif 'image/gif' in header: ext = 'gif'
        
        data = base64.b64decode(encoded)
        file_hash = hashlib.md5(data).hexdigest()[:10]
        filename = f"{sender}_{file_hash}.{ext}"
        filepath = MEDIA_FOLDER / filename
        
        if not filepath.exists():
            with open(filepath, 'wb') as f: f.write(data)
        return str(filepath).replace('\\', '/')
    except: return None

def stitch_batches():
    # 1. FIND ALL BATCH FILES
    # Look for files matching pattern
    files = [str(p) for p in DATA_RAW.glob("messenger_part_*.json")]
    
    # Sort them by creation time or number to ensure correct order
    # Assuming standard naming: messenger_part_1, messenger_part_2...
    # We extract the number to sort correctly (so 10 comes after 2, not before)
    def get_part_num(filename):
        try:
            return int(re.search(r'part_(\d+)', filename).group(1))
        except:
            return 0
    
    files.sort(key=get_part_num)

    if not files:
        print("❌ No 'messenger_part_*.json' files found in folder!")
        return

    print(f"📂 Found {len(files)} batch files. Merging...")

    # 2. MERGE SNAPSHOTS
    all_snapshots = []
    for filename in files:
        print(f"   -> Loading {filename}...")
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
                all_snapshots.extend(data)
        except Exception as e:
            print(f"⚠️ Error reading {filename}: {e}")

    # Now we have one giant list, just like before.
    # Since Part 1 was Newest and Part 10 is Oldest (captured last),
    # The list is [Newest Data ... Oldest Data].
    # We need Oldest -> Newest.
    all_snapshots.reverse()

    print(f"Processing {len(all_snapshots)} total frames...")

    # 3. PROCESSING (Same logic as v5)
    raw_items = []
    seen_hashes = set()

    for snapshot in all_snapshots:
        for item in snapshot:
            text = item.get('content', '')
            sender = item['sender']
            img_data = item.get('image_data')

            if img_data:
                content_hash = hashlib.md5(img_data.encode()).hexdigest()
                unique_key = f"IMG|{content_hash}"
            else:
                unique_key = f"TXT|{sender}|{text}"
            
            if unique_key not in seen_hashes:
                seen_hashes.add(unique_key)
                raw_items.append(item)

    final_messages = []
    current_time_label = "Unknown Time"
    ignore_exact = {"Enter", "Seen", "You sent", "Double tap to like", "Sent", "Media", PARTNER_NAME}

    i = 0
    while i < len(raw_items):
        item = raw_items[i]
        text = item.get('content', '')
        sender = item['sender']
        img_data = item.get('image_data')

        if TIMESTAMP_REGEX.match(text) or text.startswith("Today at") or text.startswith("Yesterday at"):
            current_time_label = text
            i += 1
            continue

        if text in ignore_exact or "replied to you" in text or "replied to them" in text:
            i += 1
            continue
        
        if sender == "Partner": sender = PARTNER_NAME

        if img_data:
            # Thumbnail Logic
            img_size = len(img_data) * 0.75 # Approx size
            is_reply_context = False
            if i + 1 < len(raw_items):
                next_item = raw_items[i+1]
                if not next_item.get('image_data') and next_item['sender'] == item['sender']:
                    is_reply_context = True

            if img_size < MIN_IMAGE_SIZE and is_reply_context:
                i += 1
                continue

            saved_path = save_base64_image(img_data, "Partner" if sender == PARTNER_NAME else "You")
            if saved_path:
                final_messages.append({
                    "timestamp": current_time_label, "sender": sender,
                    "content": f"[Attachment: {saved_path}]",
                    "attachment_path": saved_path, "type": "image"
                })
            i += 1
            continue

        final_messages.append({
            "timestamp": current_time_label, "sender": sender,
            "content": text, "type": "text"
        })
        i += 1

    # Grouping
    grouped_chat = []
    if final_messages:
        curr_msg = final_messages[0]
        block_lines = [curr_msg['content']]
        attachments = []
        if curr_msg.get('attachment_path'): attachments.append(curr_msg['attachment_path'])
        
        for msg in final_messages[1:]:
            if msg['sender'] == curr_msg['sender']:
                block_lines.append(msg['content'])
                if msg.get('attachment_path'): attachments.append(msg['attachment_path'])
            else:
                curr_msg['content'] = "\n".join(block_lines)
                if attachments: curr_msg['attachments'] = attachments
                grouped_chat.append(curr_msg)
                
                curr_msg = msg
                block_lines = [curr_msg['content']]
                attachments = []
                if curr_msg.get('attachment_path'): attachments.append(curr_msg['attachment_path'])
        
        curr_msg['content'] = "\n".join(block_lines)
        if attachments: curr_msg['attachments'] = attachments
        grouped_chat.append(curr_msg)

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(grouped_chat, f, indent=4, ensure_ascii=False)
    
    print(f"✅ COMPLETE! Stitched {len(files)} batches into {OUTPUT_FILE}")

stitch_batches()