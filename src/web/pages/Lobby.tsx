import { TopBar } from "@/components/TopBar";

export function Lobby() {
  return (
    <>
      <TopBar breadcrumbs={[{ label: "IM Lobby" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-xl rounded-xl border border-white/6 bg-surface-1 p-5">
          <h1 className="text-lg font-semibold text-text-primary">IM 大厅</h1>
          <p className="mt-2 text-[13px] leading-6 text-text-secondary">
            当前后端尚未暴露 IM Lobby HTTP 接口；此页面暂保留入口，等待接入当前 IM domain 的正式 Hono routes。
          </p>
        </div>
      </div>
    </>
  );
}
