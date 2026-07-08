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
    FaExternalLinkAlt,
    FaInfoCircle,
    FaFileAlt
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
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    if (!str) return 0;
    
    // Se a string contém tanto ponto quanto vírgula
    if (str.includes('.') && str.includes(',')) {
        const lastDot = str.lastIndexOf('.');
        const lastComma = str.lastIndexOf(',');
        if (lastDot > lastComma) {
            const clean = str.replace(/[^0-9.-]/g, '');
            return parseFloat(clean) || 0;
        } else {
            const clean = str.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
            return parseFloat(clean) || 0;
        }
    }
    
    // Se contém apenas vírgula
    if (str.includes(',')) {
        const commaCount = (str.match(/,/g) || []).length;
        if (commaCount === 1) {
            const clean = str.replace(',', '.').replace(/[^0-9.-]/g, '');
            return parseFloat(clean) || 0;
        } else {
            const clean = str.replace(/,/g, '').replace(/[^0-9.-]/g, '');
            return parseFloat(clean) || 0;
        }
    }
    
    // Se contém apenas ponto
    if (str.includes('.')) {
        const dotCount = (str.match(/\./g) || []).length;
        if (dotCount === 1) {
            const clean = str.replace(/[^0-9.-]/g, '');
            return parseFloat(clean) || 0;
        } else {
            const clean = str.replace(/\./g, '').replace(/[^0-9.-]/g, '');
            return parseFloat(clean) || 0;
        }
    }
    
    const clean = str.replace(/[^0-9.-]/g, '');
    return parseFloat(clean) || 0;
};

