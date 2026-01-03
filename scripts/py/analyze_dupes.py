"""Quick analysis of duplicates in a raw batch file."""
import json
import sys
from collections import Counter
from pathlib import Path

def analyze_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"File: {filepath}")
    print(f"Total entries: {len(data)}")
    
    texts = Counter(r['raw_text'] for r in data)
    print(f"Unique texts: {len(texts)}")
    print(f"Duplication ratio: {len(data)/max(len(texts),1):.2f}x")
    
    # Count how many are duplicated
    dup_count = sum(1 for t, c in texts.items() if c > 1)
    dup_entries = sum(c - 1 for t, c in texts.items() if c > 1)
    print(f"Duplicated unique texts: {dup_count} ({dup_entries} extra entries)")
    
    print("\n--- Top 10 duplicated ---")
    for t, c in texts.most_common(10):
        preview = t[:70].replace('\n', ' | ')
        print(f"{c}x: {preview}...")

if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else "data/raw/batch11/messenger_row_part_290.json"
    analyze_file(filepath)
