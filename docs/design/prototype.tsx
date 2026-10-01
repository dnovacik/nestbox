import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Terminal,
  Play,
  Square,
  RefreshCw,
  Folder,
  Code2,
  Cpu,
  HardDrive,
  Globe,
  Settings,
  Search,
  Plus,
  Server,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  Trash2,
  Power,
  ShieldAlert,
  Sliders,
  ChevronRight,
  Filter,
  Download,
  QrCode,
  Activity,
  Layers,
  FileCode,
  Sparkles,
  Command,
  Bell,
  X,
  Check,
  ArrowRight,
  Maximize2,
  Minus,
  AlertCircle
} from 'lucide-react';

/* DESIGN TOKENS */
const TOKENS = {
  bgApp: '#0D1117',
  bgCard: '#161B22',
  bgSurface: '#21262D',
  bgHover: '#2A303C',
  border: '#30363D',
  textPrimary: '#C9D1D9',
  textSecondary: '#8B949E',
  textMuted: '#484F58',
  accent: '#7C8CFF',
  accentHover: '#697AFA',
  status: {
    green: '#3FB950',
    amber: '#D29922',
    red: '#F85149',
    grey: '#8B949E'
  }
};

const INITIAL_PROJECTS = [
  {
    id: 'api-gateway',
    name: 'api-gateway',
    path: '/Users/dev/projects/api-gateway',
    packageManager: 'pnpm@8.15.0',
    gitBranch: 'feature/mcp-integration',
    gitHash: 'a8f912c',
    pinned: true,
    status: 'running',
    scripts: [
      { name: 'dev', command: 'tsx watch src/index.ts', status: 'running', pid: 48102, port: 3000, cpu: '1.4%', ram: '142 MB' },
      { name: 'build', command: 'tsup src/index.ts --dts', status: 'stopped', pid: null },
      { name: 'test', command: 'vitest run', status: 'stopped', pid: null },
      { name: 'db:migrate', command: 'prisma migrate dev', status: 'stopped', pid: null },
      { name: 'lint', command: 'eslint . --ext .ts', status: 'stopped', pid: null }
    ]
  },
  {
    id: 'web-dashboard',
    name: 'web-dashboard',
    path: '/Users/dev/projects/web-dashboard',
    packageManager: 'pnpm@8.15.0',
    gitBranch: 'main',
    gitHash: '7b2c9e1',
    pinned: true,
    status: 'running',
    scripts: [
      { name: 'dev', command: 'vite --port 5173', status: 'running', pid: 51203, port: 5173, cpu: '2.1%', ram: '210 MB' },
      { name: 'build', command: 'tsc && vite build', status: 'stopped', pid: null },
      { name: 'preview', command: 'vite preview', status: 'stopped', pid: null }
    ]
  },
  {
    id: 'auth-service',
    name: 'auth-service',
    path: '/Users/dev/projects/auth-service',
    packageManager: 'npm@10.2.0',
    gitBranch: 'fix/jwt-expiry',
    gitHash: 'c4e3a21',
    pinned: false,
    status: 'crashed',
    scripts: [
      { name: 'start', command: 'node dist/server.js', status: 'crashed', pid: null, error: 'EADDRINUSE: port 8080' },
      { name: 'dev', command: 'nodemon src/server.js', status: 'stopped', pid: null }
    ]
  },
  {
    id: 'billing-cron',
    name: 'billing-cron',
    path: '/Users/dev/projects/billing-cron',
    packageManager: 'yarn@3.6.0',
    gitBranch: 'main',
    gitHash: '9d10e4f',
    pinned: false,
    status: 'idle',
    scripts: [
      { name: 'start', command: 'ts-node worker.ts', status: 'stopped', pid: null }
    ]
  }
];

const INITIAL_PORTS = [
  { port: 3000, pid: 48102, process: 'node (tsx)', path: '/Users/dev/projects/api-gateway', origin: 'Nestbox', status: 'active' },
  { port: 5173, pid: 51203, process: 'vite', path: '/Users/dev/projects/web-dashboard', origin: 'Nestbox', status: 'active' },
  { port: 5432, pid: 1042, process: 'postgres', path: '/opt/homebrew/opt/postgresql@15/bin/postgres', origin: 'External', status: 'active' },
  { port: 6379, pid: 1120, process: 'redis-server', path: '/opt/homebrew/bin/redis-server', origin: 'External', status: 'active' },
  { port: 8080, pid: 88412, process: 'node', path: '/Users/dev/projects/legacy-auth', origin: 'External', status: 'active' }
];

const INITIAL_LOGS = [
  { id: 1, time: '10:42:01.102', level: 'INFO', ctx: 'server', msg: 'Nestbox Daemon v1.4.0 active', details: 'Initialized in 42ms' },
  { id: 2, time: '10:42:01.450', level: 'INFO', ctx: 'api-gateway', msg: 'Starting process: tsx watch src/index.ts', details: 'PID 48102' },
  { id: 3, time: '10:42:02.011', level: 'INFO', ctx: 'api-gateway', msg: 'HTTP Server listening on http://localhost:3000', details: 'Routes registered: 14' },
  { id: 4, time: '10:42:05.890', level: 'WARN', ctx: 'api-gateway', msg: 'DB Connection pool reached 80% capacity', details: '16/20 active connections' },
  { id: 5, time: '10:42:12.330', level: 'INFO', ctx: 'web-dashboard', msg: 'Vite v5.1.0 dev server ready in 280 ms', details: 'Local: http://localhost:5173/' },
  { id: 6, time: '10:42:20.100', level: 'ERR', ctx: 'auth-service', msg: 'Process exited with code 1 (EADDRINUSE :8080)', details: 'Port 8080 is currently occupied by PID 88412' }
];

