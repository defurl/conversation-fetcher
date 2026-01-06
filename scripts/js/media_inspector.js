// Media Tab Inspector
// Paste this into the Console while on the "Media and files" -> "Media" tab

(function() {
  console.clear();
  console.log("🕵️ Starting Media Inspector...");

  // Select all potential media containers (using the class structure from your sample)
  // The structure seems to be: div[role="button"][aria-label^="View photo"]
  const items = Array.from(document.querySelectorAll('div[role="button"][aria-label^="View photo"], div[role="button"][aria-label^="View video"]'));

  console.log(`📊 Found ${items.length} media items in DOM.`);

  if (items.length === 0) {
    console.warn("⚠️ No items found. Selectors might need adjustment or content not loaded.");
    return;
  }

  // Analyze a sample (first 5, middle 5, last 5)
  const samples = [
    ...items.slice(0, 5),
    ...items.slice(Math.floor(items.length / 2), Math.floor(items.length / 2) + 5),
    ...items.slice(-5)
  ];

  // remove duplicates if list is short
  const uniqueSamples = [...new Set(samples)];

  const analysis = uniqueSamples.map(item => {
    const img = item.querySelector('img');
    const src = img ? img.src : 'No IMG tag';
    const label = item.ariaLabel;
    
    let urlType = 'unknown';
    if (src.startsWith('data:')) urlType = 'base64 (thumbnail)';
    else if (src.startsWith('https://scontent')) urlType = 'scontent (signed)';
    else if (src.startsWith('https://static')) urlType = 'static (permanent)';
    else urlType = 'other';

    return {
      label: label,
      type: urlType,
      srcPrefix: src.substring(0, 50) + '...'
    };
  });

  console.table(analysis);

  // Check for month headers
  const headers = Array.from(document.querySelectorAll('h2 span[dir="auto"]')).map(h => h.innerText);
  console.log("📅 Month Headers Found:", headers);

  console.log("\n💡 CONCLUSION:");
  const hasTimestamps = analysis.every(a => a.label.includes("sent on"));
  const hasRealUrls = analysis.some(a => a.type !== 'base64 (thumbnail)');

  if (hasTimestamps) console.log("✅ Timestamps detected in aria-labels (Alignment possible!)");
  else console.warn("⚠️ Timestamps missing or inconsistent.");

  if (hasRealUrls) console.log("ℹ️ Found some non-base64 URLs. Check if they are high-res.");
  else console.log("⚠️ Only base64 thumbnails found. We might need to click to get full quality.");

})();
