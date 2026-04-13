(function (window, document) {
  'use strict';

  if (!window || !document) {
    return;
  }

  if (window.__AUTO_ANTI_BOT_BOOTSTRAPPED__) {
    return;
  }
  window.__AUTO_ANTI_BOT_BOOTSTRAPPED__ = true;

  var externalConfig = window.__ANTI_BOT_CONFIG__ || {};
  var defaultConfig = {
    minObservationMs: 1800,
    observationWindowMs: 6000,
    primaryPassScore: 60,
    secondaryPassScore: 55,
    primaryMinEventCount: 8,
    pointerSampleIntervalMs: 40,
    maxTrackPoints: 180,
    challengeZIndex: 2147483646,
    sessionTrustMs: 30 * 60 * 1000,
    storageKey: '__anti_bot_guard_pass__',
    reportUrl: '',
    autoShowBadge: true,
    badgeTextMonitoring: '环境校验中',
    badgeTextPassed: '访问已放行',
    badgeTextChallenge: '需要验证',
    titleText: '访问验证',
    descText: '检测到当前访问风险较高，完成下方验证后继续访问。',
    sliderText: '拖动滑块到最右侧',
    scrollText: '滚动阅读验证区域到底部',
    successText: '验证通过，正在继续访问。',
    retryText: '验证未通过，请按自然操作轨迹重新完成一次。',
    debug: false
  };

  function extend(base, extra) {
    var result = {};
    var key;

    for (key in base) {
      if (Object.prototype.hasOwnProperty.call(base, key)) {
        result[key] = base[key];
      }
    }

    for (key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        result[key] = extra[key];
      }
    }

    return result;
  }

  var config = extend(defaultConfig, externalConfig);
  var docEl = document.documentElement;
  var bodyReady = false;
  var primaryTimer = null;
  var delayedEvalTimer = null;
  var badgeEl = null;
  var overlayEl = null;
  var statusTextEl = null;
  var sliderTrackEl = null;
  var sliderFillEl = null;
  var sliderHandleEl = null;
  var scrollBoxEl = null;

  var state = {
    status: 'idle',
    startedAt: now(),
    lastActivityAt: now(),
    currentScore: 0,
    currentSecondaryScore: 0,
    unlocked: false,
    challengeShown: false,
    pointerDown: false,
    pointerDragActive: false,
    pointerLastSampleAt: 0,
    pointerLastX: null,
    pointerLastY: null,
    pointerLastAt: 0,
    metrics: createMetrics(),
    challenge: createChallengeState(),
    sessionRestored: false
  };

  function createMetrics() {
    return {
      pointerEvents: 0,
      pointerTrustedEvents: 0,
      syntheticEvents: 0,
      clickCount: 0,
      keyCount: 0,
      scrollCount: 0,
      wheelCount: 0,
      focusCount: 0,
      blurCount: 0,
      hiddenCount: 0,
      totalDistance: 0,
      directionChanges: 0,
      suspiciousJumps: 0,
      totalPointerDuration: 0,
      totalScrollDistance: 0,
      lastScrollTop: getScrollTop(),
      lastScrollAt: 0,
      trustedSequence: 0,
      intervals: [],
      speeds: [],
      track: [],
      uniqueCells: {},
      uniqueCellCount: 0,
      lastAngle: null
    };
  }

  function createChallengeState() {
    return {
      openAt: 0,
      dragStartedAt: 0,
      dragEndedAt: 0,
      dragCompleted: false,
      dragSamples: 0,
      dragDistance: 0,
      dragReversals: 0,
      dragLastX: null,
      dragLastDelta: 0,
      dragTrustedEvents: 0,
      scrollStartedAt: 0,
      scrollEndedAt: 0,
      scrollCount: 0,
      scrollDistance: 0,
      scrollReachedBottom: false,
      syntheticEvents: 0
    };
  }

  function now() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function clamp(value, min, max) {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function safeSessionStorageGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeSessionStorageSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (error) {
    }
  }

  function getScrollTop() {
    return window.pageYOffset || docEl.scrollTop || document.body.scrollTop || 0;
  }

  function getViewportWidth() {
    return window.innerWidth || docEl.clientWidth || document.body.clientWidth || 1;
  }

  function getViewportHeight() {
    return window.innerHeight || docEl.clientHeight || document.body.clientHeight || 1;
  }

  function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  }

  function debugLog() {
    if (!config.debug || !window.console || !window.console.log) {
      return;
    }
    window.console.log.apply(window.console, arguments);
  }

  function dispatchEventSafe(name, detail) {
    var event;

    if (typeof window.CustomEvent === 'function') {
      event = new CustomEvent(name, {
        detail: detail
      });
    } else {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent(name, false, false, detail);
    }

    window.dispatchEvent(event);
  }

  function setStatus(status, payload) {
    state.status = status;
    docEl.setAttribute('data-antibot-status', status);

    if (typeof payload !== 'undefined' && payload !== null && typeof payload.score !== 'undefined') {
      docEl.setAttribute('data-antibot-score', String(round(payload.score)));
    }

    updateBadge(status);
    dispatchEventSafe('antiBot:status', {
      status: status,
      score: state.currentScore,
      secondaryScore: state.currentSecondaryScore,
      payload: payload || null
    });

    reportStatus(status, payload || null);
  }

  function reportStatus(status, payload) {
    if (!config.reportUrl) {
      return;
    }

    var data = {
      status: status,
      score: round(state.currentScore),
      secondaryScore: round(state.currentSecondaryScore),
      startedAt: state.startedAt,
      at: now(),
      payload: payload || null,
      metrics: {
        pointerEvents: state.metrics.pointerEvents,
        clickCount: state.metrics.clickCount,
        keyCount: state.metrics.keyCount,
        scrollCount: state.metrics.scrollCount,
        totalDistance: round(state.metrics.totalDistance),
        directionChanges: state.metrics.directionChanges,
        suspiciousJumps: state.metrics.suspiciousJumps,
        syntheticEvents: state.metrics.syntheticEvents
      }
    };

    var body = JSON.stringify(data);

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(config.reportUrl, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (error) {
    }

    try {
      if (window.fetch) {
        window.fetch(config.reportUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'same-origin',
          keepalive: true,
          body: body
        });
      }
    } catch (error) {
    }
  }

  function mean(list) {
    var i;
    var total = 0;

    if (!list.length) {
      return 0;
    }

    for (i = 0; i < list.length; i += 1) {
      total += list[i];
    }

    return total / list.length;
  }

  function variance(list) {
    var i;
    var avg = mean(list);
    var total = 0;

    if (!list.length) {
      return 0;
    }

    for (i = 0; i < list.length; i += 1) {
      total += Math.pow(list[i] - avg, 2);
    }

    return total / list.length;
  }

  function normalizeAngleDelta(delta) {
    var value = delta;
    while (value > Math.PI) {
      value -= Math.PI * 2;
    }
    while (value < -Math.PI) {
      value += Math.PI * 2;
    }
    return Math.abs(value);
  }

  function addLimited(list, value, maxLength) {
    list.push(value);
    if (list.length > maxLength) {
      list.shift();
    }
  }

  function markTrustedOrSynthetic(evt, targetMetrics) {
    if (evt && evt.isTrusted === false) {
      targetMetrics.syntheticEvents += 1;
      return false;
    }

    if (typeof targetMetrics.pointerTrustedEvents === 'number') {
      targetMetrics.pointerTrustedEvents += 1;
    }
    if (typeof targetMetrics.dragTrustedEvents === 'number') {
      targetMetrics.dragTrustedEvents += 1;
    }

    return true;
  }

  function rememberSession(score, source) {
    var payload = {
      score: round(score),
      source: source,
      expiresAt: now() + config.sessionTrustMs
    };

    safeSessionStorageSet(config.storageKey, JSON.stringify(payload));
  }

  function hasValidSession() {
    var raw = safeSessionStorageGet(config.storageKey);
    var parsed;

    if (!raw) {
      return false;
    }

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return false;
    }

    if (!parsed || !parsed.expiresAt || parsed.expiresAt < now()) {
      return false;
    }

    state.sessionRestored = true;
    state.currentScore = parsed.score || 100;
    return true;
  }

  function ensureBadge() {
    if (!config.autoShowBadge || badgeEl || !bodyReady) {
      return;
    }

    badgeEl = document.createElement('div');
    badgeEl.className = 'ab-guard-badge';
    badgeEl.textContent = config.badgeTextMonitoring;
    document.body.appendChild(badgeEl);
  }

  function updateBadge(status) {
    if (!config.autoShowBadge) {
      return;
    }

    ensureBadge();

    if (!badgeEl) {
      return;
    }

    if (status === 'passed') {
      badgeEl.textContent = config.badgeTextPassed;
      badgeEl.className = 'ab-guard-badge is-pass';
      return;
    }

    if (status === 'challenge') {
      badgeEl.textContent = config.badgeTextChallenge;
      badgeEl.className = 'ab-guard-badge is-risk';
      return;
    }

    badgeEl.textContent = config.badgeTextMonitoring;
    badgeEl.className = 'ab-guard-badge';
  }

  function injectStyle() {
    if (document.getElementById('ab-guard-style')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'ab-guard-style';
    style.type = 'text/css';
    style.appendChild(document.createTextNode('')
      + '.ab-guard-badge{position:fixed;right:16px;bottom:16px;z-index:' + config.challengeZIndex + ';padding:8px 12px;border-radius:999px;background:rgba(17,24,39,.86);color:#fff;font-size:12px;line-height:1;box-shadow:0 8px 24px rgba(0,0,0,.18);backdrop-filter:blur(6px);pointer-events:none;transition:opacity .2s ease,transform .2s ease;opacity:.92;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif;}'
      + '.ab-guard-badge.is-pass{background:rgba(22,163,74,.92);}'
      + '.ab-guard-badge.is-risk{background:rgba(220,38,38,.92);}'
      + '.ab-guard-overlay{position:fixed;inset:0;z-index:' + config.challengeZIndex + ';display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:16px;box-sizing:border-box;}'
      + '.ab-guard-panel{width:min(520px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 72px rgba(15,23,42,.22);padding:24px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif;color:#0f172a;}'
      + '.ab-guard-title{font-size:22px;font-weight:700;line-height:1.4;margin:0 0 8px;}'
      + '.ab-guard-desc{font-size:14px;line-height:1.7;color:#475569;margin:0 0 18px;}'
      + '.ab-guard-block{margin-top:14px;padding:14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;}'
      + '.ab-guard-label{font-size:13px;font-weight:600;line-height:1.5;margin-bottom:10px;color:#334155;}'
      + '.ab-guard-track{position:relative;height:46px;border-radius:999px;background:#e2e8f0;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none;}'
      + '.ab-guard-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:999px;background:linear-gradient(90deg,#22c55e,#16a34a);transition:width .08s linear;}'
      + '.ab-guard-handle{position:absolute;left:0;top:3px;width:40px;height:40px;border-radius:50%;background:#fff;border:1px solid #cbd5e1;box-shadow:0 6px 18px rgba(15,23,42,.16);cursor:grab;touch-action:none;}'
      + '.ab-guard-handle.is-dragging{cursor:grabbing;}'
      + '.ab-guard-scroll{max-height:150px;overflow:auto;padding:12px;border-radius:12px;background:#fff;border:1px solid #dbe3ef;font-size:13px;line-height:1.8;color:#475569;}'
      + '.ab-guard-scroll p{margin:0 0 10px;}'
      + '.ab-guard-scroll p:last-child{margin-bottom:0;}'
      + '.ab-guard-status{margin-top:16px;font-size:13px;line-height:1.6;color:#475569;min-height:20px;}'
      + '.ab-guard-status.is-pass{color:#15803d;}'
      + '.ab-guard-status.is-fail{color:#b91c1c;}'
    ));
    document.head.appendChild(style);
  }

  function schedulePrimaryEvaluation() {
    if (primaryTimer) {
      window.clearTimeout(primaryTimer);
    }

    primaryTimer = window.setTimeout(function () {
      evaluatePrimary(true);
    }, config.observationWindowMs);
  }

  function delayedEvaluation() {
    if (delayedEvalTimer) {
      window.clearTimeout(delayedEvalTimer);
    }

    delayedEvalTimer = window.setTimeout(function () {
      evaluatePrimary(false);
    }, 120);
  }

  function updateActivity() {
    state.lastActivityAt = now();
  }

  function quantizePoint(x, y) {
    var cellX = Math.floor((x / Math.max(getViewportWidth(), 1)) * 12);
    var cellY = Math.floor((y / Math.max(getViewportHeight(), 1)) * 8);
    return cellX + ':' + cellY;
  }

  function pushTrackPoint(x, y, at) {
    addLimited(state.metrics.track, {
      x: x,
      y: y,
      at: at
    }, config.maxTrackPoints);
  }

  function onPointerMove(evt) {
    var eventTime = now();
    var x;
    var y;
    var dx;
    var dy;
    var distance;
    var dt;
    var angle;
    var intervalVariance;
    var speedVariance;
    var cellKey;

    if (evt.type === 'pointermove' && evt.pointerType && evt.pointerType !== 'mouse') {
      return;
    }

    if (eventTime - state.pointerLastSampleAt < config.pointerSampleIntervalMs) {
      return;
    }
    state.pointerLastSampleAt = eventTime;

    x = typeof evt.clientX === 'number' ? evt.clientX : 0;
    y = typeof evt.clientY === 'number' ? evt.clientY : 0;

    state.metrics.pointerEvents += 1;
    if (!markTrustedOrSynthetic(evt, state.metrics)) {
      updateActivity();
      delayedEvaluation();
      return;
    }

    cellKey = quantizePoint(x, y);
    if (!state.metrics.uniqueCells[cellKey]) {
      state.metrics.uniqueCells[cellKey] = 1;
      state.metrics.uniqueCellCount += 1;
    } else {
      state.metrics.uniqueCells[cellKey] += 1;
    }

    if (state.pointerLastX !== null && state.pointerLastY !== null) {
      dx = x - state.pointerLastX;
      dy = y - state.pointerLastY;
      distance = Math.sqrt(dx * dx + dy * dy);
      dt = Math.max(eventTime - state.pointerLastAt, 1);
      angle = Math.atan2(dy, dx);

      state.metrics.totalDistance += distance;
      state.metrics.totalPointerDuration += dt;
      addLimited(state.metrics.intervals, dt, 40);
      addLimited(state.metrics.speeds, distance / dt, 40);

      if (distance > Math.max(getViewportWidth(), getViewportHeight()) * 0.8) {
        state.metrics.suspiciousJumps += 1;
      }

      if (state.metrics.lastAngle !== null && normalizeAngleDelta(angle - state.metrics.lastAngle) > 0.45) {
        state.metrics.directionChanges += 1;
      }

      state.metrics.lastAngle = angle;
      intervalVariance = variance(state.metrics.intervals);
      speedVariance = variance(state.metrics.speeds);

      if (intervalVariance > 8 || speedVariance > 0.0006) {
        state.metrics.trustedSequence += 1;
      }
    }

    state.pointerLastX = x;
    state.pointerLastY = y;
    state.pointerLastAt = eventTime;
    pushTrackPoint(x, y, eventTime);
    updateActivity();
    delayedEvaluation();
  }

  function onPointerDown(evt) {
    state.pointerDown = true;
    updateActivity();
    markTrustedOrSynthetic(evt, state.metrics);
  }

  function onPointerUp(evt) {
    state.pointerDown = false;
    updateActivity();
    markTrustedOrSynthetic(evt, state.metrics);
  }

  function onClick(evt) {
    state.metrics.clickCount += 1;
    updateActivity();
    markTrustedOrSynthetic(evt, state.metrics);
    delayedEvaluation();
  }

  function onKeydown(evt) {
    state.metrics.keyCount += 1;
    updateActivity();
    markTrustedOrSynthetic(evt, state.metrics);
    delayedEvaluation();
  }

  function onScroll(evt) {
    var currentScrollTop = getScrollTop();
    var delta = Math.abs(currentScrollTop - state.metrics.lastScrollTop);
    var eventTime = now();
    var interval = state.metrics.lastScrollAt ? (eventTime - state.metrics.lastScrollAt) : 0;

    state.metrics.scrollCount += 1;
    state.metrics.totalScrollDistance += delta;
    state.metrics.lastScrollTop = currentScrollTop;
    state.metrics.lastScrollAt = eventTime;
    if (interval > 0) {
      addLimited(state.metrics.intervals, interval, 40);
    }

    updateActivity();
    markTrustedOrSynthetic(evt, state.metrics);
    delayedEvaluation();
  }

  function onWheel(evt) {
    state.metrics.wheelCount += 1;
    updateActivity();
    markTrustedOrSynthetic(evt, state.metrics);
  }

  function onVisibilityChange() {
    if (document.hidden) {
      state.metrics.hiddenCount += 1;
    }
    updateActivity();
  }

  function onFocus() {
    state.metrics.focusCount += 1;
    updateActivity();
  }

  function onBlur() {
    state.metrics.blurCount += 1;
    updateActivity();
  }

  function computePrimaryScore() {
    var elapsed = now() - state.startedAt;
    var score = 0;
    var reasons = [];
    var totalEvents = state.metrics.pointerEvents + state.metrics.clickCount + state.metrics.keyCount + state.metrics.scrollCount;
    var intervalVar = variance(state.metrics.intervals);
    var speedVar = variance(state.metrics.speeds);

    if (elapsed >= config.minObservationMs) {
      score += 10;
      reasons.push('基础停留时长满足');
    }

    if (state.metrics.pointerEvents >= 10) {
      score += 14;
      reasons.push('鼠标轨迹样本充足');
    } else {
      score += clamp(state.metrics.pointerEvents, 0, 8);
    }

    if (state.metrics.uniqueCellCount >= 6) {
      score += 10;
      reasons.push('轨迹覆盖区域正常');
    } else {
      score += clamp(state.metrics.uniqueCellCount, 0, 5);
    }

    if (state.metrics.totalDistance >= 180) {
      score += 8;
      reasons.push('轨迹位移正常');
    } else if (state.metrics.totalDistance >= 80) {
      score += 4;
    }

    if (state.metrics.directionChanges >= 4) {
      score += 10;
      reasons.push('轨迹方向变化自然');
    } else if (state.metrics.directionChanges >= 2) {
      score += 5;
    }

    if (intervalVar >= 30) {
      score += 8;
      reasons.push('操作节奏具备波动');
    } else if (intervalVar >= 8) {
      score += 4;
    } else if (state.metrics.pointerEvents >= 6) {
      score -= 6;
      reasons.push('操作节奏过于均匀');
    }

    if (speedVar >= 0.002) {
      score += 8;
      reasons.push('移动速度存在自然波动');
    } else if (speedVar >= 0.0006) {
      score += 4;
    } else if (state.metrics.pointerEvents >= 6) {
      score -= 6;
      reasons.push('移动速度过于稳定');
    }

    if (state.metrics.clickCount > 0) {
      score += 8;
      reasons.push('存在点击行为');
    }

    if (state.metrics.scrollCount > 0) {
      score += 8;
      reasons.push('存在滚动行为');
    }

    if (state.metrics.keyCount > 0) {
      score += 6;
      reasons.push('存在键盘行为');
    }

    if (state.metrics.focusCount > 0) {
      score += 4;
    }

    if (!isTouchDevice() && state.metrics.pointerEvents === 0) {
      score -= 18;
      reasons.push('桌面端缺少鼠标轨迹');
    }

    if (state.metrics.suspiciousJumps >= 2) {
      score -= 10;
      reasons.push('轨迹出现异常跳变');
    }

    if (state.metrics.syntheticEvents > 0) {
      score -= 18;
      reasons.push('检测到非可信事件');
    }

    if (state.metrics.totalDistance > 240 && state.metrics.directionChanges === 0) {
      score -= 12;
      reasons.push('长距离直线轨迹异常');
    }

    if (totalEvents < config.primaryMinEventCount && elapsed >= config.observationWindowMs) {
      score -= 12;
      reasons.push('有效行为样本不足');
    }

    return {
      score: clamp(score, 0, 100),
      reasons: reasons,
      totalEvents: totalEvents,
      elapsed: elapsed,
      intervalVariance: round(intervalVar),
      speedVariance: round(speedVar)
    };
  }

  function unlockAccess(source, score, extra) {
    if (state.unlocked) {
      return;
    }

    state.unlocked = true;
    state.challengeShown = false;
    state.currentScore = typeof score === 'number' ? round(score) : state.currentScore;
    rememberSession(state.currentScore, source || 'primary');
    removeChallenge();
    setStatus('passed', {
      source: source || 'primary',
      score: state.currentScore,
      extra: extra || null
    });
    dispatchEventSafe('antiBot:passed', {
      source: source || 'primary',
      score: state.currentScore,
      secondaryScore: state.currentSecondaryScore,
      extra: extra || null
    });
  }

  function evaluatePrimary(forceChallenge) {
    var result;

    if (state.unlocked || state.challengeShown) {
      return;
    }

    result = computePrimaryScore();
    state.currentScore = result.score;

    debugLog('anti-bot primary score:', result);

    if (result.elapsed >= config.minObservationMs && result.totalEvents >= config.primaryMinEventCount && result.score >= config.primaryPassScore) {
      unlockAccess('primary', result.score, result);
      return;
    }

    if (forceChallenge || result.elapsed >= config.observationWindowMs) {
      showChallenge(result);
    } else {
      setStatus('monitoring', result);
    }
  }

  function createChallengeContent() {
    var text = [];
    text.push('<p>请保持自然阅读节奏，缓慢滚动到容器底部。</p>');
    text.push('<p>验证过程会结合拖动轨迹、滚动节奏、停留时长进行二次评分。</p>');
    text.push('<p>连续、线性、瞬间完成的轨迹会降低评分。</p>');
    text.push('<p>操作完成后会自动放行，不需要额外点击确认按钮。</p>');
    text.push('<p>当前验证仅在本次会话内生效，过期后会重新评估。</p>');
    text.push('<p>如需和服务端联动，可配置 reportUrl 接收状态上报。</p>');
    return text.join('');
  }

  function ensureChallenge() {
    if (overlayEl || !bodyReady) {
      return;
    }

    overlayEl = document.createElement('div');
    overlayEl.className = 'ab-guard-overlay';
    overlayEl.innerHTML = ''
      + '<div class="ab-guard-panel" role="dialog" aria-modal="true" aria-label="访问验证">'
      + '  <h3 class="ab-guard-title"></h3>'
      + '  <p class="ab-guard-desc"></p>'
      + '  <div class="ab-guard-block">'
      + '    <div class="ab-guard-label"></div>'
      + '    <div class="ab-guard-track">'
      + '      <div class="ab-guard-fill"></div>'
      + '      <div class="ab-guard-handle" tabindex="0" aria-label="拖动滑块"></div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="ab-guard-block">'
      + '    <div class="ab-guard-label"></div>'
      + '    <div class="ab-guard-scroll"></div>'
      + '  </div>'
      + '  <div class="ab-guard-status"></div>'
      + '</div>';

    document.body.appendChild(overlayEl);

    overlayEl.querySelector('.ab-guard-title').textContent = config.titleText;
    overlayEl.querySelector('.ab-guard-desc').textContent = config.descText;
    overlayEl.querySelectorAll('.ab-guard-label')[0].textContent = config.sliderText;
    overlayEl.querySelectorAll('.ab-guard-label')[1].textContent = config.scrollText;

    statusTextEl = overlayEl.querySelector('.ab-guard-status');
    sliderTrackEl = overlayEl.querySelector('.ab-guard-track');
    sliderFillEl = overlayEl.querySelector('.ab-guard-fill');
    sliderHandleEl = overlayEl.querySelector('.ab-guard-handle');
    scrollBoxEl = overlayEl.querySelector('.ab-guard-scroll');
    scrollBoxEl.innerHTML = createChallengeContent();

    bindChallengeEvents();
  }

  function showChallenge(primaryResult) {
    if (state.unlocked) {
      return;
    }

    ensureChallenge();
    resetChallenge(false);
    state.challengeShown = true;
    state.challenge.openAt = now();
    overlayEl.style.display = 'flex';
    hintText(config.descText, '');
    setStatus('challenge', primaryResult || {
      score: state.currentScore
    });
    dispatchEventSafe('antiBot:challenge', {
      score: state.currentScore,
      detail: primaryResult || null
    });
  }

  function removeChallenge() {
    if (!overlayEl) {
      return;
    }

    overlayEl.style.display = 'none';
  }

  function resetChallenge(clearMessage) {
    state.challenge = createChallengeState();

    if (sliderFillEl) {
      sliderFillEl.style.width = '0px';
    }
    if (sliderHandleEl) {
      sliderHandleEl.style.left = '0px';
      sliderHandleEl.classList.remove('is-dragging');
    }
    if (scrollBoxEl) {
      scrollBoxEl.scrollTop = 0;
    }

    if (clearMessage !== false) {
      hintText(config.descText, '');
    }
  }

  function hintText(text, className) {
    if (!statusTextEl) {
      return;
    }
    statusTextEl.textContent = text;
    statusTextEl.className = 'ab-guard-status' + (className ? (' ' + className) : '');
  }

  function getTrackMaxLeft() {
    if (!sliderTrackEl || !sliderHandleEl) {
      return 0;
    }
    return Math.max(sliderTrackEl.clientWidth - sliderHandleEl.offsetWidth, 0);
  }

  function setSliderLeft(left) {
    var value = clamp(left, 0, getTrackMaxLeft());

    sliderHandleEl.style.left = value + 'px';
    sliderFillEl.style.width = (value + sliderHandleEl.offsetWidth / 2) + 'px';
    return value;
  }

  function getEventClientX(evt) {
    if (evt.touches && evt.touches.length) {
      return evt.touches[0].clientX;
    }
    if (evt.changedTouches && evt.changedTouches.length) {
      return evt.changedTouches[0].clientX;
    }
    return typeof evt.clientX === 'number' ? evt.clientX : 0;
  }

  function beginDrag(evt) {
    state.pointerDragActive = true;
    state.challenge.dragStartedAt = state.challenge.dragStartedAt || now();
    sliderHandleEl.classList.add('is-dragging');

    if (evt && evt.isTrusted === false) {
      state.challenge.syntheticEvents += 1;
    } else {
      state.challenge.dragTrustedEvents += 1;
    }
  }

  function updateDrag(evt) {
    var trackRect;
    var currentX;
    var left;
    var moveDelta;

    if (!state.pointerDragActive) {
      return;
    }

    trackRect = sliderTrackEl.getBoundingClientRect();
    currentX = getEventClientX(evt);
    left = currentX - trackRect.left - sliderHandleEl.offsetWidth / 2;
    left = setSliderLeft(left);

    state.challenge.dragSamples += 1;
    state.challenge.dragDistance = Math.max(state.challenge.dragDistance, left);

    if (state.challenge.dragLastX !== null) {
      moveDelta = currentX - state.challenge.dragLastX;
      if ((moveDelta > 0 && state.challenge.dragLastDelta < 0) || (moveDelta < 0 && state.challenge.dragLastDelta > 0)) {
        state.challenge.dragReversals += 1;
      }
      state.challenge.dragLastDelta = moveDelta;
    }

    state.challenge.dragLastX = currentX;

    if (evt && evt.isTrusted === false) {
      state.challenge.syntheticEvents += 1;
    } else {
      state.challenge.dragTrustedEvents += 1;
    }

    if (left >= getTrackMaxLeft() - 2) {
      state.challenge.dragCompleted = true;
      state.challenge.dragEndedAt = now();
      sliderHandleEl.classList.remove('is-dragging');
      state.pointerDragActive = false;
      maybeCompleteChallenge();
    }
  }

  function endDrag(evt) {
    if (!state.pointerDragActive) {
      return;
    }

    state.pointerDragActive = false;
    sliderHandleEl.classList.remove('is-dragging');

    if (!state.challenge.dragCompleted) {
      setSliderLeft(0);
      hintText('滑块未完成，请按自然拖动轨迹重新验证。', 'is-fail');
    }

    if (evt && evt.isTrusted === false) {
      state.challenge.syntheticEvents += 1;
    }
  }

  function onChallengeScroll(evt) {
    var currentTop = scrollBoxEl.scrollTop;
    var maxTop = scrollBoxEl.scrollHeight - scrollBoxEl.clientHeight;
    var eventTime = now();
    var delta = currentTop - (state.challenge.lastTop || 0);

    if (!state.challenge.scrollStartedAt) {
      state.challenge.scrollStartedAt = eventTime;
    }

    state.challenge.scrollEndedAt = eventTime;
    state.challenge.scrollCount += 1;
    state.challenge.scrollDistance += Math.abs(delta);
    state.challenge.lastTop = currentTop;

    if (evt && evt.isTrusted === false) {
      state.challenge.syntheticEvents += 1;
    }

    if (maxTop > 0 && currentTop >= maxTop - 4) {
      state.challenge.scrollReachedBottom = true;
      maybeCompleteChallenge();
    }
  }

  function computeSecondaryScore() {
    var score = 0;
    var dragDuration = state.challenge.dragEndedAt && state.challenge.dragStartedAt ? (state.challenge.dragEndedAt - state.challenge.dragStartedAt) : 0;
    var scrollDuration = state.challenge.scrollEndedAt && state.challenge.scrollStartedAt ? (state.challenge.scrollEndedAt - state.challenge.scrollStartedAt) : 0;
    var challengeDuration = now() - state.challenge.openAt;
    var dragCompletionRatio = getTrackMaxLeft() > 0 ? (state.challenge.dragDistance / getTrackMaxLeft()) : 0;
    var result = {
      dragDuration: dragDuration,
      scrollDuration: scrollDuration,
      challengeDuration: challengeDuration,
      dragSamples: state.challenge.dragSamples,
      scrollCount: state.challenge.scrollCount,
      dragReversals: state.challenge.dragReversals,
      syntheticEvents: state.challenge.syntheticEvents,
      dragCompletionRatio: round(dragCompletionRatio)
    };

    if (state.challenge.dragCompleted) {
      score += 24;
    }

    if (dragDuration >= 500 && dragDuration <= 12000) {
      score += 12;
    } else if (dragDuration > 0) {
      score -= 8;
    }

    if (state.challenge.dragSamples >= 10) {
      score += 10;
    } else {
      score += clamp(state.challenge.dragSamples, 0, 8) * 0.8;
    }

    if (state.challenge.dragReversals <= 5) {
      score += 6;
    } else if (state.challenge.dragReversals > 10) {
      score -= 4;
    }

    if (dragCompletionRatio >= 0.96) {
      score += 8;
    }

    if (state.challenge.scrollReachedBottom) {
      score += 18;
    }

    if (scrollDuration >= 700) {
      score += 8;
    } else if (state.challenge.scrollReachedBottom && scrollDuration > 0) {
      score -= 8;
    }

    if (state.challenge.scrollCount >= 4) {
      score += 8;
    } else {
      score += clamp(state.challenge.scrollCount, 0, 3) * 1.5;
    }

    if (challengeDuration >= 1600) {
      score += 6;
    } else {
      score -= 6;
    }

    if (state.challenge.syntheticEvents > 0) {
      score -= 18;
    }

    result.score = clamp(score, 0, 100);
    return result;
  }

  function maybeCompleteChallenge() {
    var result;

    if (!state.challenge.dragCompleted || !state.challenge.scrollReachedBottom) {
      if (state.challenge.dragCompleted && !state.challenge.scrollReachedBottom) {
        hintText('滑块已完成，请继续滚动验证区域到底部。', '');
      } else if (!state.challenge.dragCompleted && state.challenge.scrollReachedBottom) {
        hintText('滚动已完成，请继续完成滑块验证。', '');
      }
      return;
    }

    result = computeSecondaryScore();
    state.currentSecondaryScore = result.score;

    debugLog('anti-bot secondary score:', result);

    if (result.score >= config.secondaryPassScore) {
      hintText(config.successText, 'is-pass');
      unlockAccess('challenge', result.score, result);
      return;
    }

    hintText(config.retryText, 'is-fail');
    window.setTimeout(function () {
      resetChallenge(false);
    }, 900);
  }

  function bindChallengeEvents() {
    var moveHandler = function (evt) {
      if (!state.pointerDragActive) {
        return;
      }
      evt.preventDefault();
      updateDrag(evt);
    };

    var endHandler = function (evt) {
      endDrag(evt);
    };

    sliderHandleEl.addEventListener('mousedown', function (evt) {
      evt.preventDefault();
      beginDrag(evt);
    }, false);

    sliderHandleEl.addEventListener('touchstart', function (evt) {
      evt.preventDefault();
      beginDrag(evt);
    }, { passive: false });

    sliderTrackEl.addEventListener('mousedown', function (evt) {
      if (evt.target === sliderHandleEl) {
        return;
      }
      evt.preventDefault();
      beginDrag(evt);
      updateDrag(evt);
    }, false);

    sliderTrackEl.addEventListener('touchstart', function (evt) {
      evt.preventDefault();
      beginDrag(evt);
      updateDrag(evt);
    }, { passive: false });

    window.addEventListener('mousemove', moveHandler, false);
    window.addEventListener('touchmove', moveHandler, { passive: false });
    window.addEventListener('mouseup', endHandler, false);
    window.addEventListener('touchend', endHandler, false);
    window.addEventListener('touchcancel', endHandler, false);

    scrollBoxEl.addEventListener('scroll', onChallengeScroll, { passive: true });
  }

  function bindEvents() {
    if (window.PointerEvent) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerdown', onPointerDown, { passive: true });
      window.addEventListener('pointerup', onPointerUp, { passive: true });
    } else {
      window.addEventListener('mousemove', onPointerMove, { passive: true });
      window.addEventListener('mousedown', onPointerDown, { passive: true });
      window.addEventListener('mouseup', onPointerUp, { passive: true });
    }

    window.addEventListener('click', onClick, { passive: true });
    window.addEventListener('keydown', onKeydown, false);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange, false);
    window.addEventListener('focus', onFocus, false);
    window.addEventListener('blur', onBlur, false);
  }

  function bootstrap() {
    bodyReady = true;
    injectStyle();
    ensureBadge();
    bindEvents();
    setStatus('monitoring', {
      score: 0
    });

    if (hasValidSession()) {
      unlockAccess('session', state.currentScore, {
        restored: true
      });
      return;
    }

    schedulePrimaryEvaluation();
  }

  window.__ANTI_BOT_RUNTIME__ = {
    getStatus: function () {
      return {
        status: state.status,
        score: state.currentScore,
        secondaryScore: state.currentSecondaryScore,
        unlocked: state.unlocked,
        challengeShown: state.challengeShown,
        sessionRestored: state.sessionRestored
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, false);
  } else {
    bootstrap();
  }
})(window, document);
