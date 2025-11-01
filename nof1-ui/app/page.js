// 页面级组件：组合头部、行情条、主图面板以及右侧活动栏
import Header from "../components/Header";
import TickerBar from "../components/TickerBar";
import ChartPanel from "../components/ChartPanel";
import RightFeed from "../components/RightFeed";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <TickerBar />
      <main className="flex-1 overflow-hidden">
        <div className="mx-auto flex h-full max-w-[1920px] flex-col gap-4 px-4 py-4">
          <div className="flex flex-1 flex-col gap-4 2xl:flex-row">
            <div className="flex-1 min-h-0">
              <div className="h-full min-h-0 overflow-hidden rounded border border-transparent">
                <ChartPanel />
              </div>
            </div>
            <div className="w-full min-h-0 2xl:w-[420px]">
              <div className="h-full min-h-0">
                <RightFeed />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