const ToastContainer = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-10 right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-lg border shadow-2xl backdrop-blur-md transition-all duration-300 animate-slide-in ${
            t.type === 'error'
              ? 'bg-[#161B22]/95 border-[#F85149]/50 text-red-200'
              : t.type === 'success'
              ? 'bg-[#161B22]/95 border-[#3FB950]/50 text-green-200'
              : 'bg-[#161B22]/95 border-[#7C8CFF]/50 text-indigo-100'
          }`}
        >
          {t.type === 'error' && <AlertTriangle className="w-5 h-5 text-[#F85149] shrink-0 mt-0.5" />}
          {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-[#3FB950] shrink-0 mt-0.5" />}
          {t.type === 'info' && <Sparkles className="w-5 h-5 text-[#7C8CFF] shrink-0 mt-0.5" />}
          <div className="flex-1 text-xs">
            <div className="font-semibold text-sm mb-0.5">{t.title}</div>
            <div className="text-gray-300 leading-relaxed">{t.message}</div>
          </div>
          <button onClick={() => onDismiss(t.id)} className="text-gray-400 hover:text-white p-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default function App() {
  /* State Definitions */
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [selectedProjectId, setSelectedProjectId] = useState('api-gateway');
  const [activeTab, setActiveTab] = useState('overview'); // overview, scripts, ports, env, server, claude
  const [ports, setPorts] = useState(INITIAL_PORTS);
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [toasts, setToasts] = useState([]);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [killModalPort, setKillModalPort] = useState(null);

  const selectedProject = useMemo(() => {
    return projects.find(p => p.id === selectedProjectId) || projects[0];
  }, [projects, selectedProjectId]);

  /* Helper to add toast */
  const addToast = (title, message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  /* Keyboard Shortcuts */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdPaletteOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setCmdPaletteOpen(false);
        setKillModalPort(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /* Simulate Crash Trigger */
  const triggerSimulatedCrash = () => {
    setProjects(prev => prev.map(p => {
      if (p.id === selectedProjectId) {
        return {
          ...p,
          status: 'crashed',
          scripts: p.scripts.map(s => s.name === 'dev' ? { ...s, status: 'crashed', error: 'Uncaught Fatal Exception: heap out of memory' } : s)
        };
      }
      return p;
    }));

    const newLog = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      level: 'ERR',
      ctx: selectedProject.name,
      msg: 'FATAL EXCEPTION: JavaScript heap out of memory',
      details: 'CALL_AND_RETRY_LAST Allocation failed - process exited with code 134'
    };
    setLogs(prev => [...prev, newLog]);

    addToast('Process Crash Detected!', `Project '${selectedProject.name}' stopped unexpectedly (code 134).`, 'error');
  };

  /* Kill Port Action */
  const confirmKillPort = () => {
    if (!killModalPort) return;
    setPorts(prev => prev.filter(p => p.port !== killModalPort.port));
    addToast('Port Freed', `Killed PID ${killModalPort.pid} running on port :${killModalPort.port}`, 'success');
    setKillModalPort(null);
  };

  return (
    <div className="w-full h-screen bg-[#0D1117] text-[#C9D1D9] font-sans antialiased flex flex-col justify-between overflow-hidden select-none">
      
      {/* WINDOW TITLEBAR (macOS / Windows Style Shell) */}
      {}
      <div className="h-10 bg-[#161B22] border-b border-[#30363D] flex items-center justify-between px-4 shrink-0 drag-handle">
        <div className="flex items-center gap-3">
          {/* macOS Window Controls */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 cursor-pointer" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 cursor-pointer" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 cursor-pointer" />
          </div>

          <div className="h-4 w-[1px] bg-[#30363D] mx-1" />

          {/* Minimal Nestbox Logo */}
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[#7C8CFF]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 9.5V21C2 21.5523 2.44772 22 3 22H21C21.5523 22 22 21.5523 22 21V9.5L12 2ZM12 11C13.6569 11 15 12.3431 15 14C15 15.6569 13.6569 17 12 17C10.3431 17 9 15.6569 9 14C9 12.3431 10.3431 11 12 11Z"/>
            </svg>
            <span className="font-bold text-xs tracking-wide text-white">nestbox</span>
            <span className="text-[10px] bg-[#21262D] text-[#8B949E] px-1.5 py-0.5 rounded font-mono border border-[#30363D]">v1.4.0</span>
          </div>
        </div>

        {/* Center Title */}
        <div className="text-xs text-[#8B949E] font-medium flex items-center gap-2">
          <span>{selectedProject.name}</span>
          <span className="text-[#484F58]">•</span>
          <span className="font-mono text-[11px] text-[#7C8CFF]">{selectedProject.gitBranch}</span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setCmdPaletteOpen(true)}
            className="flex items-center gap-2 text-xs bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#8B949E] px-2.5 py-1 rounded transition"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search or command...</span>
            <kbd className="bg-[#0D1117] text-[10px] px-1 rounded border border-[#30363D] text-gray-400">⌘K</kbd>
          </button>
        </div>
      </div>

      {/* MAIN CONTAINER (SIDEBAR + CONTENT AREA) */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT SIDEBAR */}
        {}
        <div className="w-64 bg-[#161B22]/70 border-r border-[#30363D] flex flex-col justify-between shrink-0">
          <div className="p-3 flex flex-col gap-4 overflow-y-auto">
            
            {/* Sidebar Search Filter */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#8B949E]" />
              <input
                type="text"
                placeholder="Filter projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#C9D1D9] focus:outline-none focus:border-[#7C8CFF] transition placeholder-[#484F58]"
              />
            </div>

            {/* Pinned Projects Section */}
            <div>
              <div className="text-[10px] font-semibold text-[#8B949E] uppercase tracking-wider px-2 mb-1.5 flex items-center justify-between">
                <span>PINNED WORKSPACES</span>
                <span className="text-[10px] text-[#484F58]">2</span>
              </div>
              <div className="space-y-0.5">
                {projects.filter(p => p.pinned && p.name.includes(searchQuery)).map(project => (
                  <button
                    key={project.id}
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition ${
                      selectedProjectId === project.id 
                        ? 'bg-[#21262D] text-white border border-[#30363D]' 
                        : 'text-[#8B949E] hover:bg-[#21262D]/50 hover:text-[#C9D1D9]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        project.status === 'running' ? 'bg-[#3FB950] shadow-[0_0_8px_#3FB950]' :
                        project.status === 'crashed' ? 'bg-[#F85149] shadow-[0_0_8px_#F85149]' : 'bg-[#8B949E]'
                      }`} />
                      <span className="truncate">{project.name}</span>
                    </div>
                    <ChevronRight className={`w-3.5 h-3.5 text-[#484F58] ${selectedProjectId === project.id ? 'text-[#7C8CFF]' : ''}`} />
                  </button>
                ))}
              </div>
            </div>

            {/* All Projects Section */}
            <div>
              <div className="text-[10px] font-semibold text-[#8B949E] uppercase tracking-wider px-2 mb-1.5 flex items-center justify-between">
                <span>ALL PROJECTS</span>
                <span className="text-[10px] text-[#484F58]">{projects.length}</span>
              </div>
              <div className="space-y-0.5">
                {projects.filter(p => !p.pinned && p.name.includes(searchQuery)).map(project => (
                  <button
                    key={project.id}
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition ${
                      selectedProjectId === project.id 
                        ? 'bg-[#21262D] text-white border border-[#30363D]' 
                        : 'text-[#8B949E] hover:bg-[#21262D]/50 hover:text-[#C9D1D9]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        project.status === 'running' ? 'bg-[#3FB950]' :
                        project.status === 'crashed' ? 'bg-[#F85149]' : 'bg-[#8B949E]'
                      }`} />
                      <span className="truncate">{project.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Add Project Button at Bottom of Sidebar */}
          <div className="p-3 border-t border-[#30363D] bg-[#161B22]">
            <button 
              onClick={() => addToast('Add Project', 'Select a directory containing a package.json', 'info')}
              className="w-full flex items-center justify-center gap-2 bg-[#21262D] hover:bg-[#30363D] text-[#C9D1D9] border border-[#30363D] py-1.5 rounded-md text-xs font-medium transition"
            >
              <Plus className="w-3.5 h-3.5 text-[#7C8CFF]" />
              <span>Add Local Project</span>
            </button>
          </div>
        </div>

        {/* MAIN WORKSPACE PANEL */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0D1117]">

          {/* PROJECT HEADER BANNER */}
          {}
          <div className="p-5 border-b border-[#30363D] bg-[#161B22]/40 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              
              {/* Left Details */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold text-white tracking-tight">{selectedProject.name}</h1>
                  
                  {/* Status Badge */}
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                    selectedProject.status === 'running' 
                      ? 'bg-[#3FB950]/10 border-[#3FB950]/30 text-[#3FB950]' 
                      : selectedProject.status === 'crashed'
                      ? 'bg-[#F85149]/10 border-[#F85149]/30 text-[#F85149]'
                      : 'bg-[#8B949E]/10 border-[#8B949E]/30 text-[#8B949E]'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      selectedProject.status === 'running' ? 'bg-[#3FB950] animate-pulse' :
                      selectedProject.status === 'crashed' ? 'bg-[#F85149]' : 'bg-[#8B949E]'
                    }`} />
                    {selectedProject.status.toUpperCase()}
                  </span>
                </div>

                {/* Sub Metadata Row */}
                <div className="flex items-center gap-3 text-xs text-[#8B949E] font-mono">
                  <span className="flex items-center gap-1">
                    <Folder className="w-3.5 h-3.5 text-[#484F58]" />
                    {selectedProject.path}
                  </span>
                  <span>•</span>
                  <span className="bg-[#21262D] px-1.5 py-0.5 rounded border border-[#30363D] text-[#C9D1D9]">
                    {selectedProject.packageManager}
                  </span>
                  <span>•</span>
                  <span className="text-[#7C8CFF] flex items-center gap-1">
                    <Code2 className="w-3.5 h-3.5" />
                    {selectedProject.gitBranch} ({selectedProject.gitHash})
                  </span>
                </div>
              </div>

              {/* Right Action Buttons */}
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => addToast('VS Code', `Opening ${selectedProject.name} in VS Code...`, 'info')}
                  className="flex items-center gap-2 bg-[#21262D] hover:bg-[#30363D] text-xs font-medium text-[#C9D1D9] border border-[#30363D] px-3 py-1.5 rounded-md transition"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[#7C8CFF]" />
                  <span>Open in VS Code</span>
                </button>

                <button 
                  onClick={() => addToast('Claude Code', `Launching Claude Code CLI session in terminal...`, 'info')}
                  className="flex items-center gap-2 bg-[#21262D] hover:bg-[#30363D] text-xs font-medium text-[#C9D1D9] border border-[#30363D] px-3 py-1.5 rounded-md transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>Claude Code</span>
                </button>

                <button 
                  onClick={() => {
                    setProjects(prev => prev.map(p => p.id === selectedProjectId ? { ...p, status: 'idle', scripts: p.scripts.map(s => ({ ...s, status: 'stopped' })) } : p));
                    addToast('Processes Killed', `Stopped all processes for ${selectedProject.name}`, 'success');
                  }}
                  className="flex items-center gap-1.5 bg-[#F85149]/10 hover:bg-[#F85149]/20 text-[#F85149] border border-[#F85149]/30 text-xs font-medium px-3 py-1.5 rounded-md transition"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>Kill All</span>
                </button>
              </div>

            </div>

            {/* TAB NAVIGATION HEADER */}
            <div className="flex items-center gap-1 border-b border-[#30363D] -mb-5 pt-2">
              {[
                { id: 'overview', label: 'Overview', icon: LayoutGridIcon },
                { id: 'scripts', label: 'Scripts & Logs', icon: Terminal },
                { id: 'ports', label: 'Ports Manager', icon: Server },
                { id: 'env', label: 'Env Matrix', icon: ShieldAlert },
                { id: 'server', label: 'Static Server', icon: Globe },
                { id: 'claude', label: 'Claude Integration', icon: Sparkles }
              ].map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium border-b-2 transition -mb-[1px] ${
                      isActive 
                        ? 'border-[#7C8CFF] text-[#7C8CFF] bg-[#21262D]/30' 
                        : 'border-transparent text-[#8B949E] hover:text-[#C9D1D9] hover:border-[#30363D]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* TAB CONTENT CONTAINER */}
          <div className="flex-1 overflow-y-auto p-6 bg-[#0D1117]">
            {activeTab === 'overview' && <OverviewTab project={selectedProject} onTriggerCrash={triggerSimulatedCrash} onNav={setActiveTab} />}
            {activeTab === 'scripts' && <ScriptsTab project={selectedProject} logs={logs} setLogs={setLogs} addToast={addToast} />}
            {activeTab === 'ports' && <PortsTab ports={ports} setKillModalPort={setKillModalPort} addToast={addToast} />}
            {activeTab === 'env' && <EnvTab addToast={addToast} />}
            {activeTab === 'server' && <StaticServerTab addToast={addToast} />}
            {activeTab === 'claude' && <ClaudeTab addToast={addToast} />}
          </div>

        </div>

      </div>

      {/* BOTTOM STATUS BAR */}
      {}
      <div className="h-7 bg-[#161B22] border-t border-[#30363D] px-4 flex items-center justify-between text-[11px] text-[#8B949E] shrink-0 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-[#7C8CFF]" />
            <span>CPU: 12%</span>
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3 h-3 text-[#7C8CFF]" />
            <span>RAM: 4.2 GB / 16 GB</span>
          </span>
          <span className="text-[#484F58]">|</span>
          <span className="flex items-center gap-1 text-[#3FB950]">
            <span className="w-2 h-2 rounded-full bg-[#3FB950] animate-pulse" />
            Daemon Connected
          </span>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={triggerSimulatedCrash}
            className="text-red-400 hover:text-red-300 underline font-sans text-[10px] cursor-pointer"
          >
            [Simulate Process Crash]
          </button>
          <span>Active Processes: 2</span>
          <span>Open Ports: {ports.length}</span>
          <Bell className="w-3 h-3 text-[#8B949E] hover:text-white cursor-pointer" />
        </div>
      </div>

      {/* KILL PORT CONFIRMATION MODAL */}
      {}
      {killModalPort && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-lg max-w-md w-full p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-bold text-base text-white">Kill External Process?</h3>
            </div>
            
            <p className="text-xs text-[#8B949E] leading-relaxed">
              Process <strong className="text-white font-mono">{killModalPort.process}</strong> (PID {killModalPort.pid}) on port <strong className="text-[#7C8CFF] font-mono">:{killModalPort.port}</strong> was not launched by Nestbox.
              Terminating external processes may result in un-saved local state loss.
            </p>

            <div className="p-3 bg-[#0D1117] border border-[#30363D] rounded text-xs font-mono text-gray-300">
              <div>Command: {killModalPort.path}</div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button 
                onClick={() => setKillModalPort(null)}
                className="px-3.5 py-1.5 text-xs text-[#8B949E] hover:text-white transition"
              >
                Cancel
              </button>
              <button 
                onClick={confirmKillPort}
                className="px-4 py-1.5 text-xs font-semibold bg-[#F85149] hover:bg-red-600 text-white rounded transition shadow"
              >
                Force Kill Process
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMMAND PALETTE OVERLAY */}
      {cmdPaletteOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-20">
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col">
            <div className="p-3 border-b border-[#30363D] flex items-center gap-2">
              <Search className="w-4 h-4 text-[#7C8CFF]" />
              <input
                autoFocus
                type="text"
                placeholder="Type a command or search projects..."
                className="w-full bg-transparent border-none text-sm text-white focus:outline-none placeholder-[#484F58]"
              />
              <kbd className="text-[10px] bg-[#0D1117] border border-[#30363D] px-1.5 py-0.5 rounded text-[#8B949E]">ESC</kbd>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto space-y-1 text-xs">
              <div className="px-2 py-1 text-[10px] text-[#8B949E] font-semibold uppercase">Quick Navigation</div>
              <button onClick={() => { setActiveTab('scripts'); setCmdPaletteOpen(false); }} className="w-full text-left px-3 py-2 rounded hover:bg-[#21262D] text-[#C9D1D9] flex items-center justify-between">
                <span>Go to Package Scripts & Logs</span>
                <span className="text-[#8B949E] font-mono">⌘1</span>
              </button>
              <button onClick={() => { setActiveTab('ports'); setCmdPaletteOpen(false); }} className="w-full text-left px-3 py-2 rounded hover:bg-[#21262D] text-[#C9D1D9] flex items-center justify-between">
                <span>Open Ports Inspector</span>
                <span className="text-[#8B949E] font-mono">⌘2</span>
              </button>
              <button onClick={() => { setActiveTab('env'); setCmdPaletteOpen(false); }} className="w-full text-left px-3 py-2 rounded hover:bg-[#21262D] text-[#C9D1D9] flex items-center justify-between">
                <span>View Env Matrix & Security Audit</span>
                <span className="text-[#8B949E] font-mono">⌘3</span>
              </button>
              <div className="px-2 py-1 text-[10px] text-[#8B949E] font-semibold uppercase pt-2">System Actions</div>
              <button onClick={() => { triggerSimulatedCrash(); setCmdPaletteOpen(false); }} className="w-full text-left px-3 py-2 rounded hover:bg-[#21262D] text-red-400 flex items-center justify-between">
                <span>Simulate Crash Event</span>
                <AlertTriangle className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST SYSTEM */}
      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(t => t.filter(x => x.id !== id))} />

    </div>
  );
}

/* Helper Icon */
function LayoutGridIcon(props) {
  return (
    <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth="2" />
      <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth="2" />
      <rect x="14" y="14" width="7" height="7" rx="1" strokeWidth="2" />
      <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth="2" />
    </svg>
  );
}

function OverviewTab({ project, onTriggerCrash, onNav }) {
  return (
    <div className="space-y-6">
      
      {/* Top Overview Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Active Processes Card */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#8B949E] mb-3">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Active Processes</span>
            <Activity className="w-4 h-4 text-[#7C8CFF]" />
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            {project.scripts.filter(s => s.status === 'running').length} / {project.scripts.length}
          </div>
          <div className="text-xs text-[#8B949E]">
            {project.scripts.find(s => s.status === 'running') ? 'tsx watch src/index.ts running' : 'All processes idle'}
          </div>
        </div>

        {/* Port Allocations Card */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#8B949E] mb-3">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Bound Ports</span>
            <Server className="w-4 h-4 text-[#3FB950]" />
          </div>
          <div className="text-2xl font-bold text-white mb-1 font-mono">
            :3000, :5173
          </div>
          <div className="text-xs text-[#3FB950] flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> No port conflicts detected
          </div>
        </div>

        {/* Env Health Card */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#8B949E] mb-3">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Env Health</span>
            <ShieldAlert className="w-4 h-4 text-[#D29922]" />
          </div>
          <div className="text-2xl font-bold text-amber-400 mb-1">
            2 Warnings
          </div>
          <div className="text-xs text-[#8B949E]">
            Missing keys in <code className="text-white font-mono">.env.example</code>
          </div>
        </div>

        {/* Claude Code Status Card */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#8B949E] mb-3">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Claude Code</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            Linked
          </div>
          <div className="text-xs text-purple-300">
            3 MCP Servers Active
          </div>
        </div>

      </div>

      {/* Main Process Inspector Panel */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#7C8CFF]" />
            Running Script Details
          </h3>
          <button 
            onClick={() => onNav('scripts')}
            className="text-xs text-[#7C8CFF] hover:underline flex items-center gap-1"
          >
            <span>View Full Console Output</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-3">
          {project.scripts.map(s => (
            <div key={s.name} className="bg-[#0D1117] border border-[#30363D] rounded-md p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${s.status === 'running' ? 'bg-[#3FB950] animate-pulse' : s.status === 'crashed' ? 'bg-[#F85149]' : 'bg-[#8B949E]'}`} />
                <div>
                  <div className="text-xs font-semibold text-white font-mono">{s.name}</div>
                  <div className="text-[11px] text-[#8B949E] font-mono">{s.command}</div>
                </div>
              </div>

              <div className="flex items-center gap-6 text-xs font-mono text-[#8B949E]">
                {s.pid && <div>PID: <span className="text-white">{s.pid}</span></div>}
                {s.cpu && <div>CPU: <span className="text-[#3FB950]">{s.cpu}</span></div>}
                {s.ram && <div>RAM: <span className="text-[#7C8CFF]">{s.ram}</span></div>}
                {s.status === 'crashed' && <span className="text-red-400 font-sans text-xs">{s.error}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity Timeline */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#7C8CFF]" />
          System Event Stream
        </h3>
        <div className="space-y-2 text-xs font-mono">
          <div className="p-2 bg-[#0D1117] border border-[#30363D] rounded flex items-center justify-between">
            <span className="text-gray-300">[10:42:01] Process 'dev' spawned on PID 48102</span>
            <span className="text-[#3FB950]">OK</span>
          </div>
          <div className="p-2 bg-[#0D1117] border border-[#30363D] rounded flex items-center justify-between">
            <span className="text-gray-300">[10:42:05] Port :3000 successfully claimed</span>
            <span className="text-[#3FB950]">OK</span>
          </div>
        </div>
      </div>

    </div>
  );
}

function ScriptsTab({ project, logs, setLogs, addToast }) {
  const [logViewMode, setLogViewMode] = useState('ansi'); // 'ansi' or 'json'
  const [logFilter, setLogFilter] = useState('');

  const filteredLogs = logs.filter(l => l.msg.toLowerCase().includes(logFilter.toLowerCase()) || l.level.toLowerCase().includes(logFilter.toLowerCase()));

  return (
    <div className="h-[620px] flex gap-4 overflow-hidden">
      
      {/* Left Pane: Interactive Script List */}
      <div className="w-72 bg-[#161B22] border border-[#30363D] rounded-lg p-3 flex flex-col justify-between shrink-0">
        <div>
          <div className="text-[10px] font-semibold text-[#8B949E] uppercase tracking-wider mb-3 px-1">
            package.json scripts
          </div>
          <div className="space-y-1.5">
            {project.scripts.map(s => (
              <div key={s.name} className="p-2.5 bg-[#0D1117] border border-[#30363D] rounded-md flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white font-mono">{s.name}</div>
                  <div className="text-[10px] text-[#8B949E] font-mono truncate max-w-[130px]">{s.command}</div>
                </div>
                <button
                  onClick={() => addToast('Script Execution', `Toggled state for script '${s.name}'`, 'info')}
                  className={`p-1.5 rounded transition ${
                    s.status === 'running' 
                      ? 'bg-[#F85149]/20 text-[#F85149] hover:bg-[#F85149]/30' 
                      : 'bg-[#3FB950]/20 text-[#3FB950] hover:bg-[#3FB950]/30'
                  }`}
                >
                  {s.status === 'running' ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                </button>
              </div>
            ))}
          </div>
        </div>

        <button 
          onClick={() => setLogs([])}
          className="w-full text-xs text-[#8B949E] hover:text-white py-1.5 border border-[#30363D] rounded bg-[#21262D] transition flex items-center justify-center gap-2"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear Console Logs
        </button>
      </div>

      {/* Right Pane: Console Terminal & Log Viewer */}
      <div className="flex-1 bg-[#161B22] border border-[#30363D] rounded-lg flex flex-col overflow-hidden">
        
        {/* Terminal Controls Bar */}
        <div className="p-3 bg-[#0D1117] border-b border-[#30363D] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLogViewMode('ansi')}
              className={`px-3 py-1 text-xs font-medium rounded transition ${
                logViewMode === 'ansi' ? 'bg-[#7C8CFF] text-white' : 'text-[#8B949E] hover:text-white'
              }`}
            >
              ANSI Plain Console
            </button>
            <button
              onClick={() => setLogViewMode('json')}
              className={`px-3 py-1 text-xs font-medium rounded transition ${
                logViewMode === 'json' ? 'bg-[#7C8CFF] text-white' : 'text-[#8B949E] hover:text-white'
              }`}
            >
              Structured JSON Table
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter logs..."
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              className="bg-[#161B22] border border-[#30363D] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7C8CFF]"
            />
            <button 
              onClick={() => addToast('Copied', 'Console output copied to clipboard', 'success')}
              className="p-1.5 text-[#8B949E] hover:text-white bg-[#21262D] border border-[#30363D] rounded"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Console Content */}
        <div className="flex-1 p-4 font-mono text-xs overflow-y-auto bg-[#0D1117]">
          {logViewMode === 'ansi' ? (
            <div className="space-y-1.5">
              {filteredLogs.map(log => (
                <div key={log.id} className="flex items-start gap-3">
                  <span className="text-[#484F58] shrink-0">{log.time}</span>
                  <span className={`px-1.5 rounded text-[10px] font-bold shrink-0 ${
                    log.level === 'ERR' ? 'bg-red-900/40 text-red-400 border border-red-800' :
                    log.level === 'WARN' ? 'bg-amber-900/40 text-amber-400 border border-amber-800' : 'bg-blue-900/40 text-blue-400 border border-blue-800'
                  }`}>
                    {log.level}
                  </span>
                  <span className="text-[#7C8CFF] shrink-0">[{log.ctx}]</span>
                  <span className="text-gray-200">{log.msg}</span>
                  <span className="text-[#484F58] text-[11px] ml-auto">{log.details}</span>
                </div>
              ))}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#30363D] text-[#8B949E] text-[11px]">
                  <th className="p-2">TIME</th>
                  <th className="p-2">LEVEL</th>
                  <th className="p-2">CONTEXT</th>
                  <th className="p-2">MESSAGE</th>
                  <th className="p-2">DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map(log => (
                  <tr key={log.id} className="border-b border-[#30363D]/50 hover:bg-[#161B22]">
                    <td className="p-2 text-[#484F58]">{log.time}</td>
                    <td className="p-2">
                      <span className={log.level === 'ERR' ? 'text-red-400' : log.level === 'WARN' ? 'text-amber-400' : 'text-blue-400'}>
                        {log.level}
                      </span>
                    </td>
                    <td className="p-2 text-[#7C8CFF]">{log.ctx}</td>
                    <td className="p-2 text-gray-200">{log.msg}</td>
                    <td className="p-2 text-[#8B949E]">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>

    </div>
  );
}

function PortsTab({ ports, setKillModalPort, addToast }) {
  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-lg overflow-hidden">
      <div className="p-4 border-b border-[#30363D] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Active System & App Bound Ports</h3>
          <p className="text-xs text-[#8B949E]">Inspect and release TCP ports claimed by dev tools or lingering background processes.</p>
        </div>
        <button 
          onClick={() => addToast('Free Ports', 'Scanned and cleared inactive ghost sockets', 'success')}
          className="px-3 py-1.5 bg-[#21262D] hover:bg-[#30363D] text-xs text-white border border-[#30363D] rounded transition"
        >
          Free All Inactive Ports
        </button>
      </div>

      <table className="w-full text-left border-collapse text-xs font-mono">
        <thead>
          <tr className="bg-[#0D1117] border-b border-[#30363D] text-[#8B949E]">
            <th className="p-3">PORT</th>
            <th className="p-3">PID</th>
            <th className="p-3">PROCESS NAME</th>
            <th className="p-3">EXECUTABLE PATH</th>
            <th className="p-3">ORIGIN</th>
            <th className="p-3 text-right">ACTION</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#30363D]">
          {ports.map(p => (
            <tr key={p.port} className="hover:bg-[#21262D]/40 transition">
              <td className="p-3 font-bold text-[#7C8CFF]">:{p.port}</td>
              <td className="p-3 text-[#8B949E]">{p.pid}</td>
              <td className="p-3 text-white font-sans font-medium">{p.process}</td>
              <td className="p-3 text-[#8B949E] max-w-xs truncate">{p.path}</td>
              <td className="p-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-sans ${
                  p.origin === 'Nestbox' ? 'bg-[#7C8CFF]/20 text-[#7C8CFF] border border-[#7C8CFF]/30' : 'bg-[#21262D] text-[#8B949E]'
                }`}>
                  {p.origin}
                </span>
              </td>
              <td className="p-3 text-right">
                <button
                  onClick={() => setKillModalPort(p)}
                  className="px-2.5 py-1 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-800/40 rounded transition font-sans text-xs"
                >
                  Kill Port
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EnvTab({ addToast }) {
  const [showValues, setShowValues] = useState(false);

  const envData = [
    { key: 'DATABASE_URL', env: 'postgresql://postgres:pass@localhost:5432/db', example: 'postgresql://user:pass@localhost:5432/dbname', status: 'OK' },
    { key: 'PORT', env: '3000', example: '3000', status: 'OK' },
    { key: 'JWT_SECRET', env: 'super-secret-jwt-key-991283', example: 'your-secret-here', status: 'OK' },
    { key: 'STRIPE_API_KEY', env: 'sk_test_51Mz...', example: 'MISSING', status: 'MISSING_IN_EXAMPLE' },
    { key: 'REDIS_HOST', env: 'MISSING', example: '127.0.0.1', status: 'MISSING_IN_ENV' }
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-[#161B22] border border-[#30363D] p-4 rounded-lg">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-white">Active Profile:</span>
          <select className="bg-[#0D1117] border border-[#30363D] text-xs text-white px-3 py-1.5 rounded focus:outline-none">
            <option>Development (.env.local)</option>
            <option>Staging (.env.staging)</option>
            <option>Production Local (.env.prod)</option>
          </select>
        </div>

        <button 
          onClick={() => setShowValues(!showValues)}
          className="flex items-center gap-2 text-xs bg-[#21262D] hover:bg-[#30363D] text-[#C9D1D9] border border-[#30363D] px-3 py-1.5 rounded transition"
        >
          {showValues ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{showValues ? 'Hide Values' : 'Reveal Masked Values'}</span>
        </button>
      </div>

      <div className="bg-[#161B22] border border-[#30363D] rounded-lg overflow-hidden">
        <table className="w-full text-left border-collapse text-xs font-mono">
          <thead>
            <tr className="bg-[#0D1117] border-b border-[#30363D] text-[#8B949E]">
              <th className="p-3">KEY NAME</th>
              <th className="p-3">.env VALUE</th>
              <th className="p-3">.env.example VALUE</th>
              <th className="p-3">AUDIT STATUS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#30363D]">
            {envData.map(row => (
              <tr key={row.key} className="hover:bg-[#21262D]/40">
                <td className="p-3 text-white font-bold">{row.key}</td>
                <td className="p-3 text-gray-300">
                  {row.env === 'MISSING' ? (
                    <span className="text-red-400 font-semibold">[MISSING]</span>
                  ) : showValues ? row.env : '••••••••••••••••'}
                </td>
                <td className="p-3 text-[#8B949E]">
                  {row.example === 'MISSING' ? (
                    <span className="text-amber-400">[UNDOCUMENTED]</span>
                  ) : row.example}
                </td>
                <td className="p-3 font-sans">
                  {row.status === 'OK' && <span className="text-[#3FB950] flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Synchronized</span>}
                  {row.status === 'MISSING_IN_EXAMPLE' && <span className="text-amber-400 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Undocumented</span>}
                  {row.status === 'MISSING_IN_ENV' && <span className="text-red-400 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Missing Variable</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StaticServerTab({ addToast }) {
  const [isRunning, setIsRunning] = useState(true);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      
      {/* Config Panel */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Local Static Web Server</h3>
        
        <div className="space-y-3 text-xs">
          <div>
            <label className="text-[#8B949E] block mb-1">Target Directory</label>
            <input type="text" defaultValue="./dist" className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-1.5 text-white font-mono" />
          </div>

          <div>
            <label className="text-[#8B949E] block mb-1">Port</label>
            <input type="text" defaultValue="5173" className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-1.5 text-white font-mono" />
          </div>

          <div className="space-y-2 pt-2 border-t border-[#30363D]">
            <label className="flex items-center gap-2 text-gray-200">
              <input type="checkbox" defaultChecked className="rounded border-[#30363D]" />
              <span>SPA Fallback (index.html)</span>
            </label>
            <label className="flex items-center gap-2 text-gray-200">
              <input type="checkbox" defaultChecked className="rounded border-[#30363D]" />
              <span>Enable CORS Headers</span>
            </label>
            <label className="flex items-center gap-2 text-gray-200">
              <input type="checkbox" className="rounded border-[#30363D]" />
              <span>HTTPS Local SSL</span>
            </label>
          </div>

          <button
            onClick={() => {
              setIsRunning(!isRunning);
              addToast('Static Server', isRunning ? 'Server stopped' : 'Server active on http://192.168.1.42:5173', 'info');
            }}
            className={`w-full mt-2 py-2 rounded font-semibold text-xs transition ${
              isRunning ? 'bg-red-900/30 text-red-400 border border-red-800' : 'bg-[#3FB950] text-black hover:bg-green-400'
            }`}
          >
            {isRunning ? 'Stop Static Server' : 'Start Static Server'}
          </button>
        </div>
      </div>

      {/* LAN & QR Display */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5 flex flex-col items-center justify-center text-center gap-3">
        <div className="p-3 bg-white rounded-lg shadow-inner">
          <QrCode className="w-24 h-24 text-black" />
        </div>
        <div className="text-xs">
          <div className="text-[#8B949E]">Local Network Preview (LAN):</div>
          <div className="font-mono text-sm text-[#7C8CFF] font-bold">http://192.168.1.42:5173</div>
        </div>
        <p className="text-[11px] text-[#8B949E] max-w-xs">
          Scan with mobile browser to test responsiveness on local Wi-Fi network.
        </p>
      </div>

      {/* HTTP Request Log Stream */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5 flex flex-col">
        <h3 className="text-sm font-semibold text-white mb-3">Live HTTP Request Log</h3>
        <div className="flex-1 bg-[#0D1117] border border-[#30363D] rounded p-3 font-mono text-[11px] space-y-2 overflow-y-auto max-h-56">
          <div className="flex justify-between text-green-400">
            <span>GET / - 200 OK</span>
            <span>12ms</span>
          </div>
          <div className="flex justify-between text-green-400">
            <span>GET /assets/index.js - 200 OK</span>
            <span>4ms</span>
          </div>
          <div className="flex justify-between text-amber-400">
            <span>GET /favicon.ico - 304 Not Modified</span>
            <span>2ms</span>
          </div>
        </div>
      </div>

    </div>
  );
}

function ClaudeTab({ addToast }) {
  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <div>
            <h3 className="text-sm font-bold text-white">Claude Code Developer Assistant Linked</h3>
            <p className="text-xs text-[#8B949E]">Claude CLI v0.2.14 detected. Context file CLAUDE.md loaded.</p>
          </div>
        </div>

        <button 
          onClick={() => addToast('MCP Sync', 'Re-indexed local Model Context Protocol tools', 'success')}
          className="px-3 py-1.5 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-white rounded transition"
        >
          Sync MCP Context
        </button>
      </div>

      {/* Grid Features */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* CLAUDE.md Preview */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 flex flex-col">
          <h4 className="text-xs font-semibold text-[#8B949E] uppercase mb-2">CLAUDE.md Project Rules</h4>
          <pre className="flex-1 bg-[#0D1117] border border-[#30363D] p-3 rounded text-xs font-mono text-purple-200 overflow-x-auto">
{`# Project Guidelines
- Build command: pnpm build
- Test command: pnpm test
- Style: Strict TypeScript, no explicit \`any\`
- Preferred UI: Tailwind CSS + Shadcn design patterns`}
          </pre>
        </div>

        {/* Runtime Diff Proposal Card */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-[#8B949E] uppercase">Proposed Runtime Patch from Claude</h4>
              <span className="text-[10px] bg-purple-900/30 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">Auto Suggestion</span>
            </div>
            
            <div className="bg-[#0D1117] border border-[#30363D] p-3 rounded font-mono text-xs space-y-1 my-2">
              <div className="text-red-400">{`- "scripts": { "dev": "ts-node src/index.ts" }`}</div>
              <div className="text-green-400">{`+ "scripts": { "dev": "tsx watch src/index.ts" }`}</div>
            </div>
            <p className="text-xs text-[#8B949E]">Swapping ts-node for tsx improves server boot time by ~400ms.</p>
          </div>

          <div className="flex items-center gap-2 pt-4">
            <button 
              onClick={() => addToast('Patch Applied', 'Updated package.json script configuration', 'success')}
              className="flex-1 py-1.5 bg-[#7C8CFF] hover:bg-indigo-500 text-white text-xs font-semibold rounded transition"
            >
              Apply Changes
            </button>
            <button 
              onClick={() => addToast('Rejected', 'Dismissed patch suggestion', 'info')}
              className="px-3 py-1.5 bg-[#21262D] hover:bg-[#30363D] text-xs text-[#8B949E] rounded transition"
            >
              Reject
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}