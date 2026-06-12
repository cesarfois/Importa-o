import React, { useState, useEffect, useRef } from 'react';
import { FaFileCsv, FaDownload, FaStop, FaHistory } from 'react-icons/fa';
import { workflowAnalyticsService } from '../services/workflowAnalyticsService';
import { docuwareService } from '../services/docuwareService';
import SearchForm from '../components/Documents/SearchForm';
import ResultsTable from '../components/Documents/ResultsTable';

const ExportacaoGestoresPage = () => {
    // --- State ---
    const [stats, setStats] = useState({ totalDocs: 0, foundDocs: 0 });
    const [searchResults, setSearchResults] = useState([]);
    const [cabinetId, setCabinetId] = useState('');
    const [isSearching, setIsSearching] = useState(false);

    // Export State
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState({ current: 0, total: 0, success: 0, fail: 0 });
    const [logs, setLogs] = useState([]);
    const cancelExportRef = useRef(false);

    // --- Helpers ---
    const addLog = (msg) => {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 500));
    };

    // --- Handlers ---
    const handleCabinetSelect = async (selectedCabinetId) => {
        setCabinetId(selectedCabinetId);
        setSearchResults([]);
        setStats({ totalDocs: 0, foundDocs: 0 });
        if (selectedCabinetId) {
            try {
                const count = await docuwareService.getCabinetCount(selectedCabinetId);
                setStats(prev => ({ ...prev, totalDocs: count }));
            } catch (err) {
                console.error(err);
            }
        }
    };

    const handleSearch = async (selectedCabinetId, filters, allFields, resultLimit) => {
        setIsSearching(true);
        setLogs([]); // Clear logs on new search
        setSearchResults([]);
        try {
            addLog(`Searching in cabinet ${selectedCabinetId} (Limit: ${resultLimit})...`);
            const response = await docuwareService.searchDocuments(selectedCabinetId, filters, resultLimit);
            setSearchResults(response.items || []);
            setStats(prev => ({ ...prev, foundDocs: response.items.length }));
            addLog(`✅ Search Complete. Found ${response.items.length} documents.`);
        } catch (err) {
            addLog(`❌ Search Failed: ${err.message}`);
        } finally {
            setIsSearching(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return '';
        let d;
        if (typeof dateString === 'string' && dateString.startsWith('/Date(')) {
            // Support negative timestamps
            const timestamp = parseInt(dateString.match(/-?\d+/)[0]);
            d = new Date(timestamp);
        } else {
            d = new Date(dateString);
        }

        if (!isNaN(d.getTime())) {
            // Filter out "min value" dates
            if (d.getFullYear() < 2000) return '';

            // Return ISO format YYYY-MM-DD HH:mm (UTC)
            return d.toISOString().replace('T', ' ').substring(0, 16);
        }
        return '';
    };

    const formatDuration = (startDateStr, endDateStr) => {
        if (!startDateStr || !endDateStr) return '';
        
        let start, end;
        if (typeof startDateStr === 'string' && startDateStr.startsWith('/Date(')) {
            const timestamp = parseInt(startDateStr.match(/-?\d+/)[0]);
            start = new Date(timestamp);
        } else {
            start = new Date(startDateStr);
        }
        
        if (typeof endDateStr === 'string' && endDateStr.startsWith('/Date(')) {
            const timestamp = parseInt(endDateStr.match(/-?\d+/)[0]);
            end = new Date(timestamp);
        } else {
            end = new Date(endDateStr);
        }

        if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';

        const diffMs = end.getTime() - start.getTime();
        if (diffMs < 0) return '0s';

        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffDays > 0) {
            return `${diffDays}d ${diffHours % 24}h ${diffMins % 60}m`;
        }
        if (diffHours > 0) {
            return `${diffHours}h ${diffMins % 60}m`;
        }
        if (diffMins > 0) {
            return `${diffMins}m ${diffSecs % 60}s`;
        }
        return `${diffSecs}s`;
    };

    // --- Bulk Export Logic ---
    const handleBulkExport = async () => {
        if (!searchResults.length) return;

        setIsExporting(true);
        cancelExportRef.current = false;
        setExportProgress({ current: 0, total: searchResults.length, success: 0, fail: 0 });
        addLog(`🚀 Starting Bulk History Export for ${searchResults.length} documents...`);

        const allRows = [];
        let dynamicFields = [];

        // Helper to format CSV Value
        const escapeCsv = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(';') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const BATCH_SIZE = 10; // Process 10 docs in parallel for better speed 

        try {
            for (let i = 0; i < searchResults.length; i += BATCH_SIZE) {
                if (cancelExportRef.current) break;

                const batch = searchResults.slice(i, i + BATCH_SIZE);
                const batchPromises = batch.map(async (doc) => {
                    const docId = doc.Id;
                    try {
                        // Fetch History
                        const instances = await workflowAnalyticsService.getHistoryByDocId(docId, cabinetId);

                        // Extract fields for CSV
                        const docFields = {};
                        if (doc.Fields) {
                            doc.Fields.forEach(f => {
                                const val = f.Item || f.Int || f.Decimal || f.Date || f.DateTime || '';
                                docFields[f.FieldName] = val;
                                if (!dynamicFields.includes(f.FieldName)) dynamicFields.push(f.FieldName);
                            });
                        }

                        // Process Instances
                        if (!instances || instances.length === 0) {
                            // Row for Doc with No History
                            return [{
                                'Instance GUID': '',
                                'DOCID': docId,
                                'Instância': 'Sem Histórico',
                                'Versão': '',
                                'Iniciado Em': '',
                                'Atividade': '',
                                'Tipo Atividade': '',
                                'Decisão': '',
                                'Usuário': '',
                                'Data Início Tarefa': '',
                                'Data Decisão': '',
                                'Link Documento': docuwareService.getDocumentViewUrl(cabinetId, docId),
                                ...docFields
                            }];
                        }

                        const docRows = [];
                        instances.sort((a, b) => (b.Version || 0) - (a.Version || 0)); // Sort versions

                        instances.forEach(instance => {
                            const steps = instance.HistorySteps || [];

                            // Check if this instance has both a 'Start' step and an 'End' step
                            const hasStart = steps.some(s => (s.ActivityType || '').trim().toLowerCase() === 'start');
                            const hasEnd = steps.some(s => (s.ActivityType || '').trim().toLowerCase() === 'end');
                            const isFinished = (hasStart && hasEnd) ? 'Sim' : 'Não';

                            steps.forEach(step => {
                                // Extract User
                                const infoItem = step.Info?.Item || {};
                                let validUser = infoItem.UserName || step.User || step.UserName || '';
                                if (!validUser && infoItem.AssignedUsers && Array.isArray(infoItem.AssignedUsers)) {
                                    validUser = infoItem.AssignedUsers.join(', ');
                                }

                                const validDate = infoItem.DecisionDate || step.StepDate || step.TimeStamp || '';
                                const validDecision = infoItem.DecisionName || step.DecisionLabel || '';
                                const stepStartDate = step.StepDate || '';

                                // Filter: return only records where ActivityType is 'Start', 'general task', or 'End'
                                const activityType = (step.ActivityType || '').trim().toLowerCase();
                                const isAllowed = ['start', 'general task', 'end'].includes(activityType);

                                if (isAllowed) {
                                    docRows.push({
                                        'Instance GUID': instance.Id,
                                        'DOCID': docId,
                                        'Instância': instance.Name,
                                        'Versão': instance.Version,
                                        'Iniciado Em': formatDate(instance.StartDate || instance.StartedAt),
                                        'Atividade': step.ActivityName || step.Name,
                                        'Tipo Atividade': step.ActivityType,
                                        'Data Início Tarefa': formatDate(stepStartDate),
                                        'Decisão': validDecision,
                                        'Usuário': validUser,
                                        'Data Decisão': formatDate(validDate),
                                        'Link Documento': docuwareService.getDocumentViewUrl(cabinetId, docId),
                                        'CC_Fluxo_Finalizado': isFinished,
                                        'CC_Tempo_Execução': formatDuration(stepStartDate, validDate),
                                        ...docFields
                                    });
                                }
                            });
                        });
                        return docRows;

                    } catch (err) {
                        console.error(`Error processing doc ${docId}`, err);
                        return [{
                            'DOCID': docId,
                            'Instância': 'ERRO AO BUSCAR HISTÓRICO',
                            'Link Documento': docuwareService.getDocumentViewUrl(cabinetId, docId)
                        }];
                    }
                });

                const batchResults = await Promise.all(batchPromises);

                batchResults.forEach(res => {
                    if (res && res.length > 0) {
                        allRows.push(...res);
                        setExportProgress(prev => ({ ...prev, success: prev.success + 1 }));
                    } else {
                        setExportProgress(prev => ({ ...prev, fail: prev.fail + 1 }));
                    }
                });

                setExportProgress(prev => ({ ...prev, current: Math.min(prev.current + BATCH_SIZE, prev.total) }));
            }

            if (cancelExportRef.current) {
                addLog('🛑 Export cancelled by user.');
            } else {
                addLog(`✅ Processing complete. Generating CSV with ${allRows.length} rows...`);

                // Generate CSV
                dynamicFields.sort();
                const fixedHeaders = [
                    'Instance GUID', 'DOCID', 'Instância', 'Versão', 'Iniciado Em',
                    'Atividade', 'Tipo Atividade', 'Data Início Tarefa', 'Decisão', 'Usuário', 'Data Decisão', 'Link Documento', 'CC_Fluxo_Finalizado', 'CC_Tempo_Execução'
                ];

                const finalHeaders = [...fixedHeaders, ...dynamicFields];

                const headerRow = finalHeaders.map(escapeCsv).join(';');
                const csvRows = allRows.map(row => {
                    return finalHeaders.map(header => {
                        let val = row[header];
                        if (val && typeof val === 'string' && val.includes('/Date(')) val = formatDate(val);
                        return escapeCsv(val);
                    }).join(';');
                });

                const csvContent = [headerRow, ...csvRows].join('\n');

                const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `Bulk_Export_Workflow_${new Date().getTime()}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                addLog('💾 CSV Download started.');
            }

        } catch (err) {
            console.error('Export Global Error:', err);
            addLog(`💥 Critical Error: ${err.message}`);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="p-6 max-w-[95%] mx-auto space-y-6">

            {/* Main Header */}
            <div className="flex items-center space-x-4">
                <div className="p-3 bg-base-200 rounded-full">
                    <FaFileCsv className="w-8 h-8 text-[#00bfff]" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold text-base-content">Exportação Gestores</h1>
                    <p className="text-base-content/60 mt-1">
                        Área de exportação analítica em CSV de históricos de workflows para gestores.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-6">

                {/* Section Header: Title & Export CSV Button */}
                <div className="flex items-center justify-between bg-base-100 p-4 rounded-xl shadow-sm border border-base-200">
                    <div className="flex items-center space-x-3">
                        <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#0a1e3f] text-white font-bold">1</span>
                        <h2 className="text-xl font-semibold text-base-content">Define Export Data</h2>
                    </div>

                    <div className="flex items-center gap-3">
                        {!isExporting ? (
                            <button
                                className="btn btn-outline btn-success btn-sm gap-2"
                                onClick={handleBulkExport}
                                disabled={searchResults.length === 0}
                            >
                                <FaDownload /> Export CSV
                            </button>
                        ) : (
                            <button
                                className="btn btn-error btn-outline btn-sm gap-2"
                                onClick={() => { cancelExportRef.current = true; }}
                            >
                                <FaStop /> Cancelar Exportação
                            </button>
                        )}
                    </div>
                </div>

                {/* Export Progress Bar */}
                {isExporting && (
                    <div className="card bg-base-100 shadow-md p-4 border border-base-200">
                        <div className="flex justify-between text-xs font-semibold mb-2">
                            <span>Progresso: {exportProgress.current} / {exportProgress.total}</span>
                            <span>Sucesso: {exportProgress.success}</span>
                        </div>
                        <progress
                            className="progress progress-primary w-full h-3"
                            value={exportProgress.current}
                            max={exportProgress.total}
                        ></progress>
                    </div>
                )}

                {/* Search Form Section */}
                <div className="w-full">
                    <SearchForm
                        onSearch={handleSearch}
                        onLog={addLog}
                        totalCount={stats.totalDocs}
                        onCabinetChange={handleCabinetSelect}
                    />
                </div>

                {/* Results Section */}
                <div className="w-full">
                    <ResultsTable
                        results={searchResults}
                        totalDocs={stats.totalDocs}
                        cabinetId={cabinetId}
                    />
                </div>
            </div>
        </div>
    );
};

export default ExportacaoGestoresPage;
