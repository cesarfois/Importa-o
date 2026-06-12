import React, { useState, useEffect, useMemo } from 'react';
import { FaProjectDiagram, FaSpinner, FaExclamationTriangle, FaExpand, FaCompress } from 'react-icons/fa';

import { workflowAnalyticsService } from '../services/workflowAnalyticsService';
import { authService } from '../services/authService';
import { WorkflowDefinitionParser } from '../services/workflow/WorkflowDefinitionParser';
import { WorkflowGraphBuilder } from '../services/workflow/WorkflowGraphBuilder';
import { WorkflowHistoryAnalyzer } from '../services/workflow/WorkflowHistoryAnalyzer';
import { WorkflowTimelineEngine } from '../services/workflow/WorkflowTimelineEngine';
import { TimelineViewer } from '../components/Workflow/TimelineViewer';

/* ─────────────────────────────────────────────────────────────────
   Helper: generate fallback graph from history when no .wfd exists
   ───────────────────────────────────────────────────────────────── */
const generateFallbackGraph = (analyzedHistory) => {
    const activities = [];
    const connections = [];

    analyzedHistory.forEach((step, idx) => {
        const id = `fallback_${idx}`;
        let color = '#f6b71b';
        let icon = 'action-checkbox';

        if (step.type === 'Start' || step.type === 'StartEvent') {
            color = '#3b49a2'; icon = 'start-event';
        } else if (step.type === 'End' || step.type === 'EndEvent') {
            color = '#10b981'; icon = 'end-event';
        } else if (step.type === 'Condition') {
            color = '#40c02e'; icon = 'conditions';
        }

        activities.push({
            id, name: step.name || 'Tarefa', type: step.type || 'WorkflowTask',
            description: '', x: 0, y: 0, width: 180, height: 80, color, icon
        });

        if (idx > 0) {
            connections.push({
                id: `fallback_conn_${idx}`,
                source: `fallback_${idx - 1}`,
                target: `fallback_${idx}`,
                label: analyzedHistory[idx - 1].decision || ''
            });
        }
    });

    return { activities, connections };
};

/* ─────────────────────────────────────────────────────────────────
   WorkflowDiagramPage
   A focused, standalone view that shows ONLY the workflow diagram
   for a specific document, given ?fc=<cabinetId>&did=<docId> params.
   ───────────────────────────────────────────────────────────────── */
