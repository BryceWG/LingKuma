(function() {
  if (window.self !== window.top) {
    return;
  }

  const FLOATING_BUTTON_ENABLED_KEY = 'wordHighlightFloatingButtonEnabled';
  const HIGHLIGHT_ENABLED_KEY = 'enablePlugin';
  const HIGHLIGHT_SCOPE_KEY = 'wordHighlightFloatingButtonScope';
  const PAGE_TAB_OVERRIDES_KEY = 'wordHighlightPageTabOverrides';
  const PAGE_THEME_OVERRIDES_KEY = 'highlightPageThemeOverrides';
  const POSITION_KEY = 'wordHighlightFloatingButtonPosition';
  const ROOT_ID = 'lingkuma-word-highlight-floating-root';
  const EDGE_THRESHOLD = 35;
  const BUTTON_WIDTH = 86;
  const BUTTON_HEIGHT = 34;
  const THEME_BUTTON_HEIGHT = 34;
  const BUTTON_STACK_GAP = 8;
  const BUTTON_STACK_HEIGHT = BUTTON_HEIGHT + BUTTON_STACK_GAP + THEME_BUTTON_HEIGHT;
  const BUTTON_FRAME_HEIGHT = Math.max(BUTTON_STACK_HEIGHT, BUTTON_WIDTH);
  const DOCK_VISIBLE_SIZE = 28;
  const SIDE_DOCK_OFFSET = BUTTON_WIDTH - DOCK_VISIBLE_SIZE;

  let rootHost = null;
  let shadowRoot = null;
  let buttonStack = null;
  let highlightSlot = null;
  let themeSlot = null;
  let buttonWrap = null;
  let themeButtonWrap = null;
  let currentHighlightEnabled = true;
  let currentPageThemeIsDark = false;
  let currentPosition = null;
  let pointerState = null;
  const SUPPORTED_DOCKS = ['left', 'right', 'top', 'bottom', 'none'];

  function clampNumber(value, min, max, fallback = min) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(Math.max(number, min), max);
  }

  function getPositionBounds() {
    return {
      maxX: Math.max(0, window.innerWidth - BUTTON_WIDTH),
      maxY: Math.max(0, window.innerHeight - BUTTON_FRAME_HEIGHT)
    };
  }

  function coordinateToRatio(coordinate, max) {
    if (max <= 0) {
      return 0;
    }
    return clampNumber(coordinate / max, 0, 1, 0);
  }

  function ratioToCoordinate(ratio, max, fallback = 0) {
    return Math.round(clampNumber(ratio, 0, 1, coordinateToRatio(fallback, max)) * max);
  }

  function normalizeDock(dock) {
    return SUPPORTED_DOCKS.includes(dock) ? dock : 'none';
  }

  function getDefaultPosition() {
    const { maxX, maxY } = getPositionBounds();
    const x = Math.min(18, maxX);
    const y = Math.min(Math.max(80, Math.round(maxY * 0.45)), maxY);

    return {
      x,
      y,
      xRatio: coordinateToRatio(x, maxX),
      yRatio: coordinateToRatio(y, maxY),
      dock: 'none'
    };
  }

  function normalizePosition(position) {
    const source = position && typeof position === 'object' ? position : {};
    const fallback = getDefaultPosition();
    const { maxX, maxY } = getPositionBounds();
    const hasXRatio = Number.isFinite(Number(source.xRatio));
    const hasYRatio = Number.isFinite(Number(source.yRatio));
    const dock = normalizeDock(source.dock);
    let x = hasXRatio
      ? ratioToCoordinate(source.xRatio, maxX, fallback.x)
      : Math.round(clampNumber(source.x, 0, maxX, fallback.x));
    let y = hasYRatio
      ? ratioToCoordinate(source.yRatio, maxY, fallback.y)
      : Math.round(clampNumber(source.y, 0, maxY, fallback.y));

    let xRatio = hasXRatio
      ? clampNumber(source.xRatio, 0, 1, coordinateToRatio(x, maxX))
      : coordinateToRatio(x, maxX);
    let yRatio = hasYRatio
      ? clampNumber(source.yRatio, 0, 1, coordinateToRatio(y, maxY))
      : coordinateToRatio(y, maxY);

    if (dock === 'left') {
      x = 0;
      xRatio = 0;
    } else if (dock === 'right') {
      x = maxX;
      xRatio = 1;
    } else if (dock === 'top') {
      y = 0;
      yRatio = 0;
    } else if (dock === 'bottom') {
      y = maxY;
      yRatio = 1;
    }

    return {
      x,
      y,
      xRatio,
      yRatio,
      dock
    };
  }

  function getSharedPosition(savedPosition) {
    if (savedPosition?.position) {
      return normalizePosition(savedPosition.position);
    }
    if (savedPosition && typeof savedPosition === 'object') {
      return normalizePosition(savedPosition);
    }
    return getDefaultPosition();
  }

  function savePosition() {
    if (!currentPosition) {
      return;
    }

    const normalizedPosition = normalizePosition(currentPosition);
    chrome.storage.local.set({
      [POSITION_KEY]: {
        xRatio: normalizedPosition.xRatio,
        yRatio: normalizedPosition.yRatio,
        dock: normalizedPosition.dock
      }
    });
  }

  function applyPosition(position) {
    if (!buttonStack) {
      return;
    }

    currentPosition = normalizePosition(position);
    buttonStack.style.left = `${currentPosition.x}px`;
    buttonStack.style.top = `${currentPosition.y}px`;
    buttonStack.dataset.dock = currentPosition.dock;
  }

  function snapToEdge(position) {
    const { maxX, maxY } = getPositionBounds();
    const nextPosition = normalizePosition(position);
    const distances = [
      { edge: 'left', value: nextPosition.x },
      { edge: 'right', value: maxX - nextPosition.x },
      { edge: 'top', value: nextPosition.y },
      { edge: 'bottom', value: maxY - nextPosition.y }
    ].sort((a, b) => a.value - b.value);

    const closest = distances[0];

    if (closest.value > EDGE_THRESHOLD) {
      nextPosition.dock = 'none';
      return normalizePosition(nextPosition);
    }

    nextPosition.dock = closest.edge;
    if (closest.edge === 'left') {
      nextPosition.x = 0;
    } else if (closest.edge === 'right') {
      nextPosition.x = maxX;
    } else if (closest.edge === 'top') {
      nextPosition.y = 0;
    } else if (closest.edge === 'bottom') {
      nextPosition.y = maxY;
    }

    return normalizePosition(nextPosition);
  }

  function updateHighlightState(enabled) {
    currentHighlightEnabled = enabled !== false;
    if (buttonWrap) {
      buttonWrap.dataset.highlight = currentHighlightEnabled ? 'on' : 'off';
      buttonWrap.setAttribute(
        'aria-label',
        currentHighlightEnabled ? 'Word highlight is on. Click to turn off.' : 'Word highlight is off. Click to turn on.'
      );
      buttonWrap.setAttribute(
        'title',
        currentHighlightEnabled ? 'Word highlight: On' : 'Word highlight: Off'
      );
    }
  }

  function broadcastHighlightState(enabled) {
    chrome.runtime.sendMessage({
      action: 'broadcastToggleHighlight',
      enabled
    }, () => {
      if (chrome.runtime.lastError) {
        console.debug('[LingKuma] broadcastToggleHighlight failed:', chrome.runtime.lastError.message);
      }
    });
  }

  function getPageThemeKey() {
    try {
      return window.location.hostname.toLowerCase();
    } catch (error) {
      return window.location.host.toLowerCase();
    }
  }

  function getCurrentHighlightTheme(fallback = false) {
    try {
      if (typeof highlightManager !== 'undefined' && highlightManager && typeof highlightManager.isDarkMode === 'boolean') {
        return highlightManager.isDarkMode;
      }
    } catch (error) {
      // The highlighter may not be initialized yet.
    }
    return fallback;
  }

  function updatePageThemeState(isDark) {
    currentPageThemeIsDark = isDark === true;
    if (!themeButtonWrap) {
      return;
    }

    themeButtonWrap.dataset.theme = currentPageThemeIsDark ? 'dark' : 'light';
    themeButtonWrap.setAttribute(
      'aria-label',
      currentPageThemeIsDark ? 'Current page highlight theme is dark. Click to use light.' : 'Current page highlight theme is light. Click to use dark.'
    );
    themeButtonWrap.setAttribute(
      'title',
      currentPageThemeIsDark ? 'Current page highlight: Dark' : 'Current page highlight: Light'
    );
  }

  function normalizePageThemeOverride(value) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value && typeof value.isDark === 'boolean') {
      return value.isDark;
    }
    return null;
  }

  function applyCurrentPageTheme(isDark) {
    updatePageThemeState(isDark);

    try {
      if (typeof highlightManager !== 'undefined' && highlightManager) {
        highlightManager.setDarkMode(isDark);
        highlightManager.reapplyHighlights();
      }
    } catch (error) {
      console.debug('[LingKuma] apply current page highlight theme failed:', error);
    }
  }

  function saveCurrentPageTheme(isDark) {
    chrome.storage.local.get({ [PAGE_THEME_OVERRIDES_KEY]: {} }, (result) => {
      const overrides = result[PAGE_THEME_OVERRIDES_KEY] || {};
      const pageKey = getPageThemeKey();
      const nextOverrides = {};

      Object.entries(overrides).forEach(([key, value]) => {
        const normalized = normalizePageThemeOverride(value);
        if (normalized !== null) {
          nextOverrides[key] = normalized;
        }
      });

      nextOverrides[pageKey] = isDark === true;

      chrome.storage.local.set({
        [PAGE_THEME_OVERRIDES_KEY]: nextOverrides
      });
    });
  }

  function toggleCurrentPageTheme(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const nextIsDark = !currentPageThemeIsDark;
    applyCurrentPageTheme(nextIsDark);
    saveCurrentPageTheme(nextIsDark);

    if (event?.type === 'click' && event.detail > 0) {
      themeButtonWrap.blur();
    }
  }

  function refreshHighlightControlState() {
    chrome.runtime.sendMessage({ action: 'getWordHighlightControlState' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        chrome.storage.local.get({ [HIGHLIGHT_ENABLED_KEY]: false }, (result) => {
          updateHighlightState(result[HIGHLIGHT_ENABLED_KEY] === true);
        });
        return;
      }

      updateHighlightState(response.enabled !== false);
    });
  }

  function requestHighlightRuntimeSync() {
    chrome.runtime.sendMessage({ action: 'ensureWordHighlightRuntime' }, (response) => {
      if (chrome.runtime.lastError || response?.success === false) {
        console.debug('[LingKuma] ensure highlight runtime skipped:', chrome.runtime.lastError?.message || response?.error);
        return;
      }

      if (typeof response.enabled === 'boolean') {
        updateHighlightState(response.enabled !== false);
      }
    });
  }
  function toggleHighlight() {
    const enabled = !currentHighlightEnabled;
    updateHighlightState(enabled);

    chrome.runtime.sendMessage({
      action: 'toggleWordHighlightFromFloatingButton',
      enabled
    }, (response) => {
      if (chrome.runtime.lastError || response?.success === false) {
        console.debug('[LingKuma] floating highlight toggle failed:', chrome.runtime.lastError?.message || response?.error);
        refreshHighlightControlState();
        return;
      }

      updateHighlightState(response.enabled !== false);
    });
  }

  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      .lk-floating-stack {
        position: fixed;
        width: ${BUTTON_WIDTH}px;
        height: ${BUTTON_STACK_HEIGHT}px;
        z-index: 2147483647;
      }

      .lk-floating-stack[data-dock="top"],
      .lk-floating-stack[data-dock="bottom"] {
        width: ${BUTTON_STACK_HEIGHT}px;
        height: ${BUTTON_WIDTH}px;
      }

      .lk-floating-slot {
        position: absolute;
        top: 0;
        left: 0;
        width: ${BUTTON_WIDTH}px;
        height: ${BUTTON_HEIGHT}px;
      }

      .lk-floating-slot--theme {
        top: ${BUTTON_HEIGHT + BUTTON_STACK_GAP}px;
      }

      .lk-floating-stack[data-dock="left"] .lk-floating-slot {
        transform: translate(-${SIDE_DOCK_OFFSET}px, 0);
      }

      .lk-floating-stack[data-dock="right"] .lk-floating-slot {
        transform: translate(${SIDE_DOCK_OFFSET}px, 0);
      }

      .lk-floating-stack[data-dock="top"] .lk-floating-slot,
      .lk-floating-stack[data-dock="bottom"] .lk-floating-slot {
        width: ${BUTTON_HEIGHT}px;
        height: ${BUTTON_WIDTH}px;
      }

      .lk-floating-stack[data-dock="top"] .lk-floating-slot {
        top: 0;
        transform: translate(0, -${SIDE_DOCK_OFFSET}px);
      }

      .lk-floating-stack[data-dock="bottom"] .lk-floating-slot {
        top: 0;
        transform: translate(0, ${SIDE_DOCK_OFFSET}px);
      }

      .lk-floating-stack[data-dock="top"] .lk-floating-slot--theme,
      .lk-floating-stack[data-dock="bottom"] .lk-floating-slot--theme {
        left: ${BUTTON_HEIGHT + BUTTON_STACK_GAP}px;
      }

      .lk-floating-stack[data-dock="left"] .lk-floating-slot:hover,
      .lk-floating-stack[data-dock="left"] .lk-floating-slot:focus-within,
      .lk-floating-stack[data-dock="right"] .lk-floating-slot:hover,
      .lk-floating-stack[data-dock="right"] .lk-floating-slot:focus-within,
      .lk-floating-stack[data-dock="top"] .lk-floating-slot:hover,
      .lk-floating-stack[data-dock="top"] .lk-floating-slot:focus-within,
      .lk-floating-stack[data-dock="bottom"] .lk-floating-slot:hover,
      .lk-floating-stack[data-dock="bottom"] .lk-floating-slot:focus-within,
      .lk-floating-stack[data-dragging="true"] .lk-floating-slot {
        transform: translate(0, 0);
      }

      .lk-floating-highlight {
        position: absolute;
        top: 0;
        left: 0;
        width: ${BUTTON_WIDTH}px;
        height: ${BUTTON_HEIGHT}px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.25em;
        border: 0;
        border-radius: 2rem;
        padding: 0.9em 1.3em;
        color: #fff;
        background: rgba(60, 60, 60, 0.55);
        cursor: grab;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        opacity: 0.5;
        transition: opacity 0.15s ease;
        user-select: none;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }

      .lk-floating-stack[data-dock="top"] .lk-floating-highlight,
      .lk-floating-stack[data-dock="top"] .lk-current-page-theme {
        top: ${Math.round((BUTTON_WIDTH - BUTTON_HEIGHT) / 2)}px;
        left: -${Math.round((BUTTON_WIDTH - BUTTON_HEIGHT) / 2)}px;
        transform: rotate(-90deg);
      }

      .lk-floating-stack[data-dock="bottom"] .lk-floating-highlight,
      .lk-floating-stack[data-dock="bottom"] .lk-current-page-theme {
        top: ${Math.round((BUTTON_WIDTH - BUTTON_HEIGHT) / 2)}px;
        left: -${Math.round((BUTTON_WIDTH - BUTTON_HEIGHT) / 2)}px;
        transform: rotate(90deg);
      }

      .lk-floating-stack[data-dragging="true"] .lk-floating-highlight,
      .lk-floating-stack[data-dragging="true"] .lk-current-page-theme {
        top: 0;
        left: 0;
        transform: none;
      }

      .lk-floating-highlight:hover:not([data-collapse-after-click="true"]),
      .lk-floating-highlight:focus-visible,
      .lk-floating-highlight[data-dragging="true"] {
        opacity: 1;
      }

      .lk-floating-highlight:focus-visible {
        outline: 2px solid #3898ec;
        outline-offset: 3px;
      }

      .lk-floating-highlight:active {
        cursor: grabbing;
      }

      .text {
        position: relative;
        z-index: 1;
        color: #fff;
        pointer-events: none;
      }

      .lk-current-page-theme {
        position: absolute;
        top: 0;
        left: 0;
        width: ${BUTTON_WIDTH}px;
        height: ${THEME_BUTTON_HEIGHT}px;
        border: 0;
        border-radius: 999px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(60, 60, 60, 0.55);
        cursor: pointer;
        opacity: 0.5;
        overflow: hidden;
        transition: opacity 0.15s ease;
        user-select: none;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      .lk-current-page-theme:hover,
      .lk-current-page-theme:focus-visible {
        opacity: 1;
      }

      .lk-current-page-theme:focus-visible {
        outline: 2px solid #3898ec;
        outline-offset: 3px;
      }

      .lk-current-page-theme::after {
        content: "";
        position: absolute;
        width: 28px;
        height: 28px;
        top: 3px;
        left: 4px;
        border-radius: 999px;
        background: linear-gradient(180deg, #ffcc89, #d8860b);
      }

      .lk-current-page-theme svg {
        position: relative;
        z-index: 1;
        width: 18px;
        height: 18px;
        flex: 0 0 18px;
      }

      .lk-current-page-theme .theme-sun {
        margin-left: 9px;
        fill: #fff;
      }

      .lk-current-page-theme .theme-moon {
        margin-right: 9px;
        fill: #7e7e7e;
      }

      .lk-current-page-theme[data-theme="dark"] {
        background: rgba(20, 20, 20, 0.55);
      }

      .lk-current-page-theme[data-theme="dark"]::after {
        left: calc(100% - 4px);
        transform: translateX(-100%);
        background: linear-gradient(180deg, #777, #3a3a3a);
      }

      .lk-current-page-theme[data-theme="dark"] .theme-sun {
        fill: #7e7e7e;
      }

      .lk-current-page-theme[data-theme="dark"] .theme-moon {
        fill: #fff;
      }
    `;
    return style;
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    const baseX = currentPosition?.x ?? buttonStack.getBoundingClientRect().left;
    const baseY = currentPosition?.y ?? buttonStack.getBoundingClientRect().top;
    pointerState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - baseX,
      offsetY: event.clientY - baseY,
      dock: currentPosition?.dock || buttonStack.dataset.dock || 'none',
      moved: false
    };

    if (shadowRoot?.activeElement && shadowRoot.activeElement !== buttonWrap) {
      shadowRoot.activeElement.blur();
    }
    delete buttonWrap.dataset.collapseAfterClick;
    buttonWrap.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = Math.abs(event.clientX - pointerState.startX);
    const deltaY = Math.abs(event.clientY - pointerState.startY);
    if (!pointerState.moved && (deltaX > 3 || deltaY > 3)) {
      pointerState.moved = true;
      buttonStack.dataset.dragging = 'true';
      buttonStack.dataset.dock = 'none';
      buttonWrap.dataset.dragging = 'true';
      delete buttonWrap.dataset.collapseAfterClick;
    }

    if (!pointerState.moved) {
      event.preventDefault();
      return;
    }

    const { maxX, maxY } = getPositionBounds();
    const x = Math.round(clampNumber(event.clientX - pointerState.offsetX, 0, maxX));
    const y = Math.round(clampNumber(event.clientY - pointerState.offsetY, 0, maxY));

    currentPosition = normalizePosition({ x, y, dock: 'none' });
    buttonStack.style.left = `${currentPosition.x}px`;
    buttonStack.style.top = `${currentPosition.y}px`;
    buttonStack.dataset.dock = 'none';
    event.preventDefault();
  }

  function handlePointerUp(event) {
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    const wasMoved = pointerState.moved;
    const previousDock = pointerState.dock;
    pointerState = null;
    delete buttonStack.dataset.dragging;
    delete buttonWrap.dataset.dragging;

    try {
      buttonWrap.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture may already be released by the browser.
    }

    if (wasMoved) {
      applyPosition(snapToEdge(currentPosition));
      savePosition();
    } else {
      const dock = currentPosition?.dock || previousDock || 'none';
      buttonStack.dataset.dock = dock;
      if (dock === 'none') {
        delete buttonWrap.dataset.collapseAfterClick;
      } else {
        buttonWrap.dataset.collapseAfterClick = 'true';
      }
      toggleHighlight();
    }

    event.preventDefault();
  }

  function handlePointerLeave() {
    if (buttonWrap) {
      delete buttonWrap.dataset.collapseAfterClick;
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleHighlight();
    }
  }

  function createButton(savedPosition, pageThemeOverride = null) {
    if (document.getElementById(ROOT_ID)) {
      return;
    }

    rootHost = document.createElement('div');
    rootHost.id = ROOT_ID;
    shadowRoot = rootHost.attachShadow({ mode: 'open' });

    buttonStack = document.createElement('div');
    buttonStack.className = 'lk-floating-stack';

    highlightSlot = document.createElement('div');
    highlightSlot.className = 'lk-floating-slot lk-floating-slot--highlight';

    buttonWrap = document.createElement('button');
    buttonWrap.className = 'lk-floating-highlight';
    buttonWrap.type = 'button';
    buttonWrap.innerHTML = '<span class="text">Kuma</span>';

    themeSlot = document.createElement('div');
    themeSlot.className = 'lk-floating-slot lk-floating-slot--theme';

    themeButtonWrap = document.createElement('button');
    themeButtonWrap.className = 'lk-current-page-theme';
    themeButtonWrap.type = 'button';
    themeButtonWrap.innerHTML = `
      <svg class="theme-sun" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 18.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Zm0-15.5a1 1 0 0 1-1-1V1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm0 21a1 1 0 0 1-1-1v-1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm11-11h-1a1 1 0 1 1 0-2h1a1 1 0 1 1 0 2ZM3 13H1a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2Zm15.78-6.36a1 1 0 0 1-.7-1.71l.7-.71a1 1 0 1 1 1.42 1.42l-.71.7a1 1 0 0 1-.71.3ZM4.93 20.07a1 1 0 0 1-.71-1.7l.71-.71a1 1 0 0 1 1.41 1.41l-.7.71a1 1 0 0 1-.71.29Zm14.56 0a1 1 0 0 1-.71-.29l-.7-.71a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1-.71 1.71ZM5.64 6.34a1 1 0 0 1-.71-.3l-.71-.7a1 1 0 0 1 1.42-1.42l.7.71a1 1 0 0 1-.7 1.71Z"/>
      </svg>
      <svg class="theme-moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.3 14.05a1 1 0 0 0-1.08-.25 7.8 7.8 0 0 1-3.2.68 7.95 7.95 0 0 1-7.95-7.95c0-1.1.22-2.18.66-3.2a1 1 0 0 0-1.33-1.3A10.5 10.5 0 1 0 22 15.13a1 1 0 0 0-.7-1.08Z"/>
      </svg>
    `;

    highlightSlot.append(buttonWrap);
    themeSlot.append(themeButtonWrap);
    buttonStack.append(highlightSlot, themeSlot);
    shadowRoot.append(createStyles(), buttonStack);

    const mountRoot = document.documentElement || document.body;
    if (!mountRoot) {
      document.addEventListener('DOMContentLoaded', () => createButton(savedPosition, pageThemeOverride), { once: true });
      return;
    }
    mountRoot.appendChild(rootHost);

    buttonWrap.addEventListener('pointerdown', handlePointerDown);
    buttonWrap.addEventListener('pointermove', handlePointerMove);
    buttonWrap.addEventListener('pointerup', handlePointerUp);
    buttonWrap.addEventListener('pointercancel', handlePointerUp);
    buttonWrap.addEventListener('pointerleave', handlePointerLeave);
    buttonWrap.addEventListener('keydown', handleKeyDown);
    themeButtonWrap.addEventListener('click', toggleCurrentPageTheme);
    themeButtonWrap.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        toggleCurrentPageTheme(event);
      }
    });

    applyPosition(getSharedPosition(savedPosition));
    updateHighlightState(currentHighlightEnabled);
    const pageThemeIsDark = normalizePageThemeOverride(pageThemeOverride);
    updatePageThemeState(
      pageThemeIsDark !== null
        ? pageThemeIsDark
        : getCurrentHighlightTheme(currentPageThemeIsDark)
    );

    setTimeout(() => {
      if (!themeButtonWrap || pageThemeOverride) {
        return;
      }
      updatePageThemeState(getCurrentHighlightTheme(currentPageThemeIsDark));
    }, 800);
  }

  function destroyButton() {
    if (rootHost) {
      rootHost.remove();
    }
    rootHost = null;
    shadowRoot = null;
    buttonStack = null;
    highlightSlot = null;
    themeSlot = null;
    buttonWrap = null;
    themeButtonWrap = null;
    pointerState = null;
  }

  function initializeFloatingButton() {
    requestHighlightRuntimeSync();

    chrome.storage.local.get({
      [FLOATING_BUTTON_ENABLED_KEY]: true,
      [HIGHLIGHT_ENABLED_KEY]: false,
      [POSITION_KEY]: null,
      [PAGE_THEME_OVERRIDES_KEY]: {}
    }, (result) => {
      currentHighlightEnabled = result[HIGHLIGHT_ENABLED_KEY] !== false;
      const pageThemeOverride = (result[PAGE_THEME_OVERRIDES_KEY] || {})[getPageThemeKey()];
      const pageThemeIsDark = normalizePageThemeOverride(pageThemeOverride);
      currentPageThemeIsDark = pageThemeIsDark !== null
        ? pageThemeIsDark
        : getCurrentHighlightTheme(false);

      if (result[FLOATING_BUTTON_ENABLED_KEY] !== false) {
        createButton(result[POSITION_KEY], pageThemeOverride);
        refreshHighlightControlState();
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (changes[HIGHLIGHT_ENABLED_KEY] || changes[HIGHLIGHT_SCOPE_KEY] || changes[PAGE_TAB_OVERRIDES_KEY]) {
      refreshHighlightControlState();
    }

    if (changes[FLOATING_BUTTON_ENABLED_KEY]) {
      if (changes[FLOATING_BUTTON_ENABLED_KEY].newValue === true) {
        chrome.storage.local.get({ [POSITION_KEY]: null, [PAGE_THEME_OVERRIDES_KEY]: {} }, (result) => {
          const pageThemeOverride = (result[PAGE_THEME_OVERRIDES_KEY] || {})[getPageThemeKey()];
          createButton(result[POSITION_KEY], pageThemeOverride);
        });
      } else {
        destroyButton();
      }
    }

    if (changes[PAGE_THEME_OVERRIDES_KEY]) {
      const pageThemeOverride = (changes[PAGE_THEME_OVERRIDES_KEY].newValue || {})[getPageThemeKey()];
      const pageThemeIsDark = normalizePageThemeOverride(pageThemeOverride);
      if (pageThemeIsDark !== null) {
        updatePageThemeState(pageThemeIsDark);
      }
    }

    if (changes[POSITION_KEY] && !pointerState) {
      applyPosition(getSharedPosition(changes[POSITION_KEY].newValue));
    }
  });

  window.addEventListener('resize', () => {
    if (!currentPosition || !buttonWrap) {
      return;
    }
    applyPosition(currentPosition);
  });

  initializeFloatingButton();
})();