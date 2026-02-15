// ==UserScript==
// @name         Watch Later Bulk Add (UI Automation)
// @namespace    juanse-watchlater-bulk
// @version      4.0.0
// @description  Bulk add Watch Later videos to playlists using YouTube's native UI
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

console.log('🔥 [WL Bulk] Script loaded!', new Date().toLocaleTimeString());

(() => {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[WL Bulk]', ...args);
  const error = (...args) => console.error('[WL Bulk ERROR]', ...args);

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

  // ---------- UI Automation ----------
  async function addVideoToPlaylistViaUI(videoRenderer, playlistName) {
    log(`🎬 Adding video via UI automation...`);
    
    try {
      // Scroll to the video to make it visible and track progress
      log('📍 Scrolling to video...');
      videoRenderer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(400); // Wait for scroll to complete
      
      // Add visual highlight
      const originalBorder = videoRenderer.style.border;
      const originalBoxShadow = videoRenderer.style.boxShadow;
      videoRenderer.style.border = '3px solid #3ea6ff';
      videoRenderer.style.boxShadow = '0 0 20px rgba(62, 166, 255, 0.6)';
      videoRenderer.style.transition = 'all 0.3s ease';
      
      // Find the menu button (three dots)
      const menuButton = videoRenderer.querySelector('button[aria-label*="Action menu"], button[aria-label="More actions"], ytd-menu-renderer button');
      
      if (!menuButton) {
        throw new Error('Could not find menu button');
      }

      log('🔘 Found menu button, clicking...');
      menuButton.click();
      await sleep(500); // Wait for menu to appear

      // Find "Add to playlist" or "Save to playlist" option in the menu
      const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item');
      let addToPlaylistItem = null;

      for (const item of menuItems) {
        const text = item.textContent || '';
        if (text.includes('Add to playlist') || 
            text.includes('Save to playlist') || 
            text.includes('Save to') ||
            (text.includes('Save') && text.length < 30)) {
          addToPlaylistItem = item;
          log(`  Found option: "${text.trim()}"`);
          break;
        }
      }

      if (!addToPlaylistItem) {
        // Close menu and throw error
        document.body.click();
        log('❌ Available menu items:');
        menuItems.forEach(item => log(`  - "${item.textContent?.trim()}"`));
        throw new Error('Could not find "Save to playlist" option');
      }

      log('📋 Found "Save to playlist" option, clicking...');
      addToPlaylistItem.click();
      await sleep(1500); // Wait longer for new modal structure

      // Find playlist items using the new YouTube structure
      let playlistItems = document.querySelectorAll('yt-list-item-view-model');
      
      if (playlistItems.length === 0) {
        await sleep(500);
        playlistItems = document.querySelectorAll('yt-list-item-view-model');
      }
      
      if (playlistItems.length === 0) {
        log('❌ Could not find playlist items. Checking for alternative selectors...');
        const alternativeSelectors = [
          'ytd-playlist-add-to-option-renderer',
          '.yt-list-item-view-model',
          'button[aria-pressed]'
        ];
        
        for (const selector of alternativeSelectors) {
          const found = document.querySelectorAll(selector);
          log(`  ${selector}: ${found.length} found`);
        }
        
        throw new Error('Playlist modal did not open or has different structure');
      }

      log(`📂 Found ${playlistItems.length} playlists in modal`);

      // Function to search for playlist in current view
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

      // First, try to find playlist in current view
      let targetPlaylistItem = findPlaylistInView();
      
      // If not found, scroll through the modal to find it
      if (!targetPlaylistItem && playlistItems.length > 0) {
        log(`🔍 Playlist "${playlistName}" not in view, scrolling to find it...`);
        
        // Find the scrollable container
        const scrollableContainer = document.querySelector('tp-yt-paper-dialog-scrollable, ytd-add-to-playlist-renderer, [role="dialog"] [style*="overflow"]');
        
        if (scrollableContainer) {
          const maxScrollAttempts = 10;
          let scrollAttempt = 0;
          
          while (!targetPlaylistItem && scrollAttempt < maxScrollAttempts) {
            scrollAttempt++;
            log(`  Scroll attempt ${scrollAttempt}/${maxScrollAttempts}...`);
            
            // Scroll down
            scrollableContainer.scrollTop += 200;
            await sleep(300); // Wait for items to render
            
            // Check if playlist is now visible
            targetPlaylistItem = findPlaylistInView();
            
            if (targetPlaylistItem) {
              log(`  ✓ Found "${playlistName}" after scrolling!`);
              break;
            }
            
            // Check if we've reached the bottom
            const isAtBottom = scrollableContainer.scrollHeight - scrollableContainer.scrollTop <= scrollableContainer.clientHeight + 10;
            if (isAtBottom) {
              log('  ⚠️ Reached bottom of playlist list');
              break;
            }
          }
        }
      }

      if (!targetPlaylistItem) {
        // Log all available playlists for debugging
        log('❌ Available playlists:');
        const allItems = document.querySelectorAll('yt-list-item-view-model');
        allItems.forEach((item, idx) => {
          const titleElement = item.querySelector('.yt-list-item-view-model__title');
          const itemTitle = titleElement?.textContent?.trim() || '';
          log(`  ${idx + 1}. "${itemTitle}"`);
        });
        
        // Close modal
        const closeButton = document.querySelector('[aria-label="Close"]');
        if (closeButton) closeButton.click();
        throw new Error(`Could not find playlist "${playlistName}" in modal`);
      }

      log(`✓ Found playlist: "${playlistName}"`);

      // Scroll the found playlist item into view within the modal
      targetPlaylistItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await sleep(300);

      // Find the button inside the playlist item
      const playlistButton = targetPlaylistItem.querySelector('button.yt-list-item-view-model__button-or-anchor');
      
      if (!playlistButton) {
        throw new Error('Could not find playlist button');
      }

      // Check if already added (aria-pressed="true")
      const isPressed = playlistButton.getAttribute('aria-pressed') === 'true';
      
      if (isPressed) {
        log('✅ Video already in playlist, skipping...');
      } else {
        log(`✓ Clicking button to add to "${playlistName}"...`);
        playlistButton.click();
        await sleep(500);
      }

      // Close the modal
      const closeButton = document.querySelector('[aria-label="Close"]');
      if (closeButton) {
        log('🚪 Closing modal...');
        closeButton.click();
        await sleep(400);
      }

      // Remove visual highlight
      videoRenderer.style.border = originalBorder;
      videoRenderer.style.boxShadow = originalBoxShadow;

      return true;

    } catch (err) {
      error('❌ UI automation failed:', err.message);
      
      // Remove highlight on error
      try {
        videoRenderer.style.border = '';
        videoRenderer.style.boxShadow = '';
      } catch {}
      
      // Try to close any open menus/modals
      try {
        document.body.click();
      } catch {}
      throw err;
    }
  }

  async function removeVideoFromWatchLaterViaUI(videoRenderer) {
    log(`🗑️ Removing video from Watch Later via UI...`);
    
    try {
      // Scroll to the video to make it visible
      log('📍 Scrolling to video...');
      videoRenderer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(400);
      
      // Add visual highlight (red for removal)
      const originalBorder = videoRenderer.style.border;
      const originalBoxShadow = videoRenderer.style.boxShadow;
      videoRenderer.style.border = '3px solid #ff4444';
      videoRenderer.style.boxShadow = '0 0 20px rgba(255, 68, 68, 0.6)';
      videoRenderer.style.transition = 'all 0.3s ease';
      
      // Find the menu button
      const menuButton = videoRenderer.querySelector('button[aria-label*="Action menu"], button[aria-label="More actions"], ytd-menu-renderer button');
      
      if (!menuButton) {
        throw new Error('Could not find menu button');
      }

      log('🔘 Found menu button, clicking...');
      menuButton.click();
      await sleep(500);

      // Find "Remove from Watch Later" option
      const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item');
      let removeItem = null;

      for (const item of menuItems) {
        const text = item.textContent || '';
        if ((text.includes('Remove from') && text.includes('Watch later')) ||
            (text.includes('Remove') && text.includes('Watch later'))) {
          removeItem = item;
          log(`  Found remove option: "${text.trim()}"`);
          break;
        }
      }

      if (!removeItem) {
        document.body.click();
        log('❌ Available menu items:');
        menuItems.forEach(item => log(`  - "${item.textContent?.trim()}"`));
        throw new Error('Could not find "Remove from Watch later" option');
      }

      log('🗑️ Found "Remove" option, clicking...');
      removeItem.click();
      await sleep(600);

      // Remove visual highlight
      videoRenderer.style.border = originalBorder;
      videoRenderer.style.boxShadow = originalBoxShadow;

      return true;

    } catch (err) {
      error('❌ Remove automation failed:', err.message);
      
      // Remove highlight on error
      try {
        videoRenderer.style.border = '';
        videoRenderer.style.boxShadow = '';
      } catch {}
      
      try {
        document.body.click();
      } catch {}
      throw err;
    }
  }

  // ---------- Storage ----------
  const STORE_KEY = 'wlBulkPlaylists.v2';

  function loadPlaylists() {
    try {
      const data = localStorage.getItem(STORE_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  function savePlaylists(obj) {
    localStorage.setItem(STORE_KEY, JSON.stringify(obj));
    log('💾 Saved playlists:', Object.keys(obj));
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
        if (match) {
          return match[1];
        }
      }
    }

    return null;
  }

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

  function updateSelectedCount() {
    const count = getSelectedVideoIds().length;
    const el = document.getElementById('wlBulkCount');
    if (el) {
      el.textContent = String(count);
      el.style.color = count > 0 ? '#3ea6ff' : '#aaa';
    }
  }

  // ---------- Control Panel ----------
  function buildPanel() {
    if (document.getElementById('wlBulkPanel')) return;
    if (!isWatchLaterPage()) return;

    log('🎨 Building control panel...');

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

    // Header
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

    // Buttons row
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;margin-bottom:12px;';

    const selectBtn = createButton('✓ Select All');
    const clearBtn = createButton('✗ Clear');
    selectBtn.style.flex = '1';
    clearBtn.style.flex = '1';

    btnRow.appendChild(selectBtn);
    btnRow.appendChild(clearBtn);
    panel.appendChild(btnRow);

    // Playlist row
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
    playlistInput.onfocus = () => playlistInput.style.borderColor = 'rgba(62,166,255,0.6)';
    playlistInput.onblur = () => playlistInput.style.borderColor = 'rgba(255,255,255,0.2)';

    const addBtn = createButton('➜ Add to Playlist', true);
    addBtn.id = 'wlBulkAddBtn';

    plRow.appendChild(playlistInput);
    plRow.appendChild(addBtn);
    panel.appendChild(plRow);

    // Helper text
    const helperText = document.createElement('div');
    helperText.style.cssText = 'font-size:12px;opacity:0.7;margin-bottom:10px;line-height:1.5;';
    helperText.textContent = 'Type the EXACT name of your playlist as it appears in YouTube';
    panel.appendChild(helperText);

    // Checkbox: Also remove from WL
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

    // Standalone remove button
    const removeRow = document.createElement('div');
    removeRow.style.cssText = 'display:flex;gap:10px;margin-bottom:14px;';
    
    const removeOnlyBtn = createButton('🗑️ Only Remove from Watch Later', false);
    removeOnlyBtn.id = 'wlBulkRemoveOnlyBtn';
    removeOnlyBtn.style.flex = '1';
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
    
    removeRow.appendChild(removeOnlyBtn);
    panel.appendChild(removeRow);

    // Log area
    const logBox = document.createElement('div');
    logBox.id = 'wlBulkLog';
    logBox.style.cssText = 'margin-top:14px;max-height:100px;overflow-y:auto;font-size:12px;opacity:0.8;line-height:1.6;border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;';
    panel.appendChild(logBox);

    document.body.appendChild(panel);

    // Event handlers
    function logMessage(msg, isErr = false) {
      const line = document.createElement('div');
      line.style.color = isErr ? '#ff8080' : '#aaa';
      line.textContent = `${new Date().toLocaleTimeString()}: ${msg}`;
      logBox.prepend(line);
      while (logBox.children.length > 8) logBox.removeChild(logBox.lastChild);
    }

    document.addEventListener('change', (e) => {
      if (e.target?.classList?.contains('wlBulkCb')) {
        updateSelectedCount();
      }
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

    addBtn.onclick = async () => {
      log('🔘 Add button clicked!');
      
      const playlistName = playlistInput.value.trim();
      
      if (!playlistName) {
        toast('Enter a playlist name first', true);
        logMessage('No playlist name entered', true);
        return;
      }

      const renderers = getSelectedRenderers();
      
      if (renderers.length === 0) {
        toast('No videos selected', true);
        logMessage('No videos selected', true);
        return;
      }

      const alsoRemove = document.getElementById('wlBulkRemoveCheck').checked;

      log(`🚀 Starting UI automation: ${renderers.length} videos → "${playlistName}", remove: ${alsoRemove}`);

      const actionText = alsoRemove ? 'Adding & removing' : 'Adding';
      toast(`${actionText} ${renderers.length} videos via UI automation...`);
      logMessage(`Starting: ${renderers.length} videos → "${playlistName}"${alsoRemove ? ' (+ remove from WL)' : ''}`);

      addBtn.disabled = true;
      addBtn.style.opacity = '0.5';

      let successCount = 0;
      let failCount = 0;

      try {
        // Step 1: Add to playlist
        log('📤 Step 1: Adding to playlist via UI...');
        for (let i = 0; i < renderers.length; i++) {
          const renderer = renderers[i];
          log(`Processing video ${i + 1}/${renderers.length}`);
          
          try {
            await addVideoToPlaylistViaUI(renderer, playlistName);
            successCount++;
            logMessage(`Added: ${i + 1}/${renderers.length}`);
          } catch (err) {
            failCount++;
            error(`Failed to add video ${i + 1}:`, err.message);
            logMessage(`⚠️ Failed: ${i + 1}/${renderers.length} - ${err.message}`, true);
          }
          
          await sleep(1000); // Wait between videos to avoid rate limits
        }
        
        log('✅ Add phase complete');

        // Step 2: Remove from Watch Later if checkbox is checked
        if (alsoRemove && successCount > 0) {
          log('🗑️ Step 2: Removing from Watch Later...');
          logMessage('Now removing from Watch Later...');
          
          for (let i = 0; i < renderers.length; i++) {
            const renderer = renderers[i];
            log(`Removing video ${i + 1}/${renderers.length}`);
            
            try {
              await removeVideoFromWatchLaterViaUI(renderer);
              logMessage(`Removed: ${i + 1}/${renderers.length}`);
            } catch (err) {
              error(`Failed to remove video ${i + 1}:`, err.message);
              logMessage(`⚠️ Remove failed: ${i + 1}/${renderers.length}`, true);
            }
            
            await sleep(800);
          }
          
          log('✅ Remove phase complete');
        }

        const finalMsg = failCount > 0
          ? `✓ Processed ${renderers.length} videos (${successCount} succeeded, ${failCount} failed)`
          : alsoRemove
            ? `✓ Added & removed ${successCount} videos!`
            : `✓ Added ${successCount} videos! Selection kept.`;
        
        toast(finalMsg);
        logMessage(`✓ Complete: ${successCount} succeeded, ${failCount} failed`);
        
        log('🎉 Operation complete!');

        // If removed from WL, refresh after a moment
        if (alsoRemove && successCount > 0) {
          setTimeout(() => {
            const cbs = document.querySelectorAll('.wlBulkCb:checked');
            cbs.forEach(cb => cb.checked = false);
            updateSelectedCount();
            logMessage('Page will refresh in 2 seconds...');
            setTimeout(() => window.location.reload(), 2000);
          }, 1000);
        }

      } catch (err) {
        error('Bulk operation failed:', err);
        toast(`✗ Error: ${err.message}`, true);
        logMessage(`✗ Error: ${err.message}`, true);
      } finally {
        addBtn.disabled = false;
        addBtn.style.opacity = '1';
        log('🏁 Add button re-enabled');
      }
    };

    removeOnlyBtn.onclick = async () => {
      const renderers = getSelectedRenderers();
      
      if (renderers.length === 0) {
        toast('No videos selected', true);
        logMessage('No videos selected', true);
        return;
      }

      const confirmMsg = `Remove ${renderers.length} video(s) from Watch Later?`;
      if (!confirm(confirmMsg)) {
        logMessage('Remove cancelled by user');
        return;
      }

      toast(`Removing ${renderers.length} videos from Watch Later...`);
      logMessage(`Starting removal: ${renderers.length} videos`);

      removeOnlyBtn.disabled = true;
      removeOnlyBtn.style.opacity = '0.5';

      let successCount = 0;

      try {
        for (let i = 0; i < renderers.length; i++) {
          const renderer = renderers[i];
          log(`Removing video ${i + 1}/${renderers.length}`);
          
          try {
            await removeVideoFromWatchLaterViaUI(renderer);
            successCount++;
            logMessage(`Removed: ${i + 1}/${renderers.length}`);
          } catch (err) {
            error(`Failed to remove video ${i + 1}:`, err.message);
            logMessage(`⚠️ Failed: ${i + 1}/${renderers.length}`, true);
          }
          
          await sleep(800);
        }

        toast(`✓ Removed ${successCount}/${renderers.length} videos!`);
        logMessage(`✓ Success: ${successCount} videos removed`);

        // Refresh page
        setTimeout(() => {
          const cbs = document.querySelectorAll('.wlBulkCb:checked');
          cbs.forEach(cb => cb.checked = false);
          updateSelectedCount();
          logMessage('Page will refresh in 2 seconds...');
          setTimeout(() => window.location.reload(), 2000);
        }, 1000);

      } catch (err) {
        error('Remove failed:', err);
        toast(`✗ Error: ${err.message}`, true);
        logMessage(`✗ Error: ${err.message}`, true);
      } finally {
        removeOnlyBtn.disabled = false;
        removeOnlyBtn.style.opacity = '1';
      }
    };

    log('✅ Panel built successfully');
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
    if (!isWatchLaterPage()) {
      log('❌ Not on Watch Later page, skipping...');
      return;
    }

    if (panelInitialized) {
      log('⚠️ Panel already initialized, skipping...');
      injectCheckboxes();
      return;
    }

    log('✅ Watch Later detected! Initializing...');
    buildPanel();
    injectCheckboxes();
    panelInitialized = true;
    log('✅ Panel initialized successfully');
  }

  // ---------- Boot ----------
  log('🚀 Starting Watch Later Bulk tool...');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      log('📄 DOM Content Loaded');
      setTimeout(initialize, 1000);
    });
  } else {
    setTimeout(initialize, 1000);
  }

  // Watch for SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      log('🔄 URL changed:', currentUrl);
      const wasWatchLater = lastUrl.includes('list=WL');
      const isNowWatchLater = currentUrl.includes('list=WL');
      
      lastUrl = currentUrl;
      
      if (wasWatchLater && !isNowWatchLater) {
        log('📤 Navigated away from Watch Later, cleaning up...');
        const panel = document.getElementById('wlBulkPanel');
        if (panel) panel.remove();
        panelInitialized = false;
      }
      
      if (isNowWatchLater) {
        setTimeout(initialize, 500);
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true });

  // Periodic checkbox injection
  setInterval(() => {
    if (isWatchLaterPage()) {
      injectCheckboxes();
    }
  }, 2000);

  // Initial toast
  setTimeout(() => {
    if (isWatchLaterPage()) {
      toast('✓ WL Bulk tool loaded! Uses YouTube UI automation.');
    }
  }, 1500);

  log('✅ Script initialization complete');
})();