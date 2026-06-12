// ==UserScript==
// @name         MiMo 平台用量增强统计
// @namespace    http://tampermonkey.net/
// @version      6.5
// @description  在 xiaomimimo 用量统计页面增加 Token/Credits 消耗、费用、缓存命中率等指标
// @author       Hermes
// @match        https://platform.xiaomimimo.com/console/plan-manage*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ============ 配置 ============
  const MODEL_RATES = {
    'mimo-v2.5':     { hit: 2,   miss: 100, output: 200 },
    'mimo-v2.5-pro': { hit: 2.5, miss: 300, output: 600 },
    'mimo-v2-pro':   { hit: 140, miss: 700, output: 2100 },
    'mimo-v2-omni':  { hit: 56,  miss: 280, output: 1400 },
  };
  const CREDITS_PER_YUAN = 100_000_000;
  const MODEL_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];

  // ============ 主题 ============
  let isDark = true;
  function theme() {
    return isDark ? {
      // 暗色 = v5.3 原版配色
      bg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      cardBg: 'rgba(255,255,255,0.04)',
      cardBorder: 'rgba(255,255,255,0.06)',
      modelBg: 'rgba(255,255,255,0.03)',
      modelBorder: 'rgba(255,255,255,0.06)',
      text: '#e0e0e0',
      textDim: '#888',
      textFaint: '#666',
      titleColor: '#fff',
      shadow: '0 4px 20px rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.08)',
      barText: '#aaa',
      barDate: '#666',
      chartBorder: 'rgba(255,255,255,0.08)',
    } : {
      // 亮色
      bg: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
      cardBg: 'rgba(0,0,0,0.06)',
      cardBorder: 'rgba(0,0,0,0.08)',
      modelBg: 'rgba(0,0,0,0.04)',
      modelBorder: 'rgba(0,0,0,0.1)',
      text: '#1e293b',
      textDim: '#475569',
      textFaint: '#94a3b8',
      titleColor: '#0f172a',
      shadow: '0 4px 20px rgba(0,0,0,0.1)',
      border: '1px solid rgba(0,0,0,0.1)',
      barText: '#334155',
      barDate: '#94a3b8',
      chartBorder: 'rgba(0,0,0,0.1)',
    };
  }

  function fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
  }
  function pct(v) { return (v * 100).toFixed(1) + '%'; }
  function pct2(v) { return (v * 100).toFixed(2) + '%'; }
  function yuan(v) { return '¥' + v.toFixed(2); }

  function calcCredits(model, hit, miss, output) {
    const r = MODEL_RATES[model] || MODEL_RATES['mimo-v2.5'];
    return hit * r.hit + miss * r.miss + output * r.output;
  }

  let cachedUsage = null;
  let cachedList = null;
  let refreshInterval = 300000; // 5分钟
  let refreshTimer = null;

  // ============ 真实数据刷新 ============
  const API_BASE = 'https://platform.xiaomimimo.com';

  function getApiPh() {
    // 从 cookie 中提取 api-platform_ph
    const match = document.cookie.match(/api-platform_ph=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function fetchData() {
    const ph = getApiPh();
    if (!ph) { console.warn('[MiMo Stats] 未找到 api-platform_ph'); return; }
    const now = new Date();
    const body = JSON.stringify({ year: now.getFullYear(), month: now.getMonth() + 1 });
    try {
      const [usageRes, listRes] = await Promise.all([
        origFetch(API_BASE + '/api/v1/tokenPlan/usage', { credentials: 'include' }),
        origFetch(API_BASE + '/api/v1/usage/token-plan/list?api-platform_ph=' + encodeURIComponent(ph), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          credentials: 'include',
        }),
      ]);
      const usageJson = await usageRes.json();
      const listJson = await listRes.json();
      if (usageJson.code === 0) cachedUsage = usageJson.data;
      if (listJson.code === 0) cachedList = listJson.data;
    } catch (e) {
      console.warn('[MiMo Stats] fetchData error:', e);
    }
  }

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
    const monthItem = usageData?.monthUsage?.items?.[0];
    m.planLimit = planItem?.limit || monthItem?.limit || 0;
    m.planUsed = monthItem?.used || 0;
    m.planRemaining = m.planLimit - m.planUsed;

    const modelMap = {};
    for (const d of listData) {
      if (!modelMap[d.model]) modelMap[d.model] = { hit: 0, miss: 0, output: 0, total: 0, reqs: 0 };
      const m2 = modelMap[d.model];
      m2.hit += d.inputHitToken;
      m2.miss += d.inputMissToken;
      m2.output += d.outputToken;
      m2.total += d.totalToken;
      m2.reqs += d.requestCount;
    }

    m.models = Object.entries(modelMap)
      .map(([name, data]) => ({
        name, ...data,
        credits: calcCredits(name, data.hit, data.miss, data.output),
        hitRate: (data.hit + data.miss) > 0 ? data.hit / (data.hit + data.miss) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const today = new Date().toISOString().slice(0, 10);
    const todayItems = listData.filter(d => d.date === today);
    m.todayTotal = todayItems.reduce((s, d) => s + d.totalToken, 0);
    m.todayHit = todayItems.reduce((s, d) => s + d.inputHitToken, 0);
    m.todayMiss = todayItems.reduce((s, d) => s + d.inputMissToken, 0);
    m.todayOutput = todayItems.reduce((s, d) => s + d.outputToken, 0);
    m.todayReqs = todayItems.reduce((s, d) => s + d.requestCount, 0);
    m.todayCredits = todayItems.reduce((s, d) => s + calcCredits(d.model, d.inputHitToken, d.inputMissToken, d.outputToken), 0);
    m.todayHitRate = (m.todayHit + m.todayMiss) > 0 ? m.todayHit / (m.todayHit + m.todayMiss) : 0;
    m.todayYuan = m.todayCredits / CREDITS_PER_YUAN;
    m.todayPercent = m.planLimit > 0 ? m.todayCredits / m.planLimit : null;

    m.monthCredits = m.models.reduce((s, d) => s + d.credits, 0);
    m.monthYuan = m.monthCredits / CREDITS_PER_YUAN;
    m.monthRemainingYuan = m.planRemaining / CREDITS_PER_YUAN;

    const dailyMap = {};
    for (const d of listData) {
      if (!dailyMap[d.date]) dailyMap[d.date] = {};
      const dm = dailyMap[d.date];
      if (!dm[d.model]) dm[d.model] = { hit: 0, miss: 0, output: 0, total: 0, reqs: 0 };
      dm[d.model].hit += d.inputHitToken;
      dm[d.model].miss += d.inputMissToken;
      dm[d.model].output += d.outputToken;
      dm[d.model].total += d.totalToken;
      dm[d.model].reqs += d.requestCount;
    }

    m.daily = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, models]) => {
        const dayTotal = Object.values(models).reduce((s, v) => s + v.total, 0);
        const dayCredits = Object.entries(models).reduce((s, [name, v]) => s + calcCredits(name, v.hit, v.miss, v.output), 0);
        const dayHit = Object.values(models).reduce((s, v) => s + v.hit, 0);
        const dayMiss = Object.values(models).reduce((s, v) => s + v.miss, 0);
        return {
          date, models,
          total: dayTotal,
          credits: dayCredits,
          yuan: dayCredits / CREDITS_PER_YUAN,
          percent: m.planLimit > 0 ? dayCredits / m.planLimit : 0,
          hitRate: (dayHit + dayMiss) > 0 ? dayHit / (dayHit + dayMiss) : 0,
        };
      });

    const currentDay = new Date().getUTCDate();
    const avgDailyCredits = m.monthCredits / Math.max(currentDay, 1);
    m.daysUntilExhaust = avgDailyCredits > 0 ? Math.floor(m.planRemaining / avgDailyCredits) : 999;

    return m;
  }

  // ============ 渲染 ============
  function metricBox(label, value, color, sub) {
    const t = theme();
    return `<div style="background:${t.cardBg};border-radius:8px;padding:14px;text-align:center;border:1px solid ${t.cardBorder};">
      <div style="font-size:12px;color:${t.textDim};margin-bottom:6px;">${label}</div>
      <div style="font-size:20px;font-weight:700;color:${color};">${value}</div>
      ${sub ? `<div style="font-size:11px;color:${t.textFaint};margin-top:4px;">${sub}</div>` : ''}
    </div>`;
  }

  function stackedBarChart(daily, label) {
    if (!daily || daily.length === 0) return '';
    const t = theme();
    const modelNames = [...new Set(daily.flatMap(d => Object.keys(d.models)))];
    const maxVal = Math.max(...daily.map(d => d.total));
    if (maxVal === 0) return '';

    const MAX_BAR_H = 110;
    const bars = daily.map(d => {
      const colorMap = {};
      modelNames.forEach((n, i) => { colorMap[n] = MODEL_COLORS[i % MODEL_COLORS.length]; });
      let segs = '';
      for (const name of modelNames) {
        const v = d.models[name]?.total || 0;
        const segH = maxVal > 0 ? (v / maxVal) * MAX_BAR_H : 0;
        if (segH > 0) segs = `<div style="width:100%;max-width:48px;height:${Math.round(segH)}px;background:${colorMap[name]};"></div>` + segs;
      }
      const dateShort = d.date.slice(5);
      return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;">
        <div style="font-size:10px;color:${t.barText};margin-bottom:4px;white-space:nowrap;">${fmt(d.total)}</div>
        <div style="display:flex;flex-direction:column-reverse;width:100%;max-width:48px;">${segs}</div>
        <div style="font-size:10px;color:${t.barDate};margin-top:4px;white-space:nowrap;">${dateShort}</div>
      </div>`;
    }).join('');

    const legend = modelNames.map((n, i) => `<span style="display:flex;align-items:center;gap:4px;font-size:10px;color:${t.textDim};"><span style="width:8px;height:8px;border-radius:2px;background:${MODEL_COLORS[i % MODEL_COLORS.length]};display:inline-block;"></span>${n}</span>`).join('');

    const minW = daily.length * 52;
    return `
      <div style="margin-top:16px;">
        <div style="font-size:14px;font-weight:600;color:${t.text};margin-bottom:6px;">${label}</div>
        <div style="display:flex;gap:12px;margin-bottom:8px;">${legend}</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:150px;padding:0 4px;min-width:${minW}px;">${bars}</div>
      </div>`;
  }

  function simpleBarChart(daily, key, label, colorFn, displayFn) {
    if (!daily || daily.length === 0) return '';
    const t = theme();
    const maxVal = Math.max(...daily.map(d => d[key]));
    if (maxVal === 0) return '';

    const MAX_BAR_H = 110;
    const bars = daily.map(d => {
      const val = d[key];
      const h = maxVal > 0 ? (val / maxVal) * MAX_BAR_H : 0;
      const color = colorFn(d, val);
      const display = displayFn ? displayFn(val) : (key === 'hitRate' ? pct(val) : key === 'yuan' ? '¥' + val.toFixed(2) : fmt(val));
      const dateShort = d.date.slice(5);
      return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;">
        <div style="font-size:10px;color:${t.barText};margin-bottom:4px;white-space:nowrap;">${display}</div>
        <div style="width:100%;max-width:48px;height:${Math.round(Math.max(h, 3))}px;background:${color};border-radius:4px 4px 0 0;"></div>
        <div style="font-size:10px;color:${t.barDate};margin-top:4px;white-space:nowrap;">${dateShort}</div>
      </div>`;
    }).join('');

    const minW = daily.length * 52;
    return `
      <div style="margin-top:16px;">
        <div style="font-size:13px;font-weight:600;color:${t.textDim};margin-bottom:10px;">${label}</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:160px;padding:0 4px;min-width:${minW}px;">
          ${bars}
        </div>
      </div>`;
  }

  function renderCard(m) {
    const t = theme();
    const card = document.createElement('div');
    card.id = 'mimo-enhanced-stats';
    card.style.cssText = `background:${t.bg};border-radius:12px;padding:20px 24px;margin:16px 0;color:${t.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-shadow:${t.shadow};${t.border}`;

    // 模型明细卡片
    const modelCards = m.models.map((d, i) => {
      const color = MODEL_COLORS[i % MODEL_COLORS.length];
      const totalPct = m.planLimit > 0 ? (d.credits / m.planLimit * 100).toFixed(1) + '%' : '0%';
      return `
        <div style="background:${t.modelBg};border-radius:12px;padding:16px 18px;border:1px solid ${t.modelBorder};">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${color};"></span>
            <span style="font-size:15px;font-weight:600;color:${t.titleColor};">${d.name}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;font-size:13px;line-height:1.6;">
            <div><span style="color:${t.textDim};">输入命中：</span><span style="color:#4ade80;">${fmt(d.hit)}</span></div>
            <div><span style="color:${t.textDim};">输入未命中：</span><span style="color:#f87171;">${fmt(d.miss)}</span></div>
            <div><span style="color:${t.textDim};">输出：</span><span style="color:#60a5fa;">${fmt(d.output)}</span></div>
            <div><span style="color:${t.textDim};">缓存命中率：</span><span style="color:${d.hitRate > 0.9 ? '#4ade80' : '#facc15'};">${pct(d.hitRate)}</span></div>
            <div><span style="color:${t.textDim};">Token 合计：</span><span style="color:${t.titleColor};font-weight:600;">${fmt(d.total)}</span></div>
            <div><span style="color:${t.textDim};">费用：</span><span style="color:#fbbf24;">${yuan(d.credits / CREDITS_PER_YUAN)}</span></div>
            <div><span style="color:${t.textDim};">请求次数：</span><span style="color:${t.text};">${fmt(d.reqs)}</span></div>
            <div><span style="color:${t.textDim};">占比：</span><span style="color:${color};font-weight:600;">${totalPct}</span></div>
          </div>
          <div style="margin-top:10px;background:rgba(128,128,128,0.15);border-radius:4px;height:6px;overflow:hidden;">
            <div style="width:${totalPct};height:100%;background:${color};border-radius:4px;"></div>
          </div>
        </div>`;
    }).join('');

    // 刷新间隔选项
    const intervals = [
      { label: '1分钟', ms: 60000 },
      { label: '5分钟', ms: 300000 },
      { label: '10分钟', ms: 600000 },
      { label: '30分钟', ms: 1800000 },
    ];
    const intervalBtns = intervals.map(iv =>
      `<span data-ms="${iv.ms}" style="cursor:pointer;padding:2px 8px;border-radius:4px;font-size:11px;background:${refreshInterval === iv.ms ? (isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.15)') : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')};color:${refreshInterval === iv.ms ? '#818cf8' : t.textDim};border:1px solid ${refreshInterval === iv.ms ? 'rgba(99,102,241,0.4)' : 'transparent'};">${iv.label}</span>`
    ).join(' ');

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <span style="font-size:20px;">📊</span>
        <span style="font-size:16px;font-weight:600;color:${t.titleColor};">增强用量统计</span>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          <span id="mimo-refresh-interval" style="display:flex;align-items:center;gap:4px;">${intervalBtns}</span>
          <span id="mimo-refresh-time" style="font-size:10px;color:${t.textFaint};"></span>
          <span id="mimo-refresh-btn" style="cursor:pointer;padding:3px 10px;border-radius:4px;font-size:11px;background:${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.1)'};color:#818cf8;border:1px solid ${isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)'};">🔄 刷新</span>
          <span id="mimo-theme-btn" style="cursor:pointer;padding:3px 10px;border-radius:4px;font-size:11px;background:${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'};color:${t.textDim};border:1px solid ${t.cardBorder};">${isDark ? '☀️ 亮色' : '🌙 暗色'}</span>
        </div>
      </div>

      <!-- 核心指标 -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;">
        ${metricBox('今日 Token', fmt(m.todayTotal), '#c084fc', fmt(m.todayCredits) + ' Credits (' + yuan(m.todayYuan) + ')')}
        ${metricBox('今日占套餐', m.todayPercent != null ? pct(m.todayPercent) : '-', '#c084fc')}
        ${metricBox('今日缓存命中率', pct(m.todayHitRate), m.todayHitRate > 0.9 ? '#4ade80' : '#facc15')}
        ${metricBox('今日费用', yuan(m.todayYuan), '#fbbf24')}
        ${metricBox('今日请求', fmt(m.todayReqs), '#fb923c')}
      </div>

      <!-- 本月汇总 -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
        ${metricBox('本月 Token', fmt(m.models.reduce((s, d) => s + d.total, 0)), '#a78bfa', fmt(m.monthCredits) + ' Credits (' + yuan(m.monthYuan) + ')')}
        ${metricBox('本月费用', yuan(m.monthYuan), '#fbbf24')}
        ${metricBox('剩余可用', yuan(m.monthRemainingYuan), m.monthRemainingYuan < 10 ? '#f87171' : '#4ade80')}
        ${metricBox('预计可用天数', m.daysUntilExhaust + ' 天', (m.daysUntilExhaust || 999) < 3 ? '#f87171' : '#60a5fa')}
      </div>

      <!-- 模型明细 -->
      <div style="font-size:14px;font-weight:600;color:${t.text};margin-bottom:12px;">📦 模型消耗明细</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-bottom:20px;">
        ${modelCards}
      </div>

      <!-- 柱状图 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px;">
        <div style="overflow-x:auto;">
          ${stackedBarChart(m.daily, '📈 每日 Token 消耗（按模型）')}
        </div>
        <div style="overflow-x:auto;">
          ${simpleBarChart(m.daily, 'percent', '📊 每日占套餐',
            (d, v) => v > 0.1 ? '#f87171' : v > 0.05 ? '#facc15' : '#60a5fa',
            v => pct2(v))}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px;">
        <div style="overflow-x:auto;">
          ${simpleBarChart(m.daily, 'yuan', '💰 每日费用',
            (d, v) => d.date === new Date().toISOString().slice(0,10) ? '#fbbf24' : '#d97706',
            v => '¥' + v.toFixed(2))}
        </div>
        <div style="overflow-x:auto;">
          ${simpleBarChart(m.daily, 'hitRate', '🎯 每日缓存命中率',
            (d, v) => v > 0.95 ? '#4ade80' : v > 0.9 ? '#86efac' : v > 0.8 ? '#facc15' : '#f87171',
            v => pct(v))}
        </div>
      </div>
    `;
    return card;
  }

  // ============ 刷新控制 ============
  function setupRefreshControls() {
    const intervalEl = document.getElementById('mimo-refresh-interval');
    const refreshBtn = document.getElementById('mimo-refresh-btn');
    const themeBtn = document.getElementById('mimo-theme-btn');

    if (intervalEl) {
      intervalEl.querySelectorAll('[data-ms]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          refreshInterval = parseInt(btn.dataset.ms);
          startAutoRefresh();
          // 视觉反馈：选中按钮闪一下
          btn.style.transform = 'scale(1.1)';
          btn.style.transition = 'transform 0.15s';
          setTimeout(() => { btn.style.transform = ''; }, 150);
          doRefresh();
        });
      });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 视觉反馈：按钮变色
        refreshBtn.textContent = '⏳ 刷新中...';
        refreshBtn.style.background = 'rgba(99,102,241,0.4)';
        setTimeout(() => {
          doRefresh();
          // 刷新完恢复
          const btn = document.getElementById('mimo-refresh-btn');
          const timeEl = document.getElementById('mimo-refresh-time');
          if (btn) {
            btn.textContent = '✅ 已刷新';
            btn.style.background = 'rgba(34,197,94,0.2)';
            if (timeEl) timeEl.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
            setTimeout(() => {
              btn.textContent = '🔄 刷新';
              btn.style.background = '';
            }, 1500);
          }
        }, 300);
      });
    }
    if (themeBtn) {
      themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isDark = !isDark;
        doRefresh();
      });
    }
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => doRefresh(), refreshInterval);
  }

  async function doRefresh() {
    const old = document.getElementById('mimo-enhanced-stats');
    if (old) old.remove();
    // 先拉最新数据
    await fetchData();
    if (cachedUsage && cachedList) {
      const metrics = computeMetrics(cachedUsage, cachedList);
      window.__mimoMetrics = metrics;
      inject(metrics);
      setupRefreshControls();
      // 更新刷新时间
      const timeEl = document.getElementById('mimo-refresh-time');
      if (timeEl) timeEl.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }
  }

  // ============ 注入 ============
  function findInsertTarget() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() === '使用详情') {
        return walker.currentNode.parentElement;
      }
    }
    for (const el of document.querySelectorAll('*')) {
      if (el.textContent?.trim()?.startsWith('使用详情') && el.children.length === 0) {
        return el.closest('[class*="card"], [class*="panel"], [class*="section"], [class*="tab"]') || el.parentElement;
      }
    }
    const main = document.querySelector('main, [class*="content"], [class*="main"]');
    if (main) return main;
    const firstDiv = document.querySelector('body > div');
    if (firstDiv) return firstDiv;
    return null;
  }

  function inject(metrics) {
    if (document.getElementById('mimo-enhanced-stats')) return true;
    const target = findInsertTarget();
    if (target) {
      const card = renderCard(metrics);
      if (target.parentElement) {
        target.parentElement.insertBefore(card, target);
      } else {
        target.prepend(card);
      }
      return true;
    }
    document.body.prepend(renderCard(metrics));
    return true;
  }

  function tryInject() {
    if (!cachedUsage || !cachedList) return;
    const metrics = computeMetrics(cachedUsage, cachedList);
    window.__mimoMetrics = metrics;
    inject(metrics);
    setupRefreshControls();
    startAutoRefresh();
    // 首次显示刷新时间
    const timeEl = document.getElementById('mimo-refresh-time');
    if (timeEl) timeEl.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  const observer = new MutationObserver(() => {
    if (window.__mimoMetrics && !document.getElementById('mimo-enhanced-stats')) {
      inject(window.__mimoMetrics);
      setupRefreshControls();
    }
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));

  console.log('[MiMo Stats] v6.5 启动');
})();
