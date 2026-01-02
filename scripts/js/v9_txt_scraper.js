// 📜 TEXT-ONLY SCRAPER (RAM-Safe)
// 1. Scrolls up through history.
// 2. Captures text immediately.
// 3. DELETES the message from the screen to free RAM.
// 4. Downloads ONE single text file at the end.

(function() {
    // --- CONFIG ---
    // Increase this if you have a huge monitor. 
    // This is the "Safety Zone" - we won't delete messages inside this area.
    const SAFE_ZONE_HEIGHT = 5000; 

    const panel = document.createElement('div');
    panel.style.cssText = "position:fixed; top:10px; right:10px; z-index:9999; background:red; color:white; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer; font-family:sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.1);";
    panel.innerText = "🛑 STOP & DOWNLOAD";
    document.body.appendChild(panel);

    let isRunning = false;
    let allTextLines = []; // Stores the history in simple text lines
    let scrollTimer = null;
    let pruneTimer = null;

    console.log("👉 CLICK inside the chat window to start...");

    function captureAndPrune(container) {
        const containerRect = container.getBoundingClientRect();
        const children = Array.from(container.children);
        
        // We iterate backwards (bottom to top) to safely delete old items
        // But since we are scrolling UP, the "newly loaded" items appear at the TOP.
        // The "old/seen" items slide down to the BOTTOM.
        // So we want to capture and delete items at the BOTTOM.
        
        for (let child of children) {
            const rect = child.getBoundingClientRect();
            
            // IF element is pushed far below the screen (it's "done")
            if (rect.top > containerRect.bottom + 500) { 
                // 1. Capture Text before deleting
                // We grab innerText which preserves newlines and sender names
                const text = child.innerText.trim();
                
                if (text) {
                    // We push to the START of our array because we are scrolling back in time.
                    // Actually, since these are "recent" messages sliding down, they are theoretically "newer" 
                    // than the ones appearing at the top. 
                    // Let's just capture them. We can sort/reverse in Python later.
                    allTextLines.push(text);
                }
                
                // 2. DELETE from DOM to save RAM
                child.remove();
            }
        }
    }

    document.addEventListener('click', function handler(e) {
        if (isRunning) return;
        e.preventDefault();
        e.stopPropagation();

        let container = e.target;
        // Find the main scrollable message list
        while (container && container !== document.body) {
            const style = window.getComputedStyle(container);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && container.scrollHeight > container.clientHeight) {
                break;
            }
            container = container.parentElement;
        }

        if (!container) return;

        isRunning = true;
        panel.style.background = "#28a745"; 
        panel.innerText = "🏃 RUNNING... (Text Only)";
        
        // 1. Initial Scraping of what's currently visible
        allTextLines.push(container.innerText);

        // 2. Scroll & Prune Loop
        scrollTimer = setInterval(() => {
            // Scroll UP to load older messages
            container.scrollTop = 0;
            
            // Give it a moment to render, then clean up the bottom
            // We use a separate timer or just check periodically
        }, 1000); 

        // 3. Pruner Loop (Runs frequently to keep DOM light)
        pruneTimer = setInterval(() => {
            captureAndPrune(container);
        }, 1000);

    }, { once: true });

    panel.onclick = function() {
        clearInterval(scrollTimer);
        clearInterval(pruneTimer);
        
        // Create the final text file
        // Join with a distinct separator to help Python later
        const fullText = allTextLines.join("\n[----------------]\n");
        
        const blob = new Blob([fullText], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "full_chat_history.txt";
        a.click();
        
        panel.remove();
        alert("Downloaded! You now have a massive text file.");
    };
})();