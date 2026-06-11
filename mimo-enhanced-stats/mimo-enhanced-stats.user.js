// ==UserScript==
// @name         MiMo 平台用量增强统计
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  在 xiaomimimo 用量统计页面增加缓存命中率、今日消耗百分比、每日柱状图等指标
// @author       Hermes
// @match        https://platform.xiaomimimo.com/console/plan-manage*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const QUOTA = 11_000_000_000;

  function fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
  }
  function pct(v) { return (v * 100).toFixed(1) + '%'; }
  function pct2(v) { return (v * 100).toFixed(2) + '%'; }

  let cachedUsage = null;
  let cachedList = null;

  // ============ 拦截 fetch ============
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const result = origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (url.includes('/api/v1/tokenPlan/usage')) {
      result.then(r => r.clone().json().then(j => { if (j.code === 0) { cachedUsage = j.data; tryInject(); } })).catch(() => {});
    }
    if (url.includes('/api/v1/usage/token-plan/list')) {
      result.then(r => r.clone().json().then(j => { if (j.code === 0) { cachedList = j.data; tryInject(); } })).catch(() => {});
    }
    return result;
  };

  // ============ 拦截 XMLHttpRequest ============
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this._mimoUrl = url; return origOpen.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const data = JSON.parse(this.responseText);
        if (this._mimoUrl?.includes('/api/v1/tokenPlan/usage') && data.code === 0) { cachedUsage = data.data; tryInject(); }
        if (this._mimoUrl?.includes('/api/v1/usage/token-plan/list') && data.code === 0) { cachedList = data.data; tryInject(); }
      } catch (e) { }
    });
    return origSend.apply(this, args);
  };

  // ============ 计算指标 ============
  function computeMetrics(usageData, listData) {
    const m = {};
    const planItem = usageData?.usage?.items?.find(i => i.name === 'plan_total_token');
    if (planItem) { m.planUsed = planItem.used; m.planLimit = planItem.limit; }

    const today = new Date().toISOString().slice(0, 10);
    const todayItems = listData.filter(d => d.date === today);
    m.todayTotal = todayItems.reduce((s, d) => s + d.totalToken, 0);
    m.todayHit = todayItems.reduce((s, d) => s + d.inputHitToken, 0);
    m.todayMiss = todayItems.reduce((s, d) => s + d.inputMissToken, 0);
    m.todayReqs = todayItems.reduce((s, d) => s + d.requestCount, 0);
    m.todayPercent = m.todayTotal / QUOTA;
    m.cacheHitRate = (m.todayHit + m.todayMiss) > 0 ? m.todayHit / (m.todayHit + m.todayMiss) : 0;
    m.avgTokensPerReq = m.todayReqs > 0 ? m.todayTotal / m.todayReqs : 0;

    const monthUsage = usageData?.monthUsage;
    if (monthUsage) {
      const currentDay = new Date().getUTCDate();
      m.monthUsed = monthUsage.items?.[0]?.used || 0;
      m.monthDailyAvg = m.monthUsed / Math.max(currentDay, 1);
      m.monthRemaining = QUOTA - m.monthUsed;
      m.daysUntilExhaust = m.monthDailyAvg > 0 ? Math.floor(m.monthRemaining / m.monthDailyAvg) : 999;
    }

    const last7 = listData.slice(0, 7);
    m.weekTotal = last7.reduce((s, d) => s + d.totalToken, 0);
    m.weekReqs = last7.reduce((s, d) => s + d.requestCount, 0);

    // 每日聚合
    const dailyMap = {};
    for (const d of listData) {
      if (!dailyMap[d.date]) dailyMap[d.date] = { date: d.date, totalToken: 0, hit: 0, miss: 0, reqs: 0 };
      const day = dailyMap[d.date];
      day.totalToken += d.totalToken;
      day.hit += d.inputHitToken;
      day.miss += d.inputMissToken;
      day.reqs += d.requestCount;
    }
    m.daily = Object.values(dailyMap)
      .sort((a, b) => a.date.localeCompare(b.date)) // 正序用于柱状图
      .map(d => ({
        ...d,
        tokenPct: d.totalToken / QUOTA,
        cacheHitRate: (d.hit + d.miss) > 0 ? d.hit / (d.hit + d.miss) : 0,
      }));

    return m;
  }

  // ============ 渲染 ============
  function metricBox(label, value, color) {
    return `<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;text-align:center;border:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:11px;color:#888;margin-bottom:6px;">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color};">${value}</div>
    </div>`;
  }

  function barChart(daily, key, label, unit, colorFn) {
    if (!daily || daily.length === 0) return '';
    const maxVal = Math.max(...daily.map(d => d[key]));
    if (maxVal === 0) return '';

    const MAX_BAR_H = 110; // 最大柱高 px
    const bars = daily.map(d => {
      const val = d[key];
      const h = maxVal > 0 ? (val / maxVal) * MAX_BAR_H : 0;
      const color = colorFn(d, val);
      const display = key === 'tokenPct' ? pct2(val) : key === 'cacheHitRate' ? pct(val) : fmt(val);
      const dateShort = d.date.slice(5); // MM-DD
      return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;">
        <div style="font-size:10px;color:#aaa;margin-bottom:4px;white-space:nowrap;">${display}</div>
        <div style="width:100%;max-width:48px;height:${Math.round(Math.max(h, 3))}px;background:${color};border-radius:4px 4px 0 0;"></div>
        <div style="font-size:10px;color:#666;margin-top:4px;white-space:nowrap;">${dateShort}</div>
      </div>`;
    }).join('');

    return `
      <div style="margin-top:16px;">
        <div style="font-size:13px;font-weight:600;color:#ccc;margin-bottom:10px;">${label}</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:150px;padding:0 4px;">
          ${bars}
        </div>
      </div>`;
  }

  function renderCard(m) {
    const card = document.createElement('div');
    card.id = 'mimo-enhanced-stats';
    card.style.cssText = `
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 12px; padding: 20px 24px; margin: 16px 0;
      color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08);
    `;

    // 图例
    const legend = `<div style="display:flex;gap:16px;margin-top:12px;font-size:11px;color:#888;">
      <span>🟦 柱高 = 相对值（最高那天 = 100%）</span>
      <span>顶部数字 = 实际值</span>
    </div>`;

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <span style="font-size:20px;">📊</span>
        <span style="font-size:16px;font-weight:600;color:#fff;">增强用量统计</span>
        <span style="margin-left:auto;font-size:11px;color:#666;">v4.0 · auto-refresh 60s</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
        ${metricBox('缓存命中率', pct(m.cacheHitRate), m.cacheHitRate > 0.9 ? '#4ade80' : m.cacheHitRate > 0.7 ? '#facc15' : '#f87171')}
        ${metricBox('今日消耗占比', pct(m.todayPercent), m.todayPercent > 0.1 ? '#f87171' : '#60a5fa')}
        ${metricBox('今日 Token', fmt(m.todayTotal), '#c084fc')}
        ${metricBox('今日请求', fmt(m.todayReqs), '#fb923c')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
        ${metricBox('平均每次请求', fmt(Math.round(m.avgTokensPerReq)), '#94a3b8')}
        ${metricBox('本月日均消耗', fmt(Math.round(m.monthDailyAvg || 0)), '#a78bfa')}
        ${metricBox('剩余可用', fmt(m.monthRemaining || 0), (m.monthRemaining || 0) < QUOTA * 0.2 ? '#f87171' : '#4ade80')}
        ${metricBox('预计可用天数', m.daysUntilExhaust + ' 天', (m.daysUntilExhaust || 999) < 3 ? '#f87171' : '#60a5fa')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:4px;">
        ${metricBox('缓存命中 Token', fmt(m.todayHit), '#4ade80')}
        ${metricBox('缓存未命中 Token', fmt(m.todayMiss), '#f87171')}
        ${metricBox('本周累计 Token', fmt(m.weekTotal), '#67e8f9')}
        ${metricBox('本周累计请求', fmt(m.weekReqs), '#fbbf24')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px;">
        <div>
          ${barChart(m.daily, 'totalToken', '📈 每日 Token 消耗', 'M',
            (d, v) => d.date === new Date().toISOString().slice(0,10) ? '#818cf8' : '#6366f1')}
          <div style="font-size:10px;color:#555;margin-top:4px;text-align:center;">柱高 = 相对消耗量，顶部 = 实际值</div>
        </div>
        <div>
          ${barChart(m.daily, 'cacheHitRate', '🎯 每日缓存命中率', '%',
            (d, v) => v > 0.95 ? '#4ade80' : v > 0.9 ? '#86efac' : v > 0.8 ? '#facc15' : '#f87171')}
          <div style="font-size:10px;color:#555;margin-top:4px;text-align:center;">绿色 = 高命中，黄色 = 一般，红色 = 低</div>
        </div>
      </div>
    `;
    return card;
  }

  // ============ 注入 ============
  function findInsertTarget() {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length === 0 && el.textContent.trim() === '使用详情') return el;
    }
    return null;
  }

  function inject(metrics) {
    if (document.getElementById('mimo-enhanced-stats')) return;
    const target = findInsertTarget();
    if (!target) return false;
    target.parentNode.insertBefore(renderCard(metrics), target);
    return true;
  }

  function tryInject() {
    if (!cachedUsage || !cachedList) return;
    const metrics = computeMetrics(cachedUsage, cachedList);
    window.__mimoMetrics = metrics;
    inject(metrics);
  }

  const observer = new MutationObserver(() => {
    if (window.__mimoMetrics && !document.getElementById('mimo-enhanced-stats')) inject(window.__mimoMetrics);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));

  console.log('[MiMo Stats] 🚀 v4.0 启动');
})();
