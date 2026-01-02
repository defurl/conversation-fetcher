// 📸 STEP 1: THE MEDIA COLLECTOR (Fixed for Base64 Images)
// Captures text + images + stickers. Handles pre-loaded data images correctly.

(function() {
    // UI Setup
    const panel = document.createElement('div');
    panel.style.cssText = "position:fixed; top:10px; right:10px; z-index:9999; background:red; color:white; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer; font-family:sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.1);";
    panel.innerText = "🛑 STOP & SAVE JSON";
    document.body.appendChild(panel);

    let isRunning = false;
    let allSnapshots = [];
    let scrollTimer = null;

    console.log("👉 CLICK inside the chat window to start...");

    // --- HELPER: Convert Image URL to Base64 ---
    async function urlToBase64(url) {
        // FIX: If it is ALREADY a data URI, just return it. Don't fetch.
        if (url.startsWith('data:')) {
            return url;
        }

        try {
            const response = await fetch(url);
            const blob = await response.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result); 
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn("⚠️ Skipped an image (Privacy/Error):", url.substring(0, 50) + "...");
            return null;
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
        panel.innerText = "🏃 RUNNING... (Images taking longer...)";
        
        const containerRect = container.getBoundingClientRect();
        const width = containerRect.width;

        // --- SCROLL & CAPTURE LOOP ---
        scrollTimer = setInterval(async () => {
            let snapshot = [];

            // --- A. TEXT CAPTURE ---
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

            // --- B. IMAGE/STICKER CAPTURE ---
            const images = container.querySelectorAll('img');
            for (let img of images) {
                const rect = img.getBoundingClientRect();
                
                if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
                    // Filter small icons
                    if (rect.width < 40 || rect.height < 40) continue;

                    let sender = ((rect.left - containerRect.left) > (width * 0.45)) ? "You" : "Partner";
                    
                    if (img.src) {
                        const b64 = await urlToBase64(img.src);
                        if (b64) {
                            snapshot.push({ 
                                type: 'image', 
                                sender: sender, 
                                content: '[Media]', 
                                image_data: b64, 
                                y: rect.top 
                            });
                        }
                    }
                }
            }

            if (snapshot.length > 0) allSnapshots.push(snapshot);
            
            // Scroll UP
            container.scrollTop -= (container.clientHeight * 0.8);

        }, 2000); 

    }, { once: true });

    panel.onclick = function() {
        clearInterval(scrollTimer);
        const jsonStr = JSON.stringify(allSnapshots, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "messenger_media_snapshots.json";
        a.click();
        panel.remove();
        alert("Downloaded! Run the Python script.");
    };
})();