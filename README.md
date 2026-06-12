# 🛠️ Browser Scripts

> 一站式浏览器增强工具箱 —— Tampermonkey 脚本集合，即装即用。

![脚本数量](https://img.shields.io/badge/脚本-1-orange)
![许可证](https://img.shields.io/badge/license-MIT-blue)

---

## 📦 脚本列表

### [MiMo 增强统计面板](./mimo-enhanced-stats/)

在 Xiaomi MiMo 开放平台用量统计页面注入增强面板，一眼看清 Token 消耗。

| 暗色模式 | 亮色模式 |
|---------|---------|
| ![暗色](./mimo-enhanced-stats/static/1.png) | ![亮色](./mimo-enhanced-stats/static/2.png) |

- ✅ 核心指标卡片（今日/本月 Token & Credits）
- ✅ 每日消耗柱状图
- ✅ 暗色/亮色双主题自动切换

[📖 安装说明 →](./mimo-enhanced-stats/README.md)

---

## 🚀 快速开始

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 进入对应脚本目录，点击安装链接或复制 `.user.js` 内容手动创建
3. 打开目标网站，脚本自动生效

## 🤝 贡献新脚本

欢迎提交 PR！每个脚本放在独立目录下，遵循以下结构：

```
your-script-name/
├── your-script-name.user.js   # 油猴脚本（必须）
└── README.md                  # 说明文档 + 截图（必须）
```

> 脚本命名建议：`简短英文名-功能描述.user.js`
