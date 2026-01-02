// 📸 STEP 1: THE LIVE COLLECTOR
(function() {
    const panel = document.createElement('div');
    panel.style.cssText = "position:fixed; top:10px; right:10px; z-index:9999; background:red; color:white; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer;";
    panel.innerText = "🛑 STOP & SAVE";
    document.body.appendChild(panel);

    let isRunning = false;
    let allSnapshots = [];
    let scrollTimer = null;

    console.log("👉 CLICK inside the chat window to start...");

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

        if (!container) { alert("❌ Click closer to the message bubbles!"); return; }

        isRunning = true;
        panel.style.background = "#28a745"; 
        panel.innerText = "🏃 RUNNING... (Click to Finish)";
        
        const containerRect = container.getBoundingClientRect();
        const width = containerRect.width;

        scrollTimer = setInterval(() => {
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let snapshot = [];
            let node;

            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (!text) continue;

                const range = document.createRange();
                range.selectNodeContents(node);
                const rect = range.getBoundingClientRect();

                if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
                    // Logic: Right side = You, Left side = Partner
                    let sender = "Partner";
                    if ((rect.left - containerRect.left) > (width * 0.45)) sender = "You";
                    
                    snapshot.push({ sender: sender, text: text, y: rect.top });
                }
            }

            if (snapshot.length > 0) allSnapshots.push(snapshot);
            
            // Scroll UP
            container.scrollTop -= (container.clientHeight * 0.8);

        }, 500); 

    }, { once: true });

    panel.onclick = function() {
        clearInterval(scrollTimer);
        const blob = new Blob([JSON.stringify(allSnapshots, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "messenger_raw_snapshots.json";
        a.click();
        panel.remove();
    };
})();