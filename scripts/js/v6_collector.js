// 📸 STEP 1: BATCH MEDIA COLLECTOR (Anti-Crash)
// Downloads data in chunks to prevent "Out of Memory" errors.

(function() {
    // --- CONFIG ---
    const BATCH_SIZE = 50; // Downloads every 50 "frames" (approx 2-3 minutes)

    // UI Setup
    const panel = document.createElement('div');
    panel.style.cssText = "position:fixed; top:10px; right:10px; z-index:9999; background:red; color:white; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer; font-family:sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.1);";
    panel.innerText = "🛑 STOP (Save Final)";
    document.body.appendChild(panel);

    let isRunning = false;
    let currentBatch = [];
    let batchCounter = 1;
    let scrollTimer = null;

    console.log("👉 CLICK inside the chat window to start...");

    // Helper: Base64 Converter (Same as before)
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

    // Helper: Download Function
    function saveBatch() {
        if (currentBatch.length === 0) return;
        
        console.log(`💾 Saving Batch ${batchCounter} (${currentBatch.length} frames)...`);
        const jsonStr = JSON.stringify(currentBatch, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `messenger_part_${batchCounter}.json`;
        a.click();
        
        // CRITICAL: Clear memory
        currentBatch = [];
        batchCounter++;
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

        scrollTimer = setInterval(async () => {
            let snapshot = [];

            // 1. Capture Text
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

            // 2. Capture Images
            const images = container.querySelectorAll('img');
            for (let img of images) {
                const rect = img.getBoundingClientRect();
                if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
                    if (rect.width < 40 || rect.height < 40) continue;

                    let sender = ((rect.left - containerRect.left) > (width * 0.45)) ? "You" : "Partner";
                    if (img.src) {
                        const b64 = await urlToBase64(img.src);
                        if (b64) {
                            snapshot.push({ type: 'image', sender: sender, content: '[Media]', image_data: b64, y: rect.top });
                        }
                    }
                }
            }

            if (snapshot.length > 0) currentBatch.push(snapshot);
            
            // Scroll UP
            container.scrollTop -= (container.clientHeight * 0.8);

            // --- AUTO SAVE CHECK ---
            if (currentBatch.length >= BATCH_SIZE) {
                saveBatch();
                panel.innerText = `🏃 RUNNING... (Batch ${batchCounter})`;
            }

        }, 2000); 

    }, { once: true });

    panel.onclick = function() {
        clearInterval(scrollTimer);
        saveBatch(); // Save whatever is left
        panel.remove();
        alert("Done! Move ALL 'messenger_part_x.json' files to your Python folder.");
    };
})();