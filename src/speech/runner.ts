import type { Segment } from "../../shared/types";

/** 一种输入模式在运行期间可调用的回调（已由 index.ts 做过会话隔离）。 */
export interface RunnerContext {
  emit(seg: Segment): void;
  /** 运行中出错：index.ts 负责报告 error */
  fail(message: string): void;
  /** 输入自然结束（如回放播完）：index.ts 负责报告 stopped */
  finish(message?: string): void;
}

export interface Runner {
  /** 进入 recording 时附带给页面的提示（如“演示模式”标识） */
  notice?: string;
  /** 停止并释放全部资源；返回最终转写是否完整收到。必须可安全重复调用。 */
  stop(): Promise<boolean>;
}