const WorkflowDiagramPage = () => {
    const queryParams = new URLSearchParams(window.location.search);
    const cabinetId = queryParams.get('fc') || queryParams.get('fileCabinetId') || queryParams.get('cabinetId') || '';
    const documentId = queryParams.get('did') || queryParams.get('docId') || queryParams.get('documentId') || '';

    const [authLoading, setAuthLoading] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [instances, setInstances] = useState([]);
    const [activeTab, setActiveTab] = useState(0);
    const [wfdUpdateCounter, setWfdUpdateCounter] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(true);

    const [wfdDefinitions, setWfdDefinitions] = useState({});
    const [wfdLoading, setWfdLoading] = useState(false);

    /* Check authentication and log in automatically with service account if needed */
    useEffect(() => {
        const checkAndAuth = async () => {
            try {
                const currentUser = authService.getCurrentUser();
                if (!currentUser) {
                    console.log('[WorkflowDiagramPage] No active user. Authenticating using service account...');
                    await authService.loginWithServiceAccount();
                    console.log('[WorkflowDiagramPage] Service account authenticated successfully.');
                }
                setAuthLoading(false);
            } catch (err) {
                console.error('[WorkflowDiagramPage] Service account authentication failed:', err);
                setError('Falha ao autenticar acesso ao diagrama.');
                setAuthLoading(false);
            }
        };
        checkAndAuth();
    }, []);

    /* Load workflow history for the given document */
    useEffect(() => {
        if (authLoading || error) return;

        if (!cabinetId || !documentId) {
            setError('Parâmetros inválidos. A URL deve conter ?fc=<armário>&did=<documento>.');
            setLoading(false);
            return;
        }

        let cancelled = false;

        const fetchHistory = async () => {
            setLoading(true);
            setError(null);
            try {
                const result = await workflowAnalyticsService.getHistoryByDocId(documentId, cabinetId);
                if (!cancelled) {
                    if (!result || result.length === 0) {
                        setError('Nenhum histórico de workflow encontrado para este documento.');
                    } else {
                        // Sort: alphabetical name then version desc (same logic as WorkflowHistoryPage)
                        const sorted = [...result].sort((a, b) => {
                            const nA = (a.Name || '').toLowerCase();
                            const nB = (b.Name || '').toLowerCase();
                            if (nA < nB) return -1;
                            if (nA > nB) return 1;
                            return (b.Version || 0) - (a.Version || 0);
                        });
                        setInstances(sorted);
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('[WorkflowDiagramPage] Failed to load history:', err);
                    setError('Erro ao carregar o histórico do workflow. Verifique a conexão e tente novamente.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchHistory();
        return () => { cancelled = true; };
    }, [authLoading, cabinetId, documentId, wfdUpdateCounter]);

    /* Load WFD definitions asynchronously from the server (or fallback to localStorage) */
    useEffect(() => {
        if (!instances || instances.length === 0) return;

        let active = true;
        const loadDefinitions = async () => {
            setWfdLoading(true);
            const defs = { ...wfdDefinitions };
            let updated = false;
            
            for (const inst of instances) {
                const workflowId = inst.WorkflowId;
                if (defs[workflowId]) continue; // already loaded

                // Try server first
                let parsed = await workflowAnalyticsService.getWfdDefinition(workflowId);
                
                // Fallback to localStorage
                if (!parsed) {
                    const savedWfdStr = localStorage.getItem(`wfd_def_${workflowId}`);
                    if (savedWfdStr) {
                        try { parsed = JSON.parse(savedWfdStr); } catch { /* ignore */ }
                    }
                }

                if (parsed) {
                    defs[workflowId] = parsed;
                    updated = true;
                }
            }

            if (active && updated) {
                setWfdDefinitions(defs);
            }
            if (active) {
                setWfdLoading(false);
            }
        };

        loadDefinitions();
        return () => { active = false; };
    }, [instances, wfdUpdateCounter]);

    /* Build the merged graph for the active workflow tab */
    const mergedGraph = useMemo(() => {
        if (!instances || instances.length === 0 || !instances[activeTab]) return null;

        const instance = instances[activeTab];
        const rawHistory = instance.HistorySteps || [];
        const analyzedHistory = WorkflowHistoryAnalyzer.analyze(rawHistory);

        let parsedDef = wfdDefinitions[instance.WorkflowId] || null;
        let isFallback = false;

        if (!parsedDef) {
            parsedDef = generateFallbackGraph(analyzedHistory);
            isFallback = true;
        }

        const graph = WorkflowGraphBuilder.build(parsedDef.activities, parsedDef.connections);
        const merged = WorkflowTimelineEngine.merge(graph, analyzedHistory);
        return { ...merged, isFallback };
    }, [instances, activeTab, wfdDefinitions]);

    const currentInstance = instances[activeTab] || null;

    /* ── Render ───────────────────────────────────────────────────── */
    return (
        <div
            className={`flex flex-col bg-white ${isFullscreen ? 'fixed inset-0 z-[9999]' : 'min-h-screen'}`}
            style={{ fontFamily: "'Inter', 'Roboto', sans-serif" }}
        >
            {/* ── Header ── */}
            <header className="shrink-0 flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 shadow">
                        <FaProjectDiagram className="text-white text-sm" />
                    </div>
                    <div>
                        <h1 className="text-slate-800 font-semibold text-sm leading-tight">
                            Diagrama do Workflow
                        </h1>
                        {cabinetId && documentId && (
                            <p className="text-slate-400 text-[11px] leading-tight font-mono">
                                doc: {documentId} · armário: {cabinetId}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Fullscreen toggle */}
                    <button
                        type="button"
                        onClick={() => setIsFullscreen(f => !f)}
                        className="btn btn-xs btn-ghost text-slate-500 hover:bg-slate-100 border border-slate-200"
                        title={isFullscreen ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'}
                    >
                        {isFullscreen ? <FaCompress /> : <FaExpand />}
                    </button>
                </div>
            </header>

            {/* ── Workflow instance tabs (only shown if multiple) ── */}
            {instances.length > 1 && (
                <div className="shrink-0 flex items-center gap-1 px-4 pt-2 pb-0 bg-white border-b border-slate-200 overflow-x-auto">
                    {instances.map((inst, idx) => (
                        <button
                            key={inst.Id || idx}
                            type="button"
                            onClick={() => setActiveTab(idx)}
                            className={`px-3 py-1.5 text-[11px] font-medium rounded-t whitespace-nowrap transition-colors ${
                                activeTab === idx
                                    ? 'bg-slate-50 text-indigo-600 border-t border-l border-r border-slate-200'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                            {inst.Name || `Instância ${idx + 1}`}
                            {inst.Version != null && (
                                <span className="ml-1 text-slate-500 text-[10px]">v{inst.Version}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Fallback notice ── */}
            {mergedGraph?.isFallback && !loading && !error && (
                <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-700 text-[11px]">
                    <FaExclamationTriangle className="shrink-0" />
                    Diagrama simplificado gerado a partir do histórico (definição original .wfd não carregada).
                </div>
            )}

            {/* ── Main diagram area ── */}
            <main className="flex-1 min-h-0 relative bg-white">
                {authLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                        <FaSpinner className="text-3xl text-indigo-500 animate-spin" />
                        <span className="text-sm font-medium text-slate-500 animate-pulse">Autenticando acesso ao diagrama...</span>
                    </div>
                ) : loading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                        <FaSpinner className="text-3xl text-indigo-500 animate-spin" />
                        <span className="text-sm font-medium text-slate-500 animate-pulse">Carregando diagrama...</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
                        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-50 border border-red-200">
                            <FaExclamationTriangle className="text-2xl text-red-500" />
                        </div>
                        <div>
                            <p className="text-slate-800 font-semibold text-sm mb-1">Erro ao carregar diagrama</p>
                            <p className="text-slate-500 text-xs max-w-sm">{error}</p>
                        </div>
                        {(!cabinetId || !documentId) && (
                            <p className="text-slate-400 text-[11px] font-mono bg-slate-50 rounded px-3 py-2 border border-slate-200">
                                Exemplo: /workflow-diagram?fc=CABINET_ID&did=DOCUMENT_ID
                            </p>
                        )}
                    </div>
                ) : mergedGraph ? (
                    <TimelineViewer
                        nodes={mergedGraph.nodes}
                        edges={mergedGraph.edges}
                        height="h-full"
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                        <FaProjectDiagram className="text-4xl text-slate-300" />
                        <p className="text-sm text-slate-500">Nenhum diagrama disponível.</p>
                    </div>
                )}
            </main>
        </div>
    );
};

export default WorkflowDiagramPage;
