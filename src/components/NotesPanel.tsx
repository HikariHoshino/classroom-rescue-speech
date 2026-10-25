// 课后笔记面板（唯一责任人：4号）
// 停止后生成；复制与下载由 4号在组件内部实现。
import { useState } from "react";
import { formatMs } from "./TopBar";

export interface NotesPanelProps {
  /** 是否可生成（停止完成且有文本；无文本时禁用） */
  canGenerate: boolean;
  /** 独立加载状态：请求中禁止重复点击 */
  loading: boolean;
  /** 生成的 Markdown 正文（null 表示尚未生成） */
  markdown: string | null;
  /** "ai" | "extract"，extract 时必须明确显示“原文整理” */
  resultMode: "ai" | "extract" | null;
  /** 记录截止时间（毫秒），随结果展示 */
  recordedAtMs: number | null;
  /** 错误提示（可重试） */
  error: string | null;
  onGenerate: () => void;
  onRetry: () => void;
}

function downloadMarkdown(markdown: string): void {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `classroom-notes-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function NotesPanel(props: NotesPanelProps) {
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = async () => {
    if (!props.markdown) return;
    try {
      await navigator.clipboard.writeText(props.markdown);
      setCopyFailed(false);
    } catch {
      // 复制失败时仍可下载或手动选中文本
      setCopyFailed(true);
    }
  };

  return (
    <section className="panel notes-panel">
      <h2>课后笔记</h2>
      <button onClick={props.onGenerate} disabled={!props.canGenerate || props.loading}>
        {props.loading ? "正在整理…" : "生成笔记"}
      </button>
      {props.error && (
        <div className="notes-error">
          <p>{props.error}</p>
          <button onClick={props.onRetry}>重试</button>
        </div>
      )}
      {props.markdown && (
        <div className="notes-result">
          <p className="notes-meta">
            {props.resultMode === "extract" ? "原文整理（未使用 AI）" : "AI 生成"}
            {props.recordedAtMs !== null &&
              ` · 记录截止 ${formatMs(props.recordedAtMs)}`}
          </p>
          <div className="notes-actions">
            <button onClick={handleCopy}>复制</button>
            <button onClick={() => downloadMarkdown(props.markdown!)}>
              下载 .md
            </button>
            {copyFailed && (
              <span className="copy-failed">复制失败，可下载或手动选中文本</span>
            )}
          </div>
          <pre className="notes-body">{props.markdown}</pre>
        </div>
      )}
    </section>
  );
}
