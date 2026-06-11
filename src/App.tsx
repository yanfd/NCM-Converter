import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTheme, type Theme } from "./hooks/useTheme";

interface FileItem {
  path: string;
  name: string;
  status: "pending" | "converting" | "done" | "error";
  error?: string;
  output?: string;
  format?: string;
}

interface ConvertResult {
  success: boolean;
  input_file: string;
  output_file: string | null;
  metadata: { music_name: string; album: string; artist: string; format: string } | null;
  error: string | null;
}

interface ContextMenu {
  x: number;
  y: number;
  file: FileItem;
}

interface PlayerState {
  file: FileItem | null;
  playing: boolean;
  currentTime: number;
  duration: number;
}

function getPlatform(): "macos" | "windows" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "linux";
}

function getRevealLabel(): string {
  switch (getPlatform()) {
    case "macos": return "在 Finder 中显示";
    case "windows": return "在资源管理器中显示";
    case "linux": return "在文件管理器中显示";
  }
}

function getOutputName(file: FileItem): string {
  if (!file.output) return file.name;
  const parts = file.output.split(/[\\/]/);
  return parts[parts.length - 1];
}

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [player, setPlayer] = useState<PlayerState>({
    file: null, playing: false, currentTime: 0, duration: 0,
  });
  const { theme, setTheme, labels: themeLabels } = useTheme();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<number>(0);

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => {
      setPlayer((p) => ({ ...p, duration: audio.duration }));
    });
    audio.addEventListener("ended", () => {
      setPlayer((p) => ({ ...p, playing: false }));
      cancelAnimationFrame(animRef.current);
    });
    audio.addEventListener("play", () => {
      const tick = () => {
        setPlayer((p) => ({ ...p, currentTime: audio.currentTime }));
        animRef.current = requestAnimationFrame(tick);
      };
      tick();
    });
    audio.addEventListener("pause", () => {
      cancelAnimationFrame(animRef.current);
    });

    return () => {
      audio.pause();
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const addFiles = useCallback((paths: string[]) => {
    const ncmPaths = paths.filter((p) => p.toLowerCase().endsWith(".ncm"));
    if (ncmPaths.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      return [
        ...prev,
        ...ncmPaths.filter((p) => !existing.has(p)).map((p) => ({
          path: p,
          name: p.split("/").pop() || p.split("\\").pop() || p,
          status: "pending" as const,
        })),
      ];
    });
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "over") setDragging(true);
      else if (event.payload.type === "drop") {
        setDragging(false);
        if (event.payload.paths) addFiles(event.payload.paths);
      } else setDragging(false);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [addFiles]);

  const handleBrowseFiles = useCallback(async () => {
    const selected = await open({ multiple: true, filters: [{ name: "NCM Files", extensions: ["ncm"] }] });
    if (selected) addFiles(Array.isArray(selected) ? selected : [selected]);
  }, [addFiles]);

  const handleChooseOutput = useCallback(async () => {
    const dir = await open({ directory: true });
    if (dir) setOutputDir(dir);
  }, []);

  const handleConvert = useCallback(async () => {
    if (converting) return;
    const pending = files.filter((f) => f.status === "pending");
    if (pending.length === 0) return;

    setConverting(true);
    setFiles((prev) => prev.map((f) => f.status === "pending" ? { ...f, status: "converting" as const } : f));

    try {
      const results: ConvertResult[] = await invoke("convert_files", {
        files: pending.map((f) => f.path),
        outputDir,
      });
      setFiles((prev) => {
        const updated = [...prev];
        for (const r of results) {
          const idx = updated.findIndex((f) => f.path === r.input_file);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              status: r.success ? "done" : "error",
              error: r.error || undefined,
              output: r.output_file || undefined,
              format: r.metadata?.format,
            };
          }
        }
        return updated;
      });
    } catch (err) {
      setFiles((prev) => prev.map((f) =>
        f.status === "converting" ? { ...f, status: "error" as const, error: String(err) } : f,
      ));
    } finally {
      setConverting(false);
    }
  }, [files, outputDir, converting]);

  // --- Context menu actions ---
  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  }, []);

  const handleReveal = useCallback(async (file: FileItem) => {
    if (file.output) {
      try { await invoke("reveal_in_file_manager", { path: file.output }); } catch {}
    }
    setContextMenu(null);
  }, []);

  const handleDeleteFile = useCallback(async (file: FileItem) => {
    if (file.output) {
      try {
        await invoke("delete_file", { path: file.output });
        setFiles((prev) => prev.filter((f) => f.path !== file.path));
      } catch {}
    }
    setContextMenu(null);
  }, []);

  const handleRemoveFromList = useCallback((file: FileItem) => {
    setFiles((prev) => prev.filter((f) => f.path !== file.path));
    if (player.file?.path === file.path) {
      audioRef.current?.pause();
      setPlayer({ file: null, playing: false, currentTime: 0, duration: 0 });
    }
    setContextMenu(null);
  }, [player.file]);

  // --- Player ---
  const playFile = useCallback((file: FileItem) => {
    const audio = audioRef.current;
    if (!audio || !file.output) return;

    if (player.file?.path === file.path) {
      // Toggle play/pause
      if (player.playing) audio.pause();
      else audio.play();
      setPlayer((p) => ({ ...p, playing: !p.playing }));
    } else {
      // New file
      audio.pause();
      const src = convertFileSrc(file.output);
      audio.src = src;
      audio.play();
      setPlayer({ file, playing: true, currentTime: 0, duration: 0 });
    }
  }, [player]);

  const handleSeek = useCallback((e: React.MouseEvent) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !audio.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setPlayer((p) => ({ ...p, currentTime: ratio * audio.duration }));
  }, []);

  const handleSkip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
  }, []);

  const handlePlayPrev = useCallback(() => {
    const doneFiles = files.filter((f) => f.status === "done");
    if (doneFiles.length === 0 || !player.file) return;
    const idx = doneFiles.findIndex((f) => f.path === player.file!.path);
    const prev = idx <= 0 ? doneFiles[doneFiles.length - 1] : doneFiles[idx - 1];
    playFile(prev);
  }, [files, player.file, playFile]);

  const handlePlayNext = useCallback(() => {
    const doneFiles = files.filter((f) => f.status === "done");
    if (doneFiles.length === 0 || !player.file) return;
    const idx = doneFiles.findIndex((f) => f.path === player.file!.path);
    const next = idx >= doneFiles.length - 1 ? doneFiles[0] : doneFiles[idx + 1];
    playFile(next);
  }, [files, player.file, playFile]);

  const handleTogglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!player.file) {
      // Play first done file
      const firstDone = files.find((f) => f.status === "done");
      if (firstDone) playFile(firstDone);
      return;
    }
    if (player.playing) audio.pause();
    else audio.play();
    setPlayer((p) => ({ ...p, playing: !p.playing }));
  }, [player, files, playFile]);

  const handleRemoveFile = useCallback((path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const handleClearDone = useCallback(() => {
    setFiles((prev) => prev.filter((f) => f.status !== "done"));
    if (player.file && player.file.status === "done") {
      audioRef.current?.pause();
      setPlayer({ file: null, playing: false, currentTime: 0, duration: 0 });
    }
  }, [player.file]);

  const pending = files.filter((f) => f.status === "pending" || f.status === "converting");
  const done = files.filter((f) => f.status === "done");
  const errors = files.filter((f) => f.status === "error");

  const formatTime = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progressPct = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  return (
    <div className={`app ${dragging ? "app--dragging" : ""}`}>
      {/* Left panel */}
      <div className="panel panel--left">
        <div className="panel__header">
          <h2 className="panel__title">待转换</h2>
          {pending.length > 0 && <span className="panel__count">{pending.length}</span>}
          <div className="spacer" />
          <select
            className="theme-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            title="切换主题"
          >
            {Object.entries(themeLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div className="panel__body">
          <div className="dropzone" onClick={handleBrowseFiles}>
            <svg className="dropzone__icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="dropzone__text">{dragging ? "释放以添加" : "拖拽 NCM 文件到此处"}</span>
            <span className="dropzone__hint">或点击选择文件</span>
          </div>
          {pending.length > 0 && (
            <div className="file-list">
              {pending.map((file) => (
                <div key={file.path} className="file-item">
                  <div className="file-item__info">
                    <span className="file-item__name" title={file.path}>{file.name}</span>
                  </div>
                  <div className="file-item__actions">
                    {file.status === "converting" && <span className="spinner" />}
                    {file.status === "pending" && (
                      <button className="btn-icon" onClick={() => handleRemoveFile(file.path)} title="移除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {pending.length === 0 && files.length === 0 && (
            <div className="empty-hint"><span>支持批量拖入 .ncm 文件</span></div>
          )}
        </div>
        <div className="panel__footer">
          <div className="output-dir" onClick={handleChooseOutput}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="output-dir__path" title={outputDir || "默认：与源文件相同目录"}>{outputDir || "输出到同目录"}</span>
          </div>
          <button className="btn btn--primary" onClick={handleConvert} disabled={pending.length === 0 || converting}>
            {converting ? <><span className="spinner spinner--sm" /> 转换中</> : `转换${pending.length > 0 ? ` ${pending.length}` : ""} 个文件`}
          </button>
        </div>
      </div>

      {/* Right panel */}
      <div className="panel panel--right">
        <div className="panel__header">
          <h2 className="panel__title">已完成</h2>
          {done.length > 0 && <span className="panel__count panel__count--success">{done.length}</span>}
          {errors.length > 0 && <span className="panel__count panel__count--error">{errors.length}</span>}
          {done.length > 0 && <button className="btn btn--ghost" onClick={handleClearDone}>清空</button>}
        </div>
        <div className="panel__body">
          {done.length === 0 && errors.length === 0 && (
            <div className="empty-hint"><span>转换完成的文件将显示在这里</span></div>
          )}
          {done.map((file) => (
            <div
              key={file.path}
              className={`file-item file-item--done ${player.file?.path === file.path ? "file-item--playing" : ""}`}
              onContextMenu={(e) => handleContextMenu(e, file)}
              onClick={() => playFile(file)}
            >
              <div className="file-item__play-indicator">
                {player.file?.path === file.path && player.playing ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                )}
              </div>
              <div className="file-item__info">
                <span className="file-item__name" title={file.output}>{getOutputName(file)}</span>
                <span className="file-item__meta">{file.format?.toUpperCase()}</span>
              </div>
            </div>
          ))}
          {errors.map((file) => (
            <div key={file.path} className="file-item file-item--error" onContextMenu={(e) => handleContextMenu(e, file)}>
              <div className="file-item__info">
                <span className="file-item__name">{file.name}</span>
                {file.error && <span className="file-item__error">{file.error}</span>}
              </div>
              <span className="file-item__badge file-item__badge--error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
          ))}
        </div>

        {/* Player bar */}
        <div className="player">
          <div className="player__info">
            <span className="player__title">{player.file ? getOutputName(player.file) : "未在播放"}</span>
            {player.file && <span className="player__time">{formatTime(player.currentTime)} / {formatTime(player.duration)}</span>}
          </div>
          <div className="player__progress" ref={progressRef} onClick={handleSeek}>
            <div className="player__progress-bg" />
            <div className="player__progress-fill" style={{ width: `${progressPct}%` }} />
            <div className="player__progress-thumb" style={{ left: `${progressPct}%` }} />
          </div>
          <div className="player__controls">
            <button className="player__btn" onClick={handlePlayPrev} title="上一首">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="19,20 9,12 19,4"/><rect x="5" y="4" width="2" height="16"/></svg>
            </button>
            <button className="player__btn" onClick={() => handleSkip(-5)} title="后退5秒">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><text x="12" y="16" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none" fontWeight="600">5</text></svg>
            </button>
            <button className="player__btn player__btn--main" onClick={handleTogglePlay} title={player.playing ? "暂停" : "播放"}>
              {player.playing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              )}
            </button>
            <button className="player__btn" onClick={() => handleSkip(5)} title="快进5秒">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/><text x="12" y="16" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none" fontWeight="600">5</text></svg>
            </button>
            <button className="player__btn" onClick={handlePlayNext} title="下一首">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,4 15,12 5,20"/><rect x="17" y="4" width="2" height="16"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="ctx-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          {contextMenu.file.output && (
            <button className="ctx-menu__item" onClick={() => playFile(contextMenu.file)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              播放
            </button>
          )}
          {contextMenu.file.output && (
            <button className="ctx-menu__item" onClick={() => handleReveal(contextMenu.file)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              {getRevealLabel()}
            </button>
          )}
          <div className="ctx-menu__sep" />
          {contextMenu.file.output && (
            <button className="ctx-menu__item ctx-menu__item--danger" onClick={() => handleDeleteFile(contextMenu.file)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              删除文件
            </button>
          )}
          <button className="ctx-menu__item" onClick={() => handleRemoveFromList(contextMenu.file)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            从列表移除
          </button>
        </div>
      )}
    </div>
  );
}
