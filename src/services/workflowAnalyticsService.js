import axios from 'axios';

/**
 * Workflow Analytics Service
 * 
 * Interacts with the DocuWare Workflow Analytics API to retrieve detailed
 * audit trails and history for workflows, including completed instances.
 * 
 * Base URL: /DocuWare/Workflow/Analytics/api
 */

const analyticsApi = axios.create({
    baseURL: '/DocuWare/Workflow/Analytics', // Removed '/api' which is likely incorrect
    timeout: 30000,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
});

// Request Interceptor (Auth)
analyticsApi.interceptors.request.use(
    (config) => {
        const authData = sessionStorage.getItem('docuware_auth');
        let targetUrl = null;

        if (authData) {
            try {
                const parsed = JSON.parse(authData);
                if (parsed.token) {
                    config.headers.Authorization = `Bearer ${parsed.token}`;
                }
                if (parsed.url) {
                    targetUrl = parsed.url;
                }
            } catch (error) {
                console.error('[WorkflowAnalytics] Error parsing auth data:', error);
            }
        }

        // Apply Target URL for Proxy
        if (targetUrl) {
            config.headers['x-target-url'] = targetUrl;
        }

        return config;
    },
    (error) => Promise.reject(error)
);

const wfdCache = new Map();

export const workflowAnalyticsService = {
    /**
     * Get Workflow History for a Document by DocID
     * @param {string} docId 
     * @param {string} cabinetId
     * @returns {Promise<Array>}
     */
    getHistoryByDocId: async (docId, cabinetId) => {
        const CACHE_KEY_PREFIX = 'dw_hist_';
        const cacheKey = `${CACHE_KEY_PREFIX}${cabinetId}_${docId}`;

        // Check if cache exists and is still valid
        try {
            const cachedVal = localStorage.getItem(cacheKey);
            if (cachedVal) {
                const { data, expiresAt } = JSON.parse(cachedVal);
                if (Date.now() < expiresAt) {
                    console.log(`[WorkflowAnalytics] Serving history from cache for DocID: ${docId}`);
                    return data;
                }
            }
        } catch (e) {
            console.warn('[WorkflowAnalytics] Failed to read from cache:', e);
        }

        try {
            console.log(`[WorkflowAnalytics] Fetching history for DocID: ${docId}, Cabinet: ${cabinetId}`);

            // Use the specific Platform endpoint for Document History
            if (!cabinetId) {
                console.warn('[WorkflowAnalytics] CabinetID missing, cannot fetch specific history.');
                return [];
            }

            const response = await analyticsApi.get('/DocuWare/Platform/Workflow/Instances/DocumentHistory', {
                baseURL: '/',
                params: {
                    fileCabinetId: cabinetId,
                    documentId: docId
                }
            });

            console.log('[WorkflowAnalytics] History Response:', response.data);

            const instances = response.data.InstanceHistory || response.data || [];

            if (Array.isArray(instances)) {
                console.log(`[WorkflowAnalytics] Found ${instances.length} instances. Fetching details...`);

                const historyPromises = instances.map(async (inst) => {
                    try {
                        const selfLink = (inst.Links || []).find(l => l.Rel === 'self' || l.rel === 'self');
                        let historyUrl = null;

                        if (selfLink && selfLink.href) {
                            historyUrl = selfLink.href;
                        } else {
                            historyUrl = `/DocuWare/Platform/Workflow/Workflows/${inst.WorkflowId}/Instances/${inst.Id}/History`;
                        }

                        if (historyUrl) {
                            console.log(`[WorkflowAnalytics] Fetching details: ${historyUrl}`);
                            const detailResp = await analyticsApi.get(historyUrl, { baseURL: '/' });
                            return {
                                ...inst,
                                HistorySteps: detailResp.data.HistorySteps || detailResp.data || []
                            };
                        }
                    } catch (detailErr) {
                        console.warn(`[WorkflowAnalytics] Failed to fetch details for instance ${inst.Id}`, detailErr);
                        return { ...inst, HistorySteps: [] };
                    }
                    return { ...inst, HistorySteps: [] };
                });

                const instancesWithSteps = await Promise.all(historyPromises);

                // Cache the results
                try {
                    let isFinished = false;
                    if (instancesWithSteps.length > 0) {
                        const sorted = [...instancesWithSteps].sort((a, b) => (b.Version || 0) - (a.Version || 0));
                        const latestInstance = sorted[0];
                        const steps = latestInstance.HistorySteps || [];
                        if (steps.length > 0) {
                            const lastStep = steps[steps.length - 1];
                            const name = (lastStep.ActivityName || lastStep.Name || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                            const type = (lastStep.ActivityType || '').toLowerCase();
                            
                            if (
                                type.includes('end') || type.includes('fim') ||
                                name === 'end' || name.startsWith('end ') || name.endsWith(' end') || name.includes(' end ') ||
                                name.startsWith('fim') || name.includes(' fim') ||
                                name.includes('concluid') || name.includes('termin') || name.includes('conclusao') ||
                                name.includes('cancelad') || name.includes('reprovad')
                            ) {
                                isFinished = true;
                            }
                        }
                    }

                    // 7 days TTL for finished workflows, 5 minutes TTL for active ones
                    const ttl = isFinished ? (7 * 24 * 60 * 60 * 1000) : (5 * 60 * 1000);
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data: instancesWithSteps,
                        expiresAt: Date.now() + ttl
                    }));
                } catch (cacheErr) {
                    console.warn('[WorkflowAnalytics] Failed to write to cache (probably storage full), clearing cache...');
                    for (let k in localStorage) {
                        if (k.startsWith(CACHE_KEY_PREFIX)) {
                            localStorage.removeItem(k);
                        }
                    }
                }

                return instancesWithSteps;
            }

            return [];

        } catch (error) {
            console.error('[WorkflowAnalytics] Platform History fetch failed:', error);
            throw error;
        }
    },

    /**
     * Get Workflow WFD definition from backend server
     */
    getWfdDefinition: async (workflowId, workflowName = null) => {
        if (wfdCache.has(workflowId)) {
            return wfdCache.get(workflowId);
        }
        try {
            const params = {};
            if (workflowName) params.name = workflowName;
            const response = await analyticsApi.get(`/api/wfd/${workflowId}`, { 
                baseURL: '/',
                params
            });
            wfdCache.set(workflowId, response.data);
            return response.data;
        } catch (err) {
            console.warn(`[WorkflowAnalytics] WFD not found on server for ${workflowId}:`, err.message);
            wfdCache.set(workflowId, null); // Cache the negative 404 state to prevent repeat calls
            return null;
        }
    },

    /**
     * Save WFD definition to backend server
     */
    saveWfdDefinition: async (workflowId, definition) => {
        try {
            await analyticsApi.post(`/api/wfd/${workflowId}`, definition, { baseURL: '/' });
            return true;
        } catch (err) {
            console.error(`[WorkflowAnalytics] Failed to save WFD to server for ${workflowId}:`, err);
            throw err;
        }
    },

    /**
     * Delete WFD definition from backend server
     */
    deleteWfdDefinition: async (workflowId) => {
        try {
            await analyticsApi.delete(`/api/wfd/${workflowId}`, { baseURL: '/' });
            return true;
        } catch (err) {
            console.error(`[WorkflowAnalytics] Failed to delete WFD from server for ${workflowId}:`, err);
            throw err;
        }
    }
};
