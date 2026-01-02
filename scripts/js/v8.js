// 📸 STEP 1: HIGH-SPEED BATCH COLLECTOR (1.5s | 95% Jump | Pruning)
(function() {
    // --- CONFIG FOR SPEED ---
    const SPEED_MS = 1500;       // 1.5 seconds per cycle (Aggressive but usually safe)
    const SCROLL_AMOUNT = 0.95;  // Scroll 95% of screen height per jump
    const BATCH_SIZE = 100;      // Save less often to reduce overhead
    const PRUNE_THRESHOLD = 20000; // Keep a larger buffer before deleting old messages

    // UI Setup
    const panel = document.createElement('div');
    panel.style.cssText = "position:fixed; top:10px; right:10px; z-index:9999; background:red; color:white; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer; font-family:sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-size: 14px;";
    panel.innerText = "🛑 STOP & SAVE";
    document.body.appendChild(panel);

    let isRunning = false;
    let currentBatch = [];
    let batchCounter = 1;
    let scrollTimer = null;
    let pruneTimer = null;
    let lastScrollPos = -1;
    let stuckCounter = 0;

    console.log("👉 CLICK inside the chat window to start high-speed mode...");

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
        console.log(`💾 Saving Batch ${batchCounter} (${currentBatch.length} frames)...`);
        
        const jsonStr = JSON.stringify(currentBatch, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `messenger_speed_part_${batchCounter}.json`;
        a.click();
        
        currentBatch = [];
        batchCounter++;
    }

    function pruneDOM(container) {
        const containerRect = container.getBoundingClientRect();
        const children = Array.from(container.children);
        let deletedCount = 0;
        for (let child of children) {
            const rect = child.getBoundingClientRect();
            // Delete if WAY below viewport
            if (rect.top > (containerRect.bottom + PRUNE_THRESHOLD)) {
                child.remove();
                deletedCount++;
            }
        }
        if (deletedCount > 0) console.log(`🧹 Pruned ${deletedCount} elements for RAM.`);
    }

    document.addEventListener('click', function handler(e) {
        if (isRunning) return;
        e.preventDefault();
        e.stopPropagation();

        // Search for container
        let container = e.target;
        while (container && container !== document.body) {
            const style = window.getComputedStyle(container);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && container.scrollHeight > container.clientHeight) {
                break;
            }
            container = container.parentElement;
        }
        if (!container || container.scrollHeight < 500) {
             document.querySelectorAll('div, [role="main"]').forEach(el => {
                const style = window.getComputedStyle(el);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > 1000) {
                    container = el;
                }
            });
        }

        if (!container) { alert("❌ Could not detect main chat container."); return; }

        isRunning = true;
        panel.style.background = "#28a745"; 
        panel.innerText = `⚡️ RUNNING FAST... (Batch ${batchCounter})`;
        
        const containerRect = container.getBoundingClientRect();
        const width = containerRect.width;

        // --- MAIN HIGH-SPEED LOOP ---
        scrollTimer = setInterval(async () => {
            // 1. STUCK DETECTION
            if (container.scrollTop === lastScrollPos) {
                stuckCounter++;
                if (stuckCounter % 5 === 0) console.warn(`⚠️ Waiting for loading... (${stuckCounter * SPEED_MS / 1000}s)`);
            } else {
                stuckCounter = 0;
                lastScrollPos = container.scrollTop;
            }

            // 2. CAPTURE
            let snapshot = [];
            // Text
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (!text) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const rect = range.getBoundingClientRect();
                if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
                    let sender = ((rect.left - containerRect.left) > (width * 0.45)) ? "You" : "Partner";
                    snapshot.push({ type: 'text', sender: sender, content: text, y: rect.top });
                }
            }
            // Images
            const images = container.querySelectorAll('img');
            for (let img of images) {
                const rect = img.getBoundingClientRect();
                if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
                    if (rect.width < 40 || rect.height < 40) continue;
                    let sender = ((rect.left - containerRect.left) > (width * 0.45)) ? "You" : "Partner";
                    if (img.src) {
                        // In high speed, we don't wait for slow images. Either it has data or we skip.
                        if (img.src.startsWith('data:')) {
                             snapshot.push({ type: 'image', sender: sender, content: '[Media]', image_data: img.src, y: rect.top });
                        } else {
                             // Async fetch - might miss it in high speed but safer for UI thread
                             urlToBase64(img.src).then(b64 => {
                                 if(b64) snapshot.push({ type: 'image', sender: sender, content: '[Media]', image_data: b64, y: rect.top });
                             });
                        }
                    }
                }
            }

            if (snapshot.length > 0) currentBatch.push(snapshot);

            // 3. SCROLL JUMP
            container.scrollBy(0, -(container.clientHeight * SCROLL_AMOUNT));

            // 4. AUTO SAVE
            if (currentBatch.length >= BATCH_SIZE) {
                saveBatch();
                panel.innerText = `⚡️ RUNNING FAST... (Batch ${batchCounter})`;
            }

        }, SPEED_MS); 

        // Pruner Loop (Every 15s)
        pruneTimer = setInterval(() => { pruneDOM(container); }, 15000);

    }, { once: true });

    panel.onclick = function() {
        clearInterval(scrollTimer);
        clearInterval(pruneTimer);
        saveBatch(); 
        panel.remove();
        alert("Stopped. Move all 'messenger_speed_part_x.json' files to your Python folder.");
    };
})();