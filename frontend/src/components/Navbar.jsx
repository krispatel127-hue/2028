import React from 'react';
import { Bell, Sun, Moon, Zap, Activity, Shield, Database, Layout, History } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnalysis } from '../context/useAnalysis';

const Navbar = () => {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const { syncState, analysis, selectedUploadId } = useAnalysis();

  const getPageContext = () => {
    const path = location.pathname;
    switch (path) {
      case '/': 
        return { 
          label: 'Business Summary', 
          status: 'AI is Ready', 
          icon: Layout, 
          color: 'text-blue-400' 
        };
      case '/forecast': 
        return { 
          label: 'Sales Planning', 
          status: '30-Day Forecast', 
          icon: Activity, 
          color: 'text-emerald-400' 
        };
      case '/risks': 
        return { 
          label: 'Stock Alerts', 
          status: 'Protection On', 
          icon: Shield, 
          color: 'text-amber-400' 
        };
      case '/ai-processor': 
        return { 
          label: 'Data Cleaner', 
          status: 'Cleaning Data', 
          icon: Zap, 
          color: 'text-emerald-400' 
        };
      case '/builder': 
        return { 
          label: 'Page Designer', 
          status: 'Design Mode', 
          icon: Database, 
          color: 'text-blue-400' 
        };
      case '/clients':
        return {
          label: 'Customer Watch List',
          status: 'Buying Pattern Alerts',
          icon: Shield,
          color: 'text-rose-400'
        };
      case '/audit': 
        return { 
          label: 'Past Results', 
          status: 'Checking History', 
          icon: History, 
          color: 'text-purple-400' 
        };
      case '/tasks': 
        return { 
          label: 'Action Plan', 
          status: 'AI-generated tasks', 
          icon: History, 
          color: 'text-emerald-400' 
        };
      default: 
        return { 
          label: 'My AI App', 
          status: 'Online', 
          icon: Layout, 
          color: 'text-slate-400' 
        };
    }
  };

  const context = getPageContext();
  const computeSyncPct = () => {
    const lastSuccessAt = syncState?.lastSuccessAt;
    if (!lastSuccessAt) return syncState?.status === 'CONNECTED' ? 100 : 0;
    const ageMs = Date.now() - Number(lastSuccessAt);
    if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
    if (ageMs <= 25000) return 100;
    if (ageMs >= 120000) return 0;
    return Math.max(0, Math.round(100 - ((ageMs - 25000) / (120000 - 25000)) * 100));
  };
  const syncPct = computeSyncPct();
  const syncLabel = syncState?.status === 'NO_AUTH'
    ? 'Auth Required'
    : syncState?.status === 'DEGRADED'
      ? 'Degraded'
      : syncState?.status === 'CONNECTED'
        ? `${syncPct}%`
        : 'Booting';
  const aiConnected = syncState?.status === 'CONNECTED' && syncPct >= 30;
  const hasLocalData = !!analysis;
  const isPinned = !!selectedUploadId;

  const getAiStatusText = () => {
    if (aiConnected) return 'AI is Connected';
    if (isPinned) return 'Reference Locked';
    if (hasLocalData) return 'Displaying Cached';
    return 'AI Offline';
  };

  return (
    <header className="navbar relative px-8 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)]">
      <div className="navbar-left flex items-center gap-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="flex items-center gap-4"
          >
            <div className={`p-2 rounded-xl bg-[var(--bg-accent)] border border-[var(--border-subtle)] ${context.color}`}>
               <context.icon size={18} />
            </div>
            <div className="flex flex-col">
               <h2 className="text-sm font-black text-[var(--text-main)] tracking-tight leading-none mb-1 tabular-nums">
                  {context.label}
               </h2>
               <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${context.color} transition-colors duration-500`}>
                    {context.status}
                  </span>
                  <div className="w-1 h-1 rounded-full bg-slate-700 mx-1" />
                  <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
                    System Sync: {syncLabel}
                  </span>
               </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="navbar-actions flex items-center gap-4">
        {/* Neural Pulse Indicator */}
        <div className={`hidden md:flex items-center gap-3 px-4 py-2 rounded-full border ${
          aiConnected ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-slate-500/5 border-white/5'
        }`}>
           <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)] ${
             aiConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'
           }`} />
           <span className={`text-[10px] font-black uppercase tracking-widest ${
             aiConnected ? 'text-emerald-500/80' : 'text-slate-500'
           }`}>
             {getAiStatusText()}
           </span>
        </div>

        <button
          className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          <span className="text-[10px] font-black uppercase tracking-widest">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>

        <button className="relative p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-slate-400 hover:text-white transition-all group">
          <Bell size={18} className="group-hover:rotate-12 transition-transform" />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 border-2 border-[#0a0f1d] shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
        </button>
      </div>
    </header>
  );
};

export default Navbar;
