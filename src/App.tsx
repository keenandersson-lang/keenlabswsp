import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index";

const Screener = lazy(() => import("./pages/Screener"));
const Sectors = lazy(() => import("./pages/Sectors"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const StockDetail = lazy(() => import("./pages/StockDetail"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Admin = lazy(() => import("./pages/Admin"));
const Backtest = lazy(() => import("./pages/Backtest"));
const MarketSummary = lazy(() => import("./pages/MarketSummary"));
const Industries = lazy(() => import("./pages/Industries"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/screener" element={<Screener />} />
              <Route path="/sectors" element={<Sectors />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/stock/:symbol" element={<StockDetail />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/backtest" element={<Backtest />} />
              <Route path="/market-summary" element={<MarketSummary />} />
              <Route path="/industries" element={<Industries />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
