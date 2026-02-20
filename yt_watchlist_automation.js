// ==UserScript==
// @name         Watch Later Bulk Add (UI Automation)
// @namespace    juanse-watchlater-bulk
// @version      4.4.0
// @description  Bulk add Watch Later videos to playlists using YouTube's native UI + Smart Cleanup
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

console.log('🔥 [WL Bulk] Script loaded! 4.4.0', new Date().toLocaleTimeString());

(() => {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[WL Bulk]', ...args);
  const error = (...args) => console.error('[WL Bulk ERROR]', ...args);

  // ✅ NEW: disable auto page reload at the end (for debugging)
  const AUTO_RELOAD_AFTER_RUN = false;

  // ---------- Utilities ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isWatchLaterPage() {
    return window.location.pathname === '/playlist' &&
           window.location.search.includes('list=WL');
  }

  function toast(msg, isErr = false) {
    log(isErr ? '❌ Toast Error:' : '✅ Toast:', msg);

    let el = document.getElementById('wlBulkToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wlBulkToast';
      el.style.cssText = `
        position: fixed; right: 20px; bottom: 80px; z-index: 999999;
        max-width: 400px; padding: 14px 18px; border-radius: 12px;
        background: ${isErr ? 'rgba(220,38,38,0.95)' : 'rgba(20,20,20,0.95)'}; 
        color: #fff; 
        font: 14px/1.5 Roboto, Arial, sans-serif;
        box-shadow: 0 12px 40px rgba(0,0,0,0.5);
        border: 1px solid ${isErr ? 'rgba(255,100,100,0.4)' : 'rgba(255,255,255,0.2)'};
        transition: opacity 0.3s ease, transform 0.3s ease;
        transform: translateY(0);
      `;
      document.body.appendChild(el);
    }

    el.textContent = msg;
    el.style.background = isErr ? 'rgba(220,38,38,0.95)' : 'rgba(20,20,20,0.95)';
    el.style.border = isErr ? '1px solid rgba(255,100,100,0.4)' : '1px solid rgba(255,255,255,0.2)';
    el.style.display = 'block';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';

    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => el.style.display = 'none', 300);
    }, 4000);
  }

  async function processInBatches(items, batchSize, pauseMs, perItemFn) {
    for (let start = 0; start < items.length; start += batchSize) {
      const batch = items.slice(start, start + batchSize);
      for (let i = 0; i < batch.length; i++) {
        await perItemFn(batch[i], start + i, items.length);
      }
      if (start + batchSize < items.length) {
        log(`⏸️ Batch pause ${pauseMs}ms (processed ${Math.min(start + batchSize, items.length)}/${items.length})`);
        await sleep(pauseMs);
      }
    }
  }

  // ---------- Click Helpers ----------
  function robustClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); } catch {}
    const opts = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(type, opts)); } catch {}
    }
    try { el.click(); } catch {}
    return true;
  }

  function closeAnyOpenMenu() {
    try { document.body.click(); } catch {}
  }

  // ---------- Video Selection ----------
  function getVideoIdFromRenderer(renderer) {
    const selectors = [
      'a#video-title',
      'a.yt-simple-endpoint',
      'a[href*="/watch?v="]',
      '#content a'
    ];
    for (const sel of selectors) {
      const anchor = renderer.querySelector(sel);
      if (anchor) {
        const href = anchor.getAttribute('href') || '';
        const match = href.match(/[?&]v=([^&]+)/);
        if (match) return match[1];
      }
    }
    return null;
  }

  function findRendererByVideoId(videoId) {
    if (!videoId) return null;
    const renderers = document.querySelectorAll('ytd-playlist-video-renderer');
    for (const r of renderers) {
      const id = getVideoIdFromRenderer(r);
      if (id === videoId) return r;
    }
    return null;
  }

  function isVideoStillInWatchLater(videoId) {
    return !!findRendererByVideoId(videoId);
  }

  async function getFreshRenderer(videoId, fallbackRenderer = null) {
    if (fallbackRenderer && fallbackRenderer.isConnected) return fallbackRenderer;

    let r = findRendererByVideoId(videoId);
    if (r) return r;

    await sleep(300);
    r = findRendererByVideoId(videoId);
    if (r) return r;

    return null;
  }

  // ---------- Remove menu item finder ----------
  function normalizeText(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function findRemoveFromWatchLaterMenuItem() {
    const candidates = document.querySelectorAll(
      'tp-yt-paper-item.style-scope.ytd-menu-service-item-renderer, ytd-menu-service-item-renderer tp-yt-paper-item'
    );

    for (const item of candidates) {
      const t = normalizeText(item.textContent);
      if (t.includes('remove') && t.includes('watch later')) {
        return item;
      }
    }
    return null;
  }

  async function waitForRemoveMenuItem(timeoutMs = 1800) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const item = findRemoveFromWatchLaterMenuItem();
      if (item) return item;
      await sleep(50);
    }
    return null;
  }

  // ---------- Check if video is in other playlists ----------
  async function checkIfVideoInOtherPlaylists(videoRenderer) {
    log(`🔍 Checking if video is in other playlists...`);

    try {
      videoRenderer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(400);

      const originalBorder = videoRenderer.style.border;
      const originalBoxShadow = videoRenderer.style.boxShadow;
      videoRenderer.style.border = '3px solid #FFA500';
      videoRenderer.style.boxShadow = '0 0 20px rgba(255, 165, 0, 0.6)';
      videoRenderer.style.transition = 'all 0.3s ease';

      const menuButton = videoRenderer.querySelector('button[aria-label*="Action menu"], button[aria-label="More actions"], ytd-menu-renderer button');
      if (!menuButton) throw new Error('Could not find menu button');

      closeAnyOpenMenu();
      await sleep(120);
      robustClick(menuButton);
      await sleep(500);

      const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item');
      let addToPlaylistItem = null;

      for (const item of menuItems) {
        const text = item.textContent || '';
        if (text.includes('Add to playlist') ||
            text.includes('Save to playlist') ||
            text.includes('Save to') ||
            (text.includes('Save') && text.length < 30)) {
          addToPlaylistItem = item;
          break;
        }
      }

      if (!addToPlaylistItem) {
        videoRenderer.style.border = originalBorder;
        videoRenderer.style.boxShadow = originalBoxShadow;
        closeAnyOpenMenu();
        throw new Error('Could not find "Save to playlist" option');
      }

      robustClick(addToPlaylistItem);
      await sleep(1500);

      let playlistItems = document.querySelectorAll('yt-list-item-view-model');
      if (playlistItems.length === 0) {
        await sleep(500);
        playlistItems = document.querySelectorAll('yt-list-item-view-model');
      }
      if (playlistItems.length === 0) {
        videoRenderer.style.border = originalBorder;
        videoRenderer.style.boxShadow = originalBoxShadow;
        closeAnyOpenMenu();
        throw new Error('Playlist modal did not open');
      }

      // Count how many playlists this video is in
      let playlistCount = 0;
      let playlistNames = [];

      for (const item of playlistItems) {
        const playlistButton = item.querySelector('button.yt-list-item-view-model__button-or-anchor');
        if (!playlistButton) continue;

        const isPressed = playlistButton.getAttribute('aria-pressed') === 'true';
        if (isPressed) {
          playlistCount++;
          const titleElement = item.querySelector('.yt-list-item-view-model__title');
          const playlistName = titleElement?.textContent?.trim() || 'Unknown';
          playlistNames.push(playlistName);
        }
      }

      // Close the modal
      const closeButton = document.querySelector('[aria-label="Close"]');
      if (closeButton) {
        closeButton.click();
        await sleep(400);
      }

      videoRenderer.style.border = originalBorder;
      videoRenderer.style.boxShadow = originalBoxShadow;

      log(`📊 Video is in ${playlistCount} playlist(s): ${playlistNames.join(', ')}`);

      // If count > 1, it means it's in Watch Later + at least one other playlist
      const isInOtherPlaylists = playlistCount > 1;

      return { 
        isInOtherPlaylists, 
        playlistCount, 
        playlistNames 
      };

    } catch (err) {
      error('❌ Check playlists failed:', err.message);
      try { 
        videoRenderer.style.border = '';
        videoRenderer.style.boxShadow = '';
      } catch {}
      try { closeAnyOpenMenu(); } catch {}
      throw err;
    }
  }

  // ---------- Checkbox injection ----------
  function addCheckbox(renderer) {
    if (renderer.querySelector('.wlBulkCheckbox')) return;

    const videoId = getVideoIdFromRenderer(renderer);
    if (!videoId) return;

    if (getComputedStyle(renderer).position === 'static') {
      renderer.style.position = 'relative';
    }

    const container = document.createElement('div');
    container.className = 'wlBulkCheckbox';
    container.style.cssText = `
      position: absolute;
      left: -44px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 1000;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.7);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 1px solid rgba(255, 255, 255, 0.15);
    `;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'wlBulkCb';
    checkbox.dataset.videoId = videoId;
    checkbox.style.cssText = `
      width: 22px;
      height: 22px;
      cursor: pointer;
      margin: 0;
      accent-color: #3ea6ff;
    `;

    container.appendChild(checkbox);

    container.addEventListener('mouseenter', () => {
      container.style.background = 'rgba(0, 0, 0, 0.9)';
      container.style.transform = 'translateY(-50%) scale(1.08)';
      container.style.borderColor = 'rgba(62, 166, 255, 0.5)';
    });
    container.addEventListener('mouseleave', () => {
      container.style.background = 'rgba(0, 0, 0, 0.7)';
      container.style.transform = 'translateY(-50%) scale(1)';
      container.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    });

    renderer.appendChild(container);
  }

  function injectCheckboxes() {
    if (!isWatchLaterPage()) return;

    const renderers = document.querySelectorAll('ytd-playlist-video-renderer');
    if (renderers.length === 0) return;

    log(`🎯 Found ${renderers.length} video renderers, adding checkboxes...`);
    renderers.forEach(addCheckbox);
    updateSelectedCount();
  }

  function getSelectedVideoIds() {
    const checked = [...document.querySelectorAll('.wlBulkCb:checked')];
    return checked.map(cb => cb.dataset.videoId).filter(Boolean);
  }

  function getSelectedRenderers() {
    const checked = [...document.querySelectorAll('.wlBulkCb:checked')];
    return checked.map(cb => cb.closest('ytd-playlist-video-renderer')).filter(Boolean);
  }

  function getAllLoadedRenderers() {
    return [...document.querySelectorAll('ytd-playlist-video-renderer')];
  }

  function getAllLoadedVideoIds() {
    const renderers = getAllLoadedRenderers();
    return renderers.map(r => getVideoIdFromRenderer(r)).filter(Boolean);
  }

  function updateSelectedCount() {
    const count = getSelectedVideoIds().length;
    const el = document.getElementById('wlBulkCount');
    if (el) {
      el.textContent = String(count);
      el.style.color = count > 0 ? '#3ea6ff' : '#aaa';
    }
  }

  // ---------- UI Automation ----------
  async function addVideoToPlaylistViaUI(videoRenderer, playlistName) {
    log(`🎬 Adding video via UI automation...`);

    try {
      videoRenderer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(400);

      const originalBorder = videoRenderer.style.border;
      const originalBoxShadow = videoRenderer.style.boxShadow;
      videoRenderer.style.border = '3px solid #3ea6ff';
      videoRenderer.style.boxShadow = '0 0 20px rgba(62, 166, 255, 0.6)';
      videoRenderer.style.transition = 'all 0.3s ease';

      const menuButton = videoRenderer.querySelector('button[aria-label*="Action menu"], button[aria-label="More actions"], ytd-menu-renderer button');
      if (!menuButton) throw new Error('Could not find menu button');

      robustClick(menuButton);
      await sleep(500);

      const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item');
      let addToPlaylistItem = null;

      for (const item of menuItems) {
        const text = item.textContent || '';
        if (text.includes('Add to playlist') ||
            text.includes('Save to playlist') ||
            text.includes('Save to') ||
            (text.includes('Save') && text.length < 30)) {
          addToPlaylistItem = item;
          break;
        }
      }

      if (!addToPlaylistItem) {
        closeAnyOpenMenu();
        throw new Error('Could not find "Save to playlist" option');
      }

      robustClick(addToPlaylistItem);
      await sleep(1500);

      let playlistItems = document.querySelectorAll('yt-list-item-view-model');
      if (playlistItems.length === 0) {
        await sleep(500);
        playlistItems = document.querySelectorAll('yt-list-item-view-model');
      }
      if (playlistItems.length === 0) throw new Error('Playlist modal did not open or has different structure');

      const findPlaylistInView = () => {
        const visibleItems = document.querySelectorAll('yt-list-item-view-model');
        for (const item of visibleItems) {
          const titleElement = item.querySelector('.yt-list-item-view-model__title');
          const itemTitle = titleElement?.textContent?.trim() || '';
          if (itemTitle === playlistName || itemTitle.includes(playlistName)) {
            return item;
          }
        }
        return null;
      };

      let targetPlaylistItem = findPlaylistInView();

      if (!targetPlaylistItem && playlistItems.length > 0) {
        const scrollableContainer = document.querySelector('tp-yt-paper-dialog-scrollable, ytd-add-to-playlist-renderer, [role="dialog"] [style*="overflow"]');
        if (scrollableContainer) {
          const maxScrollAttempts = 10;
          for (let i = 0; i < maxScrollAttempts && !targetPlaylistItem; i++) {
            scrollableContainer.scrollTop += 200;
            await sleep(300);
            targetPlaylistItem = findPlaylistInView();
            const isAtBottom = scrollableContainer.scrollHeight - scrollableContainer.scrollTop <= scrollableContainer.clientHeight + 10;
            if (isAtBottom) break;
          }
        }
      }

      if (!targetPlaylistItem) {
        const closeButton = document.querySelector('[aria-label="Close"]');
        if (closeButton) closeButton.click();
        throw new Error(`Could not find playlist "${playlistName}" in modal`);
      }

      targetPlaylistItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await sleep(300);

      const playlistButton = targetPlaylistItem.querySelector('button.yt-list-item-view-model__button-or-anchor');
      if (!playlistButton) throw new Error('Could not find playlist button');

      const isPressed = playlistButton.getAttribute('aria-pressed') === 'true';

      if (isPressed) {
        const closeButton = document.querySelector('[aria-label="Close"]');
        if (closeButton) {
          closeButton.click();
          await sleep(400);
        }
        videoRenderer.style.border = originalBorder;
        videoRenderer.style.boxShadow = originalBoxShadow;
        return { skipped: true, reason: 'already_in_playlist' };
      } else {
        robustClick(playlistButton);
        await sleep(500);
      }

      const closeButton = document.querySelector('[aria-label="Close"]');
      if (closeButton) {
        closeButton.click();
        await sleep(400);
      }

      videoRenderer.style.border = originalBorder;
      videoRenderer.style.boxShadow = originalBoxShadow;

      return { skipped: false };

    } catch (err) {
      error('❌ UI automation failed:', err.message);
      try { videoRenderer.style.border = ''; videoRenderer.style.boxShadow = ''; } catch {}
      try { closeAnyOpenMenu(); } catch {}
      throw err;
    }
  }

  async function removeVideoFromWatchLaterViaUI(videoRenderer, videoId = null) {
    log(`🗑️ Removing video from Watch Later via UI...`, videoId || '');

    try {
      videoRenderer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(450);

      const originalBorder = videoRenderer.style.border;
      const originalBoxShadow = videoRenderer.style.boxShadow;
      videoRenderer.style.border = '3px solid #ff4444';
      videoRenderer.style.boxShadow = '0 0 20px rgba(255, 68, 68, 0.6)';
      videoRenderer.style.transition = 'all 0.3s ease';

      const menuButton = videoRenderer.querySelector('button[aria-label*="Action menu"], button[aria-label="More actions"], ytd-menu-renderer button');
      if (!menuButton) throw new Error('Could not find menu button');

      closeAnyOpenMenu();
      await sleep(120);
      robustClick(menuButton);

      const removeItem = await waitForRemoveMenuItem(2200);
      if (!removeItem) {
        closeAnyOpenMenu();
        throw new Error('Could not find Remove from Watch later menu item (menu likely did not open)');
      }

      robustClick(removeItem);
      await sleep(900);

      videoRenderer.style.border = originalBorder;
      videoRenderer.style.boxShadow = originalBoxShadow;

      return true;

    } catch (err) {
      error('❌ Remove automation failed:', err.message);
      try { videoRenderer.style.border = ''; videoRenderer.style.boxShadow = ''; } catch {}
      try { closeAnyOpenMenu(); } catch {}
      throw err;
    }
  }

  // ---------- Control Panel ----------
  function buildPanel() {
    if (document.getElementById('wlBulkPanel')) return;
    if (!isWatchLaterPage()) return;

    const panel = document.createElement('div');
    panel.id = 'wlBulkPanel';
    panel.style.cssText = `
      position: fixed !important;
      left: 20px !important;
      bottom: 20px !important;
      z-index: 9999999 !important;
      width: 400px;
      padding: 18px;
      border-radius: 14px;
      background: rgba(28, 28, 28, 0.98) !important;
      color: #fff !important;
      font: 14px/1.5 Roboto, Arial, sans-serif !important;
      box-shadow: 0 10px 50px rgba(0, 0, 0, 0.8) !important;
      border: 2px solid rgba(62, 166, 255, 0.4) !important;
      backdrop-filter: blur(12px);
      pointer-events: auto !important;
      display: block !important;
      visibility: visible !important;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;';
    const title = document.createElement('div');
    title.textContent = '📋 WL Bulk → Playlist';
    title.style.cssText = 'font-size:16px;font-weight:600;';
    const countContainer = document.createElement('div');
    countContainer.style.cssText = 'font-size:14px;';
    countContainer.textContent = 'Selected: ';
    const count = document.createElement('span');
    count.id = 'wlBulkCount';
    count.textContent = '0';
    count.style.cssText = 'font-weight:600;color:#3ea6ff;';
    countContainer.appendChild(count);
    header.appendChild(title);
    header.appendChild(countContainer);
    panel.appendChild(header);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;margin-bottom:12px;';
    const selectBtn = createButton('✓ Select All');
    const clearBtn = createButton('✗ Clear');
    selectBtn.style.flex = '1';
    clearBtn.style.flex = '1';
    btnRow.appendChild(selectBtn);
    btnRow.appendChild(clearBtn);
    panel.appendChild(btnRow);

    const plRow = document.createElement('div');
    plRow.style.cssText = 'display:flex;gap:10px;margin-bottom:10px;';
    const playlistInput = document.createElement('input');
    playlistInput.id = 'wlBulkPlaylistInput';
    playlistInput.type = 'text';
    playlistInput.placeholder = 'Playlist name (e.g., Music Theory)';
    playlistInput.style.cssText = `
      flex:1;padding:11px 14px;border-radius:10px;
      background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.2);
      color:#fff;font-size:14px;
    `;
    const addBtn = createButton('➜ Add to Playlist', true);
    addBtn.id = 'wlBulkAddBtn';
    plRow.appendChild(playlistInput);
    plRow.appendChild(addBtn);
    panel.appendChild(plRow);

    const checkRow = document.createElement('div');
    checkRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px;background:rgba(0,0,0,0.25);border-radius:8px;';
    const removeCheckbox = document.createElement('input');
    removeCheckbox.type = 'checkbox';
    removeCheckbox.id = 'wlBulkRemoveCheck';
    removeCheckbox.checked = true;
    removeCheckbox.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:#3ea6ff;margin:0;';
    const checkLabel = document.createElement('label');
    checkLabel.htmlFor = 'wlBulkRemoveCheck';
    checkLabel.textContent = '🗑️ Also remove from Watch Later after adding';
    checkLabel.style.cssText = 'cursor:pointer;font-size:13px;user-select:none;flex:1;';
    checkRow.appendChild(removeCheckbox);
    checkRow.appendChild(checkLabel);
    panel.appendChild(checkRow);

    // Separator
    const separator = document.createElement('div');
    separator.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:12px 0;';
    panel.appendChild(separator);

    // Smart Cleanup button
    const smartCleanupBtn = createButton('🧹 Smart Cleanup', false);
    smartCleanupBtn.id = 'wlBulkSmartCleanupBtn';
    smartCleanupBtn.style.width = '100%';
    smartCleanupBtn.style.background = 'rgba(0,200,83,0.15)';
    smartCleanupBtn.style.borderColor = 'rgba(0,200,83,0.3)';
    smartCleanupBtn.style.marginBottom = '8px';
    smartCleanupBtn.onmouseenter = () => {
      smartCleanupBtn.style.background = 'rgba(0,200,83,0.25)';
      smartCleanupBtn.style.transform = 'translateY(-1px)';
      smartCleanupBtn.style.borderColor = 'rgba(0,200,83,0.5)';
    };
    smartCleanupBtn.onmouseleave = () => {
      smartCleanupBtn.style.background = 'rgba(0,200,83,0.15)';
      smartCleanupBtn.style.transform = 'translateY(0)';
      smartCleanupBtn.style.borderColor = 'rgba(0,200,83,0.3)';
    };
    panel.appendChild(smartCleanupBtn);

    // Smart Cleanup explanation
    const smartCleanupHelp = document.createElement('div');
    smartCleanupHelp.style.cssText = 'font-size:11px;opacity:0.7;margin-bottom:12px;line-height:1.4;padding:6px 8px;background:rgba(0,200,83,0.08);border-radius:6px;';
    smartCleanupHelp.textContent = 'Removes videos from Watch Later only if they exist in other playlists';
    panel.appendChild(smartCleanupHelp);

    // Another separator
    const separator2 = document.createElement('div');
    separator2.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:12px 0;';
    panel.appendChild(separator2);

    const removeOnlyBtn = createButton('🗑️ Only Remove from Watch Later', false);
    removeOnlyBtn.id = 'wlBulkRemoveOnlyBtn';
    removeOnlyBtn.style.width = '100%';
    removeOnlyBtn.style.background = 'rgba(220,38,38,0.15)';
    removeOnlyBtn.style.borderColor = 'rgba(220,38,38,0.3)';
    removeOnlyBtn.onmouseenter = () => {
      removeOnlyBtn.style.background = 'rgba(220,38,38,0.25)';
      removeOnlyBtn.style.transform = 'translateY(-1px)';
      removeOnlyBtn.style.borderColor = 'rgba(220,38,38,0.5)';
    };
    removeOnlyBtn.onmouseleave = () => {
      removeOnlyBtn.style.background = 'rgba(220,38,38,0.15)';
      removeOnlyBtn.style.transform = 'translateY(0)';
      removeOnlyBtn.style.borderColor = 'rgba(220,38,38,0.3)';
    };
    panel.appendChild(removeOnlyBtn);

    const logBox = document.createElement('div');
    logBox.id = 'wlBulkLog';
    logBox.style.cssText = 'margin-top:14px;max-height:100px;overflow-y:auto;font-size:12px;opacity:0.8;line-height:1.6;border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;';
    panel.appendChild(logBox);

    document.body.appendChild(panel);

    function logMessage(msg, isErr = false) {
      const line = document.createElement('div');
      line.style.color = isErr ? '#ff8080' : '#aaa';
      line.textContent = `${new Date().toLocaleTimeString()}: ${msg}`;
      logBox.prepend(line);
      while (logBox.children.length > 8) logBox.removeChild(logBox.lastChild);
    }

    document.addEventListener('change', (e) => {
      if (e.target?.classList?.contains('wlBulkCb')) updateSelectedCount();
    });

    selectBtn.onclick = () => {
      const cbs = document.querySelectorAll('.wlBulkCb');
      cbs.forEach(cb => cb.checked = true);
      updateSelectedCount();
      toast(`Selected ${cbs.length} videos`);
      logMessage(`Selected all ${cbs.length} videos`);
    };

    clearBtn.onclick = () => {
      const cbs = document.querySelectorAll('.wlBulkCb');
      cbs.forEach(cb => cb.checked = false);
      updateSelectedCount();
      toast('Cleared selection');
      logMessage('Cleared selection');
    };

    // Smart Cleanup button handler
    smartCleanupBtn.onclick = async () => {
      log('🧹 Smart Cleanup clicked!');

      const allVideoIds = getAllLoadedVideoIds();
      const allRenderers = getAllLoadedRenderers();

      if (allVideoIds.length === 0) {
        toast('No videos loaded', true);
        logMessage('No videos loaded', true);
        return;
      }

      const confirmMsg = `Smart Cleanup will:\n\n1. Check all ${allVideoIds.length} loaded video(s)\n2. Remove from Watch Later ONLY if the video exists in other playlists\n3. Keep videos that are ONLY in Watch Later\n\nThis may take a while. Continue?`;

      if (!confirm(confirmMsg)) {
        logMessage('Smart Cleanup cancelled by user');
        return;
      }

      toast(`Smart Cleanup: Checking ${allVideoIds.length} videos...`);
      logMessage(`🧹 Smart Cleanup started: ${allVideoIds.length} videos`);

      smartCleanupBtn.disabled = true;
      smartCleanupBtn.style.opacity = '0.5';

      let checkedCount = 0;
      let toRemoveCount = 0;
      let keptCount = 0;
      let errorCount = 0;

      const videosToRemove = [];

      try {
        // Phase 1: Check each video
        logMessage('Phase 1: Checking which videos are in other playlists...');
        
        for (let i = 0; i < allRenderers.length; i++) {
          const renderer = allRenderers[i];
          const videoId = allVideoIds[i];

          log(`Checking video ${i + 1}/${allRenderers.length} (${videoId})`);
          logMessage(`🔍 Checking: ${i + 1}/${allRenderers.length}`);

          try {
            const result = await checkIfVideoInOtherPlaylists(renderer);
            checkedCount++;

            if (result.isInOtherPlaylists) {
              toRemoveCount++;
              videosToRemove.push({ videoId, renderer });
              logMessage(`✓ Will remove ${i + 1}/${allRenderers.length} (in ${result.playlistCount} playlists)`);
            } else {
              keptCount++;
              logMessage(`○ Will keep ${i + 1}/${allRenderers.length} (only in Watch Later)`);
            }

          } catch (err) {
            errorCount++;
            error(`Failed to check video ${i + 1}:`, err.message);
            logMessage(`⚠️ Check failed: ${i + 1}/${allRenderers.length}`, true);
          }

          // Pause between checks
          await sleep(1200);

          // Batch pause every 25 videos
          if ((i + 1) % 25 === 0 && (i + 1) < allRenderers.length) {
            log(`⏸️ Batch pause after ${i + 1} checks...`);
            logMessage(`⏸️ Batch pause (checked ${i + 1}/${allRenderers.length})...`);
            await sleep(2500);
          }
        }

        logMessage(`Check complete: ${toRemoveCount} to remove, ${keptCount} to keep, ${errorCount} errors`);

        // Phase 2: Remove videos that are in other playlists
        if (videosToRemove.length === 0) {
          toast('✓ No videos to remove - all are only in Watch Later!');
          logMessage('✓ No videos to remove');
        } else {
          const confirmRemove = confirm(`Found ${videosToRemove.length} video(s) that exist in other playlists.\n\nRemove them from Watch Later now?`);

          if (!confirmRemove) {
            logMessage('Removal cancelled by user');
            toast('Smart Cleanup cancelled');
          } else {
            logMessage('Phase 2: Removing videos from Watch Later...');

            let removedCount = 0;

            for (let i = 0; i < videosToRemove.length; i++) {
              const { videoId, renderer } = videosToRemove[i];

              log(`Removing video ${i + 1}/${videosToRemove.length} (${videoId})`);

              try {
                let removed = false;

                for (let attempt = 1; attempt <= 4; attempt++) {
                  const freshRenderer = await getFreshRenderer(videoId, renderer);
                  if (!freshRenderer) break;

                  closeAnyOpenMenu();
                  await sleep(150);

                  try { await removeVideoFromWatchLaterViaUI(freshRenderer, videoId); } catch {}

                  await sleep(600 + attempt * 350);

                  if (!isVideoStillInWatchLater(videoId)) {
                    removed = true;
                    break;
                  }

                  const backoff = 900 + attempt * 700;
                  log(`🔁 Removal verification failed for ${videoId} (attempt ${attempt}/4). Backoff ${backoff}ms...`);
                  await sleep(backoff);
                }

                if (!removed) throw new Error('Verification failed');

                removedCount++;
                logMessage(`🗑️ Removed: ${i + 1}/${videosToRemove.length}`);

              } catch (err) {
                error(`Failed to remove video ${i + 1}:`, err.message);
                logMessage(`⚠️ Remove failed: ${i + 1}/${videosToRemove.length}`, true);
              }

              await sleep(900);

              // Batch pause
              if ((i + 1) % 25 === 0 && (i + 1) < videosToRemove.length) {
                log(`⏸️ Batch pause after ${i + 1} removals...`);
                logMessage(`⏸️ Batch pause (removed ${i + 1}/${videosToRemove.length})...`);
                await sleep(2500);
              }
            }

            toast(`✓ Smart Cleanup complete! Removed ${removedCount}/${videosToRemove.length} videos`);
            logMessage(`✓ Complete: Removed ${removedCount}, Kept ${keptCount}`);
          }
        }

      } catch (err) {
        error('Smart Cleanup failed:', err);
        toast(`✗ Error: ${err.message}`, true);
        logMessage(`✗ Error: ${err.message}`, true);
      } finally {
        smartCleanupBtn.disabled = false;
        smartCleanupBtn.style.opacity = '1';
      }
    };

    addBtn.onclick = async () => {
      const playlistName = playlistInput.value.trim();
      if (!playlistName) {
        toast('Enter a playlist name first', true);
        logMessage('No playlist name entered', true);
        return;
      }

      const renderers = getSelectedRenderers();
      const selectedIds = getSelectedVideoIds();

      if (renderers.length === 0 || selectedIds.length === 0) {
        toast('No videos selected', true);
        logMessage('No videos selected', true);
        return;
      }

      const alsoRemove = document.getElementById('wlBulkRemoveCheck').checked;

      toast(`${alsoRemove ? 'Adding & removing' : 'Adding'} ${selectedIds.length} videos...`);
      logMessage(`Starting: ${selectedIds.length} videos → "${playlistName}"${alsoRemove ? ' (+ remove)' : ''}`);

      addBtn.disabled = true;
      addBtn.style.opacity = '0.5';

      let successCount = 0;
      let skipCount = 0;
      let failCount = 0;

      const idToInitialRenderer = new Map();
      for (const r of renderers) {
        const id = getVideoIdFromRenderer(r);
        if (id) idToInitialRenderer.set(id, r);
      }

      try {
        await processInBatches(
          selectedIds,
          50,
          2000,
          async (videoId, idx, total) => {
            try {
              const freshRenderer = await getFreshRenderer(videoId, idToInitialRenderer.get(videoId));
              if (!freshRenderer) {
                failCount++;
                logMessage(`⚠️ Add failed: ${idx + 1}/${total} - renderer not found`, true);
                return;
              }

              const result = await addVideoToPlaylistViaUI(freshRenderer, playlistName);

              if (result?.skipped) {
                skipCount++;
                logMessage(`⏭️ Skipped: ${idx + 1}/${total}`);
              } else {
                successCount++;
                logMessage(`✓ Added: ${idx + 1}/${total}`);
              }
            } catch (err) {
              failCount++;
              logMessage(`⚠️ Add failed: ${idx + 1}/${total} - ${err.message}`, true);
            }
            await sleep(1000);
          }
        );

        log('✅ Add phase complete');

        if (alsoRemove) {
          logMessage('Now removing from Watch Later...');
          await processInBatches(
            selectedIds,
            50,
            2500,
            async (videoId, idx, total) => {
              try {
                let removed = false;
                for (let attempt = 1; attempt <= 4; attempt++) {
                  const freshRenderer = await getFreshRenderer(videoId, idToInitialRenderer.get(videoId));
                  if (!freshRenderer) break;

                  closeAnyOpenMenu();
                  await sleep(150);

                  try { await removeVideoFromWatchLaterViaUI(freshRenderer, videoId); } catch {}

                  await sleep(600 + attempt * 350);

                  if (!isVideoStillInWatchLater(videoId)) {
                    removed = true;
                    break;
                  }

                  const backoff = 900 + attempt * 700;
                  log(`🔁 Removal verification failed for ${videoId} (attempt ${attempt}/4). Backoff ${backoff}ms...`);
                  await sleep(backoff);
                }

                if (!removed) throw new Error('Verification failed');

                logMessage(`🗑️ Removed: ${idx + 1}/${total}`);
              } catch (err) {
                logMessage(`⚠️ Remove failed: ${idx + 1}/${total} - ${err.message}`, true);
              }

              await sleep(900);
            }
          );

          log('✅ Remove phase complete');
        }

        const finalMsg =
          failCount > 0
            ? `✓ Processed ${selectedIds.length}: ${successCount} added, ${skipCount} skipped, ${failCount} failed`
            : `✓ Done: ${successCount} added${skipCount ? `, ${skipCount} skipped` : ''}${alsoRemove ? ' + removed from WL' : ''}`;

        toast(finalMsg);
        logMessage(finalMsg);
        log('🎉 Operation complete! (AUTO_RELOAD_AFTER_RUN disabled)');

        if (alsoRemove) {
          setTimeout(() => {
            const cbs = document.querySelectorAll('.wlBulkCb:checked');
            cbs.forEach(cb => cb.checked = false);
            updateSelectedCount();
            logMessage('Finished. Page NOT reloading (debug mode).');
          }, 600);
        }

      } catch (err) {
        error('Bulk operation failed:', err);
        toast(`✗ Error: ${err.message}`, true);
        logMessage(`✗ Error: ${err.message}`, true);
      } finally {
        addBtn.disabled = false;
        addBtn.style.opacity = '1';
      }
    };

    removeOnlyBtn.onclick = async () => {
      const selectedIds = getSelectedVideoIds();
      const renderers = getSelectedRenderers();

      if (selectedIds.length === 0 || renderers.length === 0) {
        toast('No videos selected', true);
        logMessage('No videos selected', true);
        return;
      }

      if (!confirm(`Remove ${selectedIds.length} video(s) from Watch Later?`)) {
        logMessage('Remove cancelled by user');
        return;
      }

      toast(`Removing ${selectedIds.length} videos from Watch Later...`);
      logMessage(`Starting removal: ${selectedIds.length} videos`);

      removeOnlyBtn.disabled = true;
      removeOnlyBtn.style.opacity = '0.5';

      let successCount = 0;

      const idToInitialRenderer = new Map();
      for (const r of renderers) {
        const id = getVideoIdFromRenderer(r);
        if (id) idToInitialRenderer.set(id, r);
      }

      try {
        await processInBatches(
          selectedIds,
          50,
          2500,
          async (videoId, idx, total) => {
            try {
              let removed = false;

              for (let attempt = 1; attempt <= 4; attempt++) {
                const freshRenderer = await getFreshRenderer(videoId, idToInitialRenderer.get(videoId));
                if (!freshRenderer) break;

                closeAnyOpenMenu();
                await sleep(150);

                try { await removeVideoFromWatchLaterViaUI(freshRenderer, videoId); } catch {}

                await sleep(600 + attempt * 350);

                if (!isVideoStillInWatchLater(videoId)) {
                  removed = true;
                  break;
                }

                const backoff = 900 + attempt * 700;
                log(`🔁 Remove-only verification failed for ${videoId} (attempt ${attempt}/4). Backoff ${backoff}ms...`);
                await sleep(backoff);
              }

              if (!removed) throw new Error('Verification failed');

              successCount++;
              logMessage(`Removed: ${idx + 1}/${total}`);
            } catch (err) {
              logMessage(`⚠️ Failed: ${idx + 1}/${total} - ${err.message}`, true);
            }

            await sleep(900);
          }
        );

        toast(`✓ Removed ${successCount}/${selectedIds.length} videos!`);
        logMessage(`✓ Success: ${successCount} videos removed`);
        logMessage('Finished. Page NOT reloading (debug mode).');

      } catch (err) {
        error('Remove failed:', err);
        toast(`✗ Error: ${err.message}`, true);
        logMessage(`✗ Error: ${err.message}`, true);
      } finally {
        removeOnlyBtn.disabled = false;
        removeOnlyBtn.style.opacity = '1';
      }
    };
  }

  function createButton(text, primary = false) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
      padding:11px 16px;border-radius:10px;
      background:${primary ? 'rgba(62,166,255,0.18)' : 'rgba(255,255,255,0.08)'};
      border:1px solid rgba(255,255,255,0.18);
      color:#fff;font-size:14px;font-weight:500;cursor:pointer;
      transition:all 0.2s ease;white-space:nowrap;
    `;
    btn.onmouseenter = () => {
      btn.style.background = primary ? 'rgba(62,166,255,0.28)' : 'rgba(255,255,255,0.15)';
      btn.style.transform = 'translateY(-1px)';
    };
    btn.onmouseleave = () => {
      btn.style.background = primary ? 'rgba(62,166,255,0.18)' : 'rgba(255,255,255,0.08)';
      btn.style.transform = 'translateY(0)';
    };
    return btn;
  }

  // ---------- SPA Navigation Handler ----------
  let panelInitialized = false;

  function initialize() {
    if (!isWatchLaterPage()) return;

    if (panelInitialized) {
      injectCheckboxes();
      return;
    }

    buildPanel();
    injectCheckboxes();
    panelInitialized = true;
  }

  // ---------- Boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initialize, 1000));
  } else {
    setTimeout(initialize, 1000);
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      const wasWatchLater = lastUrl.includes('list=WL');
      const isNowWatchLater = currentUrl.includes('list=WL');
      lastUrl = currentUrl;

      if (wasWatchLater && !isNowWatchLater) {
        const panel = document.getElementById('wlBulkPanel');
        if (panel) panel.remove();
        panelInitialized = false;
      }

      if (isNowWatchLater) setTimeout(initialize, 500);
    }
  }).observe(document.documentElement, { subtree: true, childList: true });

  setInterval(() => {
    if (isWatchLaterPage()) injectCheckboxes();
  }, 2000);

  setTimeout(() => {
    if (isWatchLaterPage()) toast('✓ WL Bulk tool loaded! Uses YouTube UI automation.');
  }, 1500);
})();