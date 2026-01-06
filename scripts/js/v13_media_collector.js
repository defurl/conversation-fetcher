/**
 * v13 Media Collector (Grid Scraper)
 * 
 * PURPOSE:
 * Scrapes the "Media and files" -> "Media" tab in Facebook Messenger.
 * Collects base64 thumbnails and timestamps from aria-labels.
 * 
 * FEATURES:
 * - Auto-scrolls the media grid (downwards).
 * - Extracts 'aria-label' (Timestamp) and 'src' (Base64 Image).
 * - Deduplicates items based on content.
 * - Exports to JSON (media_history.json).
 * 
 * INSTRUCTIONS:
 * 1. Open the "Media and files" tab in a Messenger conversation.
 * 2. Paste this entire script into the Console (F12).
 * 3. The script will find the scrollable container and start collecting.
 * 4. Monitor the "Items Collected" count.
 * 5. When finished (or end reached), it will auto-download the JSON.
 * 6. You can manually stop by setting `window.MEDIA_COLLECTOR_STOP = true` in console.
 */

(function() {
    console.clear();
    console.log("%c📸 v13 Media Collector Initializing...", "color: #0084ff; font-size: 16px; font-weight: bold;");

    // --- Configuration ---
    const CONFIG = {
        SCROLL_STEP: 500,        // Pixels to scroll per tick
        SCROLL_DELAY: 1500,      // Time to wait for lazy loading (ms)
        MAX_IDLE_CYCLES: 10,     // Stop after this many scrolls with no new items
        MAX_ITEMS: 20000,        // Safety limit
    };

    // --- State ---
    let collectedItems = new Map(); // Key: contentHash (or src), Value: ItemObject
    let isRunning = true;
    let idleCycles = 0;
    let scrollContainer = null;
    let totalScrollDistance = 0;

    // --- UI Helpers ---

    let diagPanel, statusLabel, countLabel, scrollLabel;

    function createDiagPanel() {
        diagPanel = document.createElement('div');
        Object.assign(diagPanel.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '9999',
            backgroundColor: 'rgba(0, 0, 0, 0.85)', color: '#0f0',
            padding: '15px', borderRadius: '8px', fontFamily: 'monospace',
            fontSize: '14px', border: '1px solid #0f0', boxShadow: '0 0 10px rgba(0,255,0,0.2)'
        });
        diagPanel.innerHTML = `
            <div style="font-weight:bold; border-bottom:1px solid #444; margin-bottom:5px; padding-bottom:5px;">📸 v13 Media Collector</div>
            <div id="v13-status" style="color:#fff">Ready</div>
            <div>Items: <span id="v13-count" style="color:#fff; font-weight:bold;">0</span></div>
            <div style="font-size:12px; color:#aaa; margin-top:5px;">Scroll: <span id="v13-scroll">0</span>px</div>
            <button id="v13-stop-btn" style="margin-top:10px; width:100%; background:#c00; color:white; border:none; padding:5px; cursor:pointer;">STOP & SAVE</button>
        `;
        document.body.appendChild(diagPanel);

        statusLabel = document.getElementById('v13-status');
        countLabel = document.getElementById('v13-count');
        scrollLabel = document.getElementById('v13-scroll');
        
        document.getElementById('v13-stop-btn').onclick = () => {
            window.MEDIA_COLLECTOR_STOP = true;
            statusLabel.innerText = "Stopping...";
        };
    }

    function updateDiagPanel(status, count, scroll) {
        if (!diagPanel) return;
        if (status) statusLabel.innerText = status;
        if (count !== undefined) countLabel.innerText = count;
        if (scroll !== undefined) scrollLabel.innerText = scroll;
    }

    // --- Helpers ---

    function getMediaItems() {
        // Select all media items (Photos and Videos)
        // Structure: div[role="button"][aria-label^="View ..."]
        const selectors = [
            'div[role="button"][aria-label^="View photo"]',
            'div[role="button"][aria-label^="View video"]'
        ];
        return Array.from(document.querySelectorAll(selectors.join(',')));
    }

    function findScrollContainer() {
        // Try to find the specific media grid container first
        // Usually it's a parent of the items that has overflow-y: scroll/auto
        const sampleItem = document.querySelector('div[role="button"][aria-label^="View photo"]');
        if (!sampleItem) return window; // Default to window if empty

        let parent = sampleItem.parentElement;
        while (parent) {
            const style = window.getComputedStyle(parent);
            if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
                return parent;
            }
            parent = parent.parentElement;
        }
        return window; // Fallback
    }

    function parseTimestamp(label) {
        // Formats: 
        // "View photo sent on Tuesday 22:43"
        // "View photo sent on 27 December 2025, 10:50"
        
        const prefix = "sent on ";
        const idx = label.indexOf(prefix);
        if (idx === -1) return { raw: label, parsed: null };
        
        const dateStr = label.substring(idx + prefix.length).trim();
        return { raw: label, cleanContent: dateStr };
    }

    function downloadData() {
        updateDiagPanel("Saving JSON...", collectedItems.size);
        if (collectedItems.size === 0) {
            console.warn("⚠️ No items collected to download.");
            updateDiagPanel("Empty - No Download");
            return;
        }

        const data = Array.from(collectedItems.values());
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `media_history_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        console.log(`%c💾 Downloaded ${data.length} items!`, "color: #00cc00; font-size: 14px;");
        updateDiagPanel("Saved!", collectedItems.size);
    }

    // --- Main Loop ---

    async function startCollection() {
        console.clear();
        createDiagPanel();
        window.MEDIA_COLLECTOR_STOP = false;
        
        updateDiagPanel("Finding Scroller...");
        scrollContainer = findScrollContainer();
        console.log("📜 Scroll Container:", scrollContainer === window ? "Window" : scrollContainer);
        
        updateDiagPanel("Running");

        while (isRunning && !window.MEDIA_COLLECTOR_STOP) {
            const domItems = getMediaItems();
            let newItemsCount = 0;

            for (const el of domItems) {
                const img = el.querySelector('img');
                const src = img ? img.src : null;
                const label = el.ariaLabel;

                // We need both label (for date) and src (for content)
                if (!src || !label) continue;

                // Deduplicate
                if (!collectedItems.has(src)) {
                    const meta = parseTimestamp(label);
                    
                    collectedItems.set(src, {
                        type: label.includes("video") ? "video_thumbnail" : "photo",
                        timestamp_raw: meta.raw,
                        timestamp_clean: meta.cleanContent,
                        src: src // The base64 data
                    });
                    newItemsCount++;
                }
            }

            console.log(`♻️ Cycle: Collected ${newItemsCount} new. Total: ${collectedItems.size}. Idle: ${idleCycles}`);
            updateDiagPanel("Scrolling...", collectedItems.size, totalScrollDistance);

            // Scroll Logic
            if (scrollContainer === window) {
                window.scrollBy(0, CONFIG.SCROLL_STEP);
            } else {
                scrollContainer.scrollBy(0, CONFIG.SCROLL_STEP);
            }
            totalScrollDistance += CONFIG.SCROLL_STEP;

            // Idle Check
            if (newItemsCount === 0) {
                idleCycles++;
                updateDiagPanel(`Idle (${idleCycles}/${CONFIG.MAX_IDLE_CYCLES})`, collectedItems.size);
            } else {
                idleCycles = 0;
            }

            // Stop Conditions
            if (idleCycles >= CONFIG.MAX_IDLE_CYCLES) {
                console.log("🛑 Stopping: No new items found for multiple cycles (End of list?).");
                updateDiagPanel("Finished (End of List)");
                break;
            }
            if (collectedItems.size >= CONFIG.MAX_ITEMS) {
                console.warn("🛑 Stopping: Max item limit reached.");
                updateDiagPanel("Finished (Limit Reached)");
                break;
            }

            // Wait for lazy load
            await new Promise(r => setTimeout(r, CONFIG.SCROLL_DELAY));
        }

        console.log("🎉 Collection Complete.");
        downloadData();
    }

    // Start
    startCollection();

})();
