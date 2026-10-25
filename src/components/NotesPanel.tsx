// 课后笔记面板（唯一责任人：4号；设计移植自 ljx 分支，props 由 1号固定）
// 停止后生成；复制与下载在组件内部实现，文件名 classroom-notes-日期时间.md。
import { useRef, useState } from "react";
import { formatMs } from "./TopBar";
import { Icon } from "./Icon";

export interface NotesPanelProps {
  canGenerate: boolean;
  loading: boolean;
  markdown: string | null;
  resultMode: "ai" | "extract" | null;
  /** 记录截止时间（毫秒），随结果展示 */
  recordedAtMs: number | null;
  error: string | null;
  onGenerate: () => void;
  onRetry: () => void;
}

function downloadMarkdown(markdown: string): void {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `classroom-notes-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function NotesPanel(props: NotesPanelProps) {
  const [feedback, setFeedback] = useState("");
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = (message: string) => {
    setFeedback(message);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(""), 4000);
  };

  const handleCopy = async () => {
    if (!props.markdown) return;
    try {
      await navigator.clipboard.writeText(props.markdown);
      announce("笔记已复制，可以粘贴到你的文档。");
    } catch {
      // 复制失败时仍可下载或手动选中文本
      announce("复制未成功，请使用下载 Markdown 保存笔记。");
    }
  };

  return (
    <section className="panel notes-panel">
      <div className="panel-heading">
        <div className="heading-label">
          <Icon name="book" />
          <h2>课后笔记</h2>
        </div>
      </div>

      {!props.markdown && !props.loading && !props.error && (
        <div className="notes-idle">
          <p className="muted">
            结束课堂后，把这节课整理成可以带走的笔记。
          </p>
          <button
            className="button dark"
            disabled={!props.canGenerate}
            onClick={props.onGenerate}
          >
            <Icon name="spark" size={16} />
            生成课后笔记
          </button>
        </div>
      )}

      {props.loading && (
        <div className="request-loading" role="status">
          <span className="spinner" />
          <h3>正在整理这节课的笔记……</h3>
          <p>从已有的课堂记录里，留住重要的部分。</p>
        </div>
      )}

      {props.error && !props.loading && (
        <div className="request-error" role="alert">
          <Icon name="info" size={25} />
          <h3>笔记还差一步</h3>
          <p>{props.error}</p>
          <button className="button red" onClick={props.onRetry}>
            重新生成笔记
          </button>
        </div>
      )}

      {props.markdown && !props.loading && (
        <>
          <div className="notes-toolbar">
            <span className="example-badge">
              {props.resultMode === "extract" ? "原文整理（未使用 AI）" : "AI 生成"}
            </span>
            {props.recordedAtMs !== null && (
              <span className="notes-source">
                记录截止 {formatMs(props.recordedAtMs)}
              </span>
            )}
            <div className="notes-tools">
              <button className="button" onClick={() => void handleCopy()}>
                <Icon name="copy" size={16} />
                复制笔记
              </button>
              <button
                className="button dark"
                onClick={() => downloadMarkdown(props.markdown!)}
              >
                <Icon name="download" size={16} />
                下载 Markdown
              </button>
            </div>
          </div>
          <article className="panel notes-paper">
            <pre className="notes-body">{props.markdown}</pre>
            <div className="notes-paper-foot">
              <Icon name="check" size={16} />
              这一节，先记到这里。
            </div>
          </article>
          <p className="notes-save-hint">
            离开或刷新页面前，记得复制或下载需要保留的笔记。
          </p>
        </>
      )}
      <div className="copy-feedback" role="status" aria-live="polite">
        {feedback}
      </div>
    </section>
  );
}
