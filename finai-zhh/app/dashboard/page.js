// 页面级组件：组合头部、行情条、主图面板以及右侧活动栏
import Header from "../../components/Header";
import TickerBar from "../../components/TickerBar";
import ChartPanel from "../../components/ChartPanel";
import RightFeed from "../../components/RightFeed";

export default function DashboardPage() {
  return (
    <div className="flex h-screen flex-col bg-neutral-50 overflow-hidden">
      <Header />
      <TickerBar />
      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0">
          <ChartPanel />
        </div>
        <div className="w-[420px] flex-shrink-0">
          <RightFeed />
        </div>
      </main>
    </div>
  );
}
