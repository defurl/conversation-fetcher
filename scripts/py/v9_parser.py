import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"

INPUT_FILE = DATA_RAW / "full_chat_history.txt"
OUTPUT_FILE = DATA_PROCESSED / "final_chat_history.json"
PARTNER_NAME = "Bạn nhỏ Xoàii 🥭"  # Exact name used in chat

def parse_text_chat():
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        # Read the whole block
        raw_data = f.read()

    # Split by the separator we used in JS
    blocks = raw_data.split("[----------------]")
    
    messages = []
    
    # We need to process this carefully. 
    # Usually, a block contains a chunk of text.
    # We will try to clean it line by line.
    
    for block in blocks:
        lines = block.strip().split('\n')
        for line in lines:
            line = line.strip()
            if not line: continue
            
            # Simple heuristic:
            # If line is exactly PARTNER_NAME -> Next lines are from Partner
            # If line is "You sent" -> Next lines are from You
            
            # Since we lost the spatial (left/right) data, we rely on these headers.
            # If we can't find a header, we assume it continues the previous sender.
            
            # Note: This is imperfect but usually works for text dumps.
            messages.append({
                "raw_content": line
            })
            
    # For a Knowledge Base, we might just want the raw lines 
    # if we can't perfectly guarantee Sender identification.
    # But let's try to structure it.
    
    structured_msgs = []
    current_sender = "Unknown"
    
    for msg in messages:
        text = msg['raw_content']
        
        if text == PARTNER_NAME:
            current_sender = PARTNER_NAME
            continue
        if text == "You sent" or text == "You":
            current_sender = "You"
            continue
            
        # Timestamp filter
        if re.match(r'^\d{1,2}:\d{2}$', text) or text.startswith("Today at"):
            continue
            
        structured_msgs.append({
            "sender": current_sender,
            "message": text
        })
        
    # Save
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(structured_msgs, f, indent=4, ensure_ascii=False)
        
    print(f"✅ Converted text dump to {len(structured_msgs)} JSON messages.")

parse_text_chat()