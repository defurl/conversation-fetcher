"""Compare two batches to evaluate collection quality."""
import json
from collections import Counter
from pathlib import Path
import sys

def analyze_batch(batch_path):
    batch_dir = Path(batch_path)
    all_entries = []
    part_count = 0
    
    for f in sorted(batch_dir.glob('messenger_row_part*.json')):
        part_count += 1
        try:
            with open(f, 'r', encoding='utf-8') as fp:
                data = json.load(fp)
                all_entries.extend(data)
        except Exception as e:
            print(f'Error loading {f}: {e}')
    
    total = len(all_entries)
    texts = Counter(r.get('raw_text', '') for r in all_entries)
    unique = len(texts)
    
    # Get timestamps for date range
    timestamps = [e.get('ts', 0) for e in all_entries if e.get('ts')]
    min_ts = min(timestamps) if timestamps else 0
    max_ts = max(timestamps) if timestamps else 0
    
    # Count duplicates
    dup_count = sum(c - 1 for c in texts.values() if c > 1)
    
    # Get top duplicated messages
    top_dupes = texts.most_common(5)
    
    return {
        'parts': part_count,
        'total': total,
        'unique': unique,
        'duplicates': dup_count,
        'dup_ratio': total / unique if unique > 0 else 0,
        'efficiency': unique / total * 100 if total > 0 else 0,
        'min_ts': min_ts,
        'max_ts': max_ts,
        'top_dupes': top_dupes
    }

def main():
    batch1_path = sys.argv[1] if len(sys.argv) > 1 else 'data/raw/batch12'
    batch2_path = sys.argv[2] if len(sys.argv) > 2 else 'data/raw/batch13'
    
    print('='*70)
    print(f'BATCH COMPARISON: {Path(batch1_path).name} vs {Path(batch2_path).name}')
    print('='*70)
    
    b1 = analyze_batch(batch1_path)
    b2 = analyze_batch(batch2_path)
    
    name1 = Path(batch1_path).name
    name2 = Path(batch2_path).name
    
    print(f'''
{"Metric":<25} {name1:<20} {name2:<20}
{"-"*65}
{"Part files":<25} {b1['parts']:<20} {b2['parts']:<20}
{"Total entries":<25} {b1['total']:<20} {b2['total']:<20}
{"Unique messages":<25} {b1['unique']:<20} {b2['unique']:<20}
{"Duplicate entries":<25} {b1['duplicates']:<20} {b2['duplicates']:<20}
{"Duplication ratio":<25} {f"{b1['dup_ratio']:.2f}x":<20} {f"{b2['dup_ratio']:.2f}x":<20}
{"Efficiency":<25} {f"{b1['efficiency']:.1f}%":<20} {f"{b2['efficiency']:.1f}%":<20}
''')
    
    # Summary
    print('SUMMARY:')
    print('-'*65)
    
    if b1['unique'] > b2['unique']:
        print(f"  [UNIQUE MSGS] {name1} captured +{b1['unique'] - b2['unique']} more unique messages")
    elif b2['unique'] > b1['unique']:
        print(f"  [UNIQUE MSGS] {name2} captured +{b2['unique'] - b1['unique']} more unique messages")
    else:
        print(f"  [UNIQUE MSGS] Both captured the same number of unique messages")
    
    if b1['efficiency'] > b2['efficiency']:
        print(f"  [EFFICIENCY]  {name1} is more efficient: {b1['efficiency']:.1f}% vs {b2['efficiency']:.1f}%")
    else:
        print(f"  [EFFICIENCY]  {name2} is more efficient: {b2['efficiency']:.1f}% vs {b1['efficiency']:.1f}%")
    
    if b1['duplicates'] < b2['duplicates']:
        print(f"  [DUPLICATES]  {name1} has fewer duplicates: {b1['duplicates']} vs {b2['duplicates']}")
    else:
        print(f"  [DUPLICATES]  {name2} has fewer duplicates: {b2['duplicates']} vs {b1['duplicates']}")
    
    print()
    
    # Recommendation
    print('RECOMMENDATION:')
    print('-'*65)
    # Score each: higher unique is better, higher efficiency is better, fewer parts is better (storage)
    score1 = b1['unique'] * 0.7 + b1['efficiency'] * 0.3
    score2 = b2['unique'] * 0.7 + b2['efficiency'] * 0.3
    
    if b1['unique'] > b2['unique']:
        winner = name1
        reason = f"More unique content ({b1['unique']} vs {b2['unique']})"
    elif b2['unique'] > b1['unique']:
        winner = name2
        reason = f"More unique content ({b2['unique']} vs {b1['unique']})"
    elif b1['efficiency'] > b2['efficiency']:
        winner = name1
        reason = f"Higher efficiency with same content ({b1['efficiency']:.1f}% vs {b2['efficiency']:.1f}%)"
    else:
        winner = name2
        reason = f"Higher efficiency with same content ({b2['efficiency']:.1f}% vs {b1['efficiency']:.1f}%)"
    
    print(f"  Winner: {winner}")
    print(f"  Reason: {reason}")
    print()

if __name__ == "__main__":
    main()
