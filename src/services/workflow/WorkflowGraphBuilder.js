/**
 * WorkflowGraphBuilder
 * Builds a directed graph structure from parsed activities and connections.
 * Normalizes layout coordinates or applies a layered layout algorithm if missing.
 */
const isAssignmentNode = (node) => {
    if (!node) return false;
    const name = (node.name || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const type = (node.type || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    return type.includes('assignment') ||
           type.includes('atribuicao') ||
           type.includes('atribuir') ||
           name.includes('atribuir') ||
           name.includes('atribuicao') ||
           name.includes('assignment') ||
           name.includes('requerente') ||
           name.includes('armazem') ||
           name.includes('superior hierarquico') ||
           name.includes('director compras') ||
           name.includes('procurement') ||
           name.includes('responsavel');
};

export const WorkflowGraphBuilder = {
    /**
     * Builds and structures the graph
     * @param {Array} activities 
     * @param {Array} connections 
     * @returns {Object} { nodes: Array, edges: Array, nodesMap: Map }
     */
    build: (activities, connections) => {
        const nodesMap = new Map();
        const adjacencyList = new Map();
        const reverseAdjacencyList = new Map();

        // Initialize node structures
        activities.forEach(act => {
            const node = {
                ...act,
                incoming: [],
                outgoing: []
            };
            nodesMap.set(act.id, node);
            adjacencyList.set(act.id, []);
            reverseAdjacencyList.set(act.id, []);
        });

        // Add connections (edges)
        connections.forEach(conn => {
            const sourceNode = nodesMap.get(conn.source);
            const targetNode = nodesMap.get(conn.target);

            if (sourceNode && targetNode) {
                sourceNode.outgoing.push(conn);
                targetNode.incoming.push(conn);

                adjacencyList.get(conn.source).push(conn.target);
                reverseAdjacencyList.get(conn.target).push(conn.source);
            }
        });

        // Determine if coordinates need automatic generation or normalization
        const allNodes = Array.from(nodesMap.values());
        const hasNoCoordinates = allNodes.every(n => n.x === 0 && n.y === 0);

        if (hasNoCoordinates) {
            console.log('[WorkflowGraphBuilder] No coordinates found, applying BFS auto-layout...');
            WorkflowGraphBuilder.applyAutoLayout(nodesMap, adjacencyList);
        } else {
            console.log('[WorkflowGraphBuilder] Coordinates found, normalizing layout...');
            WorkflowGraphBuilder.normalizeCoordinates(nodesMap);
        }

        // Align user assignment nodes directly above their target human task nodes
        WorkflowGraphBuilder.alignAssignmentNodes(nodesMap);

        // Resolve vertical overlapping collisions to separate task groups
        WorkflowGraphBuilder.resolveVerticalCollisions(nodesMap);

        return {
            nodes: Array.from(nodesMap.values()),
            edges: connections,
            nodesMap: nodesMap
        };
    },

    /**
     * Shifts and centers coordinates so they are positioned near the top-left area
     */
    normalizeCoordinates: (nodesMap) => {
        const nodes = Array.from(nodesMap.values());
        if (nodes.length === 0) return;

        let minX = Infinity;
        let minY = Infinity;

        nodes.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
        });

        // Scale coordinates down to compress blank space and bring nodes closer
        // scale x by 0.65 and y by 0.65
        const SCALE_X = 0.65;
        const SCALE_Y = 0.65;

        // Shift coordinates towards the origin with scaling
        nodes.forEach(n => {
            n.x = (n.x - minX) * SCALE_X + 100;
            n.y = (n.y - minY) * SCALE_Y + 100;
            n.width = 200; // Premium card width
            n.height = 90; // Premium card height
        });
    },

    /**
     * Layout engine based on BFS layered graph representation
     */
    applyAutoLayout: (nodesMap, adjacencyList) => {
        const nodeIds = Array.from(nodesMap.keys());
        const levels = new Map();
        const inDegrees = new Map();

        // Initialize in-degrees
        nodeIds.forEach(id => inDegrees.set(id, 0));

        // Calculate in-degree of all nodes
        for (const [sourceId, targets] of adjacencyList.entries()) {
            targets.forEach(targetId => {
                inDegrees.set(targetId, (inDegrees.get(targetId) || 0) + 1);
            });
        }

        // Find root nodes (in-degree = 0)
        let queue = [];
        nodeIds.forEach(id => {
            if (inDegrees.get(id) === 0) {
                queue.push(id);
                levels.set(id, 0);
            }
        });

        // Fallback if there are cycles (no nodes have in-degree = 0)
        if (queue.length === 0) {
            // Find start node by type or name
            const startNode = Array.from(nodesMap.values()).find(n => 
                n.type.toLowerCase().includes('start') || 
                n.name.toLowerCase().includes('início') || 
                n.name.toLowerCase().includes('start')
            );
            if (startNode) {
                queue.push(startNode.id);
                levels.set(startNode.id, 0);
            } else if (nodeIds.length > 0) {
                queue.push(nodeIds[0]);
                levels.set(nodeIds[0], 0);
            }
        }

        // Traverse using BFS to assign depth levels
        while (queue.length > 0) {
            const current = queue.shift();
            const currentLevel = levels.get(current) || 0;
            const neighbors = adjacencyList.get(current) || [];

            neighbors.forEach(neighbor => {
                if (!levels.has(neighbor)) {
                    levels.set(neighbor, currentLevel + 1);
                    queue.push(neighbor);
                } else if (levels.get(neighbor) < currentLevel + 1) {
                    // Update level and re-evaluate if we found a longer path (standard DAG leveling)
                    levels.set(neighbor, currentLevel + 1);
                    queue.push(neighbor);
                }
            });
        }

        // Group nodes by level (columns)
        const levelGroups = new Map();
        levels.forEach((level, id) => {
            if (!levelGroups.has(level)) {
                levelGroups.set(level, []);
            }
            levelGroups.get(level).push(id);
        });

        const HORIZONTAL_SPACING = 300;
        const VERTICAL_SPACING = 140;

        levelGroups.forEach((ids, level) => {
            const totalInLevel = ids.length;
            ids.forEach((id, idx) => {
                const node = nodesMap.get(id);
                if (node) {
                    node.x = level * HORIZONTAL_SPACING + 100;
                    // Vertically align nodes in columns centered around Y=300
                    node.y = (idx - (totalInLevel - 1) / 2) * VERTICAL_SPACING + 300;
                    node.width = 200;
                    node.height = 90;
                }
            });
        });

        // Position orphan nodes (unreachable nodes) in a clean area
        let orphanIdx = 0;
        nodesMap.forEach((node, id) => {
            if (!levels.has(id)) {
                const nextCol = Array.from(levelGroups.keys()).length;
                node.x = nextCol * HORIZONTAL_SPACING + 100;
                node.y = orphanIdx * VERTICAL_SPACING + 100;
                node.width = 200;
                node.height = 90;
                orphanIdx++;
            }
        });
    },

    /**
     * Identifies user assignment/technical nodes and aligns them directly above their target human tasks
     */
    alignAssignmentNodes: (nodesMap) => {
        const nodes = Array.from(nodesMap.values());

        nodes.forEach(node => {
            if (isAssignmentNode(node)) {
                // Find target nodes from outgoing connections
                const outgoingTargets = (node.outgoing || [])
                    .map(conn => nodesMap.get(conn.target))
                    .filter(Boolean);

                // Find the primary human task target
                const taskTarget = outgoingTargets.find(target => {
                    const tName = (target.name || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                    const tType = (target.type || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

                    // Target should be a General Task or a task that is not start, end, condition or assignment
                    const isTechnical =
                        tType.includes('start') || tType.includes('end') || tType.includes('fim') ||
                        tType.includes('condition') || tType.includes('condicao') || tType.includes('decision') ||
                        tType.includes('assignment') || tType.includes('atribuir') ||
                        tName.includes('condicao') || tName.includes('decisao') || tName.includes('start') ||
                        tName.includes('fim') || tName.includes('end') || isAssignmentNode(target);

                    return !isTechnical;
                }) || outgoingTargets[0]; // Fallback to first outgoing target if no human task found

                if (taskTarget) {
                    // Position assignment node directly above target task
                    node.x = taskTarget.x;
                    node.y = taskTarget.y - 105; // Position 105px above, resulting in a clean 15px visual gap (height is 90px)
                }
            }
        });
    },

    /**
     * Resolves vertical overlapping collisions for nodes in the same columns
     */
    resolveVerticalCollisions: (nodesMap) => {
        const nodes = Array.from(nodesMap.values());
        if (nodes.length === 0) return;

        // Group nodes into columns by x coordinate
        const sortedByX = [...nodes].sort((a, b) => a.x - b.x);
        const columns = [];
        let currentColumn = [];

        sortedByX.forEach(node => {
            if (currentColumn.length === 0) {
                currentColumn.push(node);
            } else {
                const prevNode = currentColumn[currentColumn.length - 1];
                // Nodes with horizontal center distance < 100px belong to the same column
                if (Math.abs(node.x - prevNode.x) < 100) {
                    currentColumn.push(node);
                } else {
                    columns.push(currentColumn);
                    currentColumn = [node];
                }
            }
        });
        if (currentColumn.length > 0) {
            columns.push(currentColumn);
        }

        // For each column, resolve collisions from top to bottom
        columns.forEach(columnNodes => {
            // Sort nodes in the column by y coordinate
            columnNodes.sort((a, b) => a.y - b.y);

            for (let i = 1; i < columnNodes.length; i++) {
                const prev = columnNodes[i - 1];
                const curr = columnNodes[i];

                // Check if prev is an assignment node and curr is its target
                const isPair = isAssignmentNode(prev) &&
                               (prev.outgoing || []).some(conn => conn.target === curr.id);

                const requiredGap = isPair ? 15 : 50;
                const prevBottom = prev.y + (prev.height || 90);
                const currentGap = curr.y - prevBottom;

                if (currentGap < requiredGap) {
                    curr.y = prevBottom + requiredGap;
                }
            }
        });
    }
};
