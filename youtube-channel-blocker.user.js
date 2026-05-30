// ==UserScript==
// @name         YouTube Channel Blocker
// @namespace    https://github.com/thousandsofthem/userscripts
// @version      5.4
// @description  Adds a channel block toggle on YouTube watch pages and hides blocked channels sitewide.
// @author       thousandsofthem
// @match        https://www.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-start
// @homepageURL  https://github.com/thousandsofthem/userscripts
// @supportURL   https://github.com/thousandsofthem/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/thousandsofthem/userscripts/master/youtube-channel-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/thousandsofthem/userscripts/master/youtube-channel-blocker.user.js
// ==/UserScript==

(function () {
  'use strict';
  const BTN_NAMEBLOCK = '⊘ Block';
  const BTN_NAMEBLOCKED = '✕ Blocked';
  // ─── Storage ──────────────────────────────────────────────────────────────────

  const STORAGE_KEY = 'yt_blocked_channels';

  function loadBlocklist() {
    try {
      return JSON.parse(GM_getValue(STORAGE_KEY, '[]'))
        .map(s => s.toLowerCase().trim()).filter(Boolean);
    } catch { return []; }
  }

  function saveBlocklist(list) {
    GM_setValue(STORAGE_KEY, JSON.stringify(
      [...new Set(list.map(s => s.toLowerCase().trim()).filter(Boolean))]
    ));
  }

  let blockedChannels = loadBlocklist();

  // ─── DOM helper ───────────────────────────────────────────────────────────────

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'cls') node.className = v;
        else node.setAttribute(k, v);
      }
    }
    for (const child of children) {
      if (child != null)
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  // ─── Filtering — hides blocked cards everywhere ───────────────────────────────

  const CARD_SELECTORS = [
    'ytd-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-renderer',
    'ytd-channel-renderer',
    'ytd-reel-item-renderer',
    'ytd-shorts-lockup-view-model',
  ].join(',');

  const NAME_SELECTORS = [
    'ytd-channel-name yt-formatted-string',
    'ytd-channel-name a',
    '#channel-name yt-formatted-string',
    '#channel-name a',
    '#channel-title yt-formatted-string',
    '#channel-title a',
    '.shortsLockupViewModelMetadataTitle',
  ];

  function getCardChannelName(card) {
    for (const s of NAME_SELECTORS) {
      const n = card.querySelector(s);
      if (n) {
        const t = (n.textContent || n.getAttribute('title') || '').trim();
        if (t) return t.toLowerCase();
      }
    }
    return null;
  }

  function blockEntryMatches(name, blockEntry) {
    const normalizedName = normalizeChannelName(name);
    const normalizedBlockEntry = normalizeChannelName(blockEntry);
    if (!normalizedName || !normalizedBlockEntry) return false;
    return normalizedName.includes(normalizedBlockEntry) || normalizedBlockEntry.includes(normalizedName);
  }

  function shouldBlock(name) {
    const normalizedName = normalizeChannelName(name);
    if (!normalizedName) return false;
    return blockedChannels.some(b => blockEntryMatches(normalizedName, b));
  }

  function applyFilter(card) {
    const name = getCardChannelName(card);
    if (shouldBlock(name)) {
      card.style.setProperty('display', 'none', 'important');
      card.dataset.ytbBlocked = '1';
    } else if (card.dataset.ytbBlocked) {
      card.style.removeProperty('display');
      delete card.dataset.ytbBlocked;
    }
  }

  function runFilter() {
    document.querySelectorAll(CARD_SELECTORS).forEach(applyFilter);
  }

  let filterPending = false;
  function scheduleFilter() {
    if (filterPending) return;
    filterPending = true;
    requestAnimationFrame(() => { filterPending = false; runFilter(); });
  }

  // ─── Block button — injected on /watch pages only ─────────────────────────────

  GM_addStyle(`
    #ytb-block-btn {
      display: inline-flex !important;
      align-items: center !important;
      margin-left: 8px !important;
      padding: 0 16px !important;
      height: 36px !important;
      font-size: 14px !important;
      font-family: 'Roboto', Arial, sans-serif !important;
      font-weight: 500 !important;
      color: #fff !important;
      background: #272727 !important;
      border: none !important;
      border-radius: 18px !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      flex-shrink: 0 !important;
      transition: background .12s !important;
      outline: none !important;
      vertical-align: middle !important;
    }
    #ytb-block-btn:hover  { background: #3f3f3f !important; }
    #ytb-block-btn.ytb-is-blocked {
      color: #aaa !important;
      background: #1a1a1a !important;
      cursor: default !important;
    }
  `);

  let blockBtn = null;
  let watchRefreshInterval = null;
  let blockBtnRefreshPending = false;

  function normalizeChannelName(name) {
    return (name || '').toLowerCase().trim();
  }

  function getWatchChannelName() {
    // Canonical source on watch page
    const selectors = [
      'ytd-video-owner-renderer ytd-channel-name a',
      'ytd-video-owner-renderer #channel-name a',
      'ytd-video-owner-renderer yt-formatted-string a',
      '#upload-info ytd-channel-name a',
    ];
    for (const s of selectors) {
      const n = document.querySelector(s);
      if (n) {
        const t = (n.textContent || '').trim();
        if (t) return t;
      }
    }
    return null;
  }

  function updateBlockBtn() {
    if (!blockBtn) return;
    const name = getWatchChannelName();
    if (!name) return;
    blockBtn.dataset.channel = normalizeChannelName(name);
    if (shouldBlock(name)) {
      blockBtn.textContent = BTN_NAMEBLOCKED;
      blockBtn.classList.add('ytb-is-blocked');
      blockBtn.disabled = false;
    } else {
      blockBtn.textContent = BTN_NAMEBLOCK;
      blockBtn.classList.remove('ytb-is-blocked');
      blockBtn.disabled = false;
    }
  }

  function injectBlockBtn() {
    if (!location.pathname.startsWith('/watch')) return;

    // Find the subscribe button container
    const subscribeContainer = document.querySelector(
      'ytd-watch-metadata #subscribe-button, ' +
      '#top-row ytd-subscribe-button-renderer, ' +
      'ytd-video-owner-renderer + #subscribe-button'
    );
    if (!subscribeContainer) return;

    // Don't inject twice
    const existing = document.getElementById('ytb-block-btn');
    if (existing) {
      blockBtn = existing;
      updateBlockBtn();
      return;
    }

    blockBtn = el('button', { id: 'ytb-block-btn', type: 'button' }, BTN_NAMEBLOCK);
    blockBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      updateBlockBtn();
      const name = normalizeChannelName(blockBtn.dataset.channel || getWatchChannelName());
      if (!name) return;
      if (shouldBlock(name)) {
        blockedChannels = blockedChannels.filter(b => !blockEntryMatches(name, b));
        saveBlocklist(blockedChannels);
        updateBlockBtn();
        runFilter();
        return;
      }
      blockedChannels.push(name);
      saveBlocklist(blockedChannels);
      updateBlockBtn();
      runFilter();
    });

    subscribeContainer.parentNode.insertBefore(blockBtn, subscribeContainer.nextSibling);
    updateBlockBtn();
  }

  function scheduleBlockBtnRefresh() {
    if (blockBtnRefreshPending || !location.pathname.startsWith('/watch')) return;
    blockBtnRefreshPending = true;
    requestAnimationFrame(() => {
      blockBtnRefreshPending = false;
      injectBlockBtn();
    });
  }

  // ─── SPA navigation — YouTube doesn't do full page reloads ───────────────────

  function onNavigate() {
    if (watchRefreshInterval) {
      clearInterval(watchRefreshInterval);
      watchRefreshInterval = null;
    }

    const existing = document.getElementById('ytb-block-btn');
    if (!location.pathname.startsWith('/watch')) {
      // Remove stale button when navigating away from /watch
      if (existing) existing.remove();
      blockBtn = null;
      return;
    }

    // YouTube changes the URL before replacing watch metadata, so keep refreshing
    // through the async swap instead of stopping at the first channel value.
    let attempts = 0;
    injectBlockBtn();
    watchRefreshInterval = setInterval(() => {
      attempts++;
      injectBlockBtn();
      if (attempts > 40) {
        clearInterval(watchRefreshInterval);
        watchRefreshInterval = null;
      }
    }, 250);
  }

  // Intercept pushState/replaceState for SPA nav detection
  function patchHistory() {
    const orig = (type) => {
      const fn = history[type];
      return function (...args) {
        const result = fn.apply(this, args);
        window.dispatchEvent(new Event('ytb-navigate'));
        return result;
      };
    };
    history.pushState = patchHistory['push'] = orig('pushState');
    history.replaceState = patchHistory['replace'] = orig('replaceState');
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    if (!document.body) { setTimeout(init, 50); return; }

    patchHistory();
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('ytb-navigate', onNavigate);
    window.addEventListener('yt-navigate-start', onNavigate);
    window.addEventListener('yt-navigate-finish', onNavigate);
    window.addEventListener('yt-page-data-updated', scheduleBlockBtnRefresh);

    // Filter observer — runs on all pages
    new MutationObserver(mutations => {
      if (mutations.some(m => m.addedNodes.length > 0)) {
        scheduleFilter();
        scheduleBlockBtnRefresh();
      }
    }).observe(document.body, { childList: true, subtree: true });

    // Initial run
    onNavigate();
    setTimeout(runFilter, 800);
    setTimeout(runFilter, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
