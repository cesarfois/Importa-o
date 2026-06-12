import React, { useState, useEffect, useRef } from 'react';
import { FaFileCsv, FaSearch, FaHistory, FaCheckCircle, FaTimesCircle, FaClock, FaUser, FaBan, FaList, FaDownload, FaStop } from 'react-icons/fa';
import { workflowAnalyticsService } from '../services/workflowAnalyticsService';
import { docuwareService } from '../services/docuwareService';
import SearchForm from '../components/Documents/SearchForm';
import ResultsTable from '../components/Documents/ResultsTable';

const ExportDataPage = () => {
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

    // --- Bulk Export Logic ---

    const handleBulkExport = async () => {
        if (!searchResults.length) return;

        setIsExporting(true);
        cancelExportRef.current = false;
        setExportProgress({ current: 0, total: searchResults.length, success: 0, fail: 0 });
        addLog(`🚀 Starting Bulk History Export for ${searchResults.length} documents...`);

        const allRows = [];
        // Define CSV Headers
        // We will collect specific field names dynamically from the first document if possible, 
        // OR we just use standard ones + whatever fields are in result.
        // Getting fields for *every* doc might be heavy if we want ALL fields. 
        // The search result usually contains basic index fields. 

        // Let's assume we want: Standard Columns + All Index Fields available in search result.
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

                        // Extract fields for CSV (just once to build header list?) 
                        // Actually, we can just grab them from the 'doc' object which has 'Fields' usually from search
                        // Search result 'Fields' is array: [{FieldName, Item, ...}]
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
                            // Filter logic (optional, keep 'show all' for export usually?)
                            // Let's keep the filter for "User facing" to avoid noise, unless user wants ALL.
                            // User request: "todo o histórico". So let's include relevant ones, standardizing on important steps.

                            if (steps.length === 0) {
                                docRows.push({
                                    'Instance GUID': instance.Id,
                                    'DOCID': docId,
                                    'Instância': instance.Name,
                                    'Versão': instance.Version,
                                    'Iniciado Em': formatDate(instance.StartDate || instance.StartedAt),
                                    'Atividade': '(Sem passos)',
                                    'Link Documento': docuwareService.getDocumentViewUrl(cabinetId, docId),
                                    ...docFields
                                });
                            } else {
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
                                        ...docFields
                                    });
                                });
                            }
                        });
                        return docRows;

                    } catch (err) {
                        console.error(`Error processing doc ${docId}`, err);
                        // Return error row
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

                // 3. Generate CSV
                dynamicFields.sort();
                const fixedHeaders = [
                    'Instance GUID', 'DOCID', 'Instância', 'Versão', 'Iniciado Em',
                    'Atividade', 'Tipo Atividade', 'Data Início Tarefa', 'Decisão', 'Usuário', 'Data Decisão', 'Link Documento'
                ];

                const finalHeaders = [...fixedHeaders, ...dynamicFields];

                const headerRow = finalHeaders.map(escapeCsv).join(';');
                const csvRows = allRows.map(row => {
                    return finalHeaders.map(header => {
                        let val = row[header];
                        // Handle date objects in dynamic fields if any
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

            {/* Header */}
            <div className="flex items-center space-x-4">
                <div className="p-3 bg-base-200 rounded-full">
                    <FaFileCsv className="w-8 h-8 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold text-base-content">Export Data</h1>
                    <p className="text-base-content/60 mt-1">
                        Pesquisa em massa e exportação de histórico de workflows.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-6">

                {/* Search Form Section */}
                <div className="w-full">
                    <SearchForm
                        onSearch={handleSearch}
                        onLog={addLog}
                        totalCount={stats.totalDocs}
                        onCabinetChange={handleCabinetSelect}
                    />
                </div>

                {/* Results & Actions Section */}
                <div className="w-full space-y-6">

                    {/* Action Card */}
                    {searchResults.length > 0 && (
                        <div className="card bg-base-100 shadow-xl border-l-4 border-primary">
                            <div className="card-body p-6 flex flex-row items-center justify-between">
                                <div>
                                    <h3 className="card-title text-lg">Documentos Encontrados: {searchResults.length}</h3>
                                    <p className="text-sm text-gray-500">Pronto para processar o histórico.</p>
                                </div>
                                <div className="flex gap-3">
                                    {!isExporting ? (
                                        <button
                                            className="btn btn-primary gap-2"
                                            onClick={handleBulkExport}
                                        >
                                            <FaDownload /> Exportar Histórico Completo (.CSV)
                                        </button>
                                    ) : (
                                        <button
                                            className="btn btn-error gap-2"
                                            onClick={() => { cancelExportRef.current = true; }}
                                        >
                                            <FaStop /> Cancelar Exportação
                                        </button>
                                    )}
                                </div>
                            </div>
                            {isExporting && (
                                <div className="px-6 pb-6">
                                    <div className="flex justify-between text-xs font-semibold mb-1">
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
                        </div>
                    )}

                    {/* Main Results Table */}
                    <div className="w-full">
                        <ResultsTable
                            results={searchResults}
                            totalDocs={stats.totalDocs}
                            cabinetId={cabinetId}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExportDataPage;
