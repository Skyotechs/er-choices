import { useState } from "react";
import { HospitalProvider } from "@/context/HospitalContext";
import { ConsentGate } from "@/components/ConsentGate";
import { Home } from "@/pages/Home";
import { About } from "@/pages/About";

type Tab = "home" | "about";

function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>("home");

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <header className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[#c0392b] rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">ER</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground leading-none">ER Choices</h1>
            <p className="text-[10px] text-muted-foreground leading-tight">For EMS Professionals</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("home")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "home" ? "bg-[#c0392b] text-white" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            🏥 Hospitals
          </button>
          <button
            onClick={() => setActiveTab("about")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "about" ? "bg-[#c0392b] text-white" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            ℹ️ About
          </button>
        </div>
      </header>

      {activeTab === "home" ? <Home /> : <About />}
    </div>
  );
}

function App() {
  return (
    <HospitalProvider>
      <ConsentGate>
        <AppShell />
      </ConsentGate>
    </HospitalProvider>
  );
}

export default App;
