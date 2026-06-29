import React, { useState, useEffect, useMemo } from 'react';
import { 
    FaChartBar, 
    FaChartPie, 
    FaChartLine, 
    FaDollarSign, 
    FaTruck, 
    FaUserShield, 
    FaExclamationTriangle,
    FaCalendarAlt,
    FaFilter,
    FaSyncAlt,
    FaClock,
    FaArrowLeft,
    FaList,
    FaSearch,
    FaExternalLinkAlt
} from 'react-icons/fa';
import { 
    ResponsiveContainer, 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    Legend, 
    PieChart, 
    Pie, 
    Cell, 
    LineChart, 
    Line, 
    AreaChart, 
    Area,
    ComposedChart 
} from 'recharts';
import { docuwareService } from '../services/docuwareService';
import { workflowAnalyticsService } from '../services/workflowAnalyticsService';
import { WorkflowHistoryAnalyzer } from '../services/workflow/WorkflowHistoryAnalyzer';
import { WorkflowGraphBuilder } from '../services/workflow/WorkflowGraphBuilder';
import { WorkflowTimelineEngine } from '../services/workflow/WorkflowTimelineEngine';

// Helpers
const getDocFieldValue = (doc, fieldName) => {
    if (!doc || !doc.Fields) return '';
    const field = doc.Fields.find(f => f.FieldName === fieldName);
    if (!field) return '';
    return field.Item || field.Value || '';
};

const findFieldVal = (doc, searchNames) => {
    if (!doc || !doc.Fields) return '';
    const field = doc.Fields.find(f => {
        const dbName = (f.FieldName || '').toUpperCase();
        return searchNames.some(name => dbName === name.toUpperCase() || dbName.includes(name.toUpperCase()));
    });
    if (!field) return '';
    return field.Item || field.Value || '';
};

const getDocumentNumber = (doc) => {
    if (!doc) return 'Sem Nº';
    return getDocFieldValue(doc, 'NO_PROCESSO_IMPORTACAO') || 
           getDocFieldValue(doc, 'NUMERO_PROCESSO') || 
           getDocFieldValue(doc, 'NO_PROCESSO') || 
           getDocFieldValue(doc, 'NUMERO_PEDIDO') || 
           getDocFieldValue(doc, 'NO_PEDIDO') || 
           doc.Id || 'Sem Nº';
};

const parseCurrency = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const clean = String(val).replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
};

const formatKwanza = (value) => {
    if (value === undefined || value === null || isNaN(value)) return 'Kz 0,00';
    return new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA', currencyDisplay: 'code' })
        .format(value)
        .replace('AOA', 'Kz')
        .trim();
};

