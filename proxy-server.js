import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Initialize Express App
const app = express();
const PORT = 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.join(__dirname, 'exports');
const WFD_DIR = path.join(__dirname, 'wfd_definitions');

if (!process.env.NETLIFY) {
    fs.mkdir(WFD_DIR, { recursive: true }).catch((error) => {
        console.error(`[WFD] Failed to ensure wfd_definitions directory: ${error.message}`);
    });
}

// ----------------------------------------------------------------------------
// Live Console Log Capture (circular buffer, max 500 lines)
// ----------------------------------------------------------------------------
const LOG_BUFFER_MAX = 500;
const liveLogBuffer = [];
let logSeq = 0;

function pushLog(level, args) {
    const text = args.map(a =>
        typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ');
    logSeq++;
    liveLogBuffer.push({ seq: logSeq, ts: new Date().toISOString(), level, text });
    if (liveLogBuffer.length > LOG_BUFFER_MAX) liveLogBuffer.shift();
}

const _log = console.log.bind(console);
const _error = console.error.bind(console);
const _warn = console.warn.bind(console);
console.log = (...a) => { _log(...a); pushLog('info', a); };
console.error = (...a) => { _error(...a); pushLog('error', a); };
console.warn = (...a) => { _warn(...a); pushLog('warn', a); };


/**
 * @file proxy-server.js
 * @description Dynamic Proxy Server for DocuWare Integration.
 * Acts as a middleware to bypass CORS restrictions when consuming the DocuWare REST API
 * from a browser-based client. This server forwards requests to the target URL specified
 * in the 'x-target-url' header.
 * 
 * @author RCSVision Engineer
 * @version 2.0.0
 */

// Initialize Express App (Moved to top)
// const app = express();
// const PORT = 3001;

import dotenv from 'dotenv';
dotenv.config();

let scheduler = null;
if (!process.env.NETLIFY) {
    const schedulerModule = await import('./scheduler.js');
    scheduler = schedulerModule.scheduler;
} else {
    scheduler = {
        init: async () => {},
        getAll: async () => [],
        getHistory: async () => [],
        getHistoryAll: async () => [],
        clearHistory: async () => {},
        save: async (s) => s,
        delete: async () => {},
        startTask: () => {},
        stopTask: () => {},
        forceRun: async () => ({ status: 'disabled' }),
        abortExport: () => false,
        getRunningFiles: () => [],
        generateCsvFromSearch: async () => ({ csvString: '', count: 0 })
    };
}
import { tokenManager } from './tokenManager.js';

if (!process.env.NETLIFY) {
    fs.mkdir(EXPORTS_DIR, { recursive: true }).catch((error) => {
        console.error(`[Exports] Failed to ensure exports directory: ${error.message}`);
    });
}

// Initialize Services
tokenManager.init();
if (!process.env.NETLIFY) {
    scheduler.init();
}


// ----------------------------------------------------------------------------
// 1. Global Middleware Configuration
// ----------------------------------------------------------------------------

/**
 * Configure Cross-Origin Resource Sharing (CORS).
 * Allows the frontend (running on different ports like 5173) to communicate with this proxy.
 * 
 * @type {cors.CorsOptions}
 */
app.use(cors({
    origin: true, // Dynamically reflects the request origin (Postman, localhost:5173, etc.)
    credentials: true, // Allow cookies/auth headers
    allowedHeaders: ['Content-Type', 'Authorization', 'x-target-url'] // Explicitly allow our custom routing header
}));

// app.use(express.json()); // MOVED: Only use for /api to avoid breaking proxy streams
app.use('/api', express.json()); // Enable JSON body parsing ONLY for local API endpoints

/**
 * Pre-flight Request Handler (OPTIONS).
 * Browsers send an OPTIONS request before the actual POST/PUT/GET to check permissions.
 * We intercept this immediately to return 200 OK, preventing CORS blocking.
 */
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ----------------------------------------------------------------------------
// 2. Discovery Route
// ----------------------------------------------------------------------------

/**
 * Route: /discovery
 * Clean Server-to-Server Discovery Endpoint to bypass DocuWare WAF.
 * Makes a direct request to DocuWare without browser headers.
 */
app.get('/discovery', async (req, res) => {
    const targetUrl = req.query.target;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing target query parameter' });
    }

    try {
        console.log(`[Proxy] 🕵️‍♂️ Performing Server-Side Discovery for: ${targetUrl}`);

        // Construct the full URL for IdentityServiceInfo
        // targetUrl e.g. https://rcsangola.docuware.cloud
        const infoUrl = `${targetUrl}/DocuWare/Platform/Home/IdentityServiceInfo`;
        console.log(`[Proxy] 📡 Fetching: ${infoUrl}`);

        const response = await axios.get(infoUrl, {
            headers: {
                'Accept': 'application/json'
                // No Origin, No Referer, No Cookies -> Clean Request
            }
        });

        console.log(`[Proxy] ✅ Discovery Success!`);
        console.log(`[Proxy] 📦 Response data:`, JSON.stringify(response.data, null, 2));
        res.json(response.data);
    } catch (error) {
        console.error(`[Proxy] ❌ Discovery Failed: ${error.message}`);
        if (error.response) {
            console.error(`[Proxy] ❌ Response status: ${error.response.status}`);
            console.error(`[Proxy] ❌ Response data:`, error.response.data);
        }
        res.status(500).json({ error: 'Discovery Failed', details: error.message });
    }
});

