// 转写面板（唯一责任人：4号；设计移植自 ljx 分支，props 由 1号固定）
// 展示正式转写片段与时间戳；自动跟随最新文字，用户上翻阅读时暂停自动滚动。
import { useEffect, useRef, useState } from "react";
import type { Segment, SpeechStatus } from "../../shared/types";
import { formatMs } from "./TopBar";
import { Icon } from "./Icon";

export interface TranscriptPanelProps {
  /** 正式转写片段（唯一数据来源：App.tsx），已按 startMs 排序 */
  segments: Segment[];
  /** 需要高亮定位的片段 id（考点雷达点击定位时设置） */
  highlightSegmentId: string | null;
  status: SpeechStatus;
  /** 空态中的“开始听课”按钮回调 */
  onStart?: () => void;
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [isFollowing, setIsFollowing] = useState(true);

  // 自动跟随最新文字；用户上翻阅读时暂停
  useEffect(() => {
    if (following.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [props.segments]);

  // 考点定位：滚动到原文并短暂高亮
  useEffect(() => {
    if (!props.highlightSegmentId) return;
    const node = scrollRef.current?.querySelector<HTMLElement>(
      `[data-segment-id="${props.highlightSegmentId}"]`,
    );
    if (!node) return;
    following.current = false;
    setIsFollowing(false);
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [props.highlightSegmentId]);

  const backToLatest = () => {
    following.current = true;
    setIsFollowing(true);
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

  const statusText =
    props.status === "recording"
      ? "正在接收"
      : props.status === "stopped"
        ? "记录已保存"
        : "等待开始";

  return (
    <section className="panel transcript-panel">
      <div className="panel-heading">
        <div className="heading-label">
          <Icon name="text" />
          <h2>课堂实时转写</h2>
          <span className="count-badge">{props.segments.length} 段</span>
        </div>
        <span className="live-label">
          <span
            className={props.status === "recording" ? "live-dot" : "muted-dot"}
          />
          {statusText}
        </span>
      </div>
      <div
        className="transcript-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          const near =
            node.scrollHeight - node.scrollTop - node.clientHeight < 55;
          following.current = near;
          setIsFollowing(near);
        }}
      >
        {props.segments.length === 0 ? (
          <div className="empty-transcript">
            <div className="empty-icon">
              <Icon name="text" size={32} />
            </div>
            <span className="eyebrow">专心听课，剩下的交给这里</span>
            <h3>每一句课堂，都有迹可循</h3>
            <p>
              开始后，老师的讲解会逐段出现在这里。
              <br />
              偶尔走神也没关系，随时可以接上。
            </p>
            {props.onStart && (
              <button className="button dark" onClick={props.onStart}>
                <Icon name="play" size={16} />
                开始听课
              </button>
            )}
          </div>
        ) : (
          <div className="transcript-list">
            {props.segments.map((seg) => (
              <article
                key={seg.id}
                data-segment-id={seg.id}
                className={`transcript-row ${
                  seg.id === props.highlightSegmentId ? "located" : ""
                }`}
              >
                <div className="segment-time">
                  {formatMs(seg.startMs)}
                  <span className="timeline-dot" />
                </div>
                <div className="segment-content">
                  <div className="segment-speaker">授课老师</div>
                  <p>{seg.text}</p>
                </div>
              </article>
            ))}
            {props.status === "stopped" && (
              <p className="transcript-end">
                本次课堂记录到这里 <Icon name="check" size={13} />
              </p>
            )}
          </div>
        )}
      </div>
      {!isFollowing && (
        <button className="latest-button" onClick={backToLatest}>
          <Icon name="arrow" size={14} style={{ transform: "rotate(-90deg)" }} />
          回到最新
        </button>
      )}
      <div className="panel-footnote">
        <Icon name="info" size={14} />
        <span>时间戳为课堂内容时间</span>
      </div>
    </section>
  );
}