const parseDWDate = (dateStr) => {
    if (!dateStr) return null;
    if (typeof dateStr === 'string' && dateStr.startsWith('/Date(')) {
        const match = dateStr.match(/-?\d+/);
        if (match) return new Date(parseInt(match[0]));
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
};

// Evaluate stage index
const evaluateActiveStage = (doc, activeTaskName, isFinished) => {
    const hasDataEntregue = !!findFieldVal(doc, ['DATA_ENTREGUE', 'DATA_ENTREGUE_RCS', 'ENTREGUE']);
    const estatutoVal = String(findFieldVal(doc, ['ESTATUTO', 'STATUS'])).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const isEstatutoConcluido = estatutoVal.includes('concluid') || estatutoVal.includes('finaliz');
    if (isFinished || hasDataEntregue || isEstatutoConcluido) return 6;

    const hasStage5Fields = [
        'MONTANTE_RDF', 'PAGAMENTO_RDF', 'DIREITO_ALFANDEGARIOS', 'DIREITOS_ALFANDEGARIOS', 'DIREITO_ALFAND',
        'VALOR_IVA_IMPORTACAO', 'IVA_IMPORTACAO', 'SERVICOS_DESPACHANTES', 'SERVICO_DESPACHANTE'
    ].some(term => !!findFieldVal(doc, [term]));

    const hasStage4Fields = [
        'DATA_CHEGADA', 'CHEGADA_AO', 'DATA_ENTRADA_INSPECAO', 'ENTRADA_INSPECAO', 'DATA_SAIDA_INSPECAO', 'SAIDA_INSPECAO', 'DATA_DESPACHO'
    ].some(term => !!findFieldVal(doc, [term]));

    const hasStage3Fields = [
        'TRANSPORTADOR', 'AWB_BL', 'AWB', 'BL', 'DATA_AWB_BL', 'DESPACHANTE', 'DATA_AVISO_DESPACHANTE', 'AVISO_DESPACHANTE',
        'NO_DOCUMENTO_TRANSPORTE', 'NUMERO_DOCUMENTO_TRANSPORTE', 'DOCUMENTO_TRANSPORTE'
    ].some(term => !!findFieldVal(doc, [term]));

    const certificates = ['INACOM', 'INIQ', 'IANORQ', 'MINDICOM', 'MINAMB', 'CNCA', 'MINCO'];
    let hasStage2Fields = false;
    for (const cert of certificates) {
        const ped = findFieldVal(doc, [`PEDIDO_${cert}`, `PEDIDO__${cert}_`]);
        const rec = findFieldVal(doc, [`RECEBIMENTO_${cert}`, `RECEBIMENTO__${cert}_`]);
        if (ped || rec) {
            hasStage2Fields = true;
            break;
        }
    }

    const activeTaskNorm = (activeTaskName || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (activeTaskNorm.includes('daf') || activeTaskNorm.includes('contas a pagar') || activeTaskNorm.includes('custos')) {
        return 5;
    }
    if (activeTaskNorm.includes('despachante') || activeTaskNorm.includes('aduaneiro') || activeTaskNorm.includes('processo aduaneiro')) {
        if (hasStage4Fields) return 4;
        return 3;
    }

    if (hasStage5Fields) return 5;
    if (hasStage4Fields) return 4;
    if (hasStage3Fields) return 3;
    if (hasStage2Fields) return 2;

    return 1; // Stage 1: Operador
};

const getStageName = (idx) => {
    switch (idx) {
        case 1: return 'Operador';
        case 2: return 'Certificados';
        case 3: return 'Despachante';
        case 4: return 'Em Trânsito';
        case 5: return 'Alfândega / DAF';
        case 6: return 'Finalizado';
        default: return 'Operador';
    }
};

// Reusable DetailDrillDown component
const DetailDrillDown = ({ groupKey, groupValue, allProcesses, handleOpenDocument, onClose }) => {
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState('docNum');
    const [sortDir, setSortDir] = useState('asc');
    
    // Filters inside drilldown
    const [filterFornecedor, setFilterFornecedor] = useState('all');
    const [filterEstado, setFilterEstado] = useState('all');
    const [filterTipoCarga, setFilterTipoCarga] = useState('all');

    // 1. Filter processes belonging to the selected group
    const groupProcesses = useMemo(() => {
        return allProcesses.filter(p => {
            const val = String(p[groupKey] || '-').trim();
            return val.toLowerCase() === String(groupValue || '').trim().toLowerCase();
        });
    }, [allProcesses, groupKey, groupValue]);

    // Calculate unique values for filters inside group
    const filterOptions = useMemo(() => {
        const suppliers = new Set();
        const cargoTypes = new Set();
        groupProcesses.forEach(p => {
            if (p.fornecedor && p.fornecedor !== '-') suppliers.add(p.fornecedor);
            if (p.tipoCarga && p.tipoCarga !== '-') cargoTypes.add(p.tipoCarga);
        });
        return {
            suppliers: Array.from(suppliers).sort(),
            cargoTypes: Array.from(cargoTypes).sort()
        };
    }, [groupProcesses]);

    // 2. Calculate summary statistics for the selected group
    const summary = useMemo(() => {
        const count = groupProcesses.length;
        let totalValue = 0;
        let totalExpenses = 0;
        let totalDays = 0;
        let daysCount = 0;
        const coefs = [];

        groupProcesses.forEach(p => {
            const totalCosts = p.frete + p.custosAdicionais + p.servicosDespachante + p.direitos + p.iva + p.rdf;
            totalValue += (p.valMercadoria + totalCosts);
            totalExpenses += totalCosts;
            
            if (typeof p.diasTotais === 'number' && p.diasTotais > 0) {
                totalDays += p.diasTotais;
                daysCount++;
            }
            if (p.coeficienteNumeric > 0) {
                coefs.push(p.coeficienteNumeric);
            }
        });

        const avgCost = count > 0 ? Math.round(totalExpenses / count) : 0;
        const avgCoef = coefs.length > 0 ? (coefs.reduce((a, b) => a + b, 0) / coefs.length).toFixed(2) : 'N/D';
        const avgTime = daysCount > 0 ? `${Math.round(totalDays / daysCount)} dias` : 'N/D';

        return {
            count,
            totalValue,
            avgCost,
            avgCoef,
            avgTime
        };
    }, [groupProcesses]);

    // 3. Apply search, sort, and filters to group processes
    const processedList = useMemo(() => {
        let list = [...groupProcesses];

        // Search
        if (search.trim() !== '') {
            const s = search.toLowerCase();
            list = list.filter(p => 
                p.docNum.toLowerCase().includes(s) ||
                p.responsavel.toLowerCase().includes(s) ||
                p.fornecedor.toLowerCase().includes(s) ||
                p.tipoCarga.toLowerCase().includes(s)
            );
        }

        // Filters
        if (filterFornecedor !== 'all') {
            list = list.filter(p => p.fornecedor === filterFornecedor);
        }
        if (filterEstado !== 'all') {
            list = list.filter(p => p.statusFinal === filterEstado);
        }
        if (filterTipoCarga !== 'all') {
            list = list.filter(p => p.tipoCarga === filterTipoCarga);
        }

        // Sort
        if (sortBy) {
            list.sort((a, b) => {
                let valA = a[sortBy];
                let valB = b[sortBy];

                if (sortBy === 'custoTotal') {
                    valA = a.frete + a.custosAdicionais + a.servicosDespachante + a.direitos + a.iva + a.rdf;
                    valB = b.frete + b.custosAdicionais + b.servicosDespachante + b.direitos + b.iva + b.rdf;
                } else if (sortBy === 'coeficiente') {
                    valA = a.coeficienteNumeric || 0;
                    valB = b.coeficienteNumeric || 0;
                } else if (sortBy === 'diasTotais') {
                    valA = typeof a.diasTotais === 'number' ? a.diasTotais : 0;
                    valB = typeof b.diasTotais === 'number' ? b.diasTotais : 0;
                }

                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();

                if (valA < valB) return sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return list;
    }, [groupProcesses, search, sortBy, sortDir, filterFornecedor, filterEstado, filterTipoCarga]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                    <h3 className="font-bold text-slate-800 text-sm">
                        Processos do Despachante: <span className="text-indigo-600 font-extrabold">{groupValue}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                        Exibindo {processedList.length} processos pertencentes ao despachante selecionado.
                    </p>
                </div>
                <button onClick={onClose} className="btn btn-sm btn-ghost text-rose-500 font-bold hover:bg-rose-50 rounded-lg">
                    Fechar
                </button>
            </div>

            {/* Resumo Executivo / Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Quantidade de processos</span>
                    <span className="text-base font-black text-slate-800 mt-1">{summary.count}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Valor total movimentado</span>
                    <span className="text-base font-black text-slate-800 mt-1 font-mono">{formatKwanza(summary.totalValue)}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Custo médio por processo</span>
                    <span className="text-base font-black text-amber-600 mt-1 font-mono">{formatKwanza(summary.avgCost)}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Coeficiente médio</span>
                    <span className="text-base font-black text-emerald-600 mt-1 font-mono">{summary.avgCoef}</span>
                </div>
                <div className="flex flex-col col-span-2 md:col-span-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Tempo médio da importação</span>
                    <span className="text-base font-black text-indigo-600 mt-1">{summary.avgTime}</span>
                </div>
            </div>

            {/* Quick Actions (Search) */}
            <div className="flex flex-col lg:flex-row gap-3 items-center justify-between">
                {/* Search */}
                <div className="relative w-full lg:w-72">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-slate-400">
                        <FaSearch className="text-xs" />
                    </span>
                    <input 
                        type="text" 
                        placeholder="Buscar por nº processo, responsável..." 
                        className="input input-bordered input-xs pl-8 bg-white text-slate-700 w-full rounded-lg"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Drilldown Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-80 scrollbar-thin">
                <table className="table table-compact w-full text-[10px]">
                    <thead>
                        <tr className="bg-slate-50">
                            <th className="bg-slate-100 text-slate-600 font-bold sticky top-0">Nº Processo</th>
                            <th className="bg-slate-100 text-slate-600 font-bold sticky top-0">Data Entrada</th>
                            <th className="bg-slate-100 text-slate-600 font-bold sticky top-0">Fornecedor</th>
                            <th className="bg-slate-100 text-slate-600 font-bold sticky top-0">Tipo Carga</th>
                            <th className="bg-slate-100 text-slate-600 font-bold sticky top-0">Estado Atual</th>
                            <th className="bg-slate-100 text-slate-600 font-bold sticky top-0">Responsável</th>
                            <th className="bg-slate-100 text-slate-600 font-bold text-center sticky top-0">Dias Importação</th>
                            <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0">V. Mercadoria</th>
                            <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0">Frete</th>
                            <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0">Custos Adicionais</th>
                            <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0">Custo Total</th>
                            <th className="bg-slate-100 text-slate-600 font-bold text-center sticky top-0">Coeficiente</th>
                            <th className="bg-slate-100 text-slate-600 font-bold text-center sticky top-0">Ação</th>
                        </tr>
                    </thead>
                    <tbody>
                        {processedList.map((p, idx) => {
                            const totalCosts = p.frete + p.custosAdicionais + p.servicosDespachante + p.direitos + p.iva + p.rdf;
                            return (
                                <tr key={idx} className="hover:bg-slate-50/50">
                                    <td className="font-bold text-slate-700">{p.docNum}</td>
                                    <td>{p.dtBollore}</td>
                                    <td className="max-w-[120px] truncate" title={p.fornecedor}>{p.fornecedor}</td>
                                    <td>{p.tipoCarga}</td>
                                    <td>
                                        <span className="font-semibold text-slate-600">{p.etapa}</span>
                                    </td>
                                    <td className="max-w-[120px] truncate" title={p.responsavel}>{p.responsavel}</td>
                                    <td className="text-center font-mono font-bold">{p.diasTotais} {p.isParcial ? '(parcial)' : ''}</td>
                                    <td className="text-right font-mono">{formatKwanza(p.valMercadoria)}</td>
                                    <td className="text-right font-mono">{formatKwanza(p.frete)}</td>
                                    <td className="text-right font-mono">{formatKwanza(p.custosAdicionais)}</td>
                                    <td className="text-right font-mono font-bold text-indigo-600">{formatKwanza(totalCosts)}</td>
                                    <td className="text-center font-mono font-bold text-emerald-600">{p.coeficienteText}</td>
                                    <td className="text-center">
                                        <button 
                                            onClick={() => handleOpenDocument(p.id)}
                                            className="btn btn-xs btn-outline btn-primary font-bold flex items-center gap-1 mx-auto rounded-lg"
                                        >
                                            Abrir Documento
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {processedList.length === 0 && (
                            <tr>
                                <td colSpan={13} className="text-center py-6 text-slate-400 italic">Nenhum processo correspondente.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const WorkflowAnalyticsPage = () => {
    // --- Date Filter Setup (Default: 6 months ago to today) ---
    const getTodayString = () => new Date().toISOString().split('T')[0];
    const getSixMonthsAgoString = () => {
        const d = new Date();
        d.setMonth(d.getMonth() - 6);
        return d.toISOString().split('T')[0];
    };

    const [dateRange, setDateRange] = useState([getSixMonthsAgoString(), getTodayString()]);
    const [selectedCabinet, setSelectedCabinet] = useState('c31ae087-921c-4985-bfcc-7b32de369db8');
    const [activeTab, setActiveTab] = useState('visao_operacional');
    const [selectedDespachanteGroup, setSelectedDespachanteGroup] = useState(null);
    const [detectedTypeField, setDetectedTypeField] = useState(null);
    const [detectedDateField, setDetectedDateField] = useState(null);

    // Loaded Data
    const [documents, setDocuments] = useState([]);
    const [documentProgress, setDocumentProgress] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // Global Filter Selection States
    const [selectedDespachante, setSelectedDespachante] = useState('all');
    const [selectedFornecedor, setSelectedFornecedor] = useState('all');
    const [selectedTipoCarga, setSelectedTipoCarga] = useState('all');
    const [selectedTransportador, setSelectedTransportador] = useState('all');
    const [selectedEstado, setSelectedEstado] = useState('all');
    const [selectedResponsavel, setSelectedResponsavel] = useState('all');

    // Visão Detalhada States
    const [detailSearch, setDetailSearch] = useState('');
    const [detailSort, setDetailSort] = useState({ column: 'docNum', direction: 'asc' });

    // Column Filters States
    const [colFilters, setColFilters] = useState({
        docNum: [],
        etapa: [],
        responsavel: [],
        despachante: [],
        fornecedor: [],
        tipoCarga: [],
        statusFinal: [],
        qualidade: []
    });

    const [colSearchTerms, setColSearchTerms] = useState({
        docNum: '',
        etapa: '',
        responsavel: '',
        despachante: '',
        fornecedor: '',
        tipoCarga: '',
        statusFinal: '',
        qualidade: ''
    });

    const renderFilterHeader = (label, colKey, widthClass = '') => {
        const uniqueVals = Array.from(new Set(detailedProcesses.map(p => String(p[colKey] || '-').trim()))).sort();
        const selectedVals = colFilters[colKey] || [];
        const searchTerm = colSearchTerms[colKey] || '';
        const filteredVals = uniqueVals.filter(v => v.toLowerCase().includes(searchTerm.toLowerCase()));

        const toggleVal = (val) => {
            setColFilters(prev => {
                const current = prev[colKey] || [];
                const next = current.includes(val) 
                    ? current.filter(x => x !== val) 
                    : [...current, val];
                return { ...prev, [colKey]: next };
            });
        };

        const clearFilter = () => {
            setColFilters(prev => ({ ...prev, [colKey]: [] }));
            setColSearchTerms(prev => ({ ...prev, [colKey]: '' }));
        };

        const selectAll = () => {
            setColFilters(prev => ({ ...prev, [colKey]: uniqueVals }));
        };

        const hasActiveFilter = selectedVals.length > 0;

        return (
            <th className={`bg-slate-100 text-slate-600 font-bold sticky top-0 z-10 p-2 border-b border-slate-200 ${widthClass}`}>
                <div className="flex items-center justify-between gap-1">
                    <span 
                        className="cursor-pointer hover:text-indigo-600 flex-1 select-none whitespace-nowrap" 
                        onClick={() => setDetailSort({ column: colKey, direction: detailSort.column === colKey && detailSort.direction === 'asc' ? 'desc' : 'asc' })}
                    >
                        {label} {detailSort.column === colKey ? (detailSort.direction === 'asc' ? '↑' : '↓') : ''}
                    </span>
                    
                    <div className={`dropdown dropdown-bottom ${colKey === 'docNum' || colKey === 'etapa' ? '' : 'dropdown-end'} inline-block`}>
                        <div tabIndex={0} role="button" className={`btn btn-ghost btn-xs p-1 h-auto min-h-0 ${hasActiveFilter ? 'text-indigo-600 font-bold' : 'text-slate-400'} hover:text-indigo-600`}>
                            <FaFilter className="text-[10px]" />
                        </div>
                        <div tabIndex={0} className="dropdown-content z-[30] card card-compact w-64 p-3 shadow-xl bg-white border border-slate-200 text-slate-700 mt-1 font-normal normal-case">
                            <div className="font-bold text-xs text-slate-700 border-b border-slate-100 pb-1.5 mb-2 flex items-center justify-between">
                                <span>Filtrar {label}</span>
                                {hasActiveFilter && (
                                    <button className="text-[10px] text-rose-500 font-bold hover:underline" onClick={clearFilter}>Limpar</button>
                                )}
                            </div>
                            <input 
                                type="text" 
                                placeholder="Buscar..." 
                                className="input input-bordered input-xs bg-white text-slate-700 w-full mb-2 rounded-md font-normal"
                                value={searchTerm}
                                onChange={(e) => setColSearchTerms(prev => ({ ...prev, [colKey]: e.target.value }))}
                            />
                            <div className="flex gap-2 mb-2 border-b border-slate-100 pb-2">
                                <button className="btn btn-xs btn-outline flex-1 rounded font-semibold text-[10px]" onClick={selectAll}>Todos</button>
                                <button className="btn btn-xs btn-outline flex-1 rounded font-semibold text-[10px]" onClick={clearFilter}>Limpar</button>
                            </div>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                                {filteredVals.map(val => (
                                    <label key={val} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer select-none text-[10px] font-medium text-slate-600">
                                        <input 
                                            type="checkbox" 
                                            className="checkbox checkbox-xs checkbox-primary" 
                                            checked={selectedVals.includes(val)}
                                            onChange={() => toggleVal(val)}
                                        />
                                        <span className="truncate flex-1" title={val}>{val}</span>
                                    </label>
                                ))}
                                {filteredVals.length === 0 && (
                                    <div className="text-[10px] text-slate-400 italic text-center py-2">Nenhum valor encontrado</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </th>
        );
    };

    // Load Cabinets on mount
    useEffect(() => {
        const fetchInitialCabinetAndFields = async () => {
            try {
                const cabList = await docuwareService.getCabinets();
                const targetCab = cabList.find(c => 
                    (c.Name || '').toLowerCase().includes('importac') ||
                    c.Id === 'c31ae087-921c-4985-bfcc-7b32de369db8'
                );
                const activeCabId = targetCab ? targetCab.Id : selectedCabinet;
                if (targetCab) {
                    setSelectedCabinet(targetCab.Id);
                }

                // Fetch fields to detect DocType and StorageDate fields
                const fields = await docuwareService.getCabinetFields(activeCabId);
                const textFields = fields.filter(f => f.DWFieldType === 'Text' || f.DWFieldType === 'String' || f.SystemField);
                const dateFields = fields.filter(f => f.DWFieldType === 'Date' || f.DWFieldType === 'DateTime');

                // 1. Detect Document Type field
                const typeKeywords = ['tipo', 'type', 'documento', 'doc_type', 'docclass'];
                const typeF = textFields.find(f => {
                    const name = (f.DBFieldName || f.FieldName || '').toLowerCase();
                    const disp = (f.DisplayName || '').toLowerCase();
                    return typeKeywords.some(kw => name.includes(kw) || disp.includes(kw));
                }) || textFields[0];
                setDetectedTypeField(typeF);

                // 2. Detect Date field
                const systemStoreField = fields.find(f => {
                    const name = (f.DBFieldName || f.FieldName || '').toUpperCase();
                    return name === 'DWSTOREDATETIME' || name === 'DWSTOREDATE';
                });
                const dateF = systemStoreField || fields.find(f => {
                    const name = (f.DBFieldName || f.FieldName || '').toLowerCase();
                    const disp = (f.DisplayName || '').toLowerCase();
                    const dateKeywords = ['dwstoredate', 'dwstoredatetime', 'storedate', 'armazenado', 'data', 'date'];
                    return dateKeywords.some(kw => name.includes(kw) || disp.includes(kw));
                }) || dateFields[0];
                setDetectedDateField(dateF);

            } catch (err) {
                console.error('[WorkflowAnalytics] Failed to fetch cabinets or fields on mount:', err);
            }
        };
        fetchInitialCabinetAndFields();
    }, []);

    // Fetch documents
    const fetchDocuments = async () => {
        if (!selectedCabinet || !detectedTypeField || !detectedDateField) return;
        setIsLoading(true);
        setError(null);
        try {
            const docTypeFilter = { 
                fieldName: detectedTypeField.DBFieldName || detectedTypeField.FieldName, 
                value: 'Registo Processo de Importação' 
            };
            const dateFilter = { 
                fieldName: detectedDateField.DBFieldName || detectedDateField.FieldName, 
                value: [dateRange[0] || '1900-01-01', dateRange[1] || '2099-12-31']
            };

            const response = await docuwareService.searchDocuments(selectedCabinet, [docTypeFilter, dateFilter], 1000);
            const fetchedDocs = response.items || [];
            setDocuments(fetchedDocs);
            
            // Trigger background queue to calculate details & history
            fetchProgressForDocs(fetchedDocs);
        } catch (err) {
            console.error('Failed to load documents for analytics:', err);
            setError('Erro ao carregar dados do DocuWare');
        } finally {
            setIsLoading(false);
        }
    };

    // Load on dateRange or cabinet change
    useEffect(() => {
        if (selectedCabinet && detectedTypeField && detectedDateField) {
            fetchDocuments();
        }
    }, [dateRange, selectedCabinet, detectedTypeField, detectedDateField]);

    const fetchProgressForDocs = async (docsToFetch) => {
        const batchSize = 15;
        for (let i = 0; i < docsToFetch.length; i += batchSize) {
            const batch = docsToFetch.slice(i, i + batchSize);
            await Promise.all(batch.map(async (doc) => {
                try {
                    const instances = await workflowAnalyticsService.getHistoryByDocId(doc.Id, selectedCabinet);
                    let percent = 0;
                    let activeTaskName = '';
                    let isFinished = false;
                    let entryDate = null;
                    let completedAt = null;
                    let responsible = '-';
                    let timeStoppedMs = 0;
                    let analyzedHistory = [];

                    if (instances && instances.length > 0) {
                        const sorted = [...instances].sort((a, b) => (b.Version || 0) - (a.Version || 0));
                        const instance = sorted[0];
                        const rawHistory = instance.HistorySteps || [];
                        analyzedHistory = WorkflowHistoryAnalyzer.analyze(rawHistory);

                        const graph = WorkflowGraphBuilder.build([], []);
                        const merged = WorkflowTimelineEngine.merge(graph, analyzedHistory);

                        const nodes = merged.nodes || [];
                        const isEndNode = (n) => {
                            if (!n) return false;
                            const type = (n.type || '').toLowerCase();
                            return type.includes('end') || type.includes('fim');
                        };
                        const endNode = nodes.find(isEndNode);
                        isFinished = endNode && endNode.status === 'completed';

                        entryDate = instance.StartedAt ? parseDWDate(instance.StartedAt) : null;
                        completedAt = isFinished && endNode ? (endNode.completedAt || null) : null;

                        const activeNode = nodes.find(n => n.status === 'active');
                        if (activeNode) {
                            if (activeNode.activeUsers && activeNode.activeUsers.length > 0) {
                                responsible = activeNode.activeUsers.join(', ');
                            }
                            activeTaskName = activeNode.name;
                            const activeStep = [...analyzedHistory].reverse().find(step => step.isActive);
                            const activeStart = activeStep ? activeStep.startedAt : null;
                            if (activeStart) {
                                timeStoppedMs = Math.max(0, new Date().getTime() - new Date(activeStart).getTime());
                            }
                        }

                        const calculatedStage = evaluateActiveStage(doc, activeNode ? activeNode.name : '', isFinished);
                        percent = Math.round((calculatedStage / 6) * 100);
                        if (isFinished) percent = 100;
                    }

                    // Fallback to entry date if not set
                    if (!entryDate) {
                        const dwStore = getDocFieldValue(doc, 'DWSTOREDATETIME') || getDocFieldValue(doc, 'DWSTOREDATE');
                        entryDate = dwStore ? parseDWDate(dwStore) : null;
                    }

                    setDocumentProgress(prev => ({
                        ...prev,
                        [doc.Id]: {
                            percent,
                            activeTaskName,
                            isFinished,
                            entryDate,
                            completedAt,
                            responsible,
                            timeStoppedMs,
                            analyzedHistory
                        }
                    }));
                } catch (err) {
                    console.error('Failed to load history for doc:', doc.Id, err);
                }
            }));
        }
    };

    // --- Dynamic Filter Option Population ---
    const filterOptions = useMemo(() => {
        const despachantes = new Set();
        const fornecedores = new Set();
        const tiposCarga = new Set();
        const transportadores = new Set();
        const responsaveis = new Set();

        documents.forEach(doc => {
            const desp = getDocFieldValue(doc, 'DESPACHANTE') || getDocFieldValue(doc, 'DESPACHADOR');
            const forn = getDocFieldValue(doc, 'FORNECEDOR') || getDocFieldValue(doc, 'EMPRESA');
            const carga = getDocFieldValue(doc, 'TIPO_DE_CARGA') || getDocFieldValue(doc, 'TIPO_CARGA');
            const trans = getDocFieldValue(doc, 'TRANSPORTADOR');
            
            if (desp) despachantes.add(desp);
            if (forn) fornecedores.add(forn);
            if (carga) tiposCarga.add(carga);
            if (trans) transportadores.add(trans);

            const prog = documentProgress[doc.Id];
            if (prog && prog.responsible && prog.responsible !== '-') {
                responsaveis.add(prog.responsible);
            }
        });

        return {
            despachantes: Array.from(despachantes).sort(),
            fornecedores: Array.from(fornecedores).sort(),
            tiposCarga: Array.from(tiposCarga).sort(),
            transportadores: Array.from(transportadores).sort(),
            responsaveis: Array.from(responsaveis).sort()
        };
    }, [documents, documentProgress]);

    // --- Apply Filters ---
    const filteredDocuments = useMemo(() => {
        return documents.filter(doc => {
            const prog = documentProgress[doc.Id] || {};

            // Despachante
            if (selectedDespachante !== 'all') {
                const val = getDocFieldValue(doc, 'DESPACHANTE') || getDocFieldValue(doc, 'DESPACHADOR');
                if (val !== selectedDespachante) return false;
            }
            // Fornecedor
            if (selectedFornecedor !== 'all') {
                const val = getDocFieldValue(doc, 'FORNECEDOR') || getDocFieldValue(doc, 'EMPRESA');
                if (val !== selectedFornecedor) return false;
            }
            // Tipo de Carga
            if (selectedTipoCarga !== 'all') {
                const val = getDocFieldValue(doc, 'TIPO_DE_CARGA') || getDocFieldValue(doc, 'TIPO_CARGA');
                if (val !== selectedTipoCarga) return false;
            }
            // Transportador
            if (selectedTransportador !== 'all') {
                const val = getDocFieldValue(doc, 'TRANSPORTADOR');
                if (val !== selectedTransportador) return false;
            }
            // Responsável
            if (selectedResponsavel !== 'all') {
                if (prog.responsible !== selectedResponsavel) return false;
            }
            // Estado do Processo
            if (selectedEstado !== 'all') {
                const isFinished = prog.isFinished || evaluateActiveStage(doc, prog.activeTaskName, prog.isFinished) === 6;
                if (selectedEstado === 'concluido' && !isFinished) return false;
                if (selectedEstado === 'ativo' && isFinished) return false;
                if (selectedEstado === 'atraso' && (isFinished || (prog.timeStoppedMs || 0) < 15 * 86400000)) return false;
            }

            return true;
        });
    }, [documents, documentProgress, selectedDespachante, selectedFornecedor, selectedTipoCarga, selectedTransportador, selectedEstado, selectedResponsavel]);

    // --- Calculated Details List ---
    const detailedProcesses = useMemo(() => {
        return filteredDocuments.map(doc => {
            const prog = documentProgress[doc.Id] || {};
            const docNum = getDocumentNumber(doc);
            
            // Dates
            const dtBollore = parseDWDate(getDocFieldValue(doc, 'DATA_ENTRADA_BOLLORE') || getDocFieldValue(doc, 'BOLLORE'));
            const dtEnvio = parseDWDate(getDocFieldValue(doc, 'DATA_EXPEDICAO') || getDocFieldValue(doc, 'DATA_ENVIO') || getDocFieldValue(doc, 'DATA_EMBARQUE'));
            const dtChegada = parseDWDate(getDocFieldValue(doc, 'DATA_CHEGADA_ANGOLA') || getDocFieldValue(doc, 'DATA_CHEGADA') || getDocFieldValue(doc, 'CHEGADA_AO'));
            const dtSaidaAlfandega = parseDWDate(getDocFieldValue(doc, 'DATA_SAIDA_ALFANDEGA') || getDocFieldValue(doc, 'DATA_DESEMBARACO') || getDocFieldValue(doc, 'LIBERACAO') || getDocFieldValue(doc, 'DATA_DESPACHO'));
            const dtEntregaRCS = parseDWDate(getDocFieldValue(doc, 'DATA_ENTREGUE') || getDocFieldValue(doc, 'DATA_ENTREGUE_RCS') || getDocFieldValue(doc, 'ENTREGUE'));
            
            // Financials
            const fMerc = parseCurrency(getDocFieldValue(doc, 'VALOR_FOB') || getDocFieldValue(doc, 'FOB') || getDocFieldValue(doc, 'VALOR_MERCADORIA') || getDocFieldValue(doc, 'MONTANTE_FACTURA') || getDocFieldValue(doc, 'VALOR'));
            const fFrete = parseCurrency(getDocFieldValue(doc, 'VALOR_FRETE') || getDocFieldValue(doc, 'FRETE'));
            const fCustosAdicionais = parseCurrency(getDocFieldValue(doc, 'CUSTOS_ADICIONAIS') || getDocFieldValue(doc, 'OUTROS_CUSTOS') || getDocFieldValue(doc, 'OUTRAS_DESPESAS'));
            const fRdf = parseCurrency(getDocFieldValue(doc, 'MONTANTE_RDF') || getDocFieldValue(doc, 'RDF'));
            const fIva = parseCurrency(getDocFieldValue(doc, 'VALOR_IVA_IMPORTACAO') || getDocFieldValue(doc, 'IVA_IMPORTACAO') || getDocFieldValue(doc, 'IVA'));
            const fDireitos = parseCurrency(getDocFieldValue(doc, 'DIREITOS_ALFANDEGARIOS') || getDocFieldValue(doc, 'DIREITO_ALFANDEGARIOS') || getDocFieldValue(doc, 'DIREITO_ALFAND'));
            const fServicosDespachante = parseCurrency(getDocFieldValue(doc, 'SERVICOS_DESPACHANTES') || getDocFieldValue(doc, 'SERVICO_DESPACHANTE'));

            // Stage evaluation
            const stageIdx = evaluateActiveStage(doc, prog.activeTaskName, prog.isFinished);
            const isFinished = stageIdx === 6 || prog.isFinished;
            const stageName = getStageName(stageIdx);

            // Coeficiente calculation
            let coefVal = 'N/D';
            let numericCoef = 0;
            if (fMerc <= 0) {
                coefVal = 'Sem valor da mercadoria';
            } else {
                const totalCosts = fFrete + fCustosAdicionais + fServicosDespachante + fDireitos + fIva + fRdf;
                if (totalCosts > 0) {
                    numericCoef = totalCosts / fMerc;
                    coefVal = numericCoef.toFixed(2);
                }
            }

            // Days calculation
            let diasTotais = 'N/D';
            let isParcial = false;
            if (dtBollore) {
                const end = dtEntregaRCS || new Date();
                const diffTime = Math.abs(end - dtBollore);
                diasTotais = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (!dtEntregaRCS) isParcial = true;
            }

            const diasParado = prog.timeStoppedMs ? Math.round(prog.timeStoppedMs / (1000 * 60 * 60 * 24)) : 0;

            // Qualidade dos Dados Status
            let qualidade = 'Completo';
            if (fMerc <= 0) {
                qualidade = 'Falta valor da mercadoria';
            } else if (!getDocFieldValue(doc, 'DESPACHANTE') && !getDocFieldValue(doc, 'DESPACHADOR')) {
                qualidade = 'Falta despachante';
            } else if (!dtEntregaRCS && isFinished) {
                qualidade = 'Falta data de entrega';
            } else if (!dtBollore || !dtChegada) {
                qualidade = 'Faltam datas logísticas';
            } else if (fFrete === 0 && fServicosDespachante === 0 && fDireitos === 0) {
                qualidade = 'Falta custo final';
            }

            return {
                id: doc.Id,
                docNum,
                etapa: stageName,
                stageIdx,
                responsavel: prog.responsible || '-',
                despachante: getDocFieldValue(doc, 'DESPACHANTE') || getDocFieldValue(doc, 'DESPACHADOR') || '-',
                fornecedor: getDocFieldValue(doc, 'FORNECEDOR') || getDocFieldValue(doc, 'EMPRESA') || '-',
                tipoCarga: getDocFieldValue(doc, 'TIPO_DE_CARGA') || getDocFieldValue(doc, 'TIPO_CARGA') || '-',
                dtBollore: dtBollore ? dtBollore.toLocaleDateString('pt-AO') : '-',
                dtEnvio: dtEnvio ? dtEnvio.toLocaleDateString('pt-AO') : '-',
                dtChegada: dtChegada ? dtChegada.toLocaleDateString('pt-AO') : '-',
                dtSaidaAlfandega: dtSaidaAlfandega ? dtSaidaAlfandega.toLocaleDateString('pt-AO') : '-',
                dtEntregaRCS: dtEntregaRCS ? dtEntregaRCS.toLocaleDateString('pt-AO') : '-',
                dtBolloreRaw: dtBollore,
                dtEnvioRaw: dtEnvio,
                dtChegadaRaw: dtChegada,
                dtSaidaAlfandegaRaw: dtSaidaAlfandega,
                dtEntregaRCSRaw: dtEntregaRCS,
                valMercadoria: fMerc,
                frete: fFrete,
                custosAdicionais: fCustosAdicionais,
                rdf: fRdf,
                iva: fIva,
                direitos: fDireitos,
                servicosDespachante: fServicosDespachante,
                coeficienteText: coefVal,
                coeficienteNumeric: numericCoef,
                diasTotais,
                isParcial,
                diasParado,
                statusFinal: isFinished ? 'Concluído' : 'Em Andamento',
                qualidade
            };
        });
    }, [filteredDocuments, documentProgress]);

    // --- Sorted & Filtered Details ---
    const searchedAndSortedDetails = useMemo(() => {
        let result = [...detailedProcesses];

        // Apply column-level checkbox filters
        Object.keys(colFilters).forEach(colKey => {
            const selected = colFilters[colKey];
            if (selected && selected.length > 0) {
                result = result.filter(p => {
                    const val = String(p[colKey] || '-').trim();
                    return selected.includes(val);
                });
            }
        });

        if (detailSearch.trim() !== '') {
            const s = detailSearch.toLowerCase();
            result = result.filter(p => 
                p.docNum.toLowerCase().includes(s) ||
                p.etapa.toLowerCase().includes(s) ||
                p.responsavel.toLowerCase().includes(s) ||
                p.despachante.toLowerCase().includes(s) ||
                p.fornecedor.toLowerCase().includes(s) ||
                p.tipoCarga.toLowerCase().includes(s) ||
                p.qualidade.toLowerCase().includes(s)
            );
        }

        if (detailSort.column) {
            result.sort((a, b) => {
                let valA = a[detailSort.column];
                let valB = b[detailSort.column];
                
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();

                if (valA < valB) return detailSort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return detailSort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [detailedProcesses, detailSearch, detailSort, colFilters]);

    // Handle Open DocuWare Document
    const handleOpenDocument = (docId) => {
        const viewUrl = docuwareService.getDocumentViewUrl(selectedCabinet, docId);
        window.open(viewUrl, '_blank');
    };

    // --- Calculated Metrics & KPI Stats ---
    const stats = useMemo(() => {
        let total = detailedProcesses.length;
        let active = 0;
        let completed = 0;
        let delayed = 0;
        let totalCycleTimeMs = 0;
        let completedCount = 0;
        let totalTimeStoppedMs = 0;
        let activeWithStopCount = 0;
        let openProcessValue = 0;
        let inactiveOver15Days = 0;

        detailedProcesses.forEach(p => {
            const isFinished = p.statusFinal === 'Concluído';
            if (isFinished) {
                completed++;
                if (p.dtBolloreRaw && p.dtEntregaRCSRaw) {
                    const diff = p.dtEntregaRCSRaw.getTime() - p.dtBolloreRaw.getTime();
                    if (diff > 0) {
                        totalCycleTimeMs += diff;
                        completedCount++;
                    }
                }
            } else {
                active++;
                openProcessValue += p.valMercadoria;
                if (p.diasParado > 15) {
                    delayed++;
                    inactiveOver15Days++;
                }
                if (p.diasParado > 0) {
                    totalTimeStoppedMs += (p.diasParado * 24 * 3600 * 1000);
                    activeWithStopCount++;
                }
            }
        });

        const avgCycleText = completedCount > 0 
            ? `${Math.round(totalCycleTimeMs / completedCount / (24 * 3600 * 1000))} dias`
            : 'N/D';

        const avgTimeStoppedText = activeWithStopCount > 0 
            ? `${Math.round(totalTimeStoppedMs / activeWithStopCount / (24 * 3600 * 1000))} dias`
            : 'N/D';

        return {
            total,
            active,
            completed,
            delayed,
            openProcessValue,
            inactiveOver15Days,
            avgCycleTimeText: avgCycleText,
            avgTimeStoppedText: avgTimeStoppedText
        };
    }, [detailedProcesses]);

    // --- 1. Visão Operacional Chart Data ---
    const stageDistributionData = useMemo(() => {
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        detailedProcesses.forEach(p => {
            counts[p.stageIdx] = (counts[p.stageIdx] || 0) + 1;
        });

        return Object.keys(counts).map(k => ({
            name: getStageName(parseInt(k)),
            Processos: counts[k]
        }));
    }, [detailedProcesses]);

    const avgTimePerStageData = useMemo(() => {
        const stagesTime = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        const stagesCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

        detailedProcesses.forEach(p => {
            const prog = documentProgress[p.id] || {};
            const history = prog.analyzedHistory || [];
            history.forEach(step => {
                if (step.completedAt && step.startedAt) {
                    const duration = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
                    const stage = evaluateActiveStage(null, step.name, false);
                    if (stagesTime[stage] !== undefined && duration > 0) {
                        stagesTime[stage] += duration;
                        stagesCount[stage]++;
                    }
                }
            });
        });

        return Object.keys(stagesTime).map(k => {
            const avgDays = stagesCount[k] > 0 
                ? parseFloat((stagesTime[k] / stagesCount[k] / (24 * 3600 * 1000)).toFixed(1))
                : 0;
            return {
                name: getStageName(parseInt(k)),
                'Dias Médios': avgDays
            };
        });
    }, [detailedProcesses, documentProgress]);

    const timeSeriesData = useMemo(() => {
        const months = {};
        detailedProcesses.forEach(p => {
            if (p.dtBolloreRaw) {
                const label = `${p.dtBolloreRaw.getFullYear()}-${String(p.dtBolloreRaw.getMonth() + 1).padStart(2, '0')}`;
                months[label] = (months[label] || 0) + 1;
            }
        });

        return Object.keys(months).sort().map(m => ({
            periodo: m,
            Processos: months[m]
        }));
    }, [detailedProcesses]);

    // --- 2. Performance Logística Metrics ---
    const logisticsMetrics = useMemo(() => {
        let totalCycleTimeMs = 0;
        let totalCycleCount = 0;
        let totalCycleTimeMsParcial = 0;
        let totalCycleCountParcial = 0;

        let totalGrupagemTimeMs = 0;
        let totalGrupagemCount = 0;

        let totalAlfandegaTimeMs = 0;
        let totalAlfandegaCount = 0;

        let transitPTBollore = 0, countPTB = 0;
        let transitBolloreAO = 0, countBAO = 0;
        let transitAORCS = 0, countAR = 0;

        detailedProcesses.forEach(p => {
            const dtBollore = p.dtBolloreRaw;
            const dtRCS = p.dtEntregaRCSRaw;
            const dtExpedicao = p.dtEnvioRaw;
            const dtChegadaAO = p.dtChegadaRaw;
            const dtSaidaAlfandega = p.dtSaidaAlfandegaRaw;

            // KPI 1: Cycle time (Bollore to RCS)
            if (dtBollore) {
                if (dtRCS && dtRCS > dtBollore) {
                    totalCycleTimeMs += (dtRCS - dtBollore);
                    totalCycleCount++;
                } else if (!dtRCS) {
                    // Parcial using last available log date or today
                    const lastLogDate = dtSaidaAlfandega || dtChegadaAO || dtExpedicao || new Date();
                    if (lastLogDate > dtBollore) {
                        totalCycleTimeMsParcial += (lastLogDate - dtBollore);
                        totalCycleCountParcial++;
                    }
                }
            }

            // KPI 2: Grupagem (Bollore to Expedicao)
            if (dtBollore && dtExpedicao && dtExpedicao > dtBollore) {
                totalGrupagemTimeMs += (dtExpedicao - dtBollore);
                totalGrupagemCount++;
            }

            // KPI 3: Alfandega (Chegada AO to Saida Alfandega/RCS)
            const dtEndAlfandega = dtSaidaAlfandega || dtRCS;
            if (dtChegadaAO && dtEndAlfandega && dtEndAlfandega > dtChegadaAO) {
                totalAlfandegaTimeMs += (dtEndAlfandega - dtChegadaAO);
                totalAlfandegaCount++;
            }

            // Segmented transit (Bolloré -> Angola is Bolloré to Chegada Angola)
            if (dtBollore && dtChegadaAO && dtChegadaAO > dtBollore) {
                transitBolloreAO += (dtChegadaAO - dtBollore);
                countBAO++;
            }
            if (dtChegadaAO && dtRCS && dtRCS > dtChegadaAO) {
                transitAORCS += (dtRCS - dtChegadaAO);
                countAR++;
            }
            // Portugal -> Bolloré is calculated if departure date is present
            const dtPortugal = parseDWDate(getDocFieldValue(documents.find(d => d.Id === p.id), 'DATA_SAIDA_PORTUGAL'));
            if (dtPortugal && dtBollore && dtBollore > dtPortugal) {
                transitPTBollore += (dtBollore - dtPortugal);
                countPTB++;
            }
        });

        const toDays = (ms) => ms > 0 ? parseFloat((ms / (24 * 3600 * 1000)).toFixed(1)) : 0;

        return {
            avgLogisticsCycle: totalCycleCount > 0 ? `${Math.round(toDays(totalCycleTimeMs / totalCycleCount))} dias` : 'N/D',
            avgLogisticsCycleParcial: totalCycleCountParcial > 0 ? `${Math.round(toDays(totalCycleTimeMsParcial / totalCycleCountParcial))} dias (parcial)` : '',
            avgGrupagem: totalGrupagemCount > 0 ? `${toDays(totalGrupagemTimeMs / totalGrupagemCount)} dias` : 'N/D',
            avgAlfandega: totalAlfandegaCount > 0 ? `${toDays(totalAlfandegaTimeMs / totalAlfandegaCount)} dias` : 'N/D',
            transitPTBollore: countPTB > 0 ? toDays(transitPTBollore / countPTB) : 0,
            transitBolloreAO: countBAO > 0 ? toDays(transitBolloreAO / countBAO) : 0,
            transitAORCS: countAR > 0 ? toDays(transitAORCS / countAR) : 0
        };
    }, [detailedProcesses, documents]);

    // Segmented transit chart data
    const transitSegmentsData = useMemo(() => {
        return [
            { segment: 'Portugal → Bolloré', 'Dias': logisticsMetrics.transitPTBollore || 0 },
            { segment: 'Bolloré → Angola', 'Dias': logisticsMetrics.transitBolloreAO || 0 },
            { segment: 'Angola → RCS', 'Dias': logisticsMetrics.transitAORCS || 0 }
        ];
    }, [logisticsMetrics]);

    // Logistics averages
    const logisticsAverages = useMemo(() => {
        const brokerDays = {};
        const cargoDays = {};
        const supplierDays = {};

        detailedProcesses.forEach(p => {
            if (p.dtBolloreRaw && p.dtEntregaRCSRaw) {
                const days = (p.dtEntregaRCSRaw - p.dtBolloreRaw) / (24 * 3600 * 1000);
                if (days > 0) {
                    // Broker
                    if (!brokerDays[p.despachante]) brokerDays[p.despachante] = [];
                    brokerDays[p.despachante].push(days);

                    // Cargo
                    if (!cargoDays[p.tipoCarga]) cargoDays[p.tipoCarga] = [];
                    cargoDays[p.tipoCarga].push(days);

                    // Supplier
                    if (!supplierDays[p.fornecedor]) supplierDays[p.fornecedor] = [];
                    supplierDays[p.fornecedor].push(days);
                }
            }
        });

        const getAvgMap = (map) => {
            return Object.keys(map).map(k => ({
                name: k,
                'Dias': parseFloat((map[k].reduce((a, b) => a + b, 0) / map[k].length).toFixed(1))
            })).sort((a, b) => b['Dias'] - a['Dias']);
        };

        return {
            broker: getAvgMap(brokerDays),
            cargo: getAvgMap(cargoDays),
            supplier: getAvgMap(supplierDays)
        };
    }, [detailedProcesses]);

    // Top 10 longest processes
    const top10Longest = useMemo(() => {
        return [...detailedProcesses]
            .filter(p => typeof p.diasTotais === 'number')
            .sort((a, b) => b.diasTotais - a.diasTotais)
            .slice(0, 10);
    }, [detailedProcesses]);

    // --- 3. Análise Financeira Stats ---
    const financialData = useMemo(() => {
        let totalMercadoria = 0;
        let totalFrete = 0;
        let totalCustosAdicionais = 0;
        let totalDespachante = 0;
        let totalDireitos = 0;
        let totalIVA = 0;
        let totalRDF = 0;

        const coeficients = [];
        const monthlyEvolutionMap = {};

        detailedProcesses.forEach(p => {
            totalMercadoria += p.valMercadoria;
            totalFrete += p.frete;
            totalCustosAdicionais += p.custosAdicionais;
            totalDespachante += p.servicosDespachante;
            totalDireitos += p.direitos;
            totalIVA += p.iva;
            totalRDF += p.rdf;

            if (p.valMercadoria > 0) {
                const totalCosts = p.frete + p.custosAdicionais + p.servicosDespachante + p.direitos + p.iva + p.rdf;
                if (totalCosts > 0) {
                    coeficients.push(totalCosts / p.valMercadoria);
                }
            }

            if (p.dtBolloreRaw) {
                const monthLabel = `${p.dtBolloreRaw.getFullYear()}-${String(p.dtBolloreRaw.getMonth() + 1).padStart(2, '0')}`;
                if (!monthlyEvolutionMap[monthLabel]) {
                    monthlyEvolutionMap[monthLabel] = {
                        periodo: monthLabel,
                        fob: 0,
                        custos: 0
                    };
                }
                monthlyEvolutionMap[monthLabel].fob += p.valMercadoria;
                monthlyEvolutionMap[monthLabel].custos += (p.frete + p.custosAdicionais + p.servicosDespachante + p.direitos + p.iva + p.rdf);
            }
        });

        const totalCustos = totalFrete + totalCustosAdicionais + totalDespachante + totalDireitos + totalIVA + totalRDF;
        const totalImportacao = totalMercadoria + totalCustos;

        const avgCoef = coeficients.length > 0 ? (coeficients.reduce((a, b) => a + b, 0) / coeficients.length) : 0;
        const minCoef = coeficients.length > 0 ? Math.min(...coeficients) : 0;
        const maxCoef = coeficients.length > 0 ? Math.max(...coeficients) : 0;

        const costComposition = [
            { name: 'Frete', value: totalFrete },
            { name: 'Serviços Despachante', value: totalDespachante },
            { name: 'Direitos Aduaneiros', value: totalDireitos },
            { name: 'IVA', value: totalIVA },
            { name: 'RDF', value: totalRDF },
            { name: 'Outros Custos', value: totalCustosAdicionais }
        ].filter(item => item.value > 0);

        const monthlyEvolution = Object.keys(monthlyEvolutionMap).sort().map(m => {
            const data = monthlyEvolutionMap[m];
            const coeficiente = data.fob > 0 ? (data.custos / data.fob) : 0;
            return {
                periodo: m,
                'Valor FOB': Math.round(data.fob),
                'Custos Adicionais': Math.round(data.custos),
                'Coeficiente': parseFloat(coeficiente.toFixed(2))
            };
        });

        // Coefficient breakdowns
        const brokerCoef = {};
        const supplierCoef = {};
        detailedProcesses.forEach(p => {
            if (typeof p.coeficienteNumeric === 'number' && p.coeficienteNumeric > 0) {
                if (!brokerCoef[p.despachante]) brokerCoef[p.despachante] = [];
                brokerCoef[p.despachante].push(p.coeficienteNumeric);

                if (!supplierCoef[p.fornecedor]) supplierCoef[p.fornecedor] = [];
                supplierCoef[p.fornecedor].push(p.coeficienteNumeric);
            }
        });

        const mapCoefAvg = (map) => {
            return Object.keys(map).map(k => ({
                name: k,
                Coeficiente: parseFloat((map[k].reduce((a, b) => a + b, 0) / map[k].length).toFixed(2))
            })).sort((a, b) => b.Coeficiente - a.Coeficiente);
        };

        const processCostRanking = [...detailedProcesses]
            .map(p => ({
                docNum: p.docNum,
                fornecedor: p.fornecedor,
                despachante: p.despachante,
                valMercadoria: p.valMercadoria,
                custoTotal: p.frete + p.custosAdicionais + p.servicosDespachante + p.direitos + p.iva + p.rdf,
                coeficienteText: p.coeficienteText
            }))
            .sort((a, b) => b.custoTotal - a.custoTotal);

        return {
            totalMercadoria,
            totalFrete,
            totalCustosAdicionais,
            totalDespachante,
            totalDireitos,
            totalIVA,
            totalRDF,
            totalCustos,
            totalImportacao,
            avgCoef: avgCoef > 0 ? avgCoef.toFixed(2) : 'N/D',
            minCoef: minCoef > 0 ? minCoef.toFixed(2) : 'N/D',
            maxCoef: maxCoef > 0 ? maxCoef.toFixed(2) : 'N/D',
            costComposition,
            monthlyEvolution,
            processCostRanking,
            brokerCoef: mapCoefAvg(brokerCoef),
            supplierCoef: mapCoefAvg(supplierCoef)
        };
    }, [detailedProcesses]);

    // --- 4. Performance dos Despachantes Metrics ---
    const despachantesPerformance = useMemo(() => {
        const perf = {};

        detailedProcesses.forEach(p => {
            const desp = p.despachante;
            if (!perf[desp]) {
                perf[desp] = {
                    name: desp,
                    count: 0,
                    completed: 0,
                    totalClearingTimeMs: 0,
                    clearingCount: 0,
                    totalDeliveryTimeMs: 0,
                    deliveryCount: 0,
                    totalValue: 0,
                    totalMerc: 0,
                    totalExpenses: 0,
                    coeficients: []
                };
            }

            const dp = perf[desp];
            dp.count++;
            const totalCosts = p.frete + p.custosAdicionais + p.servicosDespachante + p.direitos + p.iva + p.rdf;
            dp.totalValue += (p.valMercadoria + totalCosts);
            dp.totalMerc += p.valMercadoria;
            dp.totalExpenses += totalCosts;

            if (p.statusFinal === 'Concluído') {
                dp.completed++;
            }

            if (p.dtChegadaRaw && p.dtSaidaAlfandegaRaw && p.dtSaidaAlfandegaRaw > p.dtChegadaRaw) {
                dp.totalClearingTimeMs += (p.dtSaidaAlfandegaRaw - p.dtChegadaRaw);
                dp.clearingCount++;
            }

            if (p.dtSaidaAlfandegaRaw && p.dtEntregaRCSRaw && p.dtEntregaRCSRaw > p.dtSaidaAlfandegaRaw) {
                dp.totalDeliveryTimeMs += (p.dtEntregaRCSRaw - p.dtSaidaAlfandegaRaw);
                dp.deliveryCount++;
            }

            if (p.coeficienteNumeric > 0) {
                dp.coeficients.push(p.coeficienteNumeric);
            }
        });

        return Object.values(perf).map(dp => {
            const avgClearingDays = dp.clearingCount > 0 ? Math.round(dp.totalClearingTimeMs / dp.clearingCount / (24 * 3600 * 1000)) : '-';
            const avgDeliveryDays = dp.deliveryCount > 0 ? Math.round(dp.totalDeliveryTimeMs / dp.deliveryCount / (24 * 3600 * 1000)) : '-';
            const avgCoef = dp.coeficients.length > 0 ? (dp.coeficients.reduce((a, b) => a + b, 0) / dp.coeficients.length).toFixed(2) : 'N/D';
            
            return {
                ...dp,
                avgClearingDays,
                avgDeliveryDays,
                avgCoef,
                avgCostPerProcess: dp.count > 0 ? Math.round(dp.totalExpenses / dp.count) : 0
            };
        });
    }, [detailedProcesses]);

    const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

    return (
        <div className="space-y-6">
            {/* Global Filters Panel */}
            <div className="card bg-white border border-slate-200 border-l-[6px] border-l-[#4f46e5] shadow-sm rounded-2xl">
                <div className="card-body p-5">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <span className="font-bold text-slate-700 text-sm flex items-center gap-1.5">
                                <FaFilter /> Filtros Globais de Análise
                            </span>
                            <button 
                                onClick={fetchDocuments}
                                className="btn btn-ghost btn-xs text-indigo-600 hover:bg-indigo-50 font-bold"
                            >
                                <FaSyncAlt className="mr-1" /> Sincronizar
                            </button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 max-w-xs">
                            {/* Período */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Data Inicial</label>
                                <input 
                                    type="date" 
                                    className="input input-bordered input-sm bg-white text-slate-700 w-full"
                                    value={dateRange[0]}
                                    onChange={(e) => setDateRange([e.target.value, dateRange[1]])}
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Data Final</label>
                                <input 
                                    type="date" 
                                    className="input input-bordered input-sm bg-white text-slate-700 w-full"
                                    value={dateRange[1]}
                                    onChange={(e) => setDateRange([dateRange[0], e.target.value])}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="tabs tabs-boxed bg-slate-100 p-1.5 rounded-xl flex flex-wrap gap-1">
                <button 
                    onClick={() => setActiveTab('visao_operacional')}
                    className={`tab tab-md flex items-center gap-1.5 font-bold ${activeTab === 'visao_operacional' ? 'tab-active bg-[#4f46e5] text-white shadow-sm' : 'text-slate-600'}`}
                >
                    <FaChartBar /> Visão Operacional
                </button>
                <button 
                    onClick={() => setActiveTab('performance_logistica')}
                    className={`tab tab-md flex items-center gap-1.5 font-bold ${activeTab === 'performance_logistica' ? 'tab-active bg-[#4f46e5] text-white shadow-sm' : 'text-slate-600'}`}
                >
                    <FaTruck /> Performance Logística
                </button>
                <button 
                    onClick={() => setActiveTab('analise_financeira')}
                    className={`tab tab-md flex items-center gap-1.5 font-bold ${activeTab === 'analise_financeira' ? 'tab-active bg-[#4f46e5] text-white shadow-sm' : 'text-slate-600'}`}
                >
                    <FaDollarSign /> Análise Financeira
                </button>
                <button 
                    onClick={() => setActiveTab('performance_despachantes')}
                    className={`tab tab-md flex items-center gap-1.5 font-bold ${activeTab === 'performance_despachantes' ? 'tab-active bg-[#4f46e5] text-white shadow-sm' : 'text-slate-600'}`}
                >
                    <FaUserShield /> Performance dos Despachantes
                </button>
                <button 
                    onClick={() => setActiveTab('visao_detalhada')}
                    className={`tab tab-md flex items-center gap-1.5 font-bold ${activeTab === 'visao_detalhada' ? 'tab-active bg-[#4f46e5] text-white shadow-sm' : 'text-slate-600'}`}
                >
                    <FaList /> Visão Detalhada
                </button>
            </div>

            {/* TAB CONTENT */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4">
                    <span className="loading loading-spinner loading-lg text-indigo-600"></span>
                    <span className="text-slate-500 font-medium text-sm animate-pulse">Carregando dados analíticos...</span>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* 1. VISÃO OPERACIONAL */}
                    {activeTab === 'visao_operacional' && (
                        <div className="space-y-6">
                            {/* Metrics Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Processos</div>
                                    <div className="text-2xl font-black text-slate-800 mt-1">{stats.total}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Em Andamento</div>
                                    <div className="text-2xl font-black text-amber-600 mt-1">{stats.active}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Concluídos</div>
                                    <div className="text-2xl font-black text-emerald-600 mt-1">{stats.completed}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Em atraso</div>
                                    <div className="text-2xl font-black text-rose-600 mt-1">{stats.delayed}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm col-span-1 lg:col-span-2">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor total em processos abertos</div>
                                    <div className="text-lg font-black text-indigo-700 mt-1 font-mono">{formatKwanza(stats.openProcessValue)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Prazo Médio Total</div>
                                    <div className="text-xl font-black text-slate-800 mt-1">{stats.avgCycleTimeText}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Parado Etapa Atual</div>
                                    <div className="text-xl font-black text-rose-600 mt-1">{stats.avgTimeStoppedText}</div>
                                </div>
                            </div>

                            {/* Informações adicionais de qualidade */}
                            {stats.inactiveOver15Days > 0 && (
                                <div className="alert alert-warning shadow-sm py-3 text-xs font-semibold rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                                    <FaExclamationTriangle className="text-amber-500" />
                                    <span>Atenção: Existem {stats.inactiveOver15Days} processos sem movimentação há mais de 15 dias.</span>
                                </div>
                            )}

                            {/* Charts Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaChartBar /> Distribuição dos processos por etapa</h3>
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={stageDistributionData} margin={{ top: 20, right: 30, left: -10, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
                                                <Bar dataKey="Processos" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={36} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaClock /> Tempo médio por etapa (em dias)</h3>
                                    <div className="h-72">
                                        {avgTimePerStageData.every(d => d['Dias Médios'] === 0) ? (
                                            <div className="flex items-center justify-center h-full text-slate-400 italic text-xs">Não existem processos com datas suficientes para calcular este indicador.</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={avgTimePerStageData} margin={{ top: 20, right: 30, left: -10, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
                                                    <Bar dataKey="Dias Médios" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={36} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm lg:col-span-2">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaChartLine /> Linha temporal - Evolução das importações</h3>
                                    <div className="h-72">
                                        {timeSeriesData.length === 0 ? (
                                            <div className="flex items-center justify-center h-full text-slate-400 italic text-xs">Não existem processos com datas suficientes para calcular este indicador.</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={timeSeriesData} margin={{ top: 10, right: 30, left: -10, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="colorProcessos" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2}/>
                                                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                                    <XAxis dataKey="periodo" stroke="#94a3b8" fontSize={11} />
                                                    <YAxis stroke="#94a3b8" fontSize={11} />
                                                    <Tooltip />
                                                    <Area type="monotone" dataKey="Processos" stroke="#4f46e5" strokeWidth={2.5} fillOpacity={1} fill="url(#colorProcessos)" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 2. PERFORMANCE LOGÍSTICA */}
                    {activeTab === 'performance_logistica' && (
                        <div className="space-y-6">
                            {/* Logistics KPI Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-row items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Prazo Médio da Importação</div>
                                        <div className="text-2xl font-black text-indigo-600 mt-1">
                                            {logisticsMetrics.avgLogisticsCycle}
                                        </div>
                                        {logisticsMetrics.avgLogisticsCycleParcial && (
                                            <p className="text-[10px] text-amber-600 font-semibold">{logisticsMetrics.avgLogisticsCycleParcial}</p>
                                        )}
                                        <p className="text-[9px] text-slate-400 mt-0.5">Entrada na Bolloré até Entrega na RCS</p>
                                    </div>
                                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                                        <FaClock className="text-xl" />
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-row items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tempo Médio de Grupagem</div>
                                        <div className="text-2xl font-black text-amber-600 mt-1">{logisticsMetrics.avgGrupagem}</div>
                                        <p className="text-[9px] text-slate-400 mt-0.5">Tempo aguardando no lote/grupagem</p>
                                    </div>
                                    <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                                        <FaClock className="text-xl" />
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-row items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tempo na Alfândega</div>
                                        <div className="text-2xl font-black text-rose-600 mt-1">{logisticsMetrics.avgAlfandega}</div>
                                        <p className="text-[9px] text-slate-400 mt-0.5">Entrada na Inspeção até Despacho/Entrega</p>
                                    </div>
                                    <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                                        <FaClock className="text-xl" />
                                    </div>
                                </div>
                            </div>

                            {/* Charts & Rankings */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm"><FaTruck className="inline mr-1 text-slate-500" /> Tempo Médio por Trecho (Portugal → Bolloré → Angola → RCS)</h3>
                                    <div className="h-64">
                                        {transitSegmentsData.every(d => d['Dias'] === 0) ? (
                                            <div className="flex items-center justify-center h-full text-slate-400 italic text-xs">Não existem processos com datas suficientes para calcular este indicador.</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={transitSegmentsData} margin={{ top: 20, right: 30, left: -10, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                    <XAxis dataKey="segment" stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                    <Tooltip />
                                                    <Bar dataKey="Dias" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={40} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm"><FaUserShield className="inline mr-1 text-slate-500" /> Média de Dias por Despachante</h3>
                                    <div className="h-64">
                                        {logisticsAverages.broker.length === 0 ? (
                                            <div className="flex items-center justify-center h-full text-slate-400 italic text-xs">Não existem processos com datas suficientes para calcular este indicador.</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={logisticsAverages.broker} margin={{ top: 20, right: 30, left: -10, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                                                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                    <Tooltip />
                                                    <Bar dataKey="Dias" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm">Dias Médios por Tipo de Carga</h3>
                                    <div className="h-64">
                                        {logisticsAverages.cargo.length === 0 ? (
                                            <div className="flex items-center justify-center h-full text-slate-400 italic text-xs">Não existem processos com datas suficientes para calcular este indicador.</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={logisticsAverages.cargo} margin={{ top: 20, right: 30, left: -10, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                                                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                    <Tooltip />
                                                    <Bar dataKey="Dias" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={30} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm">Dias Médios por Fornecedor</h3>
                                    <div className="h-64">
                                        {logisticsAverages.supplier.length === 0 ? (
                                            <div className="flex items-center justify-center h-full text-slate-400 italic text-xs">Não existem processos com datas suficientes para calcular este indicador.</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={logisticsAverages.supplier} margin={{ top: 20, right: 30, left: -10, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                                                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                    <Tooltip />
                                                    <Bar dataKey="Dias" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={30} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm lg:col-span-2">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm">Top 10 Processos Mais Demorados</h3>
                                    <div className="overflow-x-auto max-h-80 scrollbar-thin">
                                        <table className="table table-compact w-full text-xs">
                                            <thead>
                                                <tr>
                                                    <th className="bg-slate-50 text-slate-500 font-bold sticky top-0">Processo</th>
                                                    <th className="bg-slate-50 text-slate-500 font-bold sticky top-0">Fornecedor</th>
                                                    <th className="bg-slate-50 text-slate-500 font-bold sticky top-0">Despachante</th>
                                                    <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0">Dias Totais</th>
                                                    <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {top10Longest.map((p, idx) => (
                                                    <tr key={idx} className="hover:bg-slate-50/50">
                                                        <td className="font-bold text-slate-700">{p.docNum}</td>
                                                        <td>{p.fornecedor}</td>
                                                        <td>{p.despachante}</td>
                                                        <td className="text-center font-mono font-bold text-rose-600">{p.diasTotais} {p.isParcial ? '(parcial)' : ''}</td>
                                                        <td className="text-center">
                                                            <span className={`badge badge-sm font-semibold border-none ${p.statusFinal === 'Concluído' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                                                {p.statusFinal}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {top10Longest.length === 0 && (
                                                    <tr>
                                                        <td colSpan={5} className="text-center py-6 text-slate-400 italic">Não existem processos com datas suficientes para calcular este indicador.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 3. ANÁLISE FINANCEIRA */}
                    {activeTab === 'analise_financeira' && (
                        <div className="space-y-6">
                            {/* Financial Cards Grid */}
                            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mercadoria (FOB)</div>
                                    <div className="text-lg font-black text-slate-800 mt-1 font-mono">{formatKwanza(financialData.totalMercadoria)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Frete Total</div>
                                    <div className="text-lg font-black text-slate-700 mt-1 font-mono">{formatKwanza(financialData.totalFrete)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Custos Adicionais</div>
                                    <div className="text-lg font-black text-amber-600 mt-1 font-mono">{formatKwanza(financialData.totalCustosAdicionais)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">RDF Total</div>
                                    <div className="text-lg font-black text-slate-700 mt-1 font-mono">{formatKwanza(financialData.totalRDF)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">IVA Total</div>
                                    <div className="text-lg font-black text-slate-700 mt-1 font-mono">{formatKwanza(financialData.totalIVA)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Direitos Aduaneiros</div>
                                    <div className="text-lg font-black text-slate-700 mt-1 font-mono">{formatKwanza(financialData.totalDireitos)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Serviços Despachante</div>
                                    <div className="text-lg font-black text-slate-700 mt-1 font-mono">{formatKwanza(financialData.totalDespachante)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Custo de Importação</div>
                                    <div className="text-lg font-black text-[#4f46e5] mt-1 font-mono">{formatKwanza(financialData.totalImportacao)}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-4 rounded-xl shadow-sm col-span-2 lg:col-span-1 bg-indigo-50 border-indigo-200">
                                    <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Coeficiente Médio</div>
                                    <div className="text-2xl font-black text-indigo-700 mt-1 font-mono">{financialData.avgCoef}</div>
                                    <div className="text-[9px] text-slate-400">Min: {financialData.minCoef} | Max: {financialData.maxCoef}</div>
                                </div>
                            </div>

                            {/* Cost Composition Chart */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaChartPie /> Composição dos custos da importação</h3>
                                    <div className="h-72 flex items-center justify-center">
                                        {financialData.costComposition.length === 0 ? (
                                            <div className="text-slate-400 italic text-xs">Não existem processos com dados suficientes para calcular este indicador.</div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie
                                                        data={financialData.costComposition}
                                                        cx="50%"
                                                        cy="50%"
                                                        innerRadius={60}
                                                        outerRadius={80}
                                                        paddingAngle={5}
                                                        dataKey="value"
                                                    >
                                                        {financialData.costComposition.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip formatter={(value) => formatKwanza(value)} />
                                                    <Legend />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaDollarSign /> Tabela Resumo Financeiro</h3>
                                    <div className="overflow-x-auto">
                                        <table className="table table-compact w-full text-xs">
                                            <thead>
                                                <tr>
                                                    <th className="bg-slate-50 text-slate-500 font-bold">Categoria de Custo</th>
                                                    <th className="bg-slate-50 text-slate-500 font-bold text-right">Valor</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Frete</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalFrete)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Serviços Despachante</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalDespachante)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Direitos Aduaneiros</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalDireitos)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">IVA</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalIVA)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">RDF</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalRDF)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Outros Custos / Adicionais</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalCustosAdicionais)}</td>
                                                </tr>
                                                <tr className="border-t border-slate-300 font-black bg-slate-50">
                                                    <td className="text-slate-800">Custo Adicional Total</td>
                                                    <td className="text-right text-indigo-600 font-mono">{formatKwanza(financialData.totalCustos)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* Monthly Cost Evolution Chart */}
                            <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm mt-6">
                                <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5">
                                    <FaChartLine /> Evolução dos custos por mês (Valor FOB vs Custos adicionais vs Coeficiente)
                                </h3>
                                <div className="h-80">
                                    {financialData.monthlyEvolution.length === 0 ? (
                                        <div className="flex items-center justify-center h-full text-slate-400 italic text-xs">
                                            Não existem processos com datas suficientes para calcular este indicador.
                                        </div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={financialData.monthlyEvolution} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                                <XAxis dataKey="periodo" stroke="#94a3b8" fontSize={11} />
                                                {/* Left Y-Axis for Values */}
                                                <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} label={{ value: 'Valor (Kz)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' } }} />
                                                {/* Right Y-Axis for Coefficient */}
                                                <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={11} label={{ value: 'Coeficiente', angle: 90, position: 'insideRight', style: { fill: '#10b981', fontSize: 10, fontWeight: 'bold' } }} />
                                                <Tooltip formatter={(value, name) => {
                                                    if (name === 'Coeficiente') return value;
                                                    return formatKwanza(value);
                                                }} />
                                                <Legend />
                                                <Bar yAxisId="left" dataKey="Valor FOB" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={24} />
                                                <Bar yAxisId="left" dataKey="Custos Adicionais" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={24} />
                                                <Line yAxisId="right" type="monotone" dataKey="Coeficiente" stroke="#10b981" strokeWidth={3} activeDot={{ r: 8 }} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </div>

                            {/* Ranking de Custos de Processos */}
                            <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                <h3 className="font-bold text-slate-700 mb-4 text-sm">Ranking de Processos com Maior Custo</h3>
                                <div className="overflow-x-auto max-h-80 scrollbar-thin">
                                    <table className="table table-compact w-full text-xs">
                                        <thead>
                                            <tr>
                                                <th className="bg-slate-50 text-slate-500 font-bold sticky top-0">Processo</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold sticky top-0">Fornecedor</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold sticky top-0">Despachante</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0">Valor Mercadoria</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0">Custos Adicionais</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0">Coeficiente</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {financialData.processCostRanking.map((p, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50/50">
                                                    <td className="font-bold text-slate-700">{p.docNum}</td>
                                                    <td>{p.fornecedor}</td>
                                                    <td>{p.despachante}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.valMercadoria)}</td>
                                                    <td className="text-right font-mono font-bold text-indigo-600">{formatKwanza(p.custoTotal)}</td>
                                                    <td className="text-center font-mono font-bold text-emerald-600">{p.coeficienteText}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 4. PERFORMANCE DOS DESPACHANTES */}
                    {activeTab === 'performance_despachantes' && (
                        <div className="space-y-6">
                            <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaUserShield /> Performance dos Despachantes (Volume, Prazos e Custos)</h3>
                                
                                <div className="overflow-x-auto max-h-96 scrollbar-thin">
                                    <table className="table w-full text-xs">
                                        <thead>
                                            <tr>
                                                <th className="bg-slate-50 text-slate-500 font-bold sticky top-0 whitespace-normal">Despachante</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 whitespace-normal">Processos<br />Atribuídos</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 whitespace-normal">Processos<br />Concluídos</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 whitespace-normal">Tempo Médio<br />Desembaraço</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 whitespace-normal">Tempo Médio<br />até Entrega</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 whitespace-normal">Valor<br />Movimentado</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 whitespace-normal">Custo Médio /<br />Processo</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 whitespace-normal">Coeficiente<br />Médio</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 w-24 whitespace-normal">Ação</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {despachantesPerformance.map((p, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50/50">
                                                    <td className="font-semibold text-slate-700">{p.name}</td>
                                                    <td className="text-center font-mono font-bold">{p.count}</td>
                                                    <td className="text-center font-mono">{p.completed}</td>
                                                    <td className="text-center font-mono font-bold text-indigo-600">
                                                        {p.avgClearingDays !== '-' ? `${p.avgClearingDays} dias` : '-'}
                                                    </td>
                                                    <td className="text-center font-mono">
                                                        {p.avgDeliveryDays !== '-' ? `${p.avgDeliveryDays} dias` : '-'}
                                                    </td>
                                                    <td className="text-right font-mono">{formatKwanza(p.totalValue)}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.avgCostPerProcess)}</td>
                                                    <td className="text-center font-mono font-bold text-emerald-600">{p.avgCoef}</td>
                                                    <td className="text-center">
                                                        <button 
                                                            onClick={() => {
                                                                if (selectedDespachanteGroup === p.name) {
                                                                    setSelectedDespachanteGroup(null);
                                                                } else {
                                                                    setSelectedDespachanteGroup(p.name);
                                                                }
                                                            }} 
                                                            className={selectedDespachanteGroup === p.name 
                                                                ? "px-3 py-1 bg-[#e11d48] text-white hover:bg-[#be123c] text-[10px] font-semibold rounded-full transition-all whitespace-nowrap shadow-sm" 
                                                                : "px-3 py-1 border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-[10px] font-semibold rounded-full transition-all whitespace-nowrap shadow-sm"
                                                            }
                                                        >
                                                            {selectedDespachanteGroup === p.name ? 'Fechar' : 'Visualizar Processos'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {despachantesPerformance.length === 0 && (
                                                <tr>
                                                    <td colSpan={9} className="text-center py-8 text-slate-400 italic">Não existem despachantes registrados para esta seleção.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {selectedDespachanteGroup && (
                                    <div className="mt-6 border-t border-slate-100 pt-6">
                                        <DetailDrillDown 
                                            groupKey="despachante" 
                                            groupValue={selectedDespachanteGroup} 
                                            allProcesses={detailedProcesses} 
                                            handleOpenDocument={handleOpenDocument}
                                            onClose={() => setSelectedDespachanteGroup(null)}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 5. VISÃO DETALHADA (NEW TAB) */}
                    {activeTab === 'visao_detalhada' && (
                        <div className="space-y-4">
                            {/* Search & Actions */}
                            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                                <div className="relative w-full md:w-80">
                                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                                        <FaSearch />
                                    </span>
                                    <input 
                                        type="text" 
                                        placeholder="Buscar processos..." 
                                        className="input input-bordered input-sm pl-9 bg-white text-slate-700 w-full rounded-xl"
                                        value={detailSearch}
                                        onChange={(e) => setDetailSearch(e.target.value)}
                                    />
                                </div>
                                <div className="text-xs text-slate-500 font-bold">
                                    Exibindo {searchedAndSortedDetails.length} de {detailedProcesses.length} processos
                                </div>
                            </div>

                            {/* Detailed Grid Table */}
                            <div className="card bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                                <div className="overflow-x-auto max-h-[500px] scrollbar-thin">
                                    <table className="table table-compact w-full text-[11px] border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50">
                                                {renderFilterHeader('Nº Processo', 'docNum')}
                                                {renderFilterHeader('Etapa Atual', 'etapa')}
                                                {renderFilterHeader('Responsável', 'responsavel')}
                                                {renderFilterHeader('Despachante', 'despachante')}
                                                {renderFilterHeader('Fornecedor', 'fornecedor')}
                                                {renderFilterHeader('Tipo Carga', 'tipoCarga')}
                                                <th className="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10">Entrada Bolloré</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10">Envio Angola</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10">Chegada Angola</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10">Saída Alfândega</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10">Entrega RCS</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0 z-10">V. Mercadoria</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0 z-10">Frete</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0 z-10">C. Adicionais</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0 z-10">RDF</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0 z-10">IVA</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0 z-10">Direitos</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-right sticky top-0 z-10">Serv. Desp.</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-center sticky top-0 z-10">Coeficiente</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-center sticky top-0 z-10" onClick={() => setDetailSort({ column: 'diasTotais', direction: detailSort.direction === 'asc' ? 'desc' : 'asc' })}>Dias Totais</th>
                                                <th className="bg-slate-100 text-slate-600 font-bold text-center sticky top-0 z-10" onClick={() => setDetailSort({ column: 'diasParado', direction: detailSort.direction === 'asc' ? 'desc' : 'asc' })}>Dias Parado</th>
                                                {renderFilterHeader('Status', 'statusFinal')}
                                                {renderFilterHeader('Qualidade Dados', 'qualidade')}
                                                <th className="bg-slate-100 text-slate-600 font-bold text-center sticky top-0 z-10">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {searchedAndSortedDetails.map((p, idx) => (
                                                <tr key={p.id} className="hover:bg-slate-50 border-b border-slate-100">
                                                    <td className="font-bold text-slate-700">{p.docNum}</td>
                                                    <td>
                                                        <span className="font-medium text-slate-600">{p.etapa}</span>
                                                    </td>
                                                    <td className="max-w-[120px] truncate" title={p.responsavel}>{p.responsavel}</td>
                                                    <td className="max-w-[120px] truncate" title={p.despachante}>{p.despachante}</td>
                                                    <td className="max-w-[120px] truncate" title={p.fornecedor}>{p.fornecedor}</td>
                                                    <td>{p.tipoCarga}</td>
                                                    <td>{p.dtBollore}</td>
                                                    <td>{p.dtEnvio}</td>
                                                    <td>{p.dtChegada}</td>
                                                    <td>{p.dtSaidaAlfandega}</td>
                                                    <td>{p.dtEntregaRCS}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.valMercadoria)}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.frete)}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.custosAdicionais)}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.rdf)}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.iva)}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.direitos)}</td>
                                                    <td className="text-right font-mono">{formatKwanza(p.servicosDespachante)}</td>
                                                    <td className="text-center font-mono font-bold text-indigo-600">{p.coeficienteText}</td>
                                                    <td className="text-center font-mono">{p.diasTotais} {p.isParcial ? '(parcial)' : ''}</td>
                                                    <td className="text-center font-mono font-bold text-rose-600">{p.diasParado}</td>
                                                    <td className="text-center">
                                                        <span className={`badge badge-sm font-semibold border-none ${p.statusFinal === 'Concluído' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                                            {p.statusFinal}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className={`badge badge-sm border-none font-bold ${
                                                            p.qualidade === 'Completo' ? 'bg-emerald-100 text-emerald-700' :
                                                            p.qualidade === 'Falta custo final' ? 'bg-slate-100 text-slate-600' :
                                                            'bg-amber-100 text-amber-700'
                                                        }`}>
                                                            {p.qualidade}
                                                        </span>
                                                    </td>
                                                    <td className="text-center">
                                                        <button 
                                                            onClick={() => handleOpenDocument(p.id)}
                                                            className="btn btn-xs btn-outline btn-primary font-bold flex items-center gap-1 mx-auto rounded-lg"
                                                            title="Ver documento no DocuWare"
                                                        >
                                                            <FaExternalLinkAlt className="text-[9px]" /> Abrir
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {searchedAndSortedDetails.length === 0 && (
                                                <tr>
                                                    <td colSpan={24} className="text-center py-8 text-slate-400 italic">Nenhum processo correspondente aos critérios de busca.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default WorkflowAnalyticsPage;
