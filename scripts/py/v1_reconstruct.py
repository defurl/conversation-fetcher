# [STEP 3] CLEANER & RECONSTRUCTOR
import json
from pathlib import Path

# --- PATHS ---
ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"

# --- CONFIG ---
INPUT_FILE = DATA_RAW / "raw_chat_dump.json"
OUTPUT_FILE = DATA_PROCESSED / "final_chat_history.json"
PARTNER_NAME = "Bạn nhỏ Xoàii 🥭"  # <--- COPY EXACT NAME FROM CHAT HERE

def clean_chat():
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"❌ Missing file: {INPUT_FILE}")
        return

    items = data.get('items', [])
    width = data.get('width', 1000)
    
    # 1. Sort by Y position (Time order)
    items.sort(key=lambda k: k['y'])

    cleaned_messages = []
    current_sender = None
    current_block = []

    # 2. Process Items
    for item in items:
        text = item['text']
        x = item['rel_x']

        # Skip Noise
        if text in ["Enter", "Seen", "You sent", "Double tap to like", "Sent", "Media"]:
            continue
        
        # --- Logic A: Determine "Side" (Left = Partner, Right = You) ---
        # 45% threshold handles wide monitors well
        side = "Partner" if x < (width * 0.45) else "You"

        # --- Logic B: Split Partner's Name ---
        # If the text IS the partner's name, it's a label, not a message.
        # But we use it to confirm the sender switch.
        if text == PARTNER_NAME:
            continue 

        # If we are in a "Partner" block, but the text contains the name inside it
        # (The "Visual Dump" might have glued them together)
        if side == "Partner" and PARTNER_NAME in text:
            parts = text.split(PARTNER_NAME)
            for p in parts:
                clean_p = p.strip()
                if clean_p:
                    cleaned_messages.append({"sender": PARTNER_NAME, "message": clean_p})
            continue

        # Standard Grouping
        sender_name = "You" if side == "You" else PARTNER_NAME
        
        if sender_name == current_sender:
            current_block.append(text)
        else:
            # Save previous block
            if current_block:
                cleaned_messages.append({
                    "sender": current_sender, 
                    "message": "\n".join(current_block)
                })
            current_sender = sender_name
            current_block = [text]

    # Save final block
    if current_block:
        cleaned_messages.append({"sender": current_sender, "message": "\n".join(current_block)})

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(cleaned_messages, f, indent=4, ensure_ascii=False)
    
    print(f"✅ Success! Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    clean_chat()