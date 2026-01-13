// v12 Adaptive Collector: captures rows with duplicate skip & adaptive scroll timing.
// Improvements over v10:
// - Skips already-captured rows to prevent duplicates from scroll overlap
// - Dynamically adjusts scroll speed based on content loading (fast early, slow late)
// - Reduces RAM usage by preventing duplicate captures
// v12.5 TUNING: Slower Scroll & Visual Stability
// - Slower base speed (1500ms) for DOM stability
// - Delayed media stripping (2000ms) to prevent layout jumps
// - Dimension freezing to prevent layout collapse
// - Explicit DOM marking (data-captured) to prevent re-captures
(function () {
  // === CONFIGURATION ===
  const BASE_SPEED_MS = 1500;     // Slower scroll for stability
  const MAX_SPEED_MS = 6000;
  const SPEED_INCREMENT = 400;
  const SPEED_DECREMENT = 400;
  const SCROLL_AMOUNT = 0.4;
  const STALL_THRESHOLD_PX = 20;
  const MAX_STALL_CYCLES = 3;
  const EXTRA_CAPTURE_PASSES = 1;
  const SIG_MEMORY_LIMIT = 2000;
  const HEAP_THRESHOLD_PCT = 0.8;
  const BATCH_SIZE = 50;
  const PRUNE_PX = 500;
  const CAPTURE_MEDIA = true;
  const STRIP_MEDIA_ALWAYS = false; // v12.6: Disabled to fix layout collapse
  const USE_MUTATION_OBSERVER = true;
  const STRIP_DELAY_MS = 2000;    // Wait before stripping media
  const MAX_CYCLES_BEFORE_PAUSE = Infinity;
  const SIGNATURE_TRUNCATE = 200;

  // === UI PANEL ===
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed; top:10px; right:10px; z-index:9999; background:red; color:white; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer; font-family:sans-serif; box-shadow:0 4px 6px rgba(0,0,0,0.1); font-size:14px;';
  panel.innerText = '🛑 STOP & SAVE';
  document.body.appendChild(panel);

  // === DIAGNOSTICS PANEL ===
  const diagPanel = document.createElement('div');
  diagPanel.style.cssText = 'position:fixed; top:60px; right:10px; z-index:9999; background:rgba(0,0,0,0.85); color:#0f0; padding:12px; border-radius:5px; font-family:monospace; font-size:11px; min-width:280px; box-shadow:0 4px 6px rgba(0,0,0,0.3);';
  diagPanel.innerHTML = '<div style="color:#fff;font-weight:bold;margin-bottom:8px;">📊 v12.5 Diagnostics</div><div id="diag-content">Waiting to start...</div>';
  document.body.appendChild(diagPanel);

  function updateDiagPanel() {
    const mem = performance && performance.memory ? performance.memory : null;
    const efficiency = totalCaptured > 0 ? ((totalCaptured / (totalCaptured + totalSkipped)) * 100).toFixed(1) : '100';
    const skipRate = (totalCaptured + totalSkipped) > 0 ? ((totalSkipped / (totalCaptured + totalSkipped)) * 100).toFixed(1) : '0';
    const speedColor = currentSpeed <= BASE_SPEED_MS ? '#0f0' : currentSpeed >= MAX_SPEED_MS ? '#f00' : '#ff0';
    const stallColor = stallCount === 0 ? '#0f0' : stallCount < 3 ? '#ff0' : '#f00';

    const html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;">
        <span>⏱️ Speed:</span><span style="color:${speedColor}">${currentSpeed}ms</span>
        <span>🔄 Stalls:</span><span style="color:${stallColor}">${stallCount}</span>
        <span>🚀 Nudges:</span><span style="color:#0af">${totalNudges}</span>
        <span>📦 Batch:</span><span>${batchCounter} (${currentBatch.length}/${BATCH_SIZE})</span>
        <span>✅ Captured:</span><span>${totalCaptured}</span>
        <span>⏭️ Skipped:</span><span style="color:#888">${totalSkipped}</span>
        <span>📈 Efficiency:</span><span style="color:${efficiency > 80 ? '#0f0' : '#ff0'}">${efficiency}%</span>
        <span>🧹 Pruned:</span><span>${totalPruned}</span>
        <span>🔖 Signatures:</span><span>${capturedRowSignatures.size}</span>
        <span>💾 Saved:</span><span>${totalSaved} files</span>
      </div>
      ${mem ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #333;">
        <span>🧠 Heap:</span> <span style="color:${mem.usedJSHeapSize / mem.jsHeapSizeLimit > 0.7 ? '#f00' : '#0f0'}">${(mem.usedJSHeapSize / 1048576).toFixed(0)}MB</span> / ${(mem.totalJSHeapSize / 1048576).toFixed(0)}MB
      </div>` : ''}
    `;
    document.getElementById('diag-content').innerHTML = html;
  }

  // === STATE ===
  let isRunning = false;
  let currentBatch = [];
  let batchCounter = 1;
  let scrollTimer = null;
  let pruneTimer = null;
  let observer = null;
  let container = null;
  let containerRect = null;

  // Adaptive timing state
  let currentSpeed = BASE_SPEED_MS;
  let lastTopRowY = null;
  let lastScrollHeight = 0;
  let stallCount = 0;
  let consecutiveStallCycles = 0;

  // Duplicate detection
  const capturedRowSignatures = new Set();
  const sigHistory = [];

  function pruneSignatures(newSig) {
    if (capturedRowSignatures.has(newSig)) return true;
    capturedRowSignatures.add(newSig);
    sigHistory.push(newSig);
    if (sigHistory.length > SIG_MEMORY_LIMIT) {
      const old = sigHistory.shift();
      capturedRowSignatures.delete(old);
    }
    return false;
  }

  // Diagnostics
  let totalCaptured = 0;
  let totalSaved = 0;
  let totalPruned = 0;
  let totalSkipped = 0;
  let totalNudges = 0;
  let cycle = 0;
  const LOG_EVERY = 10;

  // === HELPER FUNCTIONS ===

  function findContainer(clicked) {
    const byPagelet = document.querySelector('[data-pagelet="MWInboxDetail_MessageList"]');
    if (byPagelet && byPagelet.scrollHeight > byPagelet.clientHeight) return byPagelet;
    let el = clicked;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  }

  function detectSender(row, defaultSender) {
    const text = row.innerText || '';
    if (text.includes('You sent')) return 'You';
    if (text.includes('replied to you')) return 'Partner';
    if (text.includes('replied to them')) return 'You';
    return defaultSender;
  }

  function getRowSignature(sender, rawText, mediaUrls) {
    const textPart = rawText.slice(0, SIGNATURE_TRUNCATE);
    const mediaPart = (mediaUrls || []).slice(0, 3).join('|');
    return `${sender}|${textPart}|${mediaPart}`;
  }

  function getTopVisibleRowY() {
    if (!container) return null;
    const rows = container.querySelectorAll('[data-pagelet="MWMessageRow"]');
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
        return rect.top;
      }
    }
    return null;
  }

  function adjustSpeed() {
    const topY = getTopVisibleRowY();
    const currentScrollHeight = container.scrollHeight;

    // Heap Watcher
    const mem = performance && performance.memory ? performance.memory : null;
    if (mem && mem.usedJSHeapSize > mem.jsHeapLimit * HEAP_THRESHOLD_PCT) {
      currentSpeed = Math.min(currentSpeed + 1000, MAX_SPEED_MS);
      console.warn(`%c⚠️ RAM GUARD%c: Heap usage high (${(mem.usedJSHeapSize / 1048576).toFixed(0)}MB). Slowing to ${currentSpeed}ms to allow GC.`, 'color:red;font-weight:bold', 'color:#888');
    }

    // Stall detection
    const contentChanged = (lastTopRowY !== null && topY !== null && Math.abs(topY - lastTopRowY) >= STALL_THRESHOLD_PX) ||
      (lastScrollHeight !== 0 && currentScrollHeight > lastScrollHeight);

    if (topY !== null && !contentChanged) {
      // Stalled
      stallCount++;
      consecutiveStallCycles++;

      const oldSpeed = currentSpeed;
      currentSpeed = Math.min(currentSpeed + SPEED_INCREMENT, MAX_SPEED_MS);
      console.log(`%c⏳ STALL #${stallCount}%c: Content not loading. Speed: ${oldSpeed}ms → ${currentSpeed}ms`, 'color:#f90;font-weight:bold', 'color:#888');

      // Nudge
      if (consecutiveStallCycles >= MAX_STALL_CYCLES && currentSpeed >= MAX_SPEED_MS) {
        totalNudges++;
        console.log(`%c🚀 NUDGE #${totalNudges}%c: Deep stall detected. Forcing scroll to wake up lazy loader.`, 'color:#0af;font-weight:bold', 'color:#888');
        container.scrollBy(0, -200);
        consecutiveStallCycles = 0;
      }
    } else if (topY !== null) {
      // Recovered
      const wasStalled = stallCount > 0;
      stallCount = 0;
      consecutiveStallCycles = 0;

      const oldSpeed = currentSpeed;
      currentSpeed = Math.max(BASE_SPEED_MS, currentSpeed - SPEED_DECREMENT);
      if (wasStalled && currentSpeed < oldSpeed) {
        console.log(`%c✅ RECOVERED%c: Content flowing. Speed: ${oldSpeed}ms → ${currentSpeed}ms`, 'color:#0f0;font-weight:bold', 'color:#888');
      }
    }

    lastTopRowY = topY;
    lastScrollHeight = currentScrollHeight;
    updateDiagPanel();
  }

  function stripMedia(containerNode) {
    if (!STRIP_MEDIA_ALWAYS) return;
    containerNode.querySelectorAll('img').forEach((img) => {
      if (img.src && img.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(img.src); } catch (e) { }
      }
      // v12.5 Fix: Freeze dimensions
      if (img.getBoundingClientRect) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          img.style.width = `${rect.width}px`;
          img.style.height = `${rect.height}px`;
          img.style.objectFit = 'contain';
          img.style.backgroundColor = '#ccc'; // Visual placeholder
        }
      }
      img.removeAttribute('src');
      img.removeAttribute('srcset');
    });
    containerNode.querySelectorAll('[role="img"]').forEach((el) => {
      const bg = el.style ? el.style.backgroundImage || '' : '';
      const match = bg.match(/url\(['"]?(.*?)['"]?\)/i);
      if (match && match[1] && match[1].startsWith('blob:')) {
        try { URL.revokeObjectURL(match[1]); } catch (e) { }
      }
      if (el.style) el.style.backgroundImage = 'none';
    });
    containerNode.querySelectorAll('video,source').forEach((el) => {
      const src = el.getAttribute('src');
      if (src && src.startsWith('blob:')) {
        try { URL.revokeObjectURL(src); } catch (e) { }
      }
      el.removeAttribute('src');
      el.removeAttribute('srcset');
    });
  }

  function isLikelyAvatar(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    if (!u.startsWith('http')) return false;
    const sizeTokens = ['s160x160', 'p160x160', 'c0.0.160.160a'];
    if (u.includes('scontent') && sizeTokens.some((t) => u.includes(t))) return true;
    if (u.includes('/v/t39.30808-1/') || u.includes('/v/t39.30808-6/')) return true;
    if (u.includes('profile') || u.includes('avatar')) return true;
    return false;
  }

  function extractMedia(row) {
    if (!CAPTURE_MEDIA) return [];
    const urls = [];

    const addUrl = (u) => {
      if (!u || typeof u !== 'string') return;
      if (u.startsWith('blob:')) return;
      if (!u.startsWith('http')) return;
      if (isLikelyAvatar(u)) return;
      if (urls.includes(u)) return;
      urls.push(u);
    };

    const addFromStyle = (el) => {
      if (!el) return;
      const inlineStyle = el.getAttribute('style') || '';
      [inlineStyle, getComputedStyle(el).backgroundImage || ''].forEach((styleStr) => {
        const match = styleStr.match(/url\(['"]?(.*?)['"]?\)/i);
        if (match && match[1]) addUrl(match[1]);
      });
    };

    const fromImg = (img) => {
      addUrl(img.getAttribute('src'));
      addUrl(img.currentSrc);
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        const first = srcset.split(',')[0].trim().split(' ')[0];
        addUrl(first);
      }
      addUrl(img.getAttribute('data-uri'));
      addUrl(img.getAttribute('data-media-uri'));
      addUrl(img.getAttribute('data-muri'));
      addUrl(img.getAttribute('data-url'));
      addUrl(img.getAttribute('data-thumb-url'));
      addFromStyle(img.parentElement);
    };

    row.querySelectorAll('img').forEach(fromImg);

    row.querySelectorAll('[role="img"]').forEach((el) => {
      addFromStyle(el);
      addFromStyle(el.parentElement);
      addUrl(el.getAttribute('data-uri'));
      addUrl(el.getAttribute('data-media-uri'));
      addUrl(el.getAttribute('data-muri'));
      addUrl(el.getAttribute('data-url'));
      addUrl(el.getAttribute('data-thumb-url'));
    });

    return urls;
  }

  function logStatus(reason) {
    const mem = performance && performance.memory ? performance.memory : null;
    const rowsInDom = container ? container.querySelectorAll('[data-pagelet="MWMessageRow"]').length : -1;
    console.log('[STAT]', reason, {
      cycle,
      currentBatch: currentBatch.length,
      totalCaptured,
      totalSkipped,
      totalSaved,
      totalPruned,
      rowsInDom,
      currentSpeed,
      stallCount,
      signaturesTracked: capturedRowSignatures.size,
      usedJSHeapMB: mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) : 'n/a',
      totalJSHeapMB: mem ? (mem.totalJSHeapSize / 1048576).toFixed(1) : 'n/a'
    });
  }

  // Debug: Log signature creation to find why dupes aren't skipped
  function debugSignature(sender, rawText, media, row) {
    if (cycle < 2) return; // Only log after first scroll
    const sig = getRowSignature(sender, rawText, media);
    const isDup = capturedRowSignatures.has(sig);
    const isMarked = row.dataset.captured === '1';

    if (!isDup && !isMarked) {
      // This row is considered "NEW" by logic.
      // Check if we have a similar signature (fuzzy match?)
      // Log it to see if it SHOULD have been a dup.
      // Only log first 3 per cycle to avoid spam
      if (Math.random() < 0.05) {
        console.log(`%c[SIG CHECK] New: ${sig.slice(0, 50)}...`, 'color:pink');
        console.log('   -> DOM Marked?', isMarked);
        console.log('   -> In Set?', isDup);
      }
    }
  }

  function pruneDOM() {
    if (!container) return;
    containerRect = container.getBoundingClientRect();

    const hollowRow = (row) => {
      if (!row || row.dataset.hollowed === '1') return false;
      const rect = row.getBoundingClientRect();
      const h = rect.height || row.offsetHeight || 40;

      // v12.7: Don't strip media if it causes crash, but DO hollow out
      // To save RAM, we must remove the complex DOM nodes.
      // Fix scroll jump: When removing items ABOVE viewport, scroll position usually jumps.
      // We must adjust scrollTop to compensate, OR use `content-visibility: auto`.

      stripMedia(row); // Remove images (heavy)

      const placeholder = document.createElement('div');
      placeholder.style.height = `${h}px`;
      placeholder.style.width = '100%';
      placeholder.style.pointerEvents = 'none';
      placeholder.dataset.hollowed = '1';
      // v12.7: Visual placeholder to see what was pruned
      placeholder.style.border = '1px dashed #444';
      placeholder.textContent = `[Pruned: ${h.toFixed(0)}px]`;
      placeholder.style.color = '#666';
      placeholder.style.fontSize = '10px';

      row.replaceWith(placeholder);
      return true;
    };

    const rows = container.querySelectorAll('[data-pagelet="MWMessageRow"]');
    let hollowed = 0;

    // v12.7: Aggressive Pruning - Prune everything ABOVE the top + buffer
    // Only keep 2 screens above viewport for scroll up context
    const PRUNE_TOP_BUFFER = containerRect.height * 2;

    rows.forEach((row) => {
      const rect = row.getBoundingClientRect();

      // Prune if far ABOVE viewport (Old messages) -> Primary RAM saver
      if (rect.bottom < containerRect.top - PRUNE_TOP_BUFFER) {
        if (hollowRow(row)) hollowed += 1;
      }
      // Prune if far BELOW viewport (Future?) - unlikely in scroll up, but safe measure
      else if (rect.top > containerRect.bottom + PRUNE_PX) {
        if (hollowRow(row)) hollowed += 1;
      }
    });

    if (hollowed > 0) console.log(`🧹 Hollowed ${hollowed} rows`);
  }

  function saveBatch() {
    if (currentBatch.length === 0) return;
    const jsonStr = JSON.stringify(currentBatch, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json; charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `messenger_row_part_${batchCounter}.json`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    currentBatch.length = 0; // Clear array efficiently
    batchCounter += 1;
    totalSaved += 1;
  }

  function stopAndSave(reason) {
    clearTimeout(scrollTimer);
    clearInterval(pruneTimer);
    if (observer) observer.disconnect();
    saveBatch();
    logStatus(reason);
    panel.innerText = '⏸ PAUSED - reload to resume';
  }

  // === MAIN CAPTURE LOOP ===

  function captureLoop() {
    try {
      containerRect = container.getBoundingClientRect();
      const rows = container.querySelectorAll('[data-pagelet="MWMessageRow"]');

      rows.forEach((row) => {
        const rect = row.getBoundingClientRect();
        if (rect.top < containerRect.top || rect.top > containerRect.bottom) return;

        // Skip if already captured (DOM Flag)
        if (row.dataset.captured === '1') {
          totalSkipped++;
          return;
        }

        const defaultSender = rect.left - containerRect.left > containerRect.width * 0.5 ? 'You' : 'Partner';
        const sender = detectSender(row, defaultSender);
        const media = extractMedia(row);
        const rawText = (row.innerText || '').trim();

        // Debug signature on potential new rows
        debugSignature(sender, rawText, media, row);

        const sig = getRowSignature(sender, rawText, media);
        if (pruneSignatures(sig)) {
          totalSkipped++;
          row.dataset.captured = '1';
          return;
        }

        currentBatch.push({
          y: rect.top,
          sender,
          raw_text: rawText,
          media_urls: media,
          ts: Date.now(),
        });

        totalCaptured += 1;
        row.dataset.captured = '1';

        // Delayed strip
        setTimeout(() => stripMedia(row), STRIP_DELAY_MS);
      });

      if (!CAPTURE_MEDIA) {
        stripMedia(document);
        stripMedia(container);
      }

      if (currentBatch.length >= BATCH_SIZE) {
        saveBatch();
        panel.innerText = `⚡ Batch ${batchCounter} | ${currentSpeed}ms`;
        console.log(`%c📥 SAVED%c: Batch ${batchCounter - 1} complete. Total captured: ${totalCaptured}, skipped: ${totalSkipped}`, 'color:#0af;font-weight:bold', 'color:#888');
      }

      // Update diagnostics
      updateDiagPanel();

      container.scrollBy(0, -(container.clientHeight * SCROLL_AMOUNT));

      cycle += 1;
      if (cycle % LOG_EVERY === 0) logStatus('periodic');
      if (cycle >= MAX_CYCLES_BEFORE_PAUSE) {
        stopAndSave('safety_cutoff');
        return;
      }

      adjustSpeed();

      // Extra capture passes
      if (EXTRA_CAPTURE_PASSES > 0) {
        setTimeout(() => {
          for (let pass = 0; pass < EXTRA_CAPTURE_PASSES; pass++) {
            containerRect = container.getBoundingClientRect();
            const rows = container.querySelectorAll('[data-pagelet="MWMessageRow"]');
            rows.forEach((row) => {
              const rect = row.getBoundingClientRect();
              if (rect.top < containerRect.top || rect.top > containerRect.bottom) return;

              if (row.dataset.captured === '1') return; // DOM flag check

              const defaultSender = rect.left - containerRect.left > containerRect.width * 0.5 ? 'You' : 'Partner';
              const sender = detectSender(row, defaultSender);
              const media = extractMedia(row);
              const rawText = (row.innerText || '').trim();

              // Debug signature
              debugSignature(sender, rawText, media, row);

              const sig = getRowSignature(sender, rawText, media);
              if (pruneSignatures(sig)) {
                row.dataset.captured = '1';
                return;
              }

              currentBatch.push({
                y: rect.top,
                sender,
                raw_text: rawText,
                media_urls: media,
                ts: Date.now(),
              });
              totalCaptured += 1;
              row.dataset.captured = '1';

              // Delayed strip
              setTimeout(() => stripMedia(row), STRIP_DELAY_MS);
            });
          }
          updateDiagPanel();
        }, 200); // 200ms pass delay
      }

      scheduleNextCycle();

    } catch (err) {
      console.error('Capture loop error', err);
      logStatus('error');
      scheduleNextCycle();
    }
  }

  function scheduleNextCycle() {
    scrollTimer = setTimeout(captureLoop, currentSpeed);
  }

  // === EVENT HANDLERS ===

  document.addEventListener('click', function handler(e) {
    if (isRunning) return;
    e.preventDefault();
    e.stopPropagation();

    container = findContainer(e.target);
    if (!container) {
      alert('Could not find scroll container. Click inside the message list.');
      return;
    }
    containerRect = container.getBoundingClientRect();

    if (USE_MUTATION_OBSERVER) {
      observer = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
          m.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (!CAPTURE_MEDIA) stripMedia(node);
          });
        });
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    isRunning = true;
    panel.style.background = '#28a745';
    panel.innerText = `⚡ Batch ${batchCounter} | ${currentSpeed}ms`;
    console.log('%c🚀 v12.5 COLLECTOR STARTED%c\nAdaptive timing: %c' + BASE_SPEED_MS + 'ms%c (base)\nDuplicate protection: %cDataset Marking%c\nStability: %cDimension Freeze%c',
      'color:#0f0;font-weight:bold;font-size:14px', 'color:#888',
      'color:#0f0', 'color:#888',
      'color:#f90', 'color:#888',
      'color:#0af', 'color:#888'
    );
    updateDiagPanel();

    scheduleNextCycle();

    pruneTimer = setInterval(() => {
      pruneDOM();
    }, 1500);
  }, { once: true });

  panel.onclick = function () {
    stopAndSave('manual_stop');
    panel.remove();
    alert(`Stopped. Captured ${totalCaptured} rows, skipped ${totalSkipped} duplicates. Move messenger_row_part_*.json to data/raw`);
  };
})();