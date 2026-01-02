import json
import re
import base64
import os
import hashlib
from pathlib import Path

# --- PATHS ---
ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / 'data' / 'raw'
DATA_PROCESSED = ROOT / 'data' / 'processed'
MEDIA_FOLDER = ROOT / 'downloaded_media'

# --- CONFIG ---
INPUT_FILE = DATA_RAW / 'messenger_media_snapshots.json'
OUTPUT_FILE = DATA_PROCESSED / 'final_clean_chat_v5.json'
PARTNER_NAME = "Bạn nhỏ Xoàii 🥭"

# THRESHOLD: Images smaller than 20KB are likely thumbnails -> Delete them
MIN_IMAGE_SIZE = 20 * 1024 

# Create media folder
MEDIA_FOLDER.mkdir(parents=True, exist_ok=True)

# --- IMPROVED REGEX ---
# Catches:
# - "18 Dec 2025, 16:19"
# - "18 December at 14:25"
# - "Today at 19:30"
# - "Mon 12:00 PM"
TIMESTAMP_REGEX = re.compile(
    r'^(?:'                          # START of Group
      r'(?:\d{1,2}\s+[A-Za-z]+)'     # Option A: "18 Dec" or "18 December"
      r'|'                           # OR
      r'(?:Today|Yesterday|[A-Za-z]{3,})' # Option B: "Today", "Mon", "Friday"
    r')'                             # END of Group
    r'(?:\s+\d{4})?'                 # Optional Year: " 2025"
    r',?'                            # Optional Comma: ","
    r'\s+'                           # Space
    r'(?:at\s+)?'                    # Optional "at ": "at "
    r'\d{1,2}:\d{2}'                 # Time: "16:19"
    r'(?:\s?[AP]M)?'                 # Optional AM/PM
    r'$',                            # End of string
    re.IGNORECASE                    # Case insensitive
)

def get_image_size(b64_string):
    try:
        padding = b64_string.count('=')
        return (len(b64_string) * 3) / 4 - padding
    except:
        return 0

def save_base64_image(b64_string, sender):
    try:
        if ',' in b64_string:
            header, encoded = b64_string.split(',', 1)
        else:
            return None
        
        ext = 'png'
        if 'image/jpeg' in header: ext = 'jpg'
        elif 'image/webp' in header: ext = 'webp'
        elif 'image/gif' in header: ext = 'gif'
        
        data = base64.b64decode(encoded)
        file_hash = hashlib.md5(data).hexdigest()[:10]
        filename = f"{sender}_{file_hash}.{ext}"
        filepath = MEDIA_FOLDER / filename
        
        if not filepath.exists():
            with open(filepath, 'wb') as f:
                f.write(data)
        return str(filepath).replace('\\', '/')
    except Exception as e:
        print(f"⚠️ Image error: {e}")
        return None

def stitch_and_clean():
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            snapshots = json.load(f)
    except FileNotFoundError:
        print("❌ File not found.")
        return

    print(f"Loading {len(snapshots)} snapshots...")
    snapshots.reverse() # Oldest -> Newest

    # 1. FLATTEN & DEDUPLICATE
    raw_items = []
    seen_hashes = set()

    for snapshot in snapshots:
        for item in snapshot:
            text = item.get('content', '')
            sender = item['sender']
            img_data = item.get('image_data')

            if img_data:
                # Dedupe by image hash
                content_hash = hashlib.md5(img_data.encode()).hexdigest()
                unique_key = f"IMG|{content_hash}"
            else:
                # Dedupe by text
                unique_key = f"TXT|{sender}|{text}"
            
            if unique_key not in seen_hashes:
                seen_hashes.add(unique_key)
                raw_items.append(item)

    # 2. FILTERING & FORMATTING
    final_messages = []
    current_time_label = "Unknown Time"
    
    # Text noise to strictly ignore
    ignore_exact = {"Enter", "Seen", "You sent", "Double tap to like", "Sent", "Media", PARTNER_NAME}

    i = 0
    while i < len(raw_items):
        item = raw_items[i]
        text = item.get('content', '')
        sender = item['sender']
        img_data = item.get('image_data')

        # --- A. TIMESTAMP DETECTION (The Fix) ---
        # If the line matches our new powerful regex, capture it as time and SKIP adding it as a message.
        if TIMESTAMP_REGEX.match(text) or text.startswith("Today at") or text.startswith("Yesterday at"):
            current_time_label = text
            i += 1
            continue

        # --- B. NOISE CLEANING ---
        if text in ignore_exact or "replied to you" in text or "replied to them" in text:
            i += 1
            continue
        
        if sender == "Partner": sender = PARTNER_NAME

        # --- C. IMAGE PROCESSING ---
        if img_data:
            img_size = get_image_size(img_data)
            
            # Reply Thumbnail Check:
            # If image is small (<20KB) AND the next item is text from the same person...
            is_reply_context = False
            if i + 1 < len(raw_items):
                next_item = raw_items[i+1]
                if not next_item.get('image_data') and next_item['sender'] == item['sender']:
                    is_reply_context = True

            if img_size < MIN_IMAGE_SIZE and is_reply_context:
                # Skip this thumbnail
                i += 1
                continue

            # Save valid image
            saved_path = save_base64_image(img_data, "Partner" if sender == PARTNER_NAME else "You")
            if saved_path:
                final_messages.append({
                    "timestamp": current_time_label,
                    "sender": sender,
                    "content": f"[Attachment: {saved_path}]",
                    "attachment_path": saved_path,
                    "type": "image"
                })
            i += 1
            continue

        # --- D. NORMAL TEXT ---
        final_messages.append({
            "timestamp": current_time_label,
            "sender": sender,
            "content": text,
            "type": "text"
        })
        i += 1

    # 3. GROUPING
    grouped_chat = []
    if final_messages:
        curr_msg = final_messages[0]
        block_lines = [curr_msg['content']]
        attachments = []
        if curr_msg.get('attachment_path'): attachments.append(curr_msg['attachment_path'])
        
        for msg in final_messages[1:]:
            # Group if Sender matches
            if msg['sender'] == curr_msg['sender']:
                block_lines.append(msg['content'])
                if msg.get('attachment_path'): attachments.append(msg['attachment_path'])
            else:
                # Save block
                curr_msg['content'] = "\n".join(block_lines)
                if attachments: curr_msg['attachments'] = attachments
                grouped_chat.append(curr_msg)
                
                # New block
                curr_msg = msg
                block_lines = [curr_msg['content']]
                attachments = []
                if curr_msg.get('attachment_path'): attachments.append(curr_msg['attachment_path'])
        
        # Save last block
        curr_msg['content'] = "\n".join(block_lines)
        if attachments: curr_msg['attachments'] = attachments
        grouped_chat.append(curr_msg)

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(grouped_chat, f, indent=4, ensure_ascii=False)
    
    print(f"✅ Success! Cleaned timestamps & images. Saved to {OUTPUT_FILE}")

stitch_and_clean()