// ----------------------------------------------------------------------------
// 3. Proxy Logic Implementation
// ----------------------------------------------------------------------------

/**
 * Configuration for the http-proxy-middleware.
 * Defines how requests are routed, transformed, and logged.
 * 
 * @type {import('http-proxy-middleware').Options}
 */
const proxyOptions = {
    /**
     * @function router
     * @description Dynamic Routing Logic.
     * Instead of a static target, we read the 'x-target-url' header from the incoming request.
     * This allows the frontend to talk to ANY DocuWare organization dynamically.
     * 
     * @param {express.Request} req - Incoming Express request object
     * @returns {string} The target URL to proxy to
     * @throws {Error} If x-target-url is missing
     */
    router: (req) => {
        // Extract target from custom header
        const targetUrl = req.headers['x-target-url'];
        const timestamp = new Date().toISOString();

        // Logging for audit and debugging
        console.log(`[${timestamp}] [Proxy] Incoming request: ${req.method} ${req.url}`);

        if (!targetUrl) {
            // Will be caught by the requireTargetUrl middleware BEFORE reaching here
            console.error(`[${timestamp}] [Proxy] ❌ Missing X-Target-URL header on ${req.method} ${req.url}`);
            return 'http://localhost'; // Fallback to avoid throwing — middleware already handled this
        }

        console.log(`[${timestamp}] [Proxy] ✅ Routing to: ${targetUrl}`);
        return targetUrl;
    },

    changeOrigin: true, // Changes the origin of the host header to the target URL
    secure: false, // Don't verify SSL certificates (DocuWare Cloud might need this if using self-signed locally, but usually false for proxying)
    timeout: 300000,
    proxyTimeout: 300000,
    /**
     * @function onProxyReq
     * @description Request Interceptor.
     * Cleans up the request before sending it to the final destination.
     */
    onProxyReq: (proxyReq, req, res) => {
        const target = req.headers['x-target-url'];
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [Proxy] 📤 Forwarding ${req.method} ${req.originalUrl} -> ${target}`);

        if (target) {
            // Rewrite Origin and Referer to match the target to satisfy WCF/CORS checks
            proxyReq.setHeader('Origin', target);
            proxyReq.setHeader('Referer', target + '/');
        }

        // Cleanliness: Remove browser-specific metadata that might trigger WAFs when Origin is rewritten
        proxyReq.removeHeader('x-target-url');
        proxyReq.removeHeader('cookie');
        proxyReq.removeHeader('sec-fetch-dest');
        proxyReq.removeHeader('sec-fetch-mode');
        proxyReq.removeHeader('sec-fetch-site');
        proxyReq.removeHeader('sec-fetch-user');

        // Optional: Remove Sec-Ch-Ua if strict UA filtering is suspected, but usually browser UAs are fine.
    },

    /**
     * @function onProxyRes
     * @description Response Interceptor.
     * Logs the status code received from the upstream server.
     */
    onProxyRes: (proxyRes, req, res) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [Proxy] 📥 Response ${proxyRes.statusCode} for ${req.method} ${req.url}`);
    },

    /**
     * @function onError
     * @description Global Error Handler for the Proxy.
     * Catches network errors (e.g., DNS failure, Connection Refused) and sends a JSON response.
     */
    onError: (err, req, res) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [Proxy] ❌ Error:`, err.message);
        res.status(500).json({ error: 'Proxy Error', details: err.message });
    }
};

// ----------------------------------------------------------------------------
// 3. Route Configurations
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// 3.0 Exports File Browser API
// ----------------------------------------------------------------------------

/**
 * Helper: resolve and validate path is inside EXPORTS_DIR (prevents traversal)
 */
function resolveExportPath(relativePath) {
    const resolved = relativePath
        ? path.resolve(EXPORTS_DIR, relativePath)
        : path.resolve(EXPORTS_DIR);
    if (!resolved.startsWith(path.resolve(EXPORTS_DIR))) {
        throw new Error('Acesso negado: caminho inválido.');
    }
    return resolved;
}

/**
 * GET /api/exports/browse?path=subpasta/subsubpasta
 * Lista conteúdo de uma pasta dentro de EXPORTS_DIR
 */
app.get('/api/exports/browse', async (req, res) => {
    try {
        const rel = (req.query.path || '').replace(/\\/g, '/');
        const target = resolveExportPath(rel);
        const entries = await fs.readdir(target, { withFileTypes: true });
        const items = await Promise.all(
            entries.map(async (entry) => {
                if (entry.name.startsWith('.')) return null; // skip hidden
                const entryPath = path.join(target, entry.name);
                const stat = await fs.stat(entryPath).catch(() => null);
                return {
                    name: entry.name,
                    type: entry.isDirectory() ? 'folder' : 'file',
                    size: stat ? stat.size : 0,
                    modified: stat ? stat.mtime.toISOString() : null
                };
            })
        );
        res.json(items.filter(Boolean));
    } catch (err) {
        console.error('[Exports] Browse error:', err.message);
        res.status(err.message.includes('inválido') ? 403 : 500).json({ error: err.message });
    }
});

/**
 * GET /api/exports/download?path=subpasta/arquivo.csv
 * Faz download de um arquivo dentro de EXPORTS_DIR
 */
app.get('/api/exports/download', async (req, res) => {
    try {
        const rel = (req.query.path || '').replace(/\\/g, '/');
        if (!rel) return res.status(400).json({ error: 'Caminho não informado.' });
        const target = resolveExportPath(rel);
        const stat = await fs.stat(target).catch(() => null);
        if (!stat || stat.isDirectory()) return res.status(404).json({ error: 'Arquivo não encontrado.' });
        const filename = path.basename(target);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        const { createReadStream } = await import('fs');
        createReadStream(target).pipe(res);
    } catch (err) {
        console.error('[Exports] Download error:', err.message);
        res.status(err.message.includes('inválido') ? 403 : 500).json({ error: err.message });
    }
});

/**
 * POST /api/export/csv
 * Generates an on-the-fly CSV from Search results and history
 */
app.post('/api/export/csv', async (req, res) => {
    try {
        // Allow up to 10 minutes for large exports
        req.setTimeout(600000);
        res.setTimeout(600000);

        const { targetUrl, cabinetId, filters } = req.body;

        if (!targetUrl || !cabinetId) {
            return res.status(400).json({ error: 'Missing targetUrl or cabinetId' });
        }

        const authInfo = { url: targetUrl, organizationId: '' };

        console.log(`[Exports] Generating direct CSV for cabinet ${cabinetId}`);
        const result = await scheduler.generateCsvFromSearch(authInfo, cabinetId, filters || []);

        console.log(`[Exports] CSV generation complete. Rows: ${result.count}, Size: ${(result.csvString || '').length} chars`);

        if (!result.csvString) {
            return res.status(404).json({ error: 'No documents found for export' });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `export_${cabinetId}_${timestamp}.csv`;

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.send(result.csvString);

    } catch (err) {
        console.error('[Exports] Direct CSV export error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed: ' + err.message });
        }
    }
});

// Root-level folders that can never be deleted
const PROTECTED_EXPORT_PATHS = [
    'Exportações CSV',
    'Exportacoes CSV',
    'Histórico de exportações SQL',
    'Historico de exportacoes SQL',
];

/**
 * DELETE /api/exports/delete?path=subpasta/arquivo.csv
 * Deletes a file or folder (recursively) inside EXPORTS_DIR
 */
app.delete('/api/exports/delete', async (req, res) => {
    try {
        const rel = (req.query.path || '').replace(/\\/g, '/');
        if (!rel) return res.status(400).json({ error: 'Caminho não informado.' });

        // Block deletion of the protected root folders themselves (not their contents)
        const rootName = rel.split('/')[0];
        const isExactRoot = rel === rootName || rel === decodeURIComponent(rootName);
        if (isExactRoot && PROTECTED_EXPORT_PATHS.some(p => p === rootName || p === decodeURIComponent(rootName))) {
            return res.status(403).json({ error: `A pasta "${rootName}" é protegida e não pode ser removida.` });
        }
        const target = resolveExportPath(rel);
        const stat = await fs.stat(target).catch(() => null);
        if (!stat) return res.status(404).json({ error: 'Item não encontrado.' });
        if (stat.isDirectory()) {
            try {
                await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
            } catch (rmErr) {
                // Windows EBUSY fallback: use native rmdir command
                if (rmErr.code === 'EBUSY' || rmErr.code === 'EPERM') {
                    console.warn(`[Exports] fs.rm failed (${rmErr.code}), falling back to native rmdir...`);
                    const { exec } = await import('child_process');
                    await new Promise((resolve, reject) => {
                        exec(`rmdir /s /q "${target}"`, (error) => {
                            if (error) reject(error);
                            else resolve();
                        });
                    });
                } else {
                    throw rmErr;
                }
            }
        } else {
            await fs.rm(target, { force: true, maxRetries: 5, retryDelay: 100 });
        }
        console.log(`[Exports] Deleted: ${rel}`);
        res.json({ status: 'ok', deleted: rel });
    } catch (err) {
        console.error('[Exports] Delete error:', err.message);
        res.status(err.message.includes('inválido') ? 403 : 500).json({ error: err.message });
    }
});

/**
 * Middleware: Guard proxy routes from requests without x-target-url.
 * Returns 401 instead of letting the proxy throw an unhandled internal error.
 * This allows the frontend's api.js interceptor to catch the 401 and retry
 * after refreshing the token.
 */
const requireTargetUrl = (req, res, next) => {
    if (!req.headers['x-target-url']) {
        console.error(`[Proxy Guard] ❌ Missing x-target-url on ${req.method} ${req.url}`);
        return res.status(401).json({ error: 'Missing X-Target-URL header. Session may have expired.' });
    }
    next();
};

/**
 * Route: /DocuWare/*
 * Main entry point for DocuWare Platform API calls.
 */
app.use('/DocuWare', requireTargetUrl, createProxyMiddleware({
    ...proxyOptions,
    pathRewrite: {
        '^/': '/DocuWare/' // Ensures standard DocuWare behavior since Express strips the mount path
    }
}));

/**
 * Route: /docuware-proxy/*
 * Alternate entry point, often used for Identity Service or special auth flows.
 */
app.use('/docuware-proxy', requireTargetUrl, createProxyMiddleware(proxyOptions));

// ----------------------------------------------------------------------------
// 3.1 Auth API Routes (Centralized Token Management)
// ----------------------------------------------------------------------------

/**
 * Save valid session from Frontend Login
 */
app.post('/api/auth/session', async (req, res) => {
    try {
        const tokens = req.body;
        if (!tokens || !tokens.refreshToken) {
            return res.status(400).json({ error: 'Invalid token data' });
        }
        await tokenManager.setTokens(tokens);
        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Auth Session Error:', error);
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * Get valid Access Token (Refresh if needed)
 */
app.get('/api/auth/token', async (req, res) => {
    try {
        // Try getting current, if 401/error, try refresh
        try {
            const token = await tokenManager.getAccessToken();
            const tokens = tokenManager.getTokens() || {};
            const responseData = {
                token,
                url: tokens.url || 'https://rcsangola.docuware.cloud',
                tokenEndpoint: tokens.tokenEndpoint
            };
            // Verify if it's likely expired? 
            // For now, just return it. The frontend interceptor will handle 401 by calling /refresh if we had a separate endpoint.
            // But here "getAccessToken" just returns what we have.
            // Let's add a `?refresh=true` flag to force refresh
            if (req.query.refresh === 'true') {
                const newToken = await tokenManager.refreshAccessToken();
                const newTokens = tokenManager.getTokens() || {};
                return res.json({
                    token: newToken,
                    url: newTokens.url || 'https://rcsangola.docuware.cloud',
                    tokenEndpoint: newTokens.tokenEndpoint
                });
            }
            res.json(responseData);
        } catch (e) {
            // Check if we need to refresh?
            // If getAccessToken failed, it means no session.
            res.status(401).json({ error: 'No session' });
        }
    } catch (error) {
        console.error('Auth Token Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------------------------------
// 3.2 Scheduler API Routes
// ----------------------------------------------------------------------------

app.get('/api/schedules/logs', async (req, res) => {
    const logs = await scheduler.getHistory();
    res.json(logs);
});

app.get('/api/schedules/logs/all', async (req, res) => {
    const logs = await scheduler.getHistoryAll();
    res.json(logs);
});

app.delete('/api/schedules/logs', async (req, res) => {
    try {
        await scheduler.clearHistory();
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/system/stats', async (req, res) => {
    try {
        const schedules = await scheduler.getAll();
        const logs = await scheduler.getHistoryAll();
        const mem = process.memoryUsage();
        res.json({
            uptime: process.uptime(),
            nodeVersion: process.version,
            memoryUsedMB: Math.round(mem.rss / 1024 / 1024),
            memoryHeapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
            schedulesTotal: schedules.length,
            schedulesActive: schedules.filter(s => s.enabled !== false).length,
            logsTotal: logs.length,
            lastLog: logs[0] || null,
            startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/system/logs/live?since=<seq>
// Returns console log lines captured since the given sequence number (max 200)
app.get('/api/system/logs/live', (req, res) => {
    const since = parseInt(req.query.since, 10) || 0;
    const lines = liveLogBuffer.filter(l => l.seq > since).slice(-200);
    res.json({ lines, latestSeq: logSeq });
});

app.get('/api/schedules', async (req, res) => {
    const schedules = await scheduler.getAll();
    res.json(schedules);
});

app.post('/api/schedules', async (req, res) => {
    try {
        const schedule = req.body;
        if (!schedule.id || !schedule.cronExpression) {
            return res.status(400).json({ error: 'Invalid schedule data' });
        }
        const saved = await scheduler.save(schedule);
        res.json(saved);
        console.log(`[API] Saved schedule: ${saved.name}`);
    } catch (error) {
        console.error('Error saving schedule:', error);
        res.status(500).json({ error: 'Failed to save schedule' });
    }
});

app.delete('/api/schedules/:id', async (req, res) => {
    try {
        await scheduler.delete(req.params.id);
        res.sendStatus(204);
        console.log(`[API] Deleted schedule: ${req.params.id}`);
    } catch (error) {
        console.error('Error deleting schedule:', error);
        res.status(500).json({ error: 'Failed to delete schedule' });
    }
});

app.post('/api/schedules/:id/run', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await scheduler.forceRun(id);
        res.json(result);
    } catch (error) {
        console.error('Error running schedule:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/schedules/running', (req, res) => {
    const running = scheduler.getRunningFiles();
    res.json(running);
});

import sql from 'mssql';

// ... (existing imports)

// ... (existing code)

app.post('/api/test-sql-connection', async (req, res) => {
    const { server, port, database, user, password } = req.body;
    console.log(`[API] Testing SQL Connection to ${server}:${port} (${database})`);

    try {
        const config = {
            user,
            password,
            server,
            port: parseInt(port) || 1433,
            database,
            options: {
                encrypt: false, // Default for many local instances
                trustServerCertificate: true // Trust self-signed certs
            }
        };

        const pool = await sql.connect(config);

        // Optional: Test query if table is provided
        if (req.body.table) {
            const tableName = req.body.table.replace(/[^a-zA-Z0-9_]/g, ''); // Basic sanitization
            // Use bracket notation to handle potential keywords or odd names, though sanitization is strict for now.
            // Better: use parameterized query or just trust the admin user input but wrap in brackets.
            // Since table names can't easily be parameterized in T-SQL without dynamic SQL, we'll confirm strict characters or just wrap.
            // Let's assume the user knows what they are doing but we wrap in brackets [ ]. 
            // We can't use parameters for table names.

            // Just running a simple check.
            try {
                await pool.request().query(`SELECT TOP 1 * FROM [${req.body.table}]`);
            } catch (queryErr) {
                await pool.close();
                throw new Error(`Connection successful, but table '${req.body.table}' check failed: ${queryErr.message}`);
            }
        }

        await pool.close();

        console.log('[API] SQL Connection Test: Success');
        res.json({ success: true, message: 'Connection successful!' });
    } catch (err) {
        console.error('[API] SQL Connection Test Failed:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/schedules/:id/stop', async (req, res) => {
    try {
        const { id } = req.params;
        scheduler.abortExport(id);
        res.json({ status: 'aborted' });
    } catch (error) {
        console.error('Error stopping schedule:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export schedules as downloadable JSON
app.get('/api/schedules/export', async (req, res) => {
    try {
        const schedules = await scheduler.getAll();
        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const filename = `schedules-backup-${timestamp}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(schedules);

        console.log(`[API] Schedules exported: ${schedules.length} items`);
    } catch (error) {
        console.error('Error exporting schedules:', error);
        res.status(500).json({ error: error.message });
    }
});

