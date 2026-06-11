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
  format?: string;
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

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragging(true);
      } else if (event.payload.type === "drop") {
        setDragging(false);
        if (event.payload.paths) addFiles(event.payload.paths);
      } else {
        setDragging(false);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [addFiles]);

  const handleBrowseFiles = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "NCM Files", extensions: ["ncm"] }],
    });
    if (selected) {
      addFiles(Array.isArray(selected) ? selected : [selected]);
    }
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
    setFiles((prev) =>
      prev.map((f) => f.status === "pending" ? { ...f, status: "converting" as const } : f),
    );

    try {
      const results: ConvertResult[] = await invoke("convert_files", {
        files: pending.map((f) => f.path),
        outputDir: outputDir,
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
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "converting" ? { ...f, status: "error" as const, error: String(err) } : f,
        ),
      );
    } finally {
      setConverting(false);
    }
  }, [files, outputDir, converting]);

  const handleRemoveFile = useCallback((path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const handleClearDone = useCallback(() => {
    setFiles((prev) => prev.filter((f) => f.status !== "done"));
  }, []);

  const pending = files.filter((f) => f.status === "pending" || f.status === "converting");
  const done = files.filter((f) => f.status === "done");
  const errors = files.filter((f) => f.status === "error");

  return (
    <div className={`app ${dragging ? "app--dragging" : ""}`}>
      {/* Left panel: input */}
      <div className="panel panel--left">
        <div className="panel__header">
          <h2 className="panel__title">待转换</h2>
          {pending.length > 0 && (
            <span className="panel__count">{pending.length}</span>
          )}
        </div>

        <div className="panel__body">
          {/* Drop zone */}
          <div className="dropzone" onClick={handleBrowseFiles}>
            <svg className="dropzone__icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="dropzone__text">
              {dragging ? "释放以添加" : "拖拽 NCM 文件到此处"}
            </span>
            <span className="dropzone__hint">或点击选择文件</span>
          </div>

          {/* Pending list */}
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

          {pending.length === 0 && !dragging && files.length === 0 && (
            <div className="empty-hint">
              <span>支持批量拖入 .ncm 文件</span>
            </div>
          )}
        </div>

        <div className="panel__footer">
          <div className="output-dir" onClick={handleChooseOutput}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="output-dir__path" title={outputDir || "默认：与源文件相同目录"}>
              {outputDir || "输出到同目录"}
            </span>
          </div>
          <button
            className="btn btn--primary"
            onClick={handleConvert}
            disabled={pending.length === 0 || converting}
          >
            {converting ? (
              <><span className="spinner spinner--sm" /> 转换中</>
            ) : (
              `转换${pending.length > 0 ? ` ${pending.length}` : ""} 个文件`
            )}
          </button>
        </div>
      </div>

      {/* Right panel: output */}
      <div className="panel panel--right">
        <div className="panel__header">
          <h2 className="panel__title">已完成</h2>
          {done.length > 0 && (
            <span className="panel__count panel__count--success">{done.length}</span>
          )}
          {errors.length > 0 && (
            <span className="panel__count panel__count--error">{errors.length}</span>
          )}
          {done.length > 0 && (
            <button className="btn btn--ghost" onClick={handleClearDone}>清空</button>
          )}
        </div>

        <div className="panel__body">
          {done.length === 0 && errors.length === 0 && (
            <div className="empty-hint">
              <span>转换完成的文件将显示在这里</span>
            </div>
          )}

          {done.map((file) => (
            <div key={file.path} className="file-item file-item--done">
              <div className="file-item__info">
                <span className="file-item__name" title={file.output}>{file.name}</span>
                <span className="file-item__meta">
                  {file.format?.toUpperCase()}
                </span>
              </div>
              <span className="file-item__badge file-item__badge--success">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            </div>
          ))}

          {errors.map((file) => (
            <div key={file.path} className="file-item file-item--error">
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
      </div>
    </div>
  );
}
