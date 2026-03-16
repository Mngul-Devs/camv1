import { Outlet } from "react-router";
import { TopBar } from "./TopBar";
import { MotherSidebar } from "./MotherSidebar";

export function SystemLayout() {
  return (
    <div className="h-screen flex flex-col bg-[#0a0a0b]">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <MotherSidebar />
        <main className="flex-1 ml-14 overflow-auto bg-[#0f1115]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
