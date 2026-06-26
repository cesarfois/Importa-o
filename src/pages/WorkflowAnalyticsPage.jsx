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
    FaArrowLeft
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
    Area 
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

    return 1; // Stage 1: Abertura do Processo
};

const getStageName = (idx) => {
    switch (idx) {
        case 1: return 'Operador';
        case 2: return 'Certificados';
        case 3: return 'Despachante';
        case 4: return 'Em Trânsito';
        case 5: return 'Alfândega / DAF';
        case 6: return 'Finalizado';
        default: return 'Desconhecido';
    }
};

const isWorkflowStartNode = (node) => {
    if (!node) return false;
    const type = (node.type || '').toLowerCase();
    const name = (node.name || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    return type === 'start' || type.includes('start') || name === 'inicio' || name === 'workflow';
};

const isWorkflowEndNode = (node) => {
    if (!node) return false;
    const type = (node.type || '').toLowerCase();
    const name = (node.name || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    
    if (type.includes('assign') || type.includes('atrib') || 
        name.includes('atribuir') || name.includes('atribuicao') || name.includes('assignment')) {
        return false;
    }
    if (type.includes('end') || type.includes('fim')) return true;
    return name === 'end' || name.startsWith('fim') || name.includes('concluid') || name.includes('termin');
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
    const [selectedCabinet, setSelectedCabinet] = useState('56c20dfc-a25b-4ed7-890a-15de4b3853d7');
    const [activeTab, setActiveTab] = useState('visao_operacional');

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

    // Load WFD Definitions from localStorage or fallback
    const [wfdDefinitions, setWfdDefinitions] = useState({});

    // Fetch documents
    const fetchDocuments = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const docTypeFilter = { FieldName: 'TIPO_DOCUMENTO', Value: 'Registo Processo de Importação' };
            const dateFilter = { 
                FieldName: 'DATA_REGISTO', 
                Value: `${dateRange[0]}..${dateRange[1]}`, 
                IsRange: true 
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
        fetchDocuments();
    }, [dateRange, selectedCabinet]);

    const fetchProgressForDocs = async (docsToFetch) => {
        const batchSize = 12;
        for (let i = 0; i < docsToFetch.length; i += batchSize) {
            const batch = docsToFetch.slice(i, i + batchSize);
            await Promise.all(batch.map(async (doc) => {
                try {
                    const instances = await workflowAnalyticsService.getHistoryByDocId(doc.Id, selectedCabinet);
                    let percent = 0;
                    let activeTaskName = '';
                    let isFinished = false;
                    let isRejected = false;
                    let entryDate = null;
                    let completedAt = null;
                    let responsible = '-';
                    let timeStoppedMs = 0;
                    let merged = null;
                    let analyzedHistory = [];

                    if (instances && instances.length > 0) {
                        const sorted = [...instances].sort((a, b) => (b.Version || 0) - (a.Version || 0));
                        const instance = sorted[0];
                        const rawHistory = instance.HistorySteps || [];
                        analyzedHistory = WorkflowHistoryAnalyzer.analyze(rawHistory);

                        const graph = WorkflowGraphBuilder.build([], []); // fallback
                        merged = WorkflowTimelineEngine.merge(graph, analyzedHistory);

                        const nodes = merged.nodes || [];
                        const isEndNode = (n) => {
                            if (!n) return false;
                            const type = (n.type || '').toLowerCase();
                            return type.includes('end') || type.includes('fim');
                        };
                        const endNode = nodes.find(isEndNode);
                        isFinished = endNode && endNode.status === 'completed';

                        const parseDWDate = (dateStr) => {
                            if (!dateStr) return null;
                            if (typeof dateStr === 'string' && dateStr.startsWith('/Date(')) {
                                const match = dateStr.match(/-?\d+/);
                                if (match) return new Date(parseInt(match[0]));
                            }
                            return new Date(dateStr);
                        };

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

                    setDocumentProgress(prev => ({
                        ...prev,
                        [doc.Id]: {
                            percent,
                            activeTaskName,
                            isFinished,
                            isRejected,
                            loading: false,
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
                if (selectedEstado === 'concluido' && !prog.isFinished) return false;
                if (selectedEstado === 'ativo' && (prog.isFinished || prog.isRejected)) return false;
                if (selectedEstado === 'atraso' && (prog.isFinished || (prog.timeStoppedMs || 0) < 86400000)) return false;
            }

            return true;
        });
    }, [documents, documentProgress, selectedDespachante, selectedFornecedor, selectedTipoCarga, selectedTransportador, selectedEstado, selectedResponsavel]);

    // --- Calculated Metrics & KPI Stats ---
    const stats = useMemo(() => {
        let total = filteredDocuments.length;
        let active = 0;
        let completed = 0;
        let delayed = 0;
        let totalCycleTimeMs = 0;
        let completedCount = 0;
        let totalTimeStoppedMs = 0;
        let activeWithStopCount = 0;

        filteredDocuments.forEach(doc => {
            const prog = documentProgress[doc.Id] || {};
            if (prog.isFinished) {
                completed++;
                if (prog.entryDate && prog.completedAt) {
                    const diff = new Date(prog.completedAt).getTime() - new Date(prog.entryDate).getTime();
                    if (diff > 0) {
                        totalCycleTimeMs += diff;
                        completedCount++;
                    }
                }
            } else {
                active++;
                if ((prog.timeStoppedMs || 0) > 86400000) {
                    delayed++;
                }
                if (prog.timeStoppedMs) {
                    totalTimeStoppedMs += prog.timeStoppedMs;
                    activeWithStopCount++;
                }
            }
        });

        return {
            total,
            active,
            completed,
            delayed,
            avgCycleTimeText: completedCount > 0 
                ? WorkflowHistoryAnalyzer.formatDuration(totalCycleTimeMs / completedCount) 
                : '-',
            avgTimeStoppedText: activeWithStopCount > 0 
                ? WorkflowHistoryAnalyzer.formatDuration(totalTimeStoppedMs / activeWithStopCount) 
                : '-'
        };
    }, [filteredDocuments, documentProgress]);

    // --- 1. Visão Operacional Chart Data ---
    const stageDistributionData = useMemo(() => {
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        filteredDocuments.forEach(doc => {
            const prog = documentProgress[doc.Id] || {};
            const stage = evaluateActiveStage(doc, prog.activeTaskName, prog.isFinished);
            counts[stage] = (counts[stage] || 0) + 1;
        });

        return Object.keys(counts).map(k => ({
            name: getStageName(parseInt(k)),
            Processos: counts[k]
        }));
    }, [filteredDocuments, documentProgress]);

    const avgTimePerStageData = useMemo(() => {
        // Average cycle times calculated from historical logs
        const stagesTime = { 1: 0, 3: 0, 4: 0, 5: 0 };
        const stagesCount = { 1: 0, 3: 0, 4: 0, 5: 0 };

        filteredDocuments.forEach(doc => {
            const prog = documentProgress[doc.Id] || {};
            const history = prog.analyzedHistory || [];
            history.forEach(step => {
                if (step.completedAt && step.startedAt) {
                    const duration = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
                    const stage = evaluateActiveStage(doc, step.name, false);
                    if (stagesTime[stage] !== undefined && duration > 0) {
                        stagesTime[stage] += duration;
                        stagesCount[stage]++;
                    }
                }
            });
        });

        return Object.keys(stagesTime).map(k => {
            const avgHours = stagesCount[k] > 0 
                ? Math.round((stagesTime[k] / stagesCount[k]) / (3600 * 1000))
                : 0;
            return {
                name: getStageName(parseInt(k)),
                'Horas Médias': avgHours
            };
        });
    }, [filteredDocuments, documentProgress]);

    const timeSeriesData = useMemo(() => {
        const months = {};
        filteredDocuments.forEach(doc => {
            const regDateStr = getDocFieldValue(doc, 'DATA_REGISTO') || getDocFieldValue(doc, 'DATA_INICIO');
            if (regDateStr) {
                const date = new Date(regDateStr);
                if (!isNaN(date.getTime())) {
                    const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    months[label] = (months[label] || 0) + 1;
                }
            }
        });

        return Object.keys(months).sort().map(m => ({
            periodo: m,
            Processos: months[m]
        }));
    }, [filteredDocuments]);

    // --- 2. Performance Logística Metrics ---
    const logisticsMetrics = useMemo(() => {
        let totalCycleTimeMs = 0;
        let totalCycleCount = 0;

        let totalGrupagemTimeMs = 0;
        let totalGrupagemCount = 0;

        let totalAlfandegaTimeMs = 0;
        let totalAlfandegaCount = 0;

        let transitPTBollore = 0, countPTB = 0;
        let transitBolloreAO = 0, countBAO = 0;
        let transitAORCS = 0, countAR = 0;

        filteredDocuments.forEach(doc => {
            const parseDate = (f) => {
                const val = getDocFieldValue(doc, f);
                return val ? new Date(val) : null;
            };

            const dtBollore = parseDate('DATA_ENTRADA_BOLLORE') || parseDate('BOLLORE');
            const dtRCS = parseDate('DATA_ENTREGUE') || parseDate('DATA_ENTREGUE_RCS');
            const dtExpedicao = parseDate('DATA_EXPEDICAO') || parseDate('DATA_ENVIO');
            const dtChegadaAO = parseDate('DATA_CHEGADA_ANGOLA') || parseDate('DATA_CHEGADA');
            const dtDesembaraco = parseDate('DATA_DESEMBARACO') || parseDate('LIBERACAO');
            const dtPortugal = parseDate('DATA_SAIDA_PORTUGAL') || parseDate('DATA_PORTUGAL');

            // KPI 1: Cycle time (Bollore to RCS)
            if (dtBollore && dtRCS && dtRCS > dtBollore) {
                totalCycleTimeMs += (dtRCS - dtBollore);
                totalCycleCount++;
            }

            // KPI 2: Grupagem (Bollore to Expedicao)
            if (dtBollore && dtExpedicao && dtExpedicao > dtBollore) {
                totalGrupagemTimeMs += (dtExpedicao - dtBollore);
                totalGrupagemCount++;
            }

            // KPI 3: Alfandega (Chegada AO to Desembaraco/RCS)
            const dtEndAlfandega = dtDesembaraco || dtRCS;
            if (dtChegadaAO && dtEndAlfandega && dtEndAlfandega > dtChegadaAO) {
                totalAlfandegaTimeMs += (dtEndAlfandega - dtChegadaAO);
                totalAlfandegaCount++;
            }

            // KPI 4: Segmented transit
            if (dtPortugal && dtBollore && dtBollore > dtPortugal) {
                transitPTBollore += (dtBollore - dtPortugal);
                countPTB++;
            }
            if (dtBollore && dtChegadaAO && dtChegadaAO > dtBollore) {
                transitBolloreAO += (dtChegadaAO - dtBollore);
                countBAO++;
            }
            if (dtChegadaAO && dtRCS && dtRCS > dtChegadaAO) {
                transitAORCS += (dtRCS - dtChegadaAO);
                countAR++;
            }
        });

        const toDays = (ms) => ms > 0 ? Math.round(ms / (24 * 3600 * 1000)) : 0;

        return {
            avgLogisticsCycle: totalCycleCount > 0 ? toDays(totalCycleTimeMs / totalCycleCount) : '-',
            avgGrupagem: totalGrupagemCount > 0 ? toDays(totalGrupagemTimeMs / totalGrupagemCount) : '-',
            avgAlfandega: totalAlfandegaCount > 0 ? toDays(totalAlfandegaTimeMs / totalAlfandegaCount) : '-',
            transitPTBollore: countPTB > 0 ? toDays(transitPTBollore / countPTB) : '-',
            transitBolloreAO: countBAO > 0 ? toDays(transitBolloreAO / countBAO) : '-',
            transitAORCS: countAR > 0 ? toDays(transitAORCS / countAR) : '-'
        };
    }, [filteredDocuments]);

    // --- 3. Análise Financeira Stats ---
    const financialData = useMemo(() => {
        let totalMercadoria = 0;
        let totalFrete = 0;
        let totalDespachante = 0;
        let totalDireitos = 0;
        let totalIVA = 0;
        let totalRDF = 0;

        const coeficients = [];

        filteredDocuments.forEach(doc => {
            const fMerc = parseCurrency(getDocFieldValue(doc, 'VALOR_FOB') || getDocFieldValue(doc, 'FOB') || getDocFieldValue(doc, 'VALOR_MERCADORIA'));
            const fFrete = parseCurrency(getDocFieldValue(doc, 'VALOR_FRETE') || getDocFieldValue(doc, 'FRETE'));
            const fDesp = parseCurrency(getDocFieldValue(doc, 'SERVICOS_DESPACHANTES') || getDocFieldValue(doc, 'SERVICO_DESPACHANTE'));
            const fDir = parseCurrency(getDocFieldValue(doc, 'DIREITOS_ALFANDEGARIOS') || getDocFieldValue(doc, 'DIREITO_ALFANDEGARIOS'));
            const fIva = parseCurrency(getDocFieldValue(doc, 'VALOR_IVA_IMPORTACAO') || getDocFieldValue(doc, 'IVA_IMPORTACAO'));
            const fRdf = parseCurrency(getDocFieldValue(doc, 'MONTANTE_RDF'));

            totalMercadoria += fMerc;
            totalFrete += fFrete;
            totalDespachante += fDesp;
            totalDireitos += fDir;
            totalIVA += fIva;
            totalRDF += fRdf;

            const despesasTotais = fFrete + fDesp + fDir + fIva + fRdf;
            if (fMerc > 0) {
                const coef = despesasTotais / fMerc;
                coeficients.push(coef);
            }
        });

        const totalCustos = totalFrete + totalDespachante + totalDireitos + totalIVA + totalRDF;
        const totalImportacao = totalMercadoria + totalCustos;

        const avgCoef = coeficients.length > 0 ? (coeficients.reduce((a, b) => a + b, 0) / coeficients.length) : 0;
        const minCoef = coeficients.length > 0 ? Math.min(...coeficients) : 0;
        const maxCoef = coeficients.length > 0 ? Math.max(...coeficients) : 0;

        const costComposition = [
            { name: 'Frete', value: totalFrete },
            { name: 'Despachante', value: totalDespachante },
            { name: 'Direitos', value: totalDireitos },
            { name: 'IVA', value: totalIVA },
            { name: 'RDF', value: totalRDF }
        ].filter(item => item.value > 0);

        return {
            totalMercadoria,
            totalFrete,
            totalDespachante,
            totalDireitos,
            totalIVA,
            totalRDF,
            totalCustos,
            totalImportacao,
            avgCoef: avgCoef.toFixed(2),
            minCoef: minCoef.toFixed(2),
            maxCoef: maxCoef.toFixed(2),
            costComposition
        };
    }, [filteredDocuments]);

    // --- 4. Performance dos Despachantes Metrics ---
    const despachantesPerformance = useMemo(() => {
        const perf = {};

        filteredDocuments.forEach(doc => {
            const desp = getDocFieldValue(doc, 'DESPACHANTE') || getDocFieldValue(doc, 'DESPACHADOR') || 'Não Definido';
            const prog = documentProgress[doc.Id] || {};

            const fMerc = parseCurrency(getDocFieldValue(doc, 'VALOR_FOB') || getDocFieldValue(doc, 'FOB') || getDocFieldValue(doc, 'VALOR_MERCADORIA'));
            const fFrete = parseCurrency(getDocFieldValue(doc, 'VALOR_FRETE') || getDocFieldValue(doc, 'FRETE'));
            const fDesp = parseCurrency(getDocFieldValue(doc, 'SERVICOS_DESPACHANTES') || getDocFieldValue(doc, 'SERVICO_DESPACHANTE'));
            const fDir = parseCurrency(getDocFieldValue(doc, 'DIREITOS_ALFANDEGARIOS') || getDocFieldValue(doc, 'DIREITO_ALFANDEGARIOS'));
            const fIva = parseCurrency(getDocFieldValue(doc, 'VALOR_IVA_IMPORTACAO') || getDocFieldValue(doc, 'IVA_IMPORTACAO'));
            const fRdf = parseCurrency(getDocFieldValue(doc, 'MONTANTE_RDF'));
            const despesasTotais = fFrete + fDesp + fDir + fIva + fRdf;

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
                    totalExpenses: 0
                };
            }

            const p = perf[desp];
            p.count++;
            p.totalValue += (fMerc + despesasTotais);
            p.totalMerc += fMerc;
            p.totalExpenses += despesasTotais;

            if (prog.isFinished) {
                p.completed++;
            }

            // Clearing time (Chegada Angola -> Desembaraço)
            const dtChegada = getDocFieldValue(doc, 'DATA_CHEGADA_ANGOLA') || getDocFieldValue(doc, 'DATA_CHEGADA');
            const dtDesemb = getDocFieldValue(doc, 'DATA_DESEMBARACO') || getDocFieldValue(doc, 'LIBERACAO');
            if (dtChegada && dtDesemb) {
                const diff = new Date(dtDesemb) - new Date(dtChegada);
                if (diff > 0) {
                    p.totalClearingTimeMs += diff;
                    p.clearingCount++;
                }
            }

            // Delivery time (Desembaraço -> RCS)
            const dtRCS = getDocFieldValue(doc, 'DATA_ENTREGUE') || getDocFieldValue(doc, 'DATA_ENTREGUE_RCS');
            if (dtDesemb && dtRCS) {
                const diff = new Date(dtRCS) - new Date(dtDesemb);
                if (diff > 0) {
                    p.totalDeliveryTimeMs += diff;
                    p.deliveryCount++;
                }
            }
        });

        return Object.values(perf).map(p => {
            const avgClearingDays = p.clearingCount > 0 ? Math.round(p.totalClearingTimeMs / p.clearingCount / (24 * 3600 * 1000)) : '-';
            const avgDeliveryDays = p.deliveryCount > 0 ? Math.round(p.totalDeliveryTimeMs / p.deliveryCount / (24 * 3600 * 1000)) : '-';
            const avgCoef = p.totalMerc > 0 ? (p.totalExpenses / p.totalMerc) : 0;
            return {
                ...p,
                avgClearingDays,
                avgDeliveryDays,
                avgCoefText: avgCoef.toFixed(2),
                score: p.count // Simple sorting score
            };
        }).sort((a, b) => b.score - a.score);
    }, [filteredDocuments, documentProgress]);

    // --- 5. Alertas e Riscos ---
    const alertProcesses = useMemo(() => {
        const alerts = [];

        filteredDocuments.forEach(doc => {
            const prog = documentProgress[doc.Id] || {};
            if (prog.isFinished) return;

            const docNum = getDocumentNumber(doc);
            const timeStoppedDays = prog.timeStoppedMs ? Math.round(prog.timeStoppedMs / (24 * 3600 * 1000)) : 0;
            
            // Check certificates
            const certificates = ['INACOM', 'INIQ', 'IANORQ', 'MINDICOM', 'MINAMB', 'CNCA', 'MINCO'];
            let waitingCert = null;
            for (const cert of certificates) {
                const ped = findFieldVal(doc, [`PEDIDO_${cert}`]);
                const rec = findFieldVal(doc, [`RECEBIMENTO_${cert}`]);
                if (ped && !rec) {
                    waitingCert = cert;
                    break;
                }
            }

            // Check payments
            const waitingPayment = !getDocFieldValue(doc, 'DATA_PAGAMENTO_RDF') && !!getDocFieldValue(doc, 'MONTANTE_RDF');
            const waitingDispatch = !getDocFieldValue(doc, 'DATA_DESPACHO') && (prog.percent === 50);

            let reason = '';
            let severity = 'info';

            if (timeStoppedDays > 15) {
                reason = `Sem movimentação há ${timeStoppedDays} dias`;
                severity = 'critical';
            } else if (waitingCert) {
                reason = `Aguardando Certificado ${waitingCert}`;
                severity = 'warning';
            } else if (waitingPayment) {
                reason = 'Aguardando Pagamento da RDF';
                severity = 'warning';
            } else if (waitingDispatch) {
                reason = 'Aguardando Despacho';
                severity = 'info';
            } else if (prog.percent === 83) {
                reason = 'Aguardando Desembaraço aduaneiro';
                severity = 'info';
            } else {
                return; // Not critical
            }

            alerts.push({
                id: doc.Id,
                docNum,
                stage: getStageName(Math.round((prog.percent || 0) / 16.6) || 1),
                responsible: prog.responsible || '-',
                timeStoppedDays,
                reason,
                severity
            });
        });

        return alerts.sort((a, b) => b.timeStoppedDays - a.timeStoppedDays);
    }, [filteredDocuments, documentProgress]);

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
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
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
                                    <option value="all">Todos</option>
                                    {filterOptions.despachantes.map(d => (
                                        <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Fornecedor */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Fornecedor</label>
                                <select 
                                    className="select select-bordered select-sm bg-white text-slate-700 w-full"
                                    value={selectedFornecedor}
                                    onChange={(e) => setSelectedFornecedor(e.target.value)}
                                >
                                    <option value="all">Todos</option>
                                    {filterOptions.fornecedores.map(f => (
                                        <option key={f} value={f}>{f}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Tipo Carga */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Tipo de Carga</label>
                                <select 
                                    className="select select-bordered select-sm bg-white text-slate-700 w-full"
                                    value={selectedTipoCarga}
                                    onChange={(e) => setSelectedTipoCarga(e.target.value)}
                                >
                                    <option value="all">Todos</option>
                                    {filterOptions.tiposCarga.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Estado */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Estado</label>
                                <select 
                                    className="select select-bordered select-sm bg-white text-slate-700 w-full"
                                    value={selectedEstado}
                                    onChange={(e) => setSelectedEstado(e.target.value)}
                                >
                                    <option value="all">Todos</option>
                                    <option value="ativo">Em Andamento</option>
                                    <option value="concluido">Concluído</option>
                                    <option value="atraso">Em Atraso (&gt;24h)</option>
                                </select>
                            </div>

                            {/* Responsável */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Responsável</label>
                                <select 
                                    className="select select-bordered select-sm bg-white text-slate-700 w-full"
                                    value={selectedResponsavel}
                                    onChange={(e) => setSelectedResponsavel(e.target.value)}
                                >
                                    <option value="all">Todos</option>
                                    {filterOptions.responsaveis.map(r => (
                                        <option key={r} value={r}>{r}</option>
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
                    onClick={() => setActiveTab('alertas_riscos')}
                    className={`tab tab-md flex items-center gap-1.5 font-bold ${activeTab === 'alertas_riscos' ? 'tab-active bg-[#4f46e5] text-white shadow-sm' : 'text-slate-600'}`}
                >
                    <FaExclamationTriangle /> Alertas e Riscos
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
                            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Processos</div>
                                    <div className="text-3xl font-black text-slate-800 mt-1">{stats.total}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Em Andamento</div>
                                    <div className="text-3xl font-black text-amber-600 mt-1">{stats.active}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Concluídos</div>
                                    <div className="text-3xl font-black text-emerald-600 mt-1">{stats.completed}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Prazo Médio de Importação</div>
                                    <div className="text-2xl font-black text-indigo-600 mt-1">{stats.avgCycleTimeText}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tempo Parado Etapa Atual</div>
                                    <div className="text-2xl font-black text-rose-600 mt-1">{stats.avgTimeStoppedText}</div>
                                </div>
                            </div>

                            {/* Charts Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
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

                                <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaClock /> Tempo médio por etapa (em horas)</h3>
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={avgTimePerStageData} margin={{ top: 20, right: 30, left: -10, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                                                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
                                                <Bar dataKey="Horas Médias" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={36} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm lg:col-span-2">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaChartLine /> Linha temporal - Evolução das importações</h3>
                                    <div className="h-72">
                                        {timeSeriesData.length === 0 ? (
                                            <div className="flex items-center justify-center h-full text-slate-400 italic text-xs">Nenhum dado temporal disponível.</div>
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
                                <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-row items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Prazo Médio da Importação</div>
                                        <div className="text-3xl font-black text-indigo-600 mt-1">{logisticsMetrics.avgLogisticsCycle} <span className="text-sm font-medium text-slate-500">dias</span></div>
                                        <p className="text-[10px] text-slate-400 mt-1">Desde entrada na Bolloré até entrega na RCS</p>
                                    </div>
                                    <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl">
                                        <FaClock className="text-2xl" />
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-row items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tempo Médio de Grupagem</div>
                                        <div className="text-3xl font-black text-amber-600 mt-1">{logisticsMetrics.avgGrupagem} <span className="text-sm font-medium text-slate-500">dias</span></div>
                                        <p className="text-[10px] text-slate-400 mt-1">Tempo aguardando em Bolloré</p>
                                    </div>
                                    <div className="p-4 bg-amber-50 text-amber-600 rounded-2xl">
                                        <FaClock className="text-2xl" />
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-row items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tempo na Alfândega</div>
                                        <div className="text-3xl font-black text-rose-600 mt-1">{logisticsMetrics.avgAlfandega} <span className="text-sm font-medium text-slate-500">dias</span></div>
                                        <p className="text-[10px] text-slate-400 mt-1">Desde chegada em Angola até liberação</p>
                                    </div>
                                    <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl">
                                        <FaClock className="text-2xl" />
                                    </div>
                                </div>
                            </div>

                            {/* Segmented Transit Pipeline */}
                            <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                                <h3 className="font-bold text-slate-700 mb-6 text-sm flex items-center gap-1.5"><FaTruck /> Distribuição do Tempo de Transporte (Segmentado)</h3>
                                
                                <div className="flex flex-col lg:flex-row items-center justify-center gap-8 py-8">
                                    <div className="flex flex-col items-center p-4 bg-slate-50 border border-slate-200 rounded-2xl w-full lg:w-64 text-center">
                                        <span className="text-xs font-bold text-slate-500 uppercase">Portugal → Bolloré</span>
                                        <span className="text-2xl font-black text-indigo-600 mt-2">{logisticsMetrics.transitPTBollore} <span className="text-sm font-semibold">dias</span></span>
                                    </div>

                                    <div className="text-slate-300 text-3xl hidden lg:block">→</div>

                                    <div className="flex flex-col items-center p-4 bg-slate-50 border border-slate-200 rounded-2xl w-full lg:w-64 text-center">
                                        <span className="text-xs font-bold text-slate-500 uppercase">Bolloré → Angola</span>
                                        <span className="text-2xl font-black text-indigo-600 mt-2">{logisticsMetrics.transitBolloreAO} <span className="text-sm font-semibold">dias</span></span>
                                    </div>

                                    <div className="text-slate-300 text-3xl hidden lg:block">→</div>

                                    <div className="flex flex-col items-center p-4 bg-slate-50 border border-slate-200 rounded-2xl w-full lg:w-64 text-center">
                                        <span className="text-xs font-bold text-slate-500 uppercase">Angola → RCS</span>
                                        <span className="text-2xl font-black text-indigo-600 mt-2">{logisticsMetrics.transitAORCS} <span className="text-sm font-semibold">dias</span></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 3. ANÁLISE FINANCEIRA */}
                    {activeTab === 'analise_financeira' && (
                        <div className="space-y-6">
                            {/* Financial Cards Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor Mercadoria (FOB)</div>
                                    <div className="text-2xl font-black text-slate-800 mt-1 font-mono">
                                        {new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalMercadoria)}
                                    </div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Custos Adicionais</div>
                                    <div className="text-2xl font-black text-indigo-600 mt-1 font-mono">
                                        {new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalCustos)}
                                    </div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm col-span-1 lg:col-span-2">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Custo Total de Importações</div>
                                    <div className="text-2xl font-black text-[#4f46e5] mt-1 font-mono">
                                        {new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalImportacao)}
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Coeficiente Médio</div>
                                    <div className="text-3xl font-black text-emerald-600 mt-1 font-mono">{financialData.avgCoef}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Coeficiente Mínimo</div>
                                    <div className="text-3xl font-black text-slate-800 mt-1 font-mono">{financialData.minCoef}</div>
                                </div>
                                <div className="card bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Coeficiente Máximo</div>
                                    <div className="text-3xl font-black text-rose-600 mt-1 font-mono">{financialData.maxCoef}</div>
                                </div>
                            </div>

                            {/* Cost Composition Chart */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                                    <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaChartPie /> Composição dos custos da importação</h3>
                                    <div className="h-72 flex items-center justify-center">
                                        {financialData.costComposition.length === 0 ? (
                                            <div className="text-slate-400 italic text-xs">Nenhum custo registrado para os filtros selecionados.</div>
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
                                                    <Tooltip formatter={(value) => new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(value)} />
                                                    <Legend />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
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
                                                    <td className="text-right text-slate-700 font-mono">{new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalFrete)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Serviços Despachante</td>
                                                    <td className="text-right text-slate-700 font-mono">{new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalDespachante)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">Direitos Aduaneiros</td>
                                                    <td className="text-right text-slate-700 font-mono">{new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalDireitos)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">IVA</td>
                                                    <td className="text-right text-slate-700 font-mono">{new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalIVA)}</td>
                                                </tr>
                                                <tr>
                                                    <td className="font-semibold text-slate-600">RDF</td>
                                                    <td className="text-right text-slate-700 font-mono">{new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalRDF)}</td>
                                                </tr>
                                                <tr className="border-t border-slate-300 font-black bg-slate-50">
                                                    <td className="text-slate-800">Custo Total Adicional</td>
                                                    <td className="text-right text-indigo-600 font-mono">{new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(financialData.totalCustos)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 4. PERFORMANCE DOS DESPACHANTES */}
                    {activeTab === 'performance_despachantes' && (
                        <div className="space-y-6">
                            <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                                <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaUserShield /> Performance dos Despachantes</h3>
                                
                                <div className="overflow-x-auto">
                                    <table className="table w-full text-xs">
                                        <thead>
                                            <tr>
                                                <th className="bg-slate-50 text-slate-500 font-bold">Despachante</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center">Processos</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center">Concluídos</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center">Tempo Médio Desembaraço</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center">Tempo Médio Entrega</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-right">Valor Movimentado</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center">Coeficiente Médio</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {despachantesPerformance.map((p, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50/50">
                                                    <td className="font-semibold text-slate-700">{p.name}</td>
                                                    <td className="text-center font-mono font-bold">{p.count}</td>
                                                    <td className="text-center font-mono">{p.completed}</td>
                                                    <td className="text-center font-mono font-bold text-indigo-600">{p.avgClearingDays} <span className="text-[10px] text-slate-400">dias</span></td>
                                                    <td className="text-center font-mono">{p.avgDeliveryDays} <span className="text-[10px] text-slate-400">dias</span></td>
                                                    <td className="text-right font-mono">{new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' }).format(p.totalValue)}</td>
                                                    <td className="text-center font-mono font-bold text-emerald-600">{p.avgCoefText}</td>
                                                </tr>
                                            ))}
                                            {despachantesPerformance.length === 0 && (
                                                <tr>
                                                    <td colSpan={7} className="text-center py-8 text-slate-400 italic">Nenhum despachante registrado.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 5. ALERTAS E RISCOS */}
                    {activeTab === 'alertas_riscos' && (
                        <div className="space-y-6">
                            <div className="card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                                <h3 className="font-bold text-slate-700 mb-4 text-sm flex items-center gap-1.5"><FaExclamationTriangle className="text-amber-500" /> Alertas Críticos e Processos sem Movimentação</h3>
                                
                                <div className="overflow-x-auto">
                                    <table className="table w-full text-xs">
                                        <thead>
                                            <tr>
                                                <th className="bg-slate-50 text-slate-500 font-bold">Processo</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold">Etapa Atual</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold">Responsável</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center">Dias Parado</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold">Motivo do Alerta</th>
                                                <th className="bg-slate-50 text-slate-500 font-bold text-center">Criticidade</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {alertProcesses.map((alert, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50/50">
                                                    <td className="font-bold text-slate-700">{alert.docNum}</td>
                                                    <td className="font-semibold text-slate-600">{alert.stage}</td>
                                                    <td className="text-slate-600">{alert.responsible}</td>
                                                    <td className="text-center font-mono font-bold text-slate-700">{alert.timeStoppedDays}</td>
                                                    <td className="font-medium text-slate-700">{alert.reason}</td>
                                                    <td className="text-center">
                                                        <span className={`badge badge-sm font-bold border-none ${
                                                            alert.severity === 'critical' ? 'bg-red-100 text-red-700 animate-pulse' :
                                                            alert.severity === 'warning' ? 'bg-amber-100 text-amber-700' :
                                                            'bg-blue-100 text-blue-700'
                                                        }`}>
                                                            {alert.severity === 'critical' ? 'Crítico' :
                                                             alert.severity === 'warning' ? 'Aviso' :
                                                             'Informação'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {alertProcesses.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="text-center py-8 text-emerald-600 font-bold">✓ Nenhum alerta ou risco identificado atualmente!</td>
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
