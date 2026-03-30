import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index";
import Screener from "./pages/Screener";
import Sectors from "./pages/Sectors";
import Watchlist from "./pages/Watchlist";
import StockDetail from "./pages/StockDetail";
import NotFound from "./pages/NotFound";
import Admin from "./pages/Admin";
import Backtest from "./pages/Backtest";
import MarketSummary from "./pages/MarketSummary";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/screener" element={<Screener />} />
            <Route path="/sectors" element={<Sectors />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/stock/:symbol" element={<StockDetail />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/market-summary" element={<MarketSummary />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
