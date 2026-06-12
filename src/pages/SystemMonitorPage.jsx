import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { getProxyBaseUrl } from '../utils/proxyUrl';
import {
    FaServer, FaMemory, FaNodeJs, FaClock, FaCheckCircle,
    FaTimesCircle, FaSpinner, FaExclamationTriangle, FaTrash,
    FaSyncAlt, FaList, FaChevronLeft, FaTerminal
} from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';

const STATUS_CONFIG = {
    SUCCESS: { label: 'Sucesso', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30', icon: <FaCheckCircle /> },
    ERROR: { label: 'Erro', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30', icon: <FaTimesCircle /> },
    RUNNING: { label: 'Rodando', color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30', icon: <FaSpinner className="animate-spin" /> },
    WARNING: { label: 'Aviso', color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', icon: <FaExclamationTriangle /> },
};

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}

function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}

const FILTERS = ['ALL', 'SUCCESS', 'ERROR', 'RUNNING', 'WARNING'];

const SystemMonitorPage = () => {
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [search, setSearch] = useState('');
    const [clearConfirm, setClearConfirm] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    // Live console
    const [consoleLogs, setConsoleLogs] = useState([]);
    const [consoleSeq, setConsoleSeq] = useState(0);
    const [consolePaused, setConsolePaused] = useState(false);
    const consoleEndRef = useRef(null);

    const fetchData = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        else setRefreshing(true);
        try {
            const base = getProxyBaseUrl();
            const [statsRes, logsRes] = await Promise.all([
                axios.get(`${base}/api/system/stats`),
                axios.get(`${base}/api/schedules/logs/all`),
            ]);
            setStats(statsRes.data);
            setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
            setLastRefresh(new Date());
        } catch (err) {
            console.error('Monitor fetch failed:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => fetchData(true), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    // Live console polling every 3s
    useEffect(() => {
        const poll = async () => {
            if (consolePaused) return;
            try {
                const base = getProxyBaseUrl();
                const res = await axios.get(`${base}/api/system/logs/live?since=${consoleSeq}`);
                const { lines, latestSeq } = res.data;
                if (lines && lines.length > 0) {
                    setConsoleLogs(prev => {
                        const next = [...prev, ...lines].slice(-500);
                        return next;
                    });
                    setConsoleSeq(latestSeq);
                }
            } catch {/* backend may be restarting */ }
        };
        poll();
        const iv = setInterval(poll, 3000);
        return () => clearInterval(iv);
    }, [consoleSeq, consolePaused]);

    // Auto-scroll console to bottom when new lines arrive
    useEffect(() => {
        if (!consolePaused && consoleEndRef.current) {
            consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [consoleLogs, consolePaused]);

    const handleClear = async () => {
        if (!clearConfirm) { setClearConfirm(true); return; }
        setClearing(true);
        try {
            const base = getProxyBaseUrl();
            await axios.delete(`${base}/api/schedules/logs`);
            setLogs([]);
            setClearConfirm(false);
        } catch (err) {
            alert('Erro ao limpar histórico: ' + err.message);
        } finally {
            setClearing(false);
        }
    };

    // Hide stale RUNNING entries: logs are sorted newest-first,
    // so if we already saw SUCCESS/ERROR/WARNING for a scheduleId,
    // any older RUNNING for that same id is outdated and hidden.
    const visibleLogs = (() => {
        const finishedIds = new Set();
        return logs.filter(log => {
            if (log.status !== 'RUNNING') {
                finishedIds.add(log.scheduleId);
                return true;
            }
            return !finishedIds.has(log.scheduleId);
        });
    })();

    const filteredLogs = visibleLogs.filter(log => {
        const matchesStatus = statusFilter === 'ALL' || log.status === statusFilter;
        const matchesSearch = !search || log.scheduleName?.toLowerCase().includes(search.toLowerCase()) || log.message?.toLowerCase().includes(search.toLowerCase());
        return matchesStatus && matchesSearch;
    });

    const countByStatus = (status) => visibleLogs.filter(l => l.status === status).length;
    const successRate = visibleLogs.length > 0 ? Math.round((countByStatus('SUCCESS') / visibleLogs.filter(l => l.status !== 'RUNNING').length) * 100) : 0;

    if (loading) {
        return (
            <div className="min-h-screen bg-[#060f1e] flex items-center justify-center">
                <div className="text-center space-y-4">
                    <FaSpinner className="animate-spin text-cyan-400 text-4xl mx-auto" />
                    <p className="text-gray-400 text-sm">Carregando monitor...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#060f1e] text-white font-sans">
            {/* Top Bar */}
            <div className="sticky top-0 z-10 bg-[#060f1e]/95 backdrop-blur border-b border-white/10 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate(-1)}
                        className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        title="Voltar"
                    >
                        <FaChevronLeft />
                    </button>
                    <div className="flex items-center gap-2">
                        <FaServer className="text-cyan-400 text-lg" />
                        <span className="font-bold text-white tracking-wide text-sm uppercase">System Monitor</span>
                    </div>
                    {refreshing && <FaSyncAlt className="animate-spin text-cyan-500 text-xs opacity-60" />}
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                        Atualizado: {lastRefresh ? lastRefresh.toLocaleTimeString('pt-BR') : '—'} · auto 10s
                    </span>
                    <button
                        onClick={() => fetchData(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs transition-all"
                    >
                        <FaSyncAlt className={refreshing ? 'animate-spin' : ''} /> Atualizar
                    </button>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

                {/* Health Cards */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                            {
                                icon: <FaClock className="text-cyan-400 text-xl" />,
                                label: 'Uptime',
                                value: formatUptime(stats.uptime),
                                sub: `desde ${formatDate(stats.startedAt)}`
                            },
                            {
                                icon: <FaMemory className="text-violet-400 text-xl" />,
                                label: 'Memória RAM',
                                value: `${stats.memoryUsedMB} MB`,
                                sub: `heap ${stats.memoryHeapUsedMB} MB`
                            },
                            {
                                icon: <FaNodeJs className="text-emerald-400 text-xl" />,
                                label: 'Node.js',
                                value: stats.nodeVersion,
                                sub: 'versão atual'
                            },
                            {
                                icon: <FaList className="text-amber-400 text-xl" />,
                                label: 'Schedules',
                                value: `${stats.schedulesActive} / ${stats.schedulesTotal}`,
                                sub: 'ativos / total'
                            },
                        ].map((card, i) => (
                            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-start gap-3 hover:bg-white/8 transition-colors">
                                <div className="mt-0.5">{card.icon}</div>
                                <div className="min-w-0">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider">{card.label}</p>
                                    <p className="text-xl font-bold text-white mt-0.5 truncate">{card.value}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{card.sub}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Summary counters */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        { label: 'Total Logs', value: logs.length, color: 'text-white' },
                        { label: 'Sucesso', value: countByStatus('SUCCESS'), color: 'text-emerald-400' },
                        { label: 'Erro', value: countByStatus('ERROR'), color: 'text-red-400' },
                        { label: 'Rodando', value: countByStatus('RUNNING'), color: 'text-blue-400' },
                        { label: 'Taxa Sucesso', value: `${successRate}%`, color: successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-yellow-400' : 'text-red-400' },
                    ].map((s, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                        </div>
                    ))}
                </div>

                {/* Logs Section */}
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    {/* Log Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-white/3">
                        <div className="flex items-center gap-2">
                            <FaList className="text-cyan-400" />
                            <h2 className="font-semibold text-sm text-white">Execution Log</h2>
                            <span className="text-xs text-gray-500 ml-1">({filteredLogs.length} entradas)</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {/* Status filter tabs */}
                            <div className="flex gap-1 bg-black/30 rounded-lg p-1">
                                {FILTERS.map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setStatusFilter(f)}
                                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${statusFilter === f ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        {f === 'ALL' ? 'Todos' : STATUS_CONFIG[f]?.label}
                                        {f !== 'ALL' && <span className="ml-1 opacity-60">({countByStatus(f)})</span>}
                                    </button>
                                ))}
                            </div>

                            {/* Search */}
                            <input
                                type="text"
                                placeholder="Buscar..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 w-36"
                            />

                            {/* Clear button */}
                            <button
                                onClick={handleClear}
                                disabled={clearing || logs.length === 0}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${clearConfirm ? 'bg-red-500/30 text-red-300 border border-red-500/50 animate-pulse' : 'bg-white/5 text-gray-400 hover:text-red-400 border border-white/10 hover:border-red-500/30'} disabled:opacity-40`}
                            >
                                <FaTrash className="text-[10px]" />
                                {clearConfirm ? 'Confirmar?' : 'Limpar'}
                            </button>
                            {clearConfirm && (
                                <button onClick={() => setClearConfirm(false)} className="text-xs text-gray-500 hover:text-white px-1">
                                    Cancelar
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Log List */}
                    <div className="overflow-y-auto max-h-[520px]">
                        {filteredLogs.length === 0 ? (
                            <div className="text-center py-16 text-gray-500 text-sm">
                                Nenhum log encontrado.
                            </div>
                        ) : (
                            filteredLogs.map((log, i) => {
                                const cfg = STATUS_CONFIG[log.status] || STATUS_CONFIG['ERROR'];
                                return (
                                    <div
                                        key={log.id || i}
                                        className={`flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${i % 2 === 0 ? '' : 'bg-white/2'}`}
                                    >
                                        {/* Status icon */}
                                        <div className={`mt-0.5 text-sm flex-none ${cfg.color}`}>
                                            {cfg.icon}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                <span className="font-semibold text-sm text-white truncate">{log.scheduleName}</span>
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cfg.bg} ${cfg.color}`}>
                                                    {log.status}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-400 mt-0.5 break-words">{log.message}</p>
                                        </div>

                                        {/* Timestamp */}
                                        <div className="text-xs text-gray-600 flex-none text-right whitespace-nowrap">
                                            {formatDate(log.timestamp)}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
                {/* Live Server Console */}
                <div className="bg-black border border-white/10 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/3">
                        <div className="flex items-center gap-2">
                            <FaTerminal className="text-cyan-400 text-sm" />
                            <span className="font-semibold text-sm text-white">Server Console</span>
                            <span className="text-xs text-gray-500">({consoleLogs.length} linhas · polling 3s)</span>
                            {consolePaused && <span className="text-xs text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded">PAUSADO</span>}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setConsolePaused(p => !p)}
                                className={`text-xs px-2.5 py-1 rounded border transition-all ${consolePaused
                                    ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10'
                                    : 'border-white/10 text-gray-400 hover:text-white'
                                    }`}
                            >
                                {consolePaused ? '▶ Retomar' : '⏸ Pausar'}
                            </button>
                            <button
                                onClick={() => setConsoleLogs([])}
                                className="text-xs px-2.5 py-1 rounded border border-white/10 text-gray-500 hover:text-red-400 hover:border-red-500/30 transition-all"
                            >
                                Limpar
                            </button>
                        </div>
                    </div>
                    <div className="font-mono text-[11px] overflow-y-auto h-72 p-3 space-y-0.5">
                        {consoleLogs.length === 0 ? (
                            <p className="text-gray-600 italic">Aguardando logs do servidor...</p>
                        ) : (
                            consoleLogs.map((line, i) => {
                                const isError = line.level === 'error' || line.text.includes('❌') || line.text.toLowerCase().includes('error') || line.text.toLowerCase().includes('failed');
                                const isWarn = line.level === 'warn' || line.text.includes('⚠') || line.text.toLowerCase().includes('warn');
                                const isProxy = line.text.includes('[Proxy]');
                                const isScheduler = line.text.includes('[Scheduler]');
                                const isSuccess = line.text.includes('✅') || line.text.includes('Manual Export completed');
                                const color = isError ? 'text-red-400'
                                    : isWarn ? 'text-yellow-400'
                                        : isSuccess ? 'text-emerald-400'
                                            : isProxy ? 'text-cyan-300/80'
                                                : isScheduler ? 'text-violet-300/80'
                                                    : 'text-gray-400';
                                const ts = new Date(line.ts).toLocaleTimeString('pt-BR');
                                return (
                                    <div key={`${line.seq}-${line.ts}`} className={`flex gap-2 leading-relaxed ${color}`}>
                                        <span className="text-gray-600 flex-none">{ts}</span>
                                        <span className="break-all">{line.text}</span>
                                    </div>
                                );
                            })
                        )}
                        <div ref={consoleEndRef} />
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SystemMonitorPage;
