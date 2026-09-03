(function() {
  'use strict';

  const LINGQ_DOMAINS = ['lingq.com', 'www.lingq.com', 'app.lingq.com'];
  let isEnabled = false;
  let modalObserver = null;

  function isLingqSite() {
    const hostname = window.location.hostname;
    return LINGQ_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  }

  function hideLingqHighlights() {
    const existingStyle = document.getElementById('lingq-highlight-blocker-styles');
    if (existingStyle) {
      existingStyle.remove();
    }

    const style = document.createElement('style');
    style.id = 'lingq-highlight-blocker-styles';
    style.textContent = `
      .blue-word,
      .lingq-word {
        background-color: transparent !important;
        color: inherit !important;
        text-decoration: none !important;
        box-shadow: none !important;
        border: none !important;
      }
      
      .lingq-word.lingq-status-0,
      .lingq-word.lingq-status-1,
      .lingq-word.lingq-status-2,
      .lingq-word.lingq-status-3,
      .lingq-word.lingq-status-4 {
        background-color: transparent !important;
        color: inherit !important;
      }
      
      body.theme-luminosity-light .light-highlight-style-0 .reader-container .sentence .blue-word,
      body.theme-luminosity-light .light-highlight-style-0 .reader-container .sentence .lingq-word {
        background-color: transparent !important;
      }
    `;
    document.head.appendChild(style);
  }

  function showLingqHighlights() {
    const existingStyle = document.getElementById('lingq-highlight-blocker-styles');
    if (existingStyle) {
      existingStyle.remove();
    }
  }

  function removeModalContainer() {
    if (!isEnabled) return;
    const modalContainer = document.querySelector('.modal-container');
    if (modalContainer) {
      modalContainer.remove();
      console.log('[LingqBlocker] 已删除模态框');
    }
  }

  function startModalObserver() {
    stopModalObserver();
    if (!isEnabled) return;

    removeModalContainer();

    // 性能修复：原来是 setInterval(removeModalContainer, 1000)，
    // 即每秒无条件跑一次 querySelector。改为 MutationObserver，
    // 只在 DOM 真的新增节点时检查。
    modalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          removeModalContainer();
          return;
        }
      }
    });
    modalObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopModalObserver() {
    if (modalObserver) {
      modalObserver.disconnect();
      modalObserver = null;
    }
  }

  function enableLingqBlocker() {
    if (isEnabled) return;
    isEnabled = true;
    console.log('[LingqBlocker] 功能已启用');
    hideLingqHighlights();
    startModalObserver();
  }

  function disableLingqBlocker() {
    if (!isEnabled) return;
    isEnabled = false;
    console.log('[LingqBlocker] 功能已禁用');
    showLingqHighlights();
    stopModalObserver();
  }

  function initLingqBlocker() {
    if (!isLingqSite()) {
      console.log('[LingqBlocker] 当前不是 LingQ 网站，跳过初始化');
      return;
    }

    console.log('[LingqBlocker] 检测到 LingQ 网站，初始化功能');

    chrome.storage.local.get('lingqBlocker', function(result) {
      if (result.lingqBlocker) {
        enableLingqBlocker();
      } else {
        console.log('[LingqBlocker] 功能已禁用（通过设置）');
      }
    });

    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (namespace === 'local' && changes.lingqBlocker) {
        const newValue = changes.lingqBlocker.newValue;
        if (newValue) {
          enableLingqBlocker();
        } else {
          disableLingqBlocker();
        }
      }
    });

    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
      if (request.action === 'toggleLingqBlocker') {
        if (request.enabled) {
          enableLingqBlocker();
        } else {
          disableLingqBlocker();
        }
      }
    });
  }

  window.LingqBlocker = {
    init: initLingqBlocker,
    isLingqSite: isLingqSite,
    enable: enableLingqBlocker,
    disable: disableLingqBlocker
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLingqBlocker);
  } else {
    initLingqBlocker();
  }

})();
