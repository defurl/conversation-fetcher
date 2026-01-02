// 📸 STEP 1: ULTRA-LIGHT BATCH COLLECTOR (With DOM Pruner)
// 1. Downloads batches to save JS memory.
// 2. Deletes old HTML elements to save Browser RAM.

(function() {
    // --- CONFIG ---
    const BATCH_SIZE = 50;   // Save every 50 frames
    const PRUNE_THRESHOLD = 15000; // Delete pixels > 15,000px below view (Safe buffer)

    // UI Setup
    const panel = document.createElement('div');
    panel.style.cssText = "position:fixed; top:10px; right:10px; z-index:9999; background:red; color:white; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer; font-family:sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.1);";
    panel.innerText = "🛑 STOP (Save Final)";
    document.body.appendChild(panel);

    let isRunning = false;
    let currentBatch = [];
    let batchCounter = 1;
    let scrollTimer = null;
    let pruneTimer = null;

    console.log("👉 CLICK inside the chat window to start...");

    async function urlToBase64(url) {
        if (url.startsWith('data:')) return url;
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        } catch (e) { return null; }
    }

    function saveBatch() {
        if (currentBatch.length === 0) return;
        console.log(`💾 Saving Batch ${batchCounter}...`);
        
        const jsonStr = JSON.stringify(currentBatch, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `messenger_part_${batchCounter}.json`;
        a.click();
        
        currentBatch = [];
        batchCounter++;
    }

    // --- NEW: THE RAM SAVER ---
    function pruneDOM(container) {
        // We only remove elements that are WAY below the viewport (scrolled past).
        // Since we scroll UP, the "old" content is at the bottom.
        
        const containerRect = container.getBoundingClientRect();
        const children = Array.from(container.children);
        let deletedCount = 0;

        // Iterate through top-level children (message rows)
        for (let child of children) {
            const rect = child.getBoundingClientRect();
            
            // Logic: If the element's TOP is > X pixels BELOW the container's BOTTOM
            if (rect.top > (containerRect.bottom + PRUNE_THRESHOLD)) {
                // It is far off-screen. Delete it.
                child.remove();
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            console.log(`🧹 Pruned ${deletedCount} old DOM elements to save RAM.`);
        }
    }

    document.addEventListener('click', function handler(e) {
        if (isRunning) return;
        e.preventDefault();
        e.stopPropagation();

        let container = e.target;
        while (container && container !== document.body) {
            const style = window.getComputedStyle(container);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && container.scrollHeight > container.clientHeight) {
                break;
            }
            container = container.parentElement;
        }

        if (!container) { alert("❌ Click closer to the message list!"); return; }

        isRunning = true;
        panel.style.background = "#28a745"; 
        panel.innerText = `🏃 RUNNING... (Batch ${batchCounter})`;
        
        const containerRect = container.getBoundingClientRect();
        const width = containerRect.width;

        // 1. Main Scraper Loop
        scrollTimer = setInterval(async () => {
            let snapshot = [];

            // Capture Text
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (!text) continue;
                const rect = document.createRange().selectNodeContents(node).getBoundingClientRect(); // optimized
                
                // Fix: Access rect from the range object properly
                const range = document.createRange();
                range.selectNodeContents(node);
                const nodeRect = range.getBoundingClientRect();

                if (nodeRect.top >= containerRect.top && nodeRect.bottom <= containerRect.bottom) {
                    let sender = ((nodeRect.left - containerRect.left) > (width * 0.45)) ? "You" : "Partner";
                    snapshot.push({ type: 'text', sender: sender, content: text, y: nodeRect.top });
                }
            }

            // Capture Images
            const images = container.querySelectorAll('img');
            for (let img of images) {
                const rect = img.getBoundingClientRect();
                if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
                    if (rect.width < 40 || rect.height < 40) continue;
                    let sender = ((rect.left - containerRect.left) > (width * 0.45)) ? "You" : "Partner";
                    if (img.src) {
                        const b64 = await urlToBase64(img.src);
                        if (b64) snapshot.push({ type: 'image', sender: sender, content: '[Media]', image_data: b64, y: rect.top });
                    }
                }
            }

            if (snapshot.length > 0) currentBatch.push(snapshot);
            
            // Scroll UP
            container.scrollTop -= (container.clientHeight * 0.8);

            // Auto Save
            if (currentBatch.length >= BATCH_SIZE) {
                saveBatch();
                panel.innerText = `🏃 RUNNING... (Batch ${batchCounter})`;
            }

        }, 2000); 

        // 2. Pruning Loop (Runs every 10 seconds)
        pruneTimer = setInterval(() => {
            pruneDOM(container);
        }, 10000);

    }, { once: true });

    panel.onclick = function() {
        clearInterval(scrollTimer);
        clearInterval(pruneTimer);
        saveBatch(); 
        panel.remove();
        alert("Done! Check your downloads folder.");
    };
})();