declare module "blocked-at" {
  /**
   * 监控事件循环阻塞，当回调延迟执行时捕获调用栈。
   * @param callback - 阻塞回调，接收阻塞时长(ms)和调用栈
   * @param options - 配置项
   * @returns 清理函数，调用后停止监控
   */
  function blocked(
    callback: (time: number, stack: string) => void,
    options?: {
      /** 延迟阈值(ms)，低于此值不触发回调，默认 20 */
      threshold?: number;
      /** 资源缓存上限，0 表示不限制 */
      resourcesCap?: number;
      /** 是否裁剪 async_hooks 内部帧 */
      trimFalsePositives?: boolean;
      /** 调试模式 */
      debug?: boolean;
    }
  ): () => void;

  export = blocked;
}