// Import schedules from uploaded JSON (merge strategy)
app.post('/api/schedules/import', express.json(), async (req, res) => {
    try {
        const importedSchedules = req.body;

        if (!Array.isArray(importedSchedules)) {
            return res.status(400).json({ error: 'Invalid format: expected array of schedules' });
        }

        const existingSchedules = await scheduler.getAll();
        const existingIds = new Set(existingSchedules.map(s => s.id));

        // Merge: only add schedules that don't exist
        const newSchedules = importedSchedules.filter(s => !existingIds.has(s.id));
        const mergedSchedules = [...existingSchedules, ...newSchedules];

        // Save and restart tasks
        const fs = await import('fs/promises');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');

        await fs.writeFile(SCHEDULES_FILE, JSON.stringify(mergedSchedules, null, 2));

        // Restart scheduler to pick up new schedules
        newSchedules.forEach(schedule => {
            if (schedule.enabled) scheduler.startTask(schedule);
        });

        console.log(`[API] Schedules imported: ${newSchedules.length} new, ${existingSchedules.length} existing`);
        res.json({
            success: true,
            imported: newSchedules.length,
            skipped: importedSchedules.length - newSchedules.length,
            total: mergedSchedules.length
        });
    } catch (error) {
        console.error('Error importing schedules:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/wfd/:workflowId
app.get('/api/wfd/:workflowId', async (req, res) => {
    try {
        const { workflowId } = req.params;
        const filePath = path.join(WFD_DIR, `${workflowId}.json`);
        const content = await fs.readFile(filePath, 'utf8');
        res.json(JSON.parse(content));
    } catch (err) {
        res.status(404).json({ error: 'WFD not found' });
    }
});

// POST /api/wfd/:workflowId
app.post('/api/wfd/:workflowId', express.json({ limit: '10mb' }), async (req, res) => {
    try {
        const { workflowId } = req.params;
        const definition = req.body;
        if (!definition) {
            return res.status(400).json({ error: 'Missing definition body' });
        }
        const filePath = path.join(WFD_DIR, `${workflowId}.json`);
        await fs.writeFile(filePath, JSON.stringify(definition, null, 2), 'utf8');
        console.log(`[WFD] Saved definition for workflow: ${workflowId}`);
        res.json({ status: 'ok' });
    } catch (err) {
        console.error(`[WFD] Failed to save definition:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/wfd/:workflowId
app.delete('/api/wfd/:workflowId', async (req, res) => {
    try {
        const { workflowId } = req.params;
        const filePath = path.join(WFD_DIR, `${workflowId}.json`);
        await fs.rm(filePath, { force: true });
        console.log(`[WFD] Deleted definition for workflow: ${workflowId}`);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----------------------------------------------------------------------------
// 4. Server Start (Conditional)
// ----------------------------------------------------------------------------

// Only start the server if running directly (e.g., node proxy-server.js)
// If imported by Netlify Functions, we just export the app.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`===============================================`);
        console.log(`   Dynamic Proxy Server Running`);
        console.log(`   Port: ${PORT}`);
        console.log(`   Mode: Development / Audit`);
        console.log(`===============================================`);
    });
    server.setTimeout(300000); // 5 minutes timeout to handle slow DocuWare responses
}

// Export app for Serverless usage (Netlify)
export default app;
