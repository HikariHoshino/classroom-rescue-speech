import type { Segment } from "../../shared/types";
import type { VolcUtterance } from "./volc";

/**
 * 把服务商的分句（result_type=full，每次返回全部分句）整理成统一 Segment。
 * - 只输出 definite=true 的确认分句；最后一包时剩余分句也视为确认。
 * - id 由分句起始时间生成，同一分句被修正时 id 不变，由页面按 id 覆盖。
 * - 只返回本次新增或内容有变化的片段。
 */
export class SegmentCollector {
  private sent = new Map<string, string>();

  update(utterances: VolcUtterance[], last: boolean): Segment[] {
    const changed: Segment[] = [];
    for (const u of utterances) {
      const text = (u.text ?? "").trim();
      if (!text || !(u.definite || last)) continue;
      const seg: Segment = {
        id: `seg-${u.start_time}`,
        startMs: u.start_time,
        endMs: u.end_time,
        text,
      };
      const key = `${seg.endMs}|${text}`;
      if (this.sent.get(seg.id) === key) continue;
      this.sent.set(seg.id, key);
      changed.push(seg);
    }
    return changed;
  }
}
