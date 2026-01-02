// [STEP 2] RAW DUMPER (Relative Position)
// Paste -> Click chat -> Downloads JSON.

(function() {
    console.log("👉 CLICK inside the chat window to dump data...");

    document.addEventListener('click', function handler(e) {
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

        if (!container) return;
        document.removeEventListener('click', handler);

        console.log("📸 Scanning... (Do not scroll)");
        const containerRect = container.getBoundingClientRect();

        // Scan all text nodes for position
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let items = [];
        let node;
        
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (!text) continue; 

            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            
            // Capture only visible text inside the box
            if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
                 items.push({
                    text: text,
                    // Store position RELATIVE to the chat box left edge
                    rel_x: rect.left - containerRect.left, 
                    y: rect.top 
                });
            }
        }

        // Download
        const exportData = { width: containerRect.width, items: items };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "raw_chat_dump.json";
        a.click();
        console.log(`🎉 Downloaded ${items.length} items.`);

    }, { once: true });
})();