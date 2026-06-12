import JSZip from 'jszip';

/**
 * WorkflowDefinitionParser
 * Parses DocuWare exported workflow definitions (.wfd)
 * Supports both modern JSON definitions and legacy XML exports.
 */
export const WorkflowDefinitionParser = {
    /**
     * Parse a .wfd file or raw string/buffer
     * @param {File|ArrayBuffer|string} fileData - The file object, array buffer or raw string
     * @returns {Promise<{activities: Array, connections: Array, name: string, organizationId: string}>}
     */
    parse: async (fileData) => {
        try {
            let contentStr = '';
            const isZip = await WorkflowDefinitionParser.checkIfZip(fileData);

            if (isZip) {
                const jszip = new JSZip();
                const zip = await jszip.loadAsync(fileData);
                
                // Find json or xml files
                const files = Object.keys(zip.files);
                const jsonFile = files.find(n => n.toLowerCase().endsWith('.json') || n.toLowerCase().endsWith('.wfd'));
                const xmlFile = files.find(n => n.toLowerCase().endsWith('.xml'));

                if (jsonFile) {
                    contentStr = await zip.files[jsonFile].async('string');
                } else if (xmlFile) {
                    contentStr = await zip.files[xmlFile].async('string');
                } else {
                    throw new Error('Nenhum arquivo de definição de workflow (.json ou .xml) encontrado no pacote .wfd');
                }
            } else {
                if (fileData instanceof File) {
                    contentStr = await fileData.text();
                } else if (fileData instanceof ArrayBuffer) {
                    const decoder = new TextDecoder('utf-8');
                    contentStr = decoder.decode(fileData);
                } else if (typeof fileData === 'string') {
                    contentStr = fileData;
                } else {
                    throw new Error('Tipo de dado não suportado para leitura');
                }
            }

            // Detect if the content is JSON or XML
            const trimmed = contentStr.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                return WorkflowDefinitionParser.parseJson(trimmed);
            } else {
                return WorkflowDefinitionParser.parseXml(trimmed);
            }
        } catch (error) {
            console.error('[WorkflowDefinitionParser] Error parsing workflow definition:', error);
            throw error;
        }
    },

    /**
     * Helper to check if file data is a ZIP archive
     */
    checkIfZip: async (fileData) => {
        try {
            let buffer;
            if (fileData instanceof File) {
                buffer = await fileData.slice(0, 4).arrayBuffer();
            } else if (fileData instanceof ArrayBuffer) {
                buffer = fileData.slice(0, 4);
            } else {
                return false;
            }
            const arr = new Uint8Array(buffer);
            // ZIP magic bytes: PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
            return arr[0] === 0x50 && arr[1] === 0x4B && arr[2] === 0x03 && arr[3] === 0x04;
        } catch (_) {
            return false;
        }
    },

    /**
     * Parse modern JSON-based DocuWare workflow definition
     */
    parseJson: (jsonText) => {
        const root = JSON.parse(jsonText);
        
        // Handle wrapping structure: either array of workflows or single workflow object
        const workflowData = Array.isArray(root.workflows) ? root.workflows[0] : (root.workflows ? root.workflows : root);
        if (!workflowData) {
            throw new Error('Formato JSON inválido: Definição de workflow não encontrada.');
        }

        const name = workflowData.name || 'Workflow DocuWare';
        const organizationId = root.organizationId || '';
        
        // Parse definition JSON string if it's stored as a string
        let definition = workflowData.definition || {};
        if (typeof definition === 'string') {
            definition = JSON.parse(definition);
        }

        // Parse designerData JSON string if it's stored as a string
        let designerData = workflowData.designerData || {};
        if (typeof designerData === 'string') {
            designerData = JSON.parse(designerData);
        }

        const activitiesList = definition.activities || [];
        const connectionsList = definition.connections || [];
        
        // Create maps for quick lookups
        const designerActivitiesMap = new Map();
        if (designerData.activities && Array.isArray(designerData.activities)) {
            designerData.activities.forEach(act => {
                designerActivitiesMap.set(act.id, act);
            });
        }

        // Build a global map of conditionalOutput IDs to their labels/names
        const outputLabelMap = new Map();
        
        const registerOutputs = (outputs) => {
            if (outputs && Array.isArray(outputs)) {
                outputs.forEach(out => {
                    if (out.id && out.name) {
                        outputLabelMap.set(out.id, out.name);
                    }
                });
            }
        };

        activitiesList.forEach(act => {
            registerOutputs(act.conditionalOutputs);
            
            if (act.trueDecision) {
                registerOutputs(act.trueDecision.conditionalOutputs);
            }
            if (act.falseDecision) {
                registerOutputs(act.falseDecision.conditionalOutputs);
            }
            if (act.decisions && Array.isArray(act.decisions)) {
                act.decisions.forEach(dec => {
                    registerOutputs(dec.conditionalOutputs);
                });
            }
            if (act.parallelTaskOutputsGroup) {
                registerOutputs(act.parallelTaskOutputsGroup.conditionalOutputs);
            }
        });

        // Map Activities
        const activities = activitiesList.map(act => {
            const designerInfo = designerActivitiesMap.get(act.id) || {};
            const pos = designerInfo.position || { x: 0, y: 0 };
            
            return {
                id: act.id,
                name: act.name || act.type || 'Sem Nome',
                type: act.type || 'Task',
                description: act.description || '',
                x: pos.x || 0,
                y: pos.y || 0,
                width: 180, // Default width
                height: 80, // Default height
                color: designerInfo.color || '#3b49a2',
                icon: designerInfo.icon || 'action-checkbox'
            };
        });

        // Map Connections
        const connections = connectionsList.map((conn, idx) => {
            const sourceId = conn.sourceActivityId;
            const targetId = conn.destinationActivityId;
            const outputId = conn.outputId;

            // Fetch name from outputId map
            let label = outputLabelMap.get(outputId) || '';
            
            return {
                id: conn.id || `connection_${idx}`,
                source: sourceId,
                target: targetId,
                outputId: outputId,
                label: label
            };
        });

        return {
            name,
            organizationId,
            activities,
            connections
        };
    },

    /**
     * Fallback XML Parser for DocuWare Workflow Definitions
     */
    parseXml: (xmlText) => {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            throw new Error('Falha ao interpretar o arquivo XML: ' + parserError.textContent);
        }

        let name = 'Workflow DocuWare';
        const workflowNode = xmlDoc.querySelector('Workflow, DesignerWorkflow, Process, Definition');
        if (workflowNode) {
            name = workflowNode.getAttribute('Name') || workflowNode.getAttribute('DisplayName') || workflowNode.getAttribute('Title') || name;
        }

        const activities = [];
        const connections = [];
        const allElements = xmlDoc.getElementsByTagName('*');
        const activityIdMap = new Map();

        // Scan for activities
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const tagName = el.tagName;
            const id = el.getAttribute('Id') || el.getAttribute('GUID') || el.getAttribute('ActivityId');

            if (id) {
                const isActivityNode = 
                    tagName.toLowerCase().includes('activity') ||
                    tagName.toLowerCase().includes('task') ||
                    tagName.toLowerCase().includes('event') ||
                    tagName.toLowerCase().includes('condition') ||
                    ['start', 'end', 'step', 'node', 'state'].includes(tagName.toLowerCase()) ||
                    el.getAttribute('X') || el.getAttribute('Y') || el.querySelector('Location');

                if (isActivityNode) {
                    const actName = el.getAttribute('Name') || 
                                    el.getAttribute('DisplayName') || 
                                    el.getAttribute('Title') || 
                                    el.querySelector('Name')?.textContent || 
                                    el.querySelector('DisplayName')?.textContent || 
                                    el.querySelector('Title')?.textContent || 
                                    tagName;
                    const type = el.getAttribute('Type') || 
                                 el.getAttribute('ActivityType') || 
                                 el.querySelector('Type')?.textContent || 
                                 el.querySelector('ActivityType')?.textContent || 
                                 tagName;
                    
                    let x = parseFloat(el.getAttribute('X') || el.getAttribute('Left') || '0');
                    let y = parseFloat(el.getAttribute('Y') || el.getAttribute('Top') || '0');
                    const locationNode = el.querySelector('Location');
                    if (locationNode) {
                        x = parseFloat(locationNode.getAttribute('X') || locationNode.getAttribute('Left') || x);
                        y = parseFloat(locationNode.getAttribute('Y') || locationNode.getAttribute('Top') || y);
                    }

                    if (!activityIdMap.has(id)) {
                        activities.push({
                            id,
                            name: actName,
                            type,
                            description: el.getAttribute('Description') || '',
                            x,
                            y,
                            width: 180,
                            height: 80,
                            color: '#3b49a2',
                            icon: 'action-checkbox'
                        });
                        activityIdMap.set(id, true);
                    }
                }
            }

            // Scan for connections
            const isConnectionNode = 
                tagName.toLowerCase().includes('connection') || 
                tagName.toLowerCase().includes('transition') || 
                tagName.toLowerCase().includes('link') || 
                tagName.toLowerCase().includes('connector');

            if (isConnectionNode) {
                const source = el.getAttribute('Source') || el.getAttribute('From') || el.getAttribute('SourceId');
                const target = el.getAttribute('Target') || el.getAttribute('To') || el.getAttribute('TargetId');

                if (source && target) {
                    const label = el.getAttribute('Name') || el.getAttribute('Label') || el.getAttribute('ConditionName') || '';
                    connections.push({
                        id: el.getAttribute('Id') || `connection_${source}_${target}_${i}`,
                        source,
                        target,
                        label
                    });
                }
            }
        }

        return {
            name,
            organizationId: '',
            activities,
            connections
        };
    }
};
