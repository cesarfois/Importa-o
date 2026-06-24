import { WorkflowHistoryAnalyzer } from './WorkflowHistoryAnalyzer';

/**
 * WorkflowTimelineEngine
 * Merges static workflow definition (activities & connections)
 * with the dynamic execution history.
 */
export const WorkflowTimelineEngine = {
    /**
     * Merges static graph and chronological execution history
     * @param {Object} graph - { nodes: Array, edges: Array }
     * @param {Array} historySteps - Normalized history steps from WorkflowHistoryAnalyzer
     * @returns {Object} Graph with statuses and execution metrics
     */
    merge: (graph, historySteps) => {
        const renameWorkflowTask = (name) => {
            if (!name) return '';
            const trimmed = name.trim();
            if (trimmed === 'EP_Operador Importação' || trimmed === 'EP Operador Importação') {
                return 'Operador Importação';
            }
            if (trimmed === '26 Importação Despachantes') {
                return 'Despachante / Processo Aduaneiro';
            }
            if (trimmed === 'DAF_Contas a Pagar_2') {
                return 'DAF - Custos e Pagamentos';
            }
            return trimmed;
        };

        // Initialize node details
        const nodes = graph.nodes.map(n => ({
            ...n,
            name: renameWorkflowTask(n.name),
            status: 'pending', // 'pending' | 'completed' | 'active' | 'skipped'
            executions: [],
            activeUsers: [],
            totalDurationMs: 0,
            totalDurationText: ''
        }));

        // Initialize edge details
        const edges = graph.edges.map(e => ({
            ...e,
            status: 'pending', // 'pending' | 'taken' | 'active' | 'skipped'
            count: 0
        }));

        const nodesMap = new Map(nodes.map(n => [n.id, n]));
        
        // Helper to normalize strings for robust comparison
        const normalizeStr = (str) => {
            if (!str) return '';
            return str
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "") // Remove accents
                .replace(/[^a-z0-9]/g, '') // Keep letters/numbers only
                .trim();
        };

        // Cache normalized names for rapid matching
        const nodesByName = new Map();
        nodes.forEach(n => {
            const key = normalizeStr(n.name);
            if (!nodesByName.has(key)) {
                nodesByName.set(key, []);
            }
            nodesByName.get(key).push(n);
        });

        const isEndNode = (type, name) => {
            const t = (type || '').toLowerCase();
            const n = (name || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            if (t.includes('end') || t.includes('fim')) return true;
            return n === 'end' || 
                   n.startsWith('end ') || 
                   n.endsWith(' end') || 
                   n.includes(' end ') ||
                   n.startsWith('fim') ||
                   n.includes(' fim') ||
                   n.includes('concluid') || 
                   n.includes('termin') || 
                   n.includes('conclusao') ||
                   n.includes('cancelad') ||
                   n.includes('reprovad');
        };

        // Match a step in the history to a node in the definition
        const findNodeForStep = (step) => {
            const stepNameNorm = normalizeStr(renameWorkflowTask(step.name));
            
            // Try exact name match
            const matches = nodesByName.get(stepNameNorm);
            if (matches && matches.length > 0) {
                return matches[0];
            }

            // Standard event name matching
            if (step.type === 'Start' || step.type === 'StartEvent' || stepNameNorm === 'start' || stepNameNorm === 'inicio' || stepNameNorm.includes('inicio') || stepNameNorm.includes('start')) {
                const startNode = nodes.find(n => {
                    const type = (n.type || '').toLowerCase();
                    const name = (n.name || '').toLowerCase();
                    return type.includes('start') || name.includes('start') || name.includes('inicio') || name.includes('início');
                });
                if (startNode) return startNode;
            }

            const isStepEnd = step.type === 'End' || step.type === 'EndEvent' || isEndNode(step.type, step.name);
            if (isStepEnd) {
                const endNode = nodes.find(n => isEndNode(n.type, n.name));
                if (endNode) return endNode;
            }

            // Fuzzy matches
            const fuzzy = nodes.find(n => {
                const nNameNorm = normalizeStr(n.name);
                return nNameNorm.includes(stepNameNorm) || stepNameNorm.includes(nNameNorm);
            });
            
            return fuzzy || null;
        };

        // BFS pathfinder to bridge intermediate skipped steps (like web services or automation)
        const findPath = (sourceId, targetId) => {
            const queue = [[sourceId, []]];
            const visited = new Set([sourceId]);

            while (queue.length > 0) {
                const [currentId, path] = queue.shift();

                if (currentId === targetId) {
                    return path;
                }

                const outgoingEdges = edges.filter(e => e.source === currentId);
                for (const edge of outgoingEdges) {
                    if (!visited.has(edge.target)) {
                        visited.add(edge.target);
                        queue.push([edge.target, [...path, edge]]);
                    }
                }
            }
            return null;
        };

        // 1. Process steps sequentially to reconstruct execution trace
        let prevNodeId = null;

        const isTaskType = (typeStr) => {
            if (!typeStr) return false;
            const t = typeStr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
            if (t.includes('start') || t.includes('inicio')) return false;
            if (t.includes('end') || t.includes('fim') || t.includes('concluid') || t.includes('termin')) return false;
            if (t.includes('condition') || t.includes('condicao') || t.includes('decision') || t.includes('condicionar')) return false;
            if (t.includes('assignment') || t.includes('atribuirdados') || t.includes('atribuir')) return false;
            if (t.includes('webservice') || t.includes('web')) return false;
            if (t.includes('email') || t.includes('mail') || t.includes('notification') || t.includes('notificacao')) return false;
            return true;
        };

        const relevantSteps = historySteps.filter(step => {
            const type = step.type || '';
            const name = step.name || '';
            const isStart = type === 'Start' || type === 'StartEvent' || name.toLowerCase() === 'start' || name.toLowerCase() === 'inicio' || name.toLowerCase() === 'início';
            const isEnd = type === 'End' || type === 'EndEvent' || isEndNode(type, name);
            return isStart || isEnd || isTaskType(type);
        });

        relevantSteps.forEach((step, idx) => {
            const matchedNode = findNodeForStep(step);
            if (matchedNode) {
                const node = nodesMap.get(matchedNode.id);
                
                const isLast = idx === relevantSteps.length - 1;
                const isNodeActive = step.isActive || (isLast && !step.decision && 
                    (isTaskType(step.type) || step.stepType.includes('InProgress')));
                
                node.status = isNodeActive ? 'active' : 'completed';
                if (step.type && step.type.toLowerCase() !== 'activity') {
                    node.type = step.type;
                }

                // Add execution record
                node.executions.push({
                    stepNumber: step.stepNumber,
                    startedAt: step.startedAt,
                    completedAt: step.completedAt,
                    decision: step.decision,
                    user: step.user,
                    durationMs: step.durationMs,
                    durationText: step.durationText
                });

                node.totalDurationMs += step.durationMs || 0;

                if (isNodeActive) {
                    node.activeUsers = step.assignedUsers.length > 0 ? step.assignedUsers : (step.user ? [step.user] : []);
                }

                // Trace path between previous activity and current activity
                if (prevNodeId && prevNodeId !== node.id) {
                    const path = findPath(prevNodeId, node.id);
                    if (path && path.length > 0) {
                        path.forEach(edge => {
                            edge.status = isNodeActive ? 'active' : 'taken';
                            edge.count++;
                            
                            // If intermediate nodes were skipped in history (like automatic steps), mark them completed/skipped
                            const intermediateNode = nodesMap.get(edge.source);
                            if (intermediateNode && intermediateNode.status === 'pending') {
                                intermediateNode.status = 'completed';
                                intermediateNode.executions.push({
                                    stepNumber: 0,
                                    startedAt: step.startedAt,
                                    completedAt: step.startedAt,
                                    decision: 'Automático',
                                    user: 'Sistema',
                                    durationMs: 0,
                                    durationText: ''
                                });
                            }
                        });
                    }
                }
                
                prevNodeId = node.id;
            }
        });

        // 2. Set statuses for untraversed paths
        edges.forEach(edge => {
            const source = nodesMap.get(edge.source);
            
            if (edge.status === 'pending') {
                if (source && source.status === 'completed') {
                    // Source executed, but this edge was not taken
                    edge.status = 'skipped';
                }
            }
        });

        nodes.forEach(node => {
            if (node.status === 'pending') {
                const incomingEdges = edges.filter(e => e.target === node.id);
                // If all incoming routes are skipped, this node is skipped
                if (incomingEdges.length > 0 && incomingEdges.every(e => e.status === 'skipped')) {
                    node.status = 'skipped';
                }
            }
        });

        // Format total durations
        nodes.forEach(node => {
            if (node.totalDurationMs > 0) {
                node.totalDurationText = WorkflowHistoryAnalyzer.formatDuration(node.totalDurationMs);
            }
        });

        return {
            nodes,
            edges
        };
    }
};