const getDWFieldVal = (doc, ...aliases) => {
    if (!doc || !doc.Fields) return 0;
    const cleanAliases = aliases.map(a => a.toLowerCase().replace(/[e\s_\-\.\/]/g, ''));
    const field = doc.Fields.find(f => {
        const name = (f.FieldName || '').toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
            .replace(/[e\s_\-\.\/]/g, '');
        return cleanAliases.includes(name);
    });
    if (!field) return 0;
    return parseCurrency(field.Item || field.Value || '');
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

// Reusable Tooltip component for small stats cards (KPIs)
const CardInfoTooltip = ({ metricKey, activeKey, setActiveKey }) => {
    const [showDetails, setShowDetails] = useState(false);
    const exp = METRIC_EXPLANATIONS[metricKey];

    useEffect(() => {
        if (activeKey !== metricKey) {
            setShowDetails(false);
        }
    }, [activeKey, metricKey]);

    if (!exp || activeKey !== metricKey) return null;
    return (
        <div className="absolute z-30 top-9 right-2 bg-[#4f46e5] text-white text-[10px] p-3 rounded-xl shadow-lg w-[260px] text-left leading-relaxed">
            <div className="absolute -top-1 right-3.5 w-2 h-2 bg-[#4f46e5] transform rotate-45"></div>
            <div className="flex justify-between items-center mb-1 font-extrabold uppercase tracking-wider text-[9px] text-indigo-200">
                <span>Regra de Cálculo</span>
                <button onClick={(e) => { e.stopPropagation(); setActiveKey(null); }} className="text-indigo-200 hover:text-white ml-2 text-xs">✕</button>
            </div>
            <div className="font-bold">
                {exp.formula}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-indigo-500/50 text-[9px] text-indigo-100 font-medium">
                Origem: {exp.source}
            </div>

            {exp.details && (
                <div className="mt-2 pt-2 border-t border-indigo-500/50">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setShowDetails(!showDetails); }}
                        className="text-[9px] text-indigo-200 hover:text-white font-bold flex items-center gap-1 transition-colors"
                    >
                        {showDetails ? 'Ocultar Detalhes Técnicos' : 'Ver Detalhes (Campos DocuWare)'}
                    </button>
                    {showDetails && (
                        <div className="mt-1.5 p-2 bg-indigo-900/50 border border-indigo-700/50 rounded text-[9px] text-indigo-100 font-mono break-words">
                            {exp.details}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Reusable inline alert component for charts and big tables
const ChartInfoAlert = ({ metricKey, showInfo, setShowInfo }) => {
    const [showDetails, setShowDetails] = useState(false);
    const exp = METRIC_EXPLANATIONS[metricKey];
    
    // Reset showDetails when alert is hidden or metricKey changes
    useEffect(() => {
        if (!showInfo) {
            setShowDetails(false);
        }
    }, [showInfo, metricKey]);

    if (!exp || !showInfo) return null;
    return (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 relative text-xs mb-4 text-left">
            <button 
                onClick={() => {
                    setShowInfo(false);
                    setShowDetails(false);
                }} 
                className="absolute top-3 right-3.5 text-slate-400 hover:text-slate-600 transition-colors"
            >
                ✕
            </button>
            <h4 className="font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <FaInfoCircle className="text-indigo-600" /> Regras do Indicador ({exp.title})
            </h4>
            <div className="text-slate-600 space-y-1.5 font-medium leading-relaxed">
                <div><strong>Fórmula:</strong> {exp.formula}</div>
                <p><strong>Origem dos Dados:</strong> {exp.source}</p>
                {exp.description && <p className="text-[11px] text-slate-500 mt-1">{exp.description}</p>}
                
                {exp.details && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                        <button 
                            onClick={() => setShowDetails(!showDetails)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 transition-colors"
                        >
                            {showDetails ? 'Ocultar Detalhes Técnicos' : 'Ver Detalhes (Mapeamento de Campos do DocuWare)'}
                        </button>
                        {showDetails && (
                            <div className="mt-2 p-3 bg-white border border-slate-200 rounded-lg text-[11px]">
                                {exp.details}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
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

const METRIC_EXPLANATIONS = {
    total_processos: {
        title: "Total Processos",
        formula: "Quantidade total de instâncias localizadas",
        source: "Filtro dinâmico por Tipo de Documento no DocuWare",
        description: "Volume absoluto de processos de importação iniciados no período selecionado."
    },
    em_andamento: {
        title: "Em Andamento",
        formula: "Total Processos - Concluídos",
        source: "Verificação de etapa atual (Etapas 1 a 5) no DocuWare",
        description: "Processos ativos em qualquer etapa logística ou de desembaraço aduaneiro antes da entrega."
    },
    concluidos: {
        title: "Concluídos",
        formula: "Instâncias na Etapa 6 ou com data de entrega na RCS",
        source: "Campo DATA_ENTREGUE, DATA_ENTREGUE_RCS ou status Concluído no histórico",
        description: "Processos que finalizaram todo o ciclo logístico e aduaneiro, com a carga entregue."
    },
    em_atraso: {
        title: "Em Atraso",
        formula: "Processos ativos sem atualização de etapa há mais de 15 dias",
        source: "Cálculo de diferença de tempo a partir da última transição no histórico",
        description: "Gargalos operacionais críticos que necessitam de intervenção ou cobrança de parceiros."
    },
    valor_processos_abertos: {
        title: "Valor Total em Processos Abertos",
        formula: "Soma de (Montante_Factura * Valor Cambial) para processos 'Em Andamento'",
        source: "Campos MONTANTE_FACTURA e VALOR_CAMBIAL no DocuWare",
        description: "Exposição financeira total e fluxo de caixa comprometido em mercadorias atualmente em trânsito/desembaraço."
    },
    prazo_medio_total: {
        title: "Prazo Médio Total",
        formula: "Média de (Data de Entrega na RCS - Entrada na Bolloré) em dias",
        source: "Mapeamento dos campos DATA_ENTRADA_BOLLORE e DATA_ENTREGUE no DocuWare",
        description: "Ciclo médio total (Lead Time) de ponta a ponta para a nacionalização e entrega de cargas."
    },
    parado_etapa_atual: {
        title: "Parado na Etapa Atual",
        formula: "Média de dias desde a última movimentação de etapa dos processos ativos",
        source: "Último StepDate registrado no histórico da instância",
        description: "Tempo médio de retenção dos processos nas mãos dos respectivos responsáveis."
    },
    fob: {
        title: "Valor Mercadoria",
        formula: "Soma de (Montante_Factura * Valor Cambial)",
        source: "Campos Montante_Factura e Valor Cambial no DocuWare",
        description: "Custo de aquisição da mercadoria convertida para a moeda local (Cuanzas).",
        details: "Mercadoria: Montante_Factura, VALOR_FOB, FOB, VALOR_MERCADORIA, VALOR.\nCâmbio: VALOR_CAMBIAL, VALOR_CAMBIO, CAMBIO, TAXA_CAMBIO."
    },
    frete: {
        title: "Frete Total",
        formula: "Soma de (Montante_transporte * Valor Cambial)",
        source: "Campos Montante_transporte e Valor Cambial no DocuWare",
        description: "Custo total com frete internacional para movimentação das cargas até Angola.",
        details: "Frete: Montante_transporte, VALOR_FRETE, FRETE.\nCâmbio: VALOR_CAMBIAL, VALOR_CAMBIO, CAMBIO, TAXA_CAMBIO."
    },
    custos_adicionais: {
        title: "Custos Adicionais",
        formula: "Soma de (Despesas_extras * Valor Cambial)",
        source: "Campos Despesas_extras, CUSTOS_ADICIONAIS ou OUTROS_CUSTOS no DocuWare",
        description: "Custos diversos e taxas logísticas extraordinárias incorridas durante o trânsito.",
        details: "Custos: Despesas_extras, CUSTOS_ADICIONAIS, OUTROS_CUSTOS, OUTRAS_DESPESAS.\nCâmbio: VALOR_CAMBIAL, VALOR_CAMBIO, CAMBIO, TAXA_CAMBIO."
    },
    rdf: {
        title: "RDF Total",
        formula: "Soma de Montante_RDF",
        source: "Campo Montante_RDF (Cuanzas) no DocuWare",
        description: "Total pago em tarifas de importação e impostos via documento de arrecadação aduaneira (RDF).",
        details: "RDF: Montante_RDF, RDF."
    },
    iva: {
        title: "IVA Total",
        formula: "Soma de Valor IVA_Importação",
        source: "Campo Valor IVA_Importação no DocuWare",
        description: "Total acumulado de Imposto sobre o Valor Acrescentado recolhido na importação.",
        details: "IVA: Valor IVA_Importação, IVA_IMPORTACAO, IVA."
    },
    direitos: {
        title: "Direitos Aduaneiros",
        formula: "Soma de Direito Alfandegários e Taxas",
        source: "Campo Direito Alfandegários e Taxas no DocuWare",
        description: "Taxas aduaneiras e direitos alfandegários recolhidos.",
        details: "Direitos: Direito Alfandegários e Taxas, DIREITOS_ALFANDEGARIOS, DIREITO_ALFANDEGARIOS, DIREITO_ALFAND."
    },
    despachante: {
        title: "Serviços Despachante",
        formula: "Soma de Serviços Despachantes",
        source: "Campo Serviços Despachantes (Cuanzas) no DocuWare",
        description: "Honorários e taxas de serviços pagos aos despachantes oficiais aduaneiros.",
        details: "Despachante: Serviços Despachantes, SERVICO_DESPACHANTE."
    },
    custo_importacao: {
        title: "Custo de Importação",
        formula: "Valor_Mercadoria_Kz + Montante_RDF + Serviços Despachantes + Frete_Kz + Despesas_Extras_Kz",
        source: "Fórmula de consolidação corporativa (soma dos componentes acima convertidos)",
        description: "Custo real desembolsado de ponta a ponta para colocação da mercadoria no inventário da empresa.",
        details: "Soma: Valor Mercadoria (em Kz) + RDF + Serviços Despachante + Frete (em Kz) + Custos Adicionais (em Kz)."
    },
    fator_nacionalizacao: {
        title: "Coeficiente de Importação (Landing Factor)",
        formula: "Soma de todas as despesas ÷ Montante Fatura. É exibido como um multiplicador (ex: 1.25x representa 25% de custo adicional sobre a Mercadoria).",
        source: "Divisão do Custo total de importação pelo valor da mercadoria (Montante_Factura).",
        description: "Compara o Coeficiente Previsto (RDF) e o Coeficiente Realizado (FC).",
        details: "Previsto (RDF): (Valor_Mercadoria_Kz + RDF + Despachante + Frete_Kz + Extras_Kz + Direitos + IVA + IVA_Servicos) / Valor_Mercadoria_Kz\nRealizado (FC): (Valor_Mercadoria_FC_Kz + Direitos_FC + IVA_FC + Despachante_FC + IVA_Servicos_FC + Frete_Kz + Extras_Kz) / Valor_Mercadoria_FC_Kz"
    },
    custo_despesas_total: {
        title: "Custo Despesas Total",
        formula: "Soma de todos os impostos, taxas, frete e honorários de despachante (excluindo o valor da mercadoria).",
        source: "Campos de impostos e despesas do DocuWare de Abertura (RDF) e Fechamento (FC).",
        description: "Mostra o valor consolidado gasto em despesas de importação para nacionalizar a mercadoria.",
        details: "Previsto (RDF): Frete + Custos Adicionais + RDF + IVA + Direitos + Despachante + IVA Serviços\nRealizado (FC): Frete + Custos Adicionais + Direitos_FC + IVA_FC + Despachante_FC + IVA Serviços_FC"
    },
    desvio_cambial: {
        title: "Desvio Cambial",
        formula: "Soma de [Montante_Factura * (Valor Cambial - Vaor Cambial_FC)]",
        source: "Diferença entre a taxa cambial do fechamento (Valor Cambial) e da emissão da fatura (Vaor Cambial_FC)",
        description: "Impacto financeiro acumulado decorrente da variação do Cuanza frente às moedas estrangeiras da compra.",
        details: "Fechamento: VALOR_CAMBIAL, VALOR_CAMBIO, CAMBIO, TAXA_CAMBIO.\nEmissão (FC): VAOR_CAMBIAL_FC, VALOR_CAMBIAL_FC, CAMBIO_FC, TAXA_CAMBIO_FC."
    },
    grafico_etapas: {
        title: "Distribuição por Etapa",
        formula: "Contagem de processos ativos agrupados por sua etapa avaliada (1 a 6)",
        source: "Análise dinâmica de campos de status e tarefas do histórico no DocuWare",
        description: "Distribuição física dos processos na esteira operacional para identificação de gargalos."
    },
    grafico_tempo_etapa: {
        title: "Tempo Médio por Etapa",
        formula: "Média de dias decorridos entre a entrada e a saída de cada etapa no histórico",
        source: "Diferença entre o StepDate das tarefas de início e conclusão de cada etapa",
        description: "Velocidade de processamento operacional média em cada fase del fluxo."
    },
    trecho_portugal_bollore: {
        title: "Portugal → Bolloré",
        formula: "Média de (Data Entrada na Bolloré - Data Saída Portugal)",
        source: "Campos DATA_SAIDA_PORTUGAL e DATA_ENTRADA_BOLLORE no DocuWare",
        description: "Tempo de trânsito internacional do porto/aeroporto de origem até o operador logístico internacional."
    },
    trecho_bollore_angola: {
        title: "Bolloré → Angola",
        formula: "Média de (Data Chegada Angola - Data Entrada na Bolloré)",
        source: "Campos DATA_CHEGADA e DATA_ENTRADA_BOLLORE no DocuWare",
        description: "Tempo de consolidação e transporte da carga até a chegada em Angola."
    },
    trecho_angola_rcs: {
        title: "Angola → RCS",
        formula: "Média de (Data de Entrega na RCS - Data Chegada Angola)",
        source: "Campos DATA_CHEGADA e DATA_ENTREGUE no DocuWare",
        description: "Tempo necessário para o desembaraço aduaneiro local e transporte terrestre até o armazém final."
    },
    grafico_donut_custos: {
        title: "Composição dos Custos Adicionais da Importação",
        formula: "Rateio percentual de (Frete + Despachante + RDF + Outros Custos)",
        source: "Divisão de cada componente aduaneiro e logístico pelo custo adicional consolidado",
        description: "Identificação da participação de cada custo no acréscimo de nacionalização (excluindo FOB)."
    },
    grafico_waterfall: {
        title: "Análise de Acúmulo de Custo (Cascata)",
        formula: "Evolução empilhada a partir do FOB, somando sucessivamente Frete, RDF, Despachante e Outros Custos",
        source: "Construção de barras empilhadas para ilustrar a composição final do Custo de Importação",
        description: "Visualização didática de como o valor FOB inicial é onerado pelas despesas de importação."
    },
    tempo_grupagem: {
        title: "Tempo Médio de Grupagem",
        formula: "Média de dias decorridos na etapa de consolidação/grupagem da mercadoria",
        source: "Histórico de transições de status da carga na origem",
        description: "Tempo decorrido aguardando lote mínimo ou consolidação logística antes do embarque."
    },
    tempo_alfandega: {
        title: "Tempo na Alfândega",
        formula: "Média de (Data Despacho/Saída Alfândega - Data Chegada Angola)",
        source: "Campos DATA_CHEGADA e DATA_SAIDA_ALFANDEGA ou DATA_DESPACHO no DocuWare",
        description: "Lead time aduaneiro total para liberação da mercadoria nas alfândegas locais."
    },
    tempo_medio_trecho: {
        title: "Tempo Médio por Trecho",
        formula: "Somas médias dos tempos decorridos entre os marcos logísticos definidos",
        source: "Campos DATA_SAIDA_PORTUGAL, DATA_ENTRADA_BOLLORE, DATA_CHEGADA e DATA_ENTREGUE no DocuWare",
        description: "Ciclo de trânsito dividido por fases logísticas para identificação fina de responsabilidade."
    },
    dias_medio_despachante: {
        title: "Média de Dias por Despachante",
        formula: "Média de dias totais de processos concluídos agrupados pelo parceiro Despachante",
        source: "Campo DESPACHANTE (DocuWare) e histórico de lead time",
        description: "Performance de prazo médio de desembaraço entregue por cada parceiro despachante aduaneiro."
    },
    dias_medio_tipo_carga: {
        title: "Dias Médios por Tipo de Carga",
        formula: "Média de dias totais de processos concluídos agrupados pelo Tipo de Carga",
        source: "Campo TIPO_DE_CARGA ou TIPO_CARGA (DocuWare) e histórico de lead time",
        description: "Duração do processo de acordo com a urgência ou natureza do frete (ex: Grupagem vs Especial)."
    },
    dias_medio_fornecedor: {
        title: "Dias Médios por Fornecedor",
        formula: "Média de dias de processos concluídos agrupados pelo Fornecedor",
        source: "Campo FORNECEDOR (DocuWare) e histórico de lead time",
        description: "Prazo logístico médio desde a saída do fornecedor internacional até a entrega final."
    },
    top_10_demorados: {
        title: "Top 10 Processos Mais Demorados",
        formula: "Os 10 processos ativos ou concluídos com maior número de dias totais decorridos",
        source: "Ranking ordenado decrescente por (Data Fim / Hoje - Data Início)",
        description: "Visão executiva prioritária sobre os desvios extremos de prazo para análise de causa raiz."
    },
    performance_despachantes_tabela: {
        title: "Métricas da Tabela de Performance dos Despachantes",
        formula: (
            <ul className="list-disc pl-4 space-y-1 mt-1 text-[11px]">
                <li><strong>Processos Atribuídos:</strong> Contagem de todos os processos sob responsabilidade do despachante.</li>
                <li><strong>Processos Concluídos:</strong> Quantidade de processos do despachante cujo status é "Concluído".</li>
                <li><strong>Tempo Médio Desembaraço:</strong> Média de dias entre a Data de Chegada a Angola e a Data de Saída da Alfândega (para processos com ambas as datas).</li>
                <li><strong>Tempo Médio até Entrega:</strong> Média de dias entre a Data de Saída da Alfândega e a Data de Entrega na RCS (para processos com ambas as datas).</li>
                <li><strong>Valor Movimentado:</strong> Soma total dos valores dos processos do despachante (Valor FOB + todas as despesas).</li>
                <li><strong>Custo Médio / Processo:</strong> Média de todas as despesas (Frete + RDF + IVA + Direitos + Serviços + Adicionais, excluindo FOB) por processo do despachante.</li>
                <li><strong>Coeficiente Médio:</strong> Média aritmética dos Landing Factors dos processos do despachante (Custo de Importação / Valor FOB).</li>
            </ul>
        ),
        source: "Campos de valor e datas aduaneiras do DocuWare consolidando custos, FOB, trâmites e tempos de fluxo.",
        description: "Detalhamento das regras e dados utilizados para avaliar o desempenho de prazos, custos e volumes movimentados por despachante.",
        details: (
            <div className="space-y-3">
                <p className="font-bold text-slate-700">Mapeamento de Campos de Dados do DocuWare para a Tabela:</p>
                <div className="overflow-x-auto">
                    <table className="table table-compact table-xs w-full text-[10px] border border-slate-200">
                        <thead>
                            <tr className="bg-slate-100 text-slate-700">
                                <th className="p-1.5 border border-slate-200 text-left font-bold">Coluna da Tabela</th>
                                <th className="p-1.5 border border-slate-200 text-left font-bold">Mapeamento e Campos Técnicos do DocuWare (Ordem de Busca)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            <tr>
                                <td className="p-1.5 border border-slate-200 font-semibold text-slate-700">Despachante</td>
                                <td className="p-1.5 border border-slate-200 font-mono text-indigo-600">DESPACHANTE, DESPACHADOR</td>
                            </tr>
                            <tr className="bg-slate-50/50">
                                <td className="p-1.5 border border-slate-200 font-semibold text-slate-700">Tempo Médio Desembaraço</td>
                                <td className="p-1.5 border border-slate-200 font-mono text-indigo-600">
                                    <span className="text-slate-500 font-sans">Diferença de dias entre:</span><br />
                                    • Chegada: DATA_CHEGADA_ANGOLA, DATA_CHEGADA, CHEGADA_AO<br />
                                    • Saída: DATA_SAIDA_ALFANDEGA, DATA_DESEMBARACO, LIBERACAO, DATA_DESPACHO
                                </td>
                            </tr>
                            <tr>
                                <td className="p-1.5 border border-slate-200 font-semibold text-slate-700">Tempo Médio até Entrega</td>
                                <td className="p-1.5 border border-slate-200 font-mono text-indigo-600">
                                    <span className="text-slate-500 font-sans">Diferença de dias entre:</span><br />
                                    • Saída: DATA_SAIDA_ALFANDEGA, DATA_DESEMBARACO, LIBERACAO, DATA_DESPACHO<br />
                                    • Entrega: DATA_ENTREGUE, DATA_ENTREGUE_RCS, ENTREGUE
                                </td>
                            </tr>
                            <tr className="bg-slate-50/50">
                                <td className="p-1.5 border border-slate-200 font-semibold text-slate-700">Valor Movimentado</td>
                                <td className="p-1.5 border border-slate-200 font-mono text-indigo-600">
                                    <span className="text-slate-500 font-sans">Soma de FOB + Frete + Custos Adicionais + Impostos + Taxas + Serviços:</span><br />
                                    • FOB: VALOR_FOB, FOB, VALOR_MERCADORIA, MONTANTE_FACTURA, VALOR<br />
                                    • Frete: VALOR_FRETE, FRETE<br />
                                    • Outros Custos: CUSTOS_ADICIONAIS, OUTROS_CUSTOS, OUTRAS_DESPESAS<br />
                                    • Despachante: SERVICOS_DESPACHANTES, SERVICO_DESPACHANTE<br />
                                    • Direitos: DIREITOS_ALFANDEGARIOS, DIREITO_ALFANDEGARIOS, DIREITO_ALFAND<br />
                                    • IVA: VALOR_IVA_IMPORTACAO, IVA_IMPORTACAO, IVA<br />
                                    • RDF: MONTANTE_RDF, RDF
                                </td>
                            </tr>
                            <tr>
                                <td className="p-1.5 border border-slate-200 font-semibold text-slate-700">Custo Médio / Processo</td>
                                <td className="p-1.5 border border-slate-200 font-mono text-indigo-600">
                                    <span className="text-slate-500 font-sans">Média das despesas totais (soma de Frete + Outros Custos + Despachante + Direitos + IVA + RDF, excluindo FOB) por processo.</span>
                                </td>
                            </tr>
                            <tr className="bg-slate-50/50">
                                <td className="p-1.5 border border-slate-200 font-semibold text-slate-700">Coeficiente Médio</td>
                                <td className="p-1.5 border border-slate-200 font-mono text-indigo-600">
                                    <span className="text-slate-500 font-sans">Média dos Landing Factors de cada processo:</span><br />
                                    • Fórmula: Custo Total de Importação / Valor FOB (Kwanza)<br />
                                    • Custo Total: FOB (Kwanza) + RDF + Serviços Despachante + Frete (Kwanza) + Custos Adicionais (Kwanza)
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        )
    },
    tabela_resumo_financeiro: {
        title: "Tabela Resumo Financeiro",
        formula: "Soma consolidada das categorias de custo logístico e aduaneiro para todos os processos filtrados. Custo Adicional Total representa a soma de todas as despesas (excluindo o valor FOB da mercadoria).",
        source: "Dados financeiros extraídos dos campos do DocuWare (VALOR_FRETE, SERVICOS_DESPACHANTES, DIREITOS_ALFANDEGARIOS, VALOR_IVA_IMPORTACAO, MONTANTE_RDF, CUSTOS_ADICIONAIS).",
        details: (
            <div className="space-y-2">
                <p className="font-bold text-slate-700">Campos do DocuWare para o Resumo:</p>
                <ul className="list-disc pl-4 space-y-1">
                    <li><strong>Frete:</strong> Soma de `VALOR_FRETE` ou `FRETE` convertidos para Cuanzas.</li>
                    <li><strong>Serviços Despachante:</strong> Soma de `SERVICOS_DESPACHANTES` ou `SERVICO_DESPACHANTE`.</li>
                    <li><strong>Direitos Aduaneiros:</strong> Soma de `DIREITOS_ALFANDEGARIOS` ou `DIREITO_ALFANDEGARIOS`.</li>
                    <li><strong>IVA:</strong> Soma de `VALOR_IVA_IMPORTACAO` ou `IVA`.</li>
                    <li><strong>RDF:</strong> Soma de `MONTANTE_RDF` ou `RDF`.</li>
                    <li><strong>Outros Custos / Adicionais:</strong> Soma de `CUSTOS_ADICIONAIS` ou `OUTROS_CUSTOS` convertidos.</li>
                </ul>
            </div>
        )
    },
    ranking_processos_custo: {
        title: "Tabela de Auditoria Financeira dos Processos",
        formula: "Exibição direta de todos os 15 campos financeiros originais de Abertura (Previsto/RDF) e Fechamento (Realizado/FC) extraídos do DocuWare.",
        source: "Dados financeiros e de câmbio carregados diretamente de cada documento do DocuWare (sem cálculos ou conversões intermediárias).",
        details: (
            <div className="space-y-3 text-xs">
                <p className="font-bold text-slate-700">Explicação das Colunas Financeiras Extraídas:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <p className="font-semibold text-slate-600 border-b pb-0.5 mb-1.5">1. Abertura / Previsto (RDF)</p>
                        <ul className="list-disc pl-4 space-y-1 text-slate-600">
                            <li><strong>Montante_Factura:</strong> Valor da mercadoria em moeda estrangeira.</li>
                            <li><strong>Montante_transporte:</strong> Frete estimado em moeda estrangeira.</li>
                            <li><strong>Despesas_extras:</strong> Outras despesas em moeda estrangeira.</li>
                            <li><strong>Valor Cambial:</strong> Taxa de câmbio prevista.</li>
                            <li><strong>Montante_RDF:</strong> Total aduaneiro previsto em Cuanzas (Soma das taxas de Abertura).</li>
                            <li><strong>Taxas Previstas:</strong> <code>Direito Alfandegários e Taxas</code>, <code>Valor IVA_Importação</code>, <code>Serviços Despachantes</code> e <code>Valor IVA_Serviços</code>.</li>
                        </ul>
                    </div>
                    <div>
                        <p className="font-semibold text-slate-600 border-b pb-0.5 mb-1.5">2. Fechamento / Realizado (FC)</p>
                        <ul className="list-disc pl-4 space-y-1 text-slate-600">
                            <li><strong>Vaor Cambial_FC:</strong> Taxa de câmbio realizada no fechamento.</li>
                            <li><strong>Montante_FC:</strong> Total aduaneiro realizado em Cuanzas (Soma das taxas de Fechamento).</li>
                            <li><strong>Taxas Realizadas:</strong> <code>Dir_Alfandegários e Taxas_FC</code>, <code>IVA_Importação_FC</code>, <code>Serviços Despachante_FC</code> e <code>IVA_Serv.Despachante_FC</code>.</li>
                        </ul>
                    </div>
                </div>
            </div>
        )
    }
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
    const [activeTab, setActiveTab] = useState('analise_financeira');
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
    const [selectedViaTransporte, setSelectedViaTransporte] = useState('all');
    const [selectedTransportador, setSelectedTransportador] = useState('all');
    const [selectedEstado, setSelectedEstado] = useState('all');
    const [selectedResponsavel, setSelectedResponsavel] = useState('all');

    // Visão Detalhada States
    const [detailSearch, setDetailSearch] = useState('');
    const [detailSort, setDetailSort] = useState({ column: 'docNum', direction: 'asc' });
    const [activeExplanation, setActiveExplanation] = useState(null);
    const [visibleChartExplanations, setVisibleChartExplanations] = useState({});

    const toggleChartExplanation = (key) => {
        setVisibleChartExplanations(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

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
            // Via de Transporte (Modal)
            if (selectedViaTransporte !== 'all') {
                const val = getDocFieldValue(doc, 'TIPO') || getDocFieldValue(doc, 'VIA') || getDocFieldValue(doc, 'MODAL') || getDocFieldValue(doc, 'MEIO_TRANSPORTE') || getDocFieldValue(doc, 'VIA_TRANSPORTE');
                if (val !== selectedViaTransporte) return false;
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
    }, [documents, documentProgress, selectedDespachante, selectedFornecedor, selectedTipoCarga, selectedViaTransporte, selectedTransportador, selectedEstado, selectedResponsavel]);

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
            
            // Financials (Previsto / RDF)
            // Financials (Previsto / RDF)
            const fMerc = getDWFieldVal(doc, 'MONTANTE_FACTURA', 'VALOR_FOB', 'FOB', 'VALOR_MERCADORIA', 'VALOR');
            const fFrete = getDWFieldVal(doc, 'MONTANTE_TRANSPORTE', 'VALOR_FRETE', 'FRETE', 'TRANSPORTE');
            const fCustosAdicionais = getDWFieldVal(doc, 'DESPESAS_EXTRAS', 'CUSTOS_ADICIONAIS', 'OUTROS_CUSTOS', 'OUTRAS_DESPESAS', 'EXTRAS');
            const fRdf = getDWFieldVal(doc, 'MONTANTE_RDF');
            const fIva = getDWFieldVal(doc, 'VALOR_IVA_MERCADORIA', 'VALOR_IVA_IMPORTACAO', 'IVA_IMPORTACAO', 'IVA');
            const fDireitos = getDWFieldVal(doc, 'DIREITO_ALFANDEGARIOS_E_TAXAS', 'DIREITOS_ALFANDEGARIOS', 'DIREITO_ALFANDEGARIOS', 'DIREITO_ALFAND', 'DIREITO ALFANDEGARIOS E TAXAS');
            const fServicosDespachante = getDWFieldVal(doc, 'SERVICOS_DESPACHANTES', 'SERVICO_DESPACHANTE');
            const fIvaServicos = getDWFieldVal(doc, 'VALOR_IVA_SERVICOS', 'VALOR_IVA_SERVICES', 'IVA_SERVICES', 'IVA_SERVICOS', 'IVA_DESPACHANTE');
            
            // Financials (Realizado / FC)
            // Note: fMercFC is same as fMerc since invoice FOB is constant, just converted with Vaor Cambial_FC
            const fMercFC = fMerc;
            const fDireitosFC = getDWFieldVal(doc, 'DIR_ALFANDEGARIOS_E_TAXAS_FC', 'DIR_ALFANDEGARIOS_TAXAS_FC', 'DIR_ALFANDEGARIOS_FC', 'DIREITOS_ALFANDEGARIOS_FC', 'DIREITOS_FC', 'Dir_Alfandegarios_e_Taxas_FC', 'Dir_Alfandegarios e Taxas_FC');
            const fIvaFC = getDWFieldVal(doc, 'IVA_IMPORTACAO_FC', 'VALOR_IVA_IMPORTACAO_FC', 'IVA_FC');
            const fServicosDespachanteFC = getDWFieldVal(doc, 'SERVICOS_DESPACHANTE_FC', 'SERVICO_DESPACHANTE_FC', 'SERVICOS_DESPACHANTES_FC');
            const fIvaServicosFC = getDWFieldVal(doc, 'IVA_SERV_DESPACHANTE_FC', 'IVA_SERV_FC', 'IVA_SERVICES_FC', 'IVA_SERVICOS_FC', 'IVA_Serv.Despachante_FC');
            const fMontanteFC = getDWFieldVal(doc, 'MONTANTE_FACTURA_DESPACHANTE', 'MONTANTE_FC');

            // Exchange Rates & Conversions
            const fValorCambial = parseCurrency(findFieldVal(doc, ['VALOR_CAMBIAL', 'VALOR_CAMBIO', 'CAMBIO', 'TAXA_CAMBIO', 'VALOR CAMBIAL']));
            const fValorCambialFC = parseCurrency(findFieldVal(doc, ['VAOR_CAMBIAL_FC', 'VALOR_CAMBIAL_FC', 'CAMBIO_FC', 'TAXA_CAMBIO_FC', 'Vaor Cambial_FC']));
            
            const fMercKz = fMerc * (fValorCambial || 1);
            const fMercFCKz = fMerc * (fValorCambialFC || fValorCambial || 1);
            const fFreteKz = fFrete * (fValorCambial || 1);
            const fCustosAdicionaisKz = fCustosAdicionais * (fValorCambial || 1);
            const fDesvioCambial = (fValorCambial && fValorCambialFC) ? fMerc * (fValorCambial - fValorCambialFC) : 0;
            
            // Previsto Despesas (excluding FOB)
            const fDespesasPrevisto = fFreteKz + fCustosAdicionaisKz + fRdf + fServicosDespachante + fIvaServicos;
            
            // Realizado Despesas (excluding FOB - use fallback to previsto if realizado field is zero)
            const fDireitosFCActive = fDireitosFC > 0 ? fDireitosFC : fDireitos;
            const fIvaFCActive = fIvaFC > 0 ? fIvaFC : fIva;
            const fServicosDespachanteFCActive = fServicosDespachanteFC > 0 ? fServicosDespachanteFC : fServicosDespachante;
            const fIvaServicosFCActive = fIvaServicosFC > 0 ? fIvaServicosFC : fIvaServicos;
            const fDespesasRealizado = fFreteKz + fCustosAdicionaisKz + fDireitosFCActive + fIvaFCActive + fServicosDespachanteFCActive + fIvaServicosFCActive;

            const fCustoImportacao = fMercKz + fDespesasPrevisto;
            const activeFobKz = fMercFCKz > 0 ? fMercFCKz : fMercKz;
            const fCustoImportacaoFC = activeFobKz + fDespesasRealizado;

            // Stage evaluation
            const stageIdx = evaluateActiveStage(doc, prog.activeTaskName, prog.isFinished);
            const isFinished = stageIdx === 6 || prog.isFinished;
            const stageName = getStageName(stageIdx);

            // Coeficiente calculation (Landing Factor: 1 + Despesas/FOB)
            let coefVal = 'N/D';
            let numericCoef = 0;
            if (fMercKz <= 0) {
                coefVal = 'Sem valor da mercadoria';
            } else {
                numericCoef = 1 + (fDespesasPrevisto / fMercKz);
                coefVal = numericCoef.toFixed(2) + 'x';
            }

            // Realizado Coeficiente
            let numericCoefFC = 0;
            if (activeFobKz > 0) {
                numericCoefFC = 1 + (fDespesasRealizado / activeFobKz);
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

            const viaTransporte = getDocFieldValue(doc, 'TIPO') || getDocFieldValue(doc, 'VIA') || getDocFieldValue(doc, 'MODAL') || getDocFieldValue(doc, 'MEIO_TRANSPORTE') || getDocFieldValue(doc, 'VIA_TRANSPORTE') || '-';

            return {
                id: doc.Id,
                docNum,
                etapa: stageName,
                stageIdx,
                responsavel: prog.responsible || '-',
                despachante: getDocFieldValue(doc, 'DESPACHANTE') || getDocFieldValue(doc, 'DESPACHADOR') || '-',
                fornecedor: getDocFieldValue(doc, 'FORNECEDOR') || getDocFieldValue(doc, 'EMPRESA') || '-',
                tipoCarga: getDocFieldValue(doc, 'TIPO_DE_CARGA') || getDocFieldValue(doc, 'TIPO_CARGA') || '-',
                viaTransporte,
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
                valMercadoria: fMercKz, 
                valMercadoriaOrig: fMerc,
                valMercadoriaFC: fMercFCKz,
                valMercadoriaFCOrig: fMercFC,
                frete: fFreteKz, 
                freteOrig: fFrete,
                custosAdicionais: fCustosAdicionaisKz, 
                custosAdicionaisOrig: fCustosAdicionais,
                rdf: fRdf,
                iva: fIva,
                direitos: fDireitos,
                servicosDespachante: fServicosDespachante,
                ivaServicos: fIvaServicos,
                direitosFC: fDireitosFC,
                ivaFC: fIvaFC,
                servicosDespachanteFC: fServicosDespachanteFC,
                ivaServicosFC: fIvaServicosFC,
                montanteFC: fMontanteFC,
                valorCambial: fValorCambial,
                valorCambialFC: fValorCambialFC,
                desvioCambial: fDesvioCambial,
                despesasPrevisto: fDespesasPrevisto,
                despesasRealizado: fDespesasRealizado,
                custoImportacao: fCustoImportacao,
                custoImportacaoFC: fCustoImportacaoFC,
                coeficienteText: coefVal,
                coeficienteNumeric: numericCoef,
                coeficienteNumericFC: numericCoefFC,
                diasTotais,
                isParcial,
                diasParado,
                statusFinal: isFinished ? 'Concluído' : 'Em Andamento',
                qualidade
            };
        });
    }, [filteredDocuments, documentProgress]);

    const despachantesList = useMemo(() => {
        const set = new Set();
        documents.forEach(d => {
            const val = getDocFieldValue(d, 'DESPACHANTE') || getDocFieldValue(d, 'DESPACHADOR');
            if (val) set.add(val.trim());
        });
        return Array.from(set).sort();
    }, [documents]);

    const viasList = useMemo(() => {
        const set = new Set();
        documents.forEach(d => {
            const val = getDocFieldValue(d, 'TIPO') || getDocFieldValue(d, 'VIA') || getDocFieldValue(d, 'MODAL') || getDocFieldValue(d, 'MEIO_TRANSPORTE') || getDocFieldValue(d, 'VIA_TRANSPORTE');
            if (val) set.add(val.trim());
        });
        return Array.from(set).sort();
    }, [documents]);

    const tiposCargaList = useMemo(() => {
        const set = new Set();
        documents.forEach(d => {
            const val = getDocFieldValue(d, 'TIPO_DE_CARGA') || getDocFieldValue(d, 'TIPO_CARGA');
            if (val) set.add(val.trim());
        });
        return Array.from(set).sort();
    }, [documents]);

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
        let totalRDF = 0;
        let totalIVA = 0;
        let totalDireitos = 0;
        let totalDespachante = 0;
        let totalIvaServicos = 0;
        let totalValorCambialSum = 0;
        let totalValorCambialCount = 0;

        let totalMercadoriaFC = 0;
        let totalDireitosFC = 0;
        let totalIVAFC = 0;
        let totalDespachanteFC = 0;
        let totalIvaServicosFC = 0;
        let totalValorCambialFCSum = 0;
        let totalValorCambialFCCount = 0;
        
        let totalDesvioCambial = 0;

        const coefsPrevisto = [];
        const coefsRealizado = [];

        detailedProcesses.forEach(p => {
            totalMercadoria += p.valMercadoria;
            totalFrete += p.frete;
            totalCustosAdicionais += p.custosAdicionais;
            totalRDF += p.rdf;
            totalIVA += p.iva;
            totalDireitos += p.direitos;
            totalDespachante += p.servicosDespachante;
            totalIvaServicos += p.ivaServicos;
            if (p.valorCambial > 0) {
                totalValorCambialSum += p.valorCambial;
                totalValorCambialCount++;
            }

            // Realizados (use fallback to previsto if realizado field is zero/unpopulated)
            totalMercadoriaFC += p.valMercadoriaFC > 0 ? p.valMercadoriaFC : p.valMercadoria;
            totalDireitosFC += p.direitosFC > 0 ? p.direitosFC : p.direitos;
            totalIVAFC += p.ivaFC > 0 ? p.ivaFC : p.iva;
            totalDespachanteFC += p.servicosDespachanteFC > 0 ? p.servicosDespachanteFC : p.servicosDespachante;
            totalIvaServicosFC += p.ivaServicosFC > 0 ? p.ivaServicosFC : p.ivaServicos;
            
            const activeVCFC = p.valorCambialFC > 0 ? p.valorCambialFC : p.valorCambial;
            if (activeVCFC > 0) {
                totalValorCambialFCSum += activeVCFC;
                totalValorCambialFCCount++;
            }

            totalDesvioCambial += p.desvioCambial;

            if (p.coeficienteNumeric > 0 && p.coeficienteNumeric < 5.0) {
                coefsPrevisto.push(p.coeficienteNumeric);
            }
            if (p.coeficienteNumericFC > 0 && p.coeficienteNumericFC < 5.0) {
                coefsRealizado.push(p.coeficienteNumericFC);
            } else if (p.coeficienteNumeric > 0 && p.coeficienteNumeric < 5.0) {
                coefsRealizado.push(p.coeficienteNumeric);
            }
        });

        // Averaged Coeficients
        const avgCoefPrevisto = coefsPrevisto.length > 0 ? (coefsPrevisto.reduce((a, b) => a + b, 0) / coefsPrevisto.length) : 0;
        const avgCoefRealizado = coefsRealizado.length > 0 ? (coefsRealizado.reduce((a, b) => a + b, 0) / coefsRealizado.length) : 0;

        // Despesas totals (excluindo valor FOB da mercadoria)
        const totalDespesasPrevisto = totalFrete + totalCustosAdicionais + totalRDF + totalIVA + totalDireitos + totalDespachante + totalIvaServicos;
        const totalDespesasRealizado = totalFrete + totalCustosAdicionais + totalDireitosFC + totalIVAFC + totalDespachanteFC + totalIvaServicosFC;

        // Exchange rate averages
        const avgValorCambial = totalValorCambialCount > 0 ? (totalValorCambialSum / totalValorCambialCount) : 0;
        const avgValorCambialFC = totalValorCambialFCCount > 0 ? (totalValorCambialFCSum / totalValorCambialFCCount) : 0;

        // Blended FOB total for the process status card
        let blendedFobTotal = 0;
        detailedProcesses.forEach(p => {
            if (p.statusFinal === 'Concluído') {
                blendedFobTotal += p.valMercadoriaFC > 0 ? p.valMercadoriaFC : p.valMercadoria;
            } else {
                blendedFobTotal += p.valMercadoria;
            }
        });

        // Coefficient comparison data for Simple Bar Chart
        const coefChartData = [
            { name: 'Previsto (RDF)', Coeficiente: parseFloat(avgCoefPrevisto.toFixed(2)), fill: '#f59e0b' },
            { name: 'Realizado (FC)', Coeficiente: parseFloat(avgCoefRealizado.toFixed(2)), fill: '#4f46e5' }
        ];

        const processCostRanking = [...detailedProcesses]
            .map(p => ({
                id: p.id,
                docNum: p.docNum,
                fornecedor: p.fornecedor,
                despachante: p.despachante,
                montanteFactura: p.valMercadoriaOrig,
                montanteTransporte: p.freteOrig,
                despesasExtras: p.custosAdicionaisOrig,
                valorCambial: p.valorCambial,
                montanteRDF: p.rdf,
                direitoAlfandegarios: p.direitos,
                valorIvaImportacao: p.iva,
                servicosDespachantes: p.servicosDespachante,
                valorIvaServicos: p.ivaServicos,
                valorCambialFC: p.valorCambialFC,
                montanteFC: p.montanteFC,
                dirAlfandegariosFC: p.direitosFC,
                ivaImportacaoFC: p.ivaFC,
                servicosDespachanteFC: p.servicosDespachanteFC,
                ivaServicosFC: p.ivaServicosFC,
                custoTotalSort: p.despesasRealizado > 0 ? p.despesasRealizado : p.despesasPrevisto
            }))
            .sort((a, b) => b.custoTotalSort - a.custoTotalSort);

        return {
            totalMercadoria,
            totalFrete,
            totalCustosAdicionais,
            totalRDF,
            totalIVA,
            totalDireitos,
            totalDespachante,
            totalIvaServicos,
            avgValorCambial,

            totalMercadoriaFC,
            totalDireitosFC,
            totalIVAFC,
            totalDespachanteFC,
            totalIvaServicosFC,
            avgValorCambialFC,

            totalDespesasPrevisto,
            totalDespesasRealizado,
            blendedFobTotal,

            avgCoefPrevisto,
            avgCoefRealizado,
            coefChartData,

            totalDesvioCambial,
            processCostRanking
        };
    }, [detailedProcesses]);

    const waterfallData = useMemo(() => {
        const fob = financialData.totalMercadoria;
        const frete = financialData.totalFrete;
        const rdf = financialData.totalRDF;
        const desp = financialData.totalDespachante;
        const outros = financialData.totalCustosAdicionais;
        const total = financialData.totalImportacao;

        return [
            { name: 'FOB (Base)', border: 0, value: fob, display: fob, color: '#4f46e5', total: fob },
            { name: 'Frete', border: fob, value: frete, display: frete, color: '#10b981', total: fob + frete },
            { name: 'RDF (Impostos)', border: fob + frete, value: rdf, display: rdf, color: '#f59e0b', total: fob + frete + rdf },
            { name: 'Despachante', border: fob + frete + rdf, value: desp, display: desp, color: '#ec4899', total: fob + frete + rdf + desp },
            { name: 'Outros Custos', border: fob + frete + rdf + desp, value: outros, display: outros, color: '#8b5cf6', total: fob + frete + rdf + desp + outros },
            { name: 'Custo Importação', border: 0, value: total, display: total, color: '#312e81', total: total }
        ];
    }, [financialData]);

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
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
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

                            {/* Despachante */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Despachante</label>
                                <select 
                                    className="select select-bordered select-sm bg-white text-slate-700 w-full"
                                    value={selectedDespachante}
                                    onChange={(e) => setSelectedDespachante(e.target.value)}
                                >
                                    <option value="all">Todos os Despachantes</option>
                                    {despachantesList.map(d => (
                                        <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Via (Modal) */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Via (Modal)</label>
                                <select 
                                    className="select select-bordered select-sm bg-white text-slate-700 w-full"
                                    value={selectedViaTransporte}
                                    onChange={(e) => setSelectedViaTransporte(e.target.value)}
                                >
                                    <option value="all">Todas as Vias</option>
                                    {viasList.map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Tipo de Carga */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Tipo de Carga</label>
                                <select 
                                    className="select select-bordered select-sm bg-white text-slate-700 w-full"
                                    value={selectedTipoCarga}
                                    onChange={(e) => setSelectedTipoCarga(e.target.value)}
                                >
                                    <option value="all">Todos os Tipos</option>
                                    {tiposCargaList.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="tabs tabs-boxed bg-slate-100 p-1.5 rounded-xl flex flex-wrap gap-1">
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
                    onClick={() => setActiveTab('performance_logistica')}
                    className={`tab tab-md flex items-center gap-1.5 font-bold ${activeTab === 'performance_logistica' ? 'tab-active bg-[#4f46e5] text-white shadow-sm' : 'text-slate-600'}`}
                >
                    <FaTruck /> Performance Logística
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
                    {/* 2. PERFORMANCE LOGÍSTICA */}
                    {activeTab === 'performance_logistica' && (
                        <div className="space-y-6">
                            {/* Logistics KPI Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-row items-center justify-between relative">
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Prazo Médio da Importação</div>
                                            <button 
                                                onClick={() => setActiveExplanation(activeExplanation === 'prazo_medio_total' ? null : 'prazo_medio_total')}
                                                className="text-slate-300 hover:text-indigo-600 transition-colors mr-2"
                                                title="Ver fórmula e origem"
                                            >
                                                <FaInfoCircle className="text-[10px]" />
                                            </button>
                                        </div>
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
                                    <CardInfoTooltip metricKey="prazo_medio_total" activeKey={activeExplanation} setActiveKey={setActiveExplanation} />
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-row items-center justify-between relative">
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tempo Médio de Grupagem</div>
                                            <button 
                                                onClick={() => setActiveExplanation(activeExplanation === 'tempo_grupagem' ? null : 'tempo_grupagem')}
                                                className="text-slate-300 hover:text-indigo-600 transition-colors mr-2"
                                                title="Ver fórmula e origem"
                                            >
                                                <FaInfoCircle className="text-[10px]" />
                                            </button>
                                        </div>
                                        <div className="text-2xl font-black text-amber-600 mt-1">{logisticsMetrics.avgGrupagem}</div>
                                        <p className="text-[9px] text-slate-400 mt-0.5">Tempo aguardando no lote/grupagem</p>
                                    </div>
                                    <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                                        <FaClock className="text-xl" />
                                    </div>
                                    <CardInfoTooltip metricKey="tempo_grupagem" activeKey={activeExplanation} setActiveKey={setActiveExplanation} />
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-row items-center justify-between relative">
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tempo na Alfândega</div>
                                            <button 
                                                onClick={() => setActiveExplanation(activeExplanation === 'tempo_alfandega' ? null : 'tempo_alfandega')}
                                                className="text-slate-300 hover:text-indigo-600 transition-colors mr-2"
                                                title="Ver fórmula e origem"
                                            >
                                                <FaInfoCircle className="text-[10px]" />
                                            </button>
                                        </div>
                                        <div className="text-2xl font-black text-rose-600 mt-1">{logisticsMetrics.avgAlfandega}</div>
                                        <p className="text-[9px] text-slate-400 mt-0.5">Entrada na Inspeção até Despacho/Entrega</p>
                                    </div>
                                    <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                                        <FaClock className="text-xl" />
                                    </div>
                                    <CardInfoTooltip metricKey="tempo_alfandega" activeKey={activeExplanation} setActiveKey={setActiveExplanation} />
                                </div>
                            </div>

                            {/* Charts & Rankings */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-700 text-sm"><FaTruck className="inline mr-1 text-slate-500" /> Tempo Médio por Trecho (Portugal → Bolloré → Angola → RCS)</h3>
                                        <button 
                                            onClick={() => toggleChartExplanation('tempo_medio_trecho')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver fórmula e origem"
                                        >
                                            <FaInfoCircle className="text-xs" />
                                        </button>
                                    </div>
                                    <ChartInfoAlert 
                                        metricKey="tempo_medio_trecho" 
                                        showInfo={!!visibleChartExplanations['tempo_medio_trecho']} 
                                        setShowInfo={(val) => setVisibleChartExplanations(prev => ({...prev, tempo_medio_trecho: val}))} 
                                    />
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
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-700 text-sm"><FaUserShield className="inline mr-1 text-slate-500" /> Média de Dias por Despachante</h3>
                                        <button 
                                            onClick={() => toggleChartExplanation('dias_medio_despachante')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver fórmula e origem"
                                        >
                                            <FaInfoCircle className="text-xs" />
                                        </button>
                                    </div>
                                    <ChartInfoAlert 
                                        metricKey="dias_medio_despachante" 
                                        showInfo={!!visibleChartExplanations['dias_medio_despachante']} 
                                        setShowInfo={(val) => setVisibleChartExplanations(prev => ({...prev, dias_medio_despachante: val}))} 
                                    />
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
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-700 text-sm">Dias Médios por Tipo de Carga</h3>
                                        <button 
                                            onClick={() => toggleChartExplanation('dias_medio_tipo_carga')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver fórmula e origem"
                                        >
                                            <FaInfoCircle className="text-[11px]" />
                                        </button>
                                    </div>
                                    <ChartInfoAlert 
                                        metricKey="dias_medio_tipo_carga" 
                                        showInfo={!!visibleChartExplanations['dias_medio_tipo_carga']} 
                                        setShowInfo={(val) => setVisibleChartExplanations(prev => ({...prev, dias_medio_tipo_carga: val}))} 
                                    />
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
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-700 text-sm">Dias Médios por Fornecedor</h3>
                                        <button 
                                            onClick={() => toggleChartExplanation('dias_medio_fornecedor')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver fórmula e origem"
                                        >
                                            <FaInfoCircle className="text-[11px]" />
                                        </button>
                                    </div>
                                    <ChartInfoAlert 
                                        metricKey="dias_medio_fornecedor" 
                                        showInfo={!!visibleChartExplanations['dias_medio_fornecedor']} 
                                        setShowInfo={(val) => setVisibleChartExplanations(prev => ({...prev, dias_medio_fornecedor: val}))} 
                                    />
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
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-700 text-sm">Top 10 Processos Mais Demorados</h3>
                                        <button 
                                            onClick={() => toggleChartExplanation('top_10_demorados')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver fórmula e origem"
                                        >
                                            <FaInfoCircle className="text-xs" />
                                        </button>
                                    </div>
                                    <ChartInfoAlert 
                                        metricKey="top_10_demorados" 
                                        showInfo={!!visibleChartExplanations['top_10_demorados']} 
                                        setShowInfo={(val) => setVisibleChartExplanations(prev => ({...prev, top_10_demorados: val}))} 
                                    />
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

                    {activeTab === 'analise_financeira' && (
                        <div className="space-y-6">
                            {/* Financial Cards Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                                {/* Card Principal: Coeficiente de Importação */}
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm col-span-full lg:col-span-3 flex flex-col justify-between relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/40 rounded-full -mr-8 -mt-8 pointer-events-none"></div>
                                    <div className="flex justify-between items-start z-10">
                                        <div>
                                            <span className="text-[10px] font-extrabold text-indigo-500 uppercase tracking-widest">KPI Destaque</span>
                                            <h4 className="text-sm font-bold text-slate-700 mt-0.5">Coeficiente de Importação (Landing Factor)</h4>
                                        </div>
                                        <button 
                                            onClick={() => setActiveExplanation(activeExplanation === 'fator_nacionalizacao' ? null : 'fator_nacionalizacao')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver regra de cálculo"
                                        >
                                            <FaInfoCircle className="text-xs" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 mt-4 z-10">
                                        <div className="border-r border-slate-100 pr-4">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Previsto (RDF)</div>
                                            <div className="text-3xl font-black text-amber-500 mt-1 font-mono">{financialData.avgCoefPrevisto > 0 ? `${financialData.avgCoefPrevisto.toFixed(2)}x` : 'N/D'}</div>
                                        </div>
                                        <div className="pl-4">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Realizado (FC)</div>
                                            <div className="text-3xl font-black text-indigo-600 mt-1 font-mono">{financialData.avgCoefRealizado > 0 ? `${financialData.avgCoefRealizado.toFixed(2)}x` : 'N/D'}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Card 2: Montante Fatura */}
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm col-span-1 flex flex-col justify-between relative">
                                    <div className="flex justify-between items-start">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Montante Fatura</div>
                                        <button 
                                            onClick={() => setActiveExplanation(activeExplanation === 'fob' ? null : 'fob')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver regra de cálculo"
                                        >
                                            <FaInfoCircle className="text-xs" />
                                        </button>
                                    </div>
                                    <div className="text-xl font-black text-slate-800 mt-3 font-mono">
                                        {formatKwanza(financialData.blendedFobTotal)}
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-4 leading-tight">
                                        FOB / Fechamento dependendo do status do processo.
                                    </p>
                                </div>

                                {/* Card 3: Custo Total Despesas */}
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm col-span-1 flex flex-col justify-between relative">
                                    <div className="flex justify-between items-start">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Custo Despesas Total</div>
                                        <button 
                                            onClick={() => setActiveExplanation(activeExplanation === 'custo_despesas_total' ? null : 'custo_despesas_total')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver regra de cálculo"
                                        >
                                            <FaInfoCircle className="text-xs" />
                                        </button>
                                    </div>
                                    <div className="text-xl font-black text-slate-700 mt-3 font-mono">
                                        {formatKwanza(financialData.totalDespesasRealizado > 0 ? financialData.totalDespesasRealizado : financialData.totalDespesasPrevisto)}
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-4 leading-tight">
                                        Soma de todos os impostos, taxas e despachante.
                                    </p>
                                </div>
                            </div>

                            {/* Detailed explanations for KPI cards (using the same style as tables) */}
                            <ChartInfoAlert 
                                metricKey="fator_nacionalizacao" 
                                showInfo={activeExplanation === 'fator_nacionalizacao'} 
                                setShowInfo={(val) => setActiveExplanation(val ? 'fator_nacionalizacao' : null)} 
                            />
                            <ChartInfoAlert 
                                metricKey="fob" 
                                showInfo={activeExplanation === 'fob'} 
                                setShowInfo={(val) => setActiveExplanation(val ? 'fob' : null)} 
                            />
                            <ChartInfoAlert 
                                metricKey="custo_despesas_total" 
                                showInfo={activeExplanation === 'custo_despesas_total'} 
                                setShowInfo={(val) => setActiveExplanation(val ? 'custo_despesas_total' : null)} 
                            />

                            {/* Row 2: simple chart and comparative table */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Simple Bar Chart Comparison */}
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-700 text-sm flex items-center gap-1.5">
                                            <FaChartBar /> Comparação de Coeficientes: Previsto vs Realizado
                                        </h3>
                                    </div>
                                    <div className="h-64 mt-4">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={financialData.coefChartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} domain={[0, 'dataMax + 0.5']} />
                                                <Tooltip formatter={(value) => [`${value}x`, 'Coeficiente']} />
                                                <Bar dataKey="Coeficiente" radius={[6, 6, 0, 0]} barSize={50}>
                                                    {financialData.coefChartData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Revised Tabela Resumo Financeiro */}
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-700 text-sm flex items-center gap-1.5">
                                            <FaDollarSign /> Tabela Resumo Financeiro
                                        </h3>
                                        <button 
                                            onClick={() => toggleChartExplanation('tabela_resumo_financeiro')}
                                            className="text-slate-300 hover:text-indigo-600 transition-colors"
                                            title="Ver fórmula e origem"
                                        >
                                            <FaInfoCircle className="text-xs" />
                                        </button>
                                    </div>
                                    <ChartInfoAlert 
                                        metricKey="tabela_resumo_financeiro" 
                                        showInfo={!!visibleChartExplanations['tabela_resumo_financeiro']} 
                                        setShowInfo={(val) => setVisibleChartExplanations(prev => ({...prev, tabela_resumo_financeiro: val}))} 
                                    />
                                    <div className="overflow-x-auto">
                                        <table className="table table-compact w-full text-xs">
                                            <thead>
                                                <tr>
                                                    <th className="bg-slate-50 text-slate-500 font-bold">Categoria de Custo</th>
                                                    <th className="bg-slate-50 text-slate-500 font-bold text-right">Previsto (RDF)</th>
                                                    <th className="bg-slate-50 text-slate-500 font-bold text-right">Realizado (FC)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Montante Fatura</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalMercadoria)}</td>
                                                    <td className="text-right text-slate-700 font-mono font-bold text-indigo-600">{formatKwanza(financialData.totalMercadoriaFC)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Direitos Aduaneiros e Taxas</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalDireitos)}</td>
                                                    <td className="text-right text-slate-700 font-mono font-bold text-indigo-600">{formatKwanza(financialData.totalDireitosFC)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">IVA Importação</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalIVA)}</td>
                                                    <td className="text-right text-slate-700 font-mono font-bold text-indigo-600">{formatKwanza(financialData.totalIVAFC)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Serviços Despachante</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalDespachante)}</td>
                                                    <td className="text-right text-slate-700 font-mono font-bold text-indigo-600">{formatKwanza(financialData.totalDespachanteFC)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">IVA Serviços</td>
                                                    <td className="text-right text-slate-700 font-mono">{formatKwanza(financialData.totalIvaServicos)}</td>
                                                    <td className="text-right text-slate-700 font-mono font-bold text-indigo-600">{formatKwanza(financialData.totalIvaServicosFC)}</td>
                                                </tr>
                                                <tr className="border-t border-slate-200">
                                                    <td className="font-semibold text-slate-600">Valor Cambial / Ajustes</td>
                                                    <td className="text-right text-slate-500 font-mono">{financialData.avgValorCambial > 0 ? financialData.avgValorCambial.toFixed(2) : '-'}</td>
                                                    <td className="text-right text-slate-500 font-mono font-bold text-indigo-500">{financialData.avgValorCambialFC > 0 ? financialData.avgValorCambialFC.toFixed(2) : '-'}</td>
                                                </tr>
                                                <tr className="border-t border-slate-300 font-black bg-slate-50">
                                                    <td className="text-slate-800">Custo Despesas Total</td>
                                                    <td className="text-right text-amber-600 font-mono">{formatKwanza(financialData.totalDespesasPrevisto)}</td>
                                                    <td className="text-right text-indigo-600 font-mono">{formatKwanza(financialData.totalDespesasRealizado)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* Auditoria de Valores dos Processos (RDF vs FC) */}
                            <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-bold text-slate-700 text-sm">Auditoria de Valores dos Processos (RDF vs FC)</h3>
                                    <button 
                                        onClick={() => toggleChartExplanation('ranking_processos_custo')}
                                        className="text-slate-300 hover:text-indigo-600 transition-colors"
                                        title="Ver fórmula e origem"
                                    >
                                        <FaInfoCircle className="text-xs" />
                                    </button>
                                </div>
                                <ChartInfoAlert 
                                    metricKey="ranking_processos_custo" 
                                    showInfo={!!visibleChartExplanations['ranking_processos_custo']} 
                                    setShowInfo={(val) => setVisibleChartExplanations(prev => ({...prev, ranking_processos_custo: val}))} 
                                />
                                <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
                                    <table className="table table-compact w-full text-xs">
                                        <thead>
                                            <tr>
                                                <th className="bg-slate-50 text-slate-500 font-bold sticky top-0 whitespace-nowrap">Processo</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold sticky top-0 whitespace-nowrap">Despachante</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Montante_Factura</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Montante_transporte</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Despesas_extras</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Valor Cambial</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Montante_RDF</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Direito Alfandegários e Taxas</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Valor IVA_Importação</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Serviços Despachantes</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right sticky top-0 whitespace-nowrap">Valor IVA_Serviços</th>
                                                <th className="bg-blue-50 text-blue-700 font-bold text-right sticky top-0 whitespace-nowrap border-l border-blue-100">Vaor Cambial_FC</th>
                                                <th className="bg-blue-50 text-blue-700 font-bold text-right sticky top-0 whitespace-nowrap">Montante_FC</th>
                                                <th className="bg-slate-50/80 bg-blue-50 text-blue-700 font-bold text-right sticky top-0 whitespace-nowrap">Dir_Alfandegários e Taxas_FC</th>
                                                <th className="bg-blue-50 text-blue-700 font-bold text-right sticky top-0 whitespace-nowrap">IVA_Importação_FC</th>
                                                <th className="bg-blue-50 text-blue-700 font-bold text-right sticky top-0 whitespace-nowrap">Serviços Despachante_FC</th>
                                                <th className="bg-blue-50 text-blue-700 font-bold text-right sticky top-0 whitespace-nowrap border-r border-blue-100">IVA_Serv.Despachante_FC</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center sticky top-0 w-12"><FaFileAlt className="inline-block text-slate-400" /></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {financialData.processCostRanking.map((p, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50/50">
                                                    <td className="font-bold text-slate-700 whitespace-nowrap">{p.docNum}</td>
                                                    <td className="whitespace-nowrap">{p.despachante}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.montanteFactura ? p.montanteFactura.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.montanteTransporte ? p.montanteTransporte.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.despesasExtras ? p.despesasExtras.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.valorCambial ? p.valorCambial.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.montanteRDF ? formatKwanza(p.montanteRDF) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.direitoAlfandegarios ? formatKwanza(p.direitoAlfandegarios) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.valorIvaImportacao ? formatKwanza(p.valorIvaImportacao) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.servicosDespachantes ? formatKwanza(p.servicosDespachantes) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap">{p.valorIvaServicos ? formatKwanza(p.valorIvaServicos) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap bg-blue-50/20 border-l border-blue-100/40 text-blue-900 font-semibold">{p.valorCambialFC ? p.valorCambialFC.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap bg-blue-50/20 text-blue-900 font-semibold">{p.montanteFC ? formatKwanza(p.montanteFC) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap bg-blue-50/20 text-blue-900 font-semibold">{p.dirAlfandegariosFC ? formatKwanza(p.dirAlfandegariosFC) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap bg-blue-50/20 text-blue-900 font-semibold">{p.ivaImportacaoFC ? formatKwanza(p.ivaImportacaoFC) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap bg-blue-50/20 text-blue-900 font-semibold">{p.servicosDespachanteFC ? formatKwanza(p.servicosDespachanteFC) : 'Kz 0,00'}</td>
                                                    <td className="text-right font-mono whitespace-nowrap bg-blue-50/20 border-r border-blue-100/40 text-blue-900 font-semibold">{p.ivaServicosFC ? formatKwanza(p.ivaServicosFC) : 'Kz 0,00'}</td>
                                                    <td className="text-center">
                                                        <button 
                                                            onClick={() => handleOpenDocument(p.id)}
                                                            className="text-indigo-600 hover:text-indigo-800 transition-colors p-1"
                                                            title="Visualizar documento"
                                                        >
                                                            <FaExternalLinkAlt className="text-[10px]" />
                                                        </button>
                                                    </td>
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
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><FaUserShield /> Performance dos Despachantes (Volume, Prazos e Custos)</h3>
                                    <button 
                                        onClick={() => toggleChartExplanation('performance_despachantes_tabela')}
                                        className="text-slate-300 hover:text-indigo-600 transition-colors"
                                        title="Ver fórmula e origem"
                                    >
                                        <FaInfoCircle className="text-xs" />
                                    </button>
                                </div>
                                <ChartInfoAlert 
                                    metricKey="performance_despachantes_tabela" 
                                    showInfo={!!visibleChartExplanations['performance_despachantes_tabela']} 
                                    setShowInfo={(val) => setVisibleChartExplanations(prev => ({...prev, performance_despachantes_tabela: val}))} 
                                />
                                
                                <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
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
