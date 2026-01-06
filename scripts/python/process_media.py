import json
import os
import base64
import argparse
from datetime import datetime

# Configure
DEFAULT_INPUT = "data/media/media_history.json" # Adjust path as needed
OUTPUT_DIR = "data/media/extracted_images"

def setup_dirs():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

def process_media(json_path):
    print(f"📂 Loading: {json_path}")
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"❌ File not found: {json_path}")
        return

    print(f"📊 Found {len(data)} items.")
    setup_dirs()
    
    stats = {"photo": 0, "video": 0, "errors": 0}
    
    for i, item in enumerate(data):
        try:
            # Metadata
            timestamp = item.get('timestamp_raw', 'unknown')
            clean_date = item.get('timestamp_clean', 'unknown_date').replace(':', '-').replace(',', '').replace(' ', '_')
            media_type = item.get('type', 'photo')
            src = item.get('src', '')
            
            # Count
            if "video" in media_type: stats["video"] += 1
            else: stats["photo"] += 1

            # Extract Base64
            if src.startswith("data:image"):
                header, encoded = src.split(",", 1)
                file_ext = header.split(";")[0].split("/")[1]  # e.g., jpeg
                
                # Filename: index_date.jpg
                filename = f"{i:04d}_{clean_date}.{file_ext}"
                filepath = os.path.join(OUTPUT_DIR, filename)
                
                # Write Image
                with open(filepath, "wb") as img_file:
                    img_file.write(base64.b64decode(encoded))
                    
        except Exception as e:
            stats["errors"] += 1
            print(f"⚠️ Error processing item {i}: {e}")

    print("\n✅ Extraction Complete!")
    print(f"   Photos Output: {stats['photo']}")
    print(f"   Videos Output: {stats['video']} (thumbnails only)")
    print(f"   Errors: {stats['errors']}")
    print(f"   Location: {os.path.abspath(OUTPUT_DIR)}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract media from v13 JSON")
    parser.add_argument("file", nargs="?", default=DEFAULT_INPUT, help="Path to media_history.json")
    args = parser.parse_args()
    
    process_media(args.file)
