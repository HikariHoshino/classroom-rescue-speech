// 示例回放数据（唯一责任人：2号，讲稿来源：5号）
// ⚠️ 以下为手工编写的【示例数据】，用于验证页面与模块连接，
//    不是真实 ASR 识别结果，不得在交付口径中声称已接通 ASR。
// 2号后续将 5号讲稿转换为带时间戳的回放数据替换本文件内容。
import type { Segment } from "../../shared/types";

export interface DemoSample {
  /** 片段内容 */
  segment: Segment;
  /** 从开始播放到输出该片段的延迟（毫秒） */
  emitAtMs: number;
}

/** 示例讲稿主题：数据结构——顺序栈（与 5号讲稿主题一致） */
export const DEMO_SAMPLES: DemoSample[] = [
  { segment: { id: "sample-seg-01", startMs: 0, endMs: 8000, text: "【示例】同学们好，今天我们讲数据结构里的栈。" }, emitAtMs: 1000 },
  { segment: { id: "sample-seg-02", startMs: 8000, endMs: 18000, text: "【示例】栈是一种后进先出的线性表，只能在表尾进行插入和删除。" }, emitAtMs: 5000 },
  { segment: { id: "sample-seg-03", startMs: 18000, endMs: 28000, text: "【示例】入栈把元素压到栈顶，出栈把栈顶元素弹出。" }, emitAtMs: 11000 },
  { segment: { id: "sample-seg-04", startMs: 28000, endMs: 40000, text: "【示例】注意，顺序栈在入栈前必须判满，栈满时不能继续入栈。" }, emitAtMs: 18000 },
  { segment: { id: "sample-seg-05", startMs: 40000, endMs: 52000, text: "【示例】这个知识点期末会考，大家要重点掌握判满条件。" }, emitAtMs: 26000 },
  { segment: { id: "sample-seg-06", startMs: 52000, endMs: 62000, text: "【示例】接下来我们看下一个知识点，链式栈的存储结构。" }, emitAtMs: 34000 },
];

/** 示例回放总时长（毫秒） */
export const DEMO_TOTAL_MS = 62000;
