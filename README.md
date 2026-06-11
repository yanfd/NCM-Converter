# NCM Converter

跨平台 NCM 文件转换器，将网易云音乐加密格式（.ncm）转换为标准 MP3/FLAC 文件。

基于 [Tauri 2](https://tauri.app) 构建，原生跨平台，安装包约 3MB。

## 安装

在右侧 [Releases](https://github.com/yanfd/NCM-Converter/releases) 中下载适合自己系统的版本。

> macOS 用户首次打开如提示"无法验证开发者"，右键点击应用选择"打开"即可。

## 功能

- 拖拽或点击选择 .ncm 文件，支持批量
- 自定义输出目录
- 内置播放器
- 支持 Windows / macOS / Linux

## 开发

```bash
npm install
npm run tauri dev
```

### 前置要求

- Node.js 18+
- Rust 1.77+
- macOS: Xcode Command Line Tools
- Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
- Windows: WebView2 (Windows 10+ 自带)

## 致谢

原始 Python 实现：[ncmdump](https://github.com/lissettecarlr/ncmdump)
