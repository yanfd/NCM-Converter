![](https://image.yanfd.cn/images/2026/06/github-header-banner%20%281%29)

跨平台 NCM 文件转换器，将WYY音乐加密格式（.ncm）转换为标准 MP3/FLAC 文件，保留元数据和封面。

基于 [Tauri 2](https://tauri.app) 构建，原生跨平台，安装包约 3MB。

## 安装

在右侧 [Releases](https://github.com/yanfd/NCM-Converter/releases) 中下载适合自己系统的版本：

| 平台 | 文件 |
|------|------|
| Windows | `NCM Converter_x.x.x_x64-setup.exe` |
| macOS (Apple Silicon) | `NCM Converter_x.x.x_aarch64.dmg` |
| Linux | `.deb` 或 `.AppImage` |

> macOS 用户首次打开如提示"无法验证开发者"，右键点击应用选择"打开"即可。

## 功能

- 拖拽或点击选择 .ncm 文件，支持批量添加
- 转换进度实时显示
- 自定义输出目录
- 内置播放器（播放/暂停、进度条、上下首切换）
- 右键菜单：在文件管理器中显示、删除文件
- 主题切换（General / Light / Frutiger Aero）
- 支持 Windows / macOS / Linux

## 开发

```bash
# 安装依赖
npm install

# 开发模式（前端热重载 + Rust 后端）
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

## 致谢

原始 Python 实现：[ncmdump](https://github.com/lissettecarlr/ncmdump)
