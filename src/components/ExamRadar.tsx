// 考点雷达（唯一责任人：4号；设计移植自 ljx 分支，props 由 1号固定）
// 展示疑似考点：时间、命中词、原句；点击定位原文。
import { useEffect, useRef, useState } from "react";
import type { ExamHit, Segment } from "../../shared/types";
import { formatMs } from "./TopBar";
import { Icon } from "./Icon";

/** 已解析的考点条目（1号负责将 ExamHit 关联到片段内容） */
export interface ResolvedExamHit extends ExamHit {
  startMs: number;
  text: string;
}

export interface ExamRadarProps {
  hits: ResolvedExamHit[];
  onLocate: (segmentId: Segment["id"]) => void;
}

export function ExamRadar(props: ExamRadarProps) {
  const [expanded, setExpanded] = useState(true);
  const [notice, setNotice] = useState(false);
  const previousCount = useRef(props.hits.length);

  // 新命中时短暂提示
  useEffect(() => {
    if (props.hits.length <= previousCount.current) {
      previousCount.current = props.hits.length;
      return;
    }
    previousCount.current = props.hits.length;
    setNotice(true);
    const timer = setTimeout(() => setNotice(false), 2500);
    return () => clearTimeout(timer);
  }, [props.hits.length]);

  return (
    <section className="panel radar-panel">
      <button
        className="panel-heading radar-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="radar-content"
      >
        <span className="heading-label">
          <Icon name="radar" />
          <h2>考点雷达</h2>
          <span className="amber-count">{props.hits.length}</span>
        </span>
        <Icon
          name="chevron"
          size={16}
          className={expanded ? "rotate-chevron" : ""}
        />
      </button>
      <div id="radar-content" hidden={!expanded}>
        <div className="radar-intro">捕捉老师的强调，留住值得回看的原话。</div>
        <div className="radar-scroll">
          {props.hits.length === 0 ? (
            <div className="empty-radar">
              <span className="radar-orbit">
                <Icon name="radar" size={34} />
              </span>
              <h3>重点，正在路上</h3>
              <p>
                听到「注意」「重点」「期末」时，
                <br />
                会为你留下一张原话卡片。
              </p>
            </div>
          ) : (
            props.hits.map((hit) => (
              <button
                className="highlight-card"
                key={hit.segmentId}
                onClick={() => props.onLocate(hit.segmentId)}
                title="点击定位原文"
              >
                <span className="highlight-card-top">
                  <span>
                    <Icon name="star" size={13} />
                    疑似考点
                  </span>
                  <time>{formatMs(hit.startMs)}</time>
                </span>
                <blockquote>「{hit.text}」</blockquote>
                <span className="highlight-card-bottom">
                  <span className="keywords">
                    <span>{hit.keyword}</span>
                  </span>
                  <Icon name="chevron" size={14} />
                </span>
              </button>
            ))
          )}
        </div>
        <p className="radar-disclaimer">
          <Icon name="info" size={13} />
          关键词仅作提示，考查范围以老师为准。
        </p>
      </div>
      <div className="notice-toast" role="status" aria-live="polite">
        {notice && (
          <>
            <Icon name="star" size={14} />
            已留住一处课堂重点
          </>
        )}
      </div>
    </section>
  );
}
