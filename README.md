# NCM Converter

跨平台 NCM 文件转换器，将网易云音乐加密格式（.ncm）转换为标准 FLAC/MP3 文件。

基于 [Tauri 2](https://tauri.app) 构建，体积小（~3MB），原生跨平台。

## 功能

- 拖拽或选择 .ncm 文件
- 批量转换，实时显示进度
- 自定义输出目录
- 保留元数据（标题、艺术家、专辑）和封面图片
- 支持 Windows / macOS / Linux

## 开发

```bash
# 安装依赖
npm install

# 开发模式（前端热重载 + Rust后端）
npm run tauri dev

# 构建发布包
npm run tauri build
```

### 前置要求

- Node.js 18+
- Rust 1.77+
- macOS: Xcode Command Line Tools
- Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
- Windows: WebView2 (Windows 10+ 自带)

## 发布

Push 一个 tag 即可触发 GitHub Actions 自动构建三个平台的安装包：

```bash
git tag v1.0.0
git push origin v1.0.0
```

Actions 会创建一个 draft release，包含：
- macOS: `.dmg` + `.app`
- Windows: `.msi` + `.exe`
- Linux: `.deb` + `.AppImage`

## 架构

```
├── src/                    # React 前端
│   ├── App.tsx             # 主界面（拖拽、文件列表、进度）
│   ├── main.tsx            # 入口
│   └── styles/global.css   # 样式
├── src-tauri/              # Rust 后端
│   ├── src/ncmdump.rs      # NCM 解密核心逻辑
│   ├── src/lib.rs          # Tauri 命令定义
│   └── tauri.conf.json     # Tauri 配置
└── .github/workflows/      # CI/CD
```

## 致谢

原始 Python 实现：[ncmdump](https://github.com/anonymous5l/ncmdump)
