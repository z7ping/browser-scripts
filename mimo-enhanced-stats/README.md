# MiMo 增强用量统计

在 [Xiaomi MiMo 开放平台](https://platform.xiaomimimo.com/console/plan-manage) 用量统计页面注入增强统计面板。

## 功能

- 📊 **核心指标卡片**：缓存命中率、今日消耗占比、今日 Token、今日请求等 12 项指标
- 📈 **每日 Token 消耗柱状图**：可视化每天的 Token 消耗量
- 🎯 **每日缓存命中率柱状图**：颜色按命中率变化（绿→黄→红）
- 🔄 **自动刷新**：每 60 秒自动更新数据

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击 Tampermonkey 图标 → "添加新脚本"
3. 将 `mimo-enhanced-stats.user.js` 内容粘贴进去
4. `Ctrl+S` 保存

## 截图

深色主题面板，嵌入在"使用详情"上方。
