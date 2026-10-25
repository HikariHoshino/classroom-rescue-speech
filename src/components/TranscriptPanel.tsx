// 转写面板（唯一责任人：4号）
// 展示正式转写片段与时间戳；自动跟随最新文字，用户上翻时暂停自动滚动（4号实现）。
import { useEffect, useRef } from "react";
import type { Segment } from "../../shared/types";
import { formatMs } from "./TopBar";

export interface TranscriptPanelProps {
  /** 正式转写片段（唯一数据来源：App.tsx），已按 startMs 排序 */
  segments: Segment[];
  /** 需要高亮定位的片段 id（考点雷达点击定位时设置） */
  highlightSegmentId: string | null;
  /** 课堂状态（用于空态文案区分） */
  status: string;
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // 自动跟随最新文字；用户上翻阅读时暂停
  useEffect(() => {
    const el = listRef.current;
    if (!el || userScrolledUp.current) return;
    el.scrollTop = el.scrollHeight;
  }, [props.segments]);

  // 定位高亮原文
  useEffect(() => {
    if (!props.highlightSegmentId) return;
    const el = document.getElementById(`seg-${props.highlightSegmentId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [props.highlightSegmentId]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledUp.current = !nearBottom;
  };

  return (
    <section className="panel transcript-panel">
      <h2>课堂转写</h2>
      <div className="transcript-list" ref={listRef} onScroll={handleScroll}>
        {props.segments.length === 0 ? (
          <p className="empty">暂无转写内容，点击“开始记录”后逐段显示。</p>
        ) : (
          props.segments.map((seg) => (
            <p
              key={seg.id}
              id={`seg-${seg.id}`}
              className={
                seg.id === props.highlightSegmentId
                  ? "segment segment-highlight"
                  : "segment"
              }
            >
              <span className="segment-time">[{formatMs(seg.startMs)}]</span>
              <span>{seg.text}</span>
            </p>
          ))
        )}
      </div>
    </section>
  );
}
