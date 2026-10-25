// 笔记分节 · 只读预览（3号提供，给 4号 做笔记本 UI 时的参考渲染）
//
// 为什么单独建文件：NotesPanel.tsx 与 src/styles/ 是 4号 的独家修改范围，
// 3号 不直接改，避免和正在进行的界面调整冲突。这里用内联样式自包含，复制即可用。
//
// 接入方式（4号 三行搞定）：
//   1. import { NotesSectionsPreview } from "./NotesSectionsPreview";
//   2. 在 NotesPanel 的 markdown 展示之后加：
//        <NotesSectionsPreview
//          sections={props.sections}
//          loading={props.sectionsLoading}
//          onLocate={props.onLocateSegment}
//        />
//   3. props 里的 sections 来自 src/api.ts 的 postNoteSections(...).sections
//
// 类型说明：NoteSection 已由 1号 并入 shared/types.ts，这里直接复用公共类型。

import { useState } from "react";
import type { NoteSection } from "../../shared/types";

export interface NotesSectionsPreviewProps {
  /** 来自 POST /api/notes/sections 的 sections；null 表示还没生成 */
  sections: NoteSection[] | null;
  loading?: boolean;
  /** 点击「定位原文」时回调，传第一个片段 id */
  onLocate?: (segmentId: string) => void;
  /** 用户勾选变化时回调，交给 App 决定是否写入笔记本 */
  onToggle?: (sectionId: string, checked: boolean) => void;
}

function starsOf(count: number): string {
  const filled = Math.max(0, Math.min(3, count));
  return "★".repeat(filled) + "☆".repeat(3 - filled);
}

export function NotesSectionsPreview(props: NotesSectionsPreviewProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const toggle = (sectionId: string, next: boolean) => {
    setChecked((prev) => ({ ...prev, [sectionId]: next }));
    props.onToggle?.(sectionId, next);
  };

  if (props.loading) {
    return (
      <p style={{ margin: "12px 0", color: "#6b7280", fontSize: 14 }}>
        正在按知识点整理这节课……
      </p>
    );
  }

  if (!props.sections || props.sections.length === 0) {
    return (
      <p style={{ margin: "12px 0", color: "#6b7280", fontSize: 14 }}>
        停止记录后，可以把这节课整理成可按知识点勾选的笔记。
      </p>
    );
  }

  return (
    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13, color: "#6b7280" }}>按知识点整理（勾选后可加入笔记本）</div>
      {props.sections.map((section) => (
        <div
          key={section.id}
          style={{
            display: "flex",
            gap: 10,
            padding: "10px 12px",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            background: "#fff",
          }}
        >
          <input
            type="checkbox"
            checked={Boolean(checked[section.id])}
            onChange={(event) => toggle(section.id, event.target.checked)}
            aria-label={`选择知识点 ${section.title}`}
            style={{ marginTop: 3 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
              <strong style={{ fontSize: 15 }}>{section.title}</strong>
              <span
                style={{
                  fontSize: 13,
                  color: section.examStars > 0 ? "#d97706" : "#9ca3af",
                }}
                title="只表示该知识点在历年 408 真题中的出现频率，不代表今年一定考"
              >
                {section.examStars > 0 ? starsOf(section.examStars) : "未收录于真题统计"}
              </span>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>{section.examBasis}</span>
            </div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
              {section.points.slice(0, 2).map((point, index) => (
                <li key={index} style={{ color: "#374151" }}>
                  {point}
                </li>
              ))}
              {section.points.length > 2 && (
                <li style={{ color: "#9ca3af", listStyle: "none", marginLeft: -18 }}>
                  还有 {section.points.length - 2} 条
                </li>
              )}
            </ul>
            {props.onLocate && section.segmentIds.length > 0 && (
              <button
                type="button"
                onClick={() => props.onLocate?.(section.segmentIds[0])}
                style={{
                  marginTop: 6,
                  border: "none",
                  background: "none",
                  padding: 0,
                  color: "#2563eb",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                定位原文
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
