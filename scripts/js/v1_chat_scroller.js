// [STEP 1] AUTO-SCROLLER (Click-to-Select)
// Paste -> Click chat center -> Leaves it scrolling.

(function() {
    console.log("👉 CLICK inside the main chat history to start scrolling...");

    document.addEventListener('click', function handler(e) {
        e.preventDefault();
        e.stopPropagation();

        // 1. Find the scrollable container you clicked
        let target = e.target;
        while (target && target !== document.body) {
            const style = window.getComputedStyle(target);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && target.scrollHeight > target.clientHeight) {
                break;
            }
            target = target.parentElement;
        }

        if (!target) {
            alert("❌ Wrong target. Click exactly on the chat background.");
            return;
        }

        console.log("✅ Locked on chat! Starting scroll...");
        document.removeEventListener('click', handler);

        // 2. Scroll Loop
        let lastHeight = target.scrollHeight;
        let sameHeightCount = 0;

        const scroller = setInterval(() => {
            target.scrollTop = 0; // Move to top

            // Check if loading happened
            if (target.scrollHeight === lastHeight) {
                sameHeightCount++;
                console.log(`Waiting for load... (${sameHeightCount}/20)`);
            } else {
                sameHeightCount = 0;
                lastHeight = target.scrollHeight;
                console.log("Loaded new messages.");
            }

            // Safety Stop (approx 60 seconds of no load)
            if (sameHeightCount >= 20) {
                console.log("⚠️ Stopping script (Internet lag or End of History).");
                clearInterval(scroller);
                alert("Scrolling Finished! Now run Step 2.");
            }
        }, 1000); // 1 second per scroll
    }, { once: true });
})();