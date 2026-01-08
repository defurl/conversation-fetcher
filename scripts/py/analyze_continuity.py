import json
from datetime import datetime, timedelta
import re

INPUT_FILE = "data/processed/v12_final_clean_rows.json"

def parse_time(msg):
    # Field priority: 1. content regex, 2. timestamp field (if numeric)
    
    # Try regex first (looking for '10/01/2025, 17:10')
    content = msg.get('content', '')
    # Pattern: DD/MM/YYYY, HH:MM
    match = re.search(r'(\d{2}/\d{2}/\d{4}, \d{2}:\d{2})', content)
    if match:
        try:
            return datetime.strptime(match.group(1), "%d/%m/%Y, %H:%M")
        except ValueError:
            pass

    # Fallback to timestamp field if it's a number (capture time)
    # Useful for relative ordering if no explicit time found
    ts = msg.get('timestamp')
    if ts and ts != "Unknown Time":
        try:
            val = float(ts)
            if val > 100000000000:
                return datetime.fromtimestamp(val / 1000)
            return datetime.fromtimestamp(val)
        except (ValueError, TypeError):
            pass
            
    return None

def analyze_continuity():
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            messages = json.load(f)
    except FileNotFoundError:
        print(f"❌ Could not find {INPUT_FILE}")
        return

    print(f"📉 Analyzing {len(messages)} messages from Batch 23...")
    
    # 1. Enrich with parsed times
    valid_msgs = []
    for m in messages:
        t = parse_time(m)
        if t:
            m['_parsed_time'] = t
            valid_msgs.append(m)
    
    print(f"found {len(valid_msgs)} messages with valid timestamps.")
    
    if not valid_msgs:
        print("❌ No valid timestamps found via Regex or field. Cannot analyze gaps.")
        return

    # Sort by time
    valid_msgs.sort(key=lambda x: x['_parsed_time'])

    gap_threshold = timedelta(minutes=60) 
    warnings = []
    
    for i in range(1, len(valid_msgs)):
        curr = valid_msgs[i]
        prev = valid_msgs[i-1]
        
        delta = curr['_parsed_time'] - prev['_parsed_time']
        
        # Check for gap > 60 mins
        if delta > gap_threshold:
            # Check if this large gap is "real" or "missing data"
            # It's missing data if:
            # - The previous message was a question? (hard to know)
            # - The time jump is weird (e.g. 5 days) - common in chat
            # - BUT, if we see Reply markers that bridge the gap, that's a clue.
            
            warnings.append(f"⚠️ Gap: {delta} | {prev['_parsed_time']} -> {curr['_parsed_time']}")

    print(f"✅ Analysis Complete.")
    if warnings:
        print(f"Found {len(warnings)} time gaps > 60 mins (could be normal breaks):")
        for w in warnings[:20]:
            print(w)
    else:
        print("No gaps > 60 mins found.")

    start = valid_msgs[0]['_parsed_time']
    end = valid_msgs[-1]['_parsed_time']
    print(f"⏱️ Range: {start} -> {end}")

if __name__ == "__main__":
    analyze_continuity()
