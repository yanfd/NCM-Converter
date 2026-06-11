import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface FileItem {
  path: string;
  name: string;
  status: "pending" | "converting" | "done" | "error";
  error?: string;
  output?: string;
}

interface ConvertResult {
  success: boolean;
  input_file: string;
  output_file: string | null;
  metadata: { music_name: string; album: string; artist: string; format: string } | null;
  error: string | null;
}

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((paths: string[]) => {
    const ncmPaths = paths.filter((p) => p.toLowerCase().endsWith(".ncm"));
    if (ncmPaths.length === 0) return;

    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      const newFiles = ncmPaths
        .filter((p) => !existing.has(p))
        .map((p) => ({
          path: p,
          name: p.split("/").pop() || p.split("\\").pop() || p,
          status: "pending" as const,
        }));
      return [...prev, ...newFiles];
    });
  }, []);

  // Tauri native drag-drop (provides real file paths)
  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragging(true);
      } else if (event.payload.type === "drop") {
        setDragging(false);
        if (event.payload.paths) {
          addFiles(event.payload.paths);
        }
      } else {
        // cancelled
        setDragging(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addFiles]);

  const handleBrowseFiles = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "NCM Files", extensions: ["ncm"] }],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      addFiles(paths);
    }
  }, [addFiles]);

  const handleChooseOutput = useCallback(async () => {
    const dir = await open({ directory: true });
    if (dir) {
      setOutputDir(dir);
    }
  }, []);

  const handleConvert = useCallback(async () => {
    if (files.length === 0 || converting) return;

    setConverting(true);
    setFiles((prev) =>
      prev.map((f) =>
        f.status === "pending" ? { ...f, status: "converting" as const } : f,
      ),
    );

    try {
      const filePaths = files
        .filter((f) => f.status === "pending" || f.status === "converting")
        .map((f) => f.path);
      const results: ConvertResult[] = await invoke("convert_files", {
        files: filePaths,
        outputDir: outputDir,
      });

      setFiles((prev) => {
        const updated = [...prev];
        for (const result of results) {
          const idx = updated.findIndex((f) => f.path === result.input_file);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              status: result.success ? "done" : "error",
              error: result.error || undefined,
              output: result.output_file || undefined,
            };
          }
        }
        return updated;
      });
    } catch (err) {
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "converting"
            ? { ...f, status: "error" as const, error: String(err) }
            : f,
        ),
      );
    } finally {
      setConverting(false);
    }
  }, [files, outputDir, converting]);

  const handleClear = useCallback(() => {
    setFiles([]);
  }, []);

  const handleRemoveFile = useCallback((path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const totalCount = files.length;

  return (
    <div className="app">
      {/* Drop zone */}
      <div className={`dropzone ${dragging ? "dropzone--active" : ""} ${totalCount > 0 ? "dropzone--compact" : ""}`}>
        <div className="dropzone__content">
          <svg
            className="dropzone__icon"
            width={totalCount > 0 ? 24 : 40}
            height={totalCount > 0 ? 24 : 40}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {totalCount === 0 && (
            <span className="dropzone__text">
              {dragging ? "释放以添加文件" : "拖拽 NCM 文件到此处"}
            </span>
          )}
          <button className="btn btn--secondary" onClick={handleBrowseFiles}>
            {totalCount > 0 ? "添加文件" : "或点击选择文件"}
          </button>
        </div>
      </div>

      {/* File list */}
      {totalCount > 0 && (
        <div className="file-list">
          <div className="file-list__header">
            <span className="file-list__count">
              {totalCount} 个文件
              {doneCount > 0 && <span className="text-success"> · {doneCount} 完成</span>}
              {errorCount > 0 && <span className="text-danger"> · {errorCount} 失败</span>}
              {pendingCount > 0 && <span className="text-muted"> · {pendingCount} 待处理</span>}
            </span>
            <button className="btn btn--ghost" onClick={handleClear} disabled={converting}>
              清空
            </button>
          </div>
          <div className="file-list__items">
            {files.map((file) => (
              <div key={file.path} className={`file-item file-item--${file.status}`}>
                <span className="file-item__name" title={file.path}>
                  {file.name}
                </span>
                <span className="file-item__status">
                  {file.status === "pending" && (
                    <button
                      className="btn-icon"
                      onClick={() => handleRemoveFile(file.path)}
                      title="移除"
                    >
                      ×
                    </button>
                  )}
                  {file.status === "converting" && <span className="spinner" />}
                  {file.status === "done" && <span className="text-success">✓</span>}
                  {file.status === "error" && (
                    <span className="text-danger" title={file.error}>
                      ✕
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="bottom-bar">
        <div className="output-dir">
          <button className="btn btn--ghost btn--sm" onClick={handleChooseOutput}>
            输出目录
          </button>
          <span
            className="output-dir__path"
            title={outputDir || "默认：与源文件相同目录"}
          >
            {outputDir || "同目录"}
          </span>
        </div>
        <button
          className="btn btn--primary"
          onClick={handleConvert}
          disabled={pendingCount === 0 || converting}
        >
          {converting ? "转换中..." : `转换${pendingCount > 0 ? ` ${pendingCount}` : ""} 个文件`}
        </button>
      </div>
    </div>
  );
}
