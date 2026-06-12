import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { tokenManager } from './tokenManager.js';
import sql from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const HISTORY_TMP_FILE = HISTORY_FILE + '.tmp';
const EXPORTS_DIR = path.join(__dirname, 'exports');

// --- MUTEX QUEUE for history.json ---
// All reads AND writes to history.json are serialized through this queue.
// This prevents race conditions when multiple exports finish concurrently.
let _historyLockPromise = Promise.resolve();
function withHistoryLock(fn) {
    _historyLockPromise = _historyLockPromise.then(() => fn()).catch(() => fn());
    return _historyLockPromise;
}

// Atomic write: write to .tmp, then rename (rename is atomic on most OS/filesystems)
async function atomicWriteHistory(data) {
    await fs.writeFile(HISTORY_TMP_FILE, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(HISTORY_TMP_FILE, HISTORY_FILE);
}

// Ensure exports directory exists
if (!process.env.NETLIFY) {
    try {
        await fs.mkdir(EXPORTS_DIR, { recursive: true });
    } catch (e) {
        console.error('Failed to create exports dir:', e);
    }

    const initHistory = async () => {
        try {
            await fs.access(HISTORY_FILE);
        } catch {
            try {
                await fs.writeFile(HISTORY_FILE, '[]');
            } catch (err) {
                console.error('Failed to write history file:', err.message);
            }
        }
    };
    initHistory();
}

const tasks = new Map();
const runningTasks = new Map(); // Tracks active executions: scheduleId -> { abort: boolean }

export const scheduler = {
    init: async () => {
        try {
            const data = await fs.readFile(SCHEDULES_FILE, 'utf-8');
            const schedules = JSON.parse(data);
            console.log(`[Scheduler] Loaded ${schedules.length} schedules.`);
            schedules.forEach(schedule => {
                if (schedule.enabled) scheduler.startTask(schedule);
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.writeFile(SCHEDULES_FILE, '[]');
            } else {
                console.error('[Scheduler] Error loading schedules:', error);
            }
        }
    },

    getAll: async () => {
        try {
            const data = await fs.readFile(SCHEDULES_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    },

    getHistory: async () => {
        return withHistoryLock(async () => {
            try {
                const data = await fs.readFile(HISTORY_FILE, 'utf-8');
                return JSON.parse(data)
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                    .slice(0, 50);
            } catch (err) {
                console.error('[Scheduler] Failed to read history:', err);
                return [];
            }
        });
    },

    log: async (scheduleId, scheduleName, status, message) => {
        const entry = {
            id: crypto.randomUUID(),
            scheduleId,
            scheduleName,
            status,
            message,
            timestamp: new Date().toISOString()
        };
        return withHistoryLock(async () => {
            try {
                let history = [];
                try {
                    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
                    history = JSON.parse(data);
                } catch (readErr) {
                    // If the file is corrupted or missing, start fresh
                    console.warn('[Scheduler] history.json unreadable, resetting. Reason:', readErr.message);
                    history = [];
                }
                history.push(entry);
                // Keep max 500 entries
                if (history.length > 500) history.splice(0, history.length - 500);
                await atomicWriteHistory(history);
            } catch (err) {
                console.error('[Scheduler] Failed to write log:', err);
            }
        });
    },

    save: async (schedule) => {
        const schedules = await scheduler.getAll();
        const index = schedules.findIndex(s => s.id === schedule.id);
        if (index >= 0) {
            schedules[index] = schedule;
            scheduler.stopTask(schedule.id);
        } else {
            schedules.push(schedule);
        }
        await fs.writeFile(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
        if (schedule.enabled) scheduler.startTask(schedule);
        return schedule;
    },

    // updateSchedule function removed (not needed)

    delete: async (id) => {
        let schedules = await scheduler.getAll();
        schedules = schedules.filter(s => s.id !== id);
        await fs.writeFile(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
        scheduler.stopTask(id);
    },

    startTask: (schedule) => {
        if (!cron.validate(schedule.cronExpression)) {
            console.error(`[Scheduler] Invalid cron expression for ${schedule.name}`);
            return;
        }
        console.log(`[Scheduler] Starting task: ${schedule.name} (${schedule.cronExpression})`);

        const task = cron.schedule(schedule.cronExpression, async () => {
            console.log(`[Scheduler] ⏰ Triggering export for: ${schedule.name}`);
            await scheduler.log(schedule.id, schedule.name, 'RUNNING', 'Iniciando exportação...');
            try {
                const result = await executeExport(schedule, false); // isManual = false
                await scheduler.log(schedule.id, schedule.name, 'SUCCESS', `Sucesso. ${result.docCount} docs com ${result.lineCount} linhas.`);
                console.log(`[Scheduler] ✅ Export completed: ${schedule.name}`);
            } catch (error) {
                await scheduler.log(schedule.id, schedule.name, 'ERROR', `Falha: ${error.message}`);
                console.error(`[Scheduler] ❌ Export failed for ${schedule.name}:`, error.message);
            }
        });
        tasks.set(schedule.id, task);
    },

    stopTask: (id) => {
        if (tasks.has(id)) {
            tasks.get(id).stop();
            tasks.delete(id);
            console.log(`[Scheduler] Stopped task: ${id}`);
        }
        // Also ensure running export is aborted if any
        scheduler.abortExport(id);
    },

    forceRun: async (scheduleId) => {
        const schedules = await scheduler.getAll();
        const schedule = schedules.find(s => s.id === scheduleId);
        if (!schedule) throw new Error('Schedule not found');

        console.log(`[Scheduler] Force running: ${schedule.name}`);
        // Run async without awaiting to not block response
        (async () => {
            console.log(`[Scheduler] ⏰ Manual trigger for: ${schedule.name}`);
            await scheduler.log(schedule.id, schedule.name, 'RUNNING', 'Iniciando exportação manual...');
            try {
                const result = await executeExport(schedule, true); // isManual = true
                await scheduler.log(schedule.id, schedule.name, 'SUCCESS', `Sucesso. ${result.docCount} docs com ${result.lineCount} linhas.`);
                console.log(`[Scheduler] ✅ Manual Export completed: ${schedule.name}`);
            } catch (error) {
                if (error.message === 'ABORTED') {
                    await scheduler.log(schedule.id, schedule.name, 'ERROR', `Cancelado pelo usuário.`);
                    console.log(`[Scheduler] 🛑 Export aborted: ${schedule.name}`);
                } else {
                    await scheduler.log(schedule.id, schedule.name, 'ERROR', `Falha: ${error.message}`);
                    console.error(`[Scheduler] ❌ Export failed for ${schedule.name}:`, error.message);
                }
            }
        })();
        return { status: 'started' };
    },

    abortExport: (scheduleId) => {
        if (runningTasks.has(scheduleId)) {
            console.log(`[Scheduler] Aborting export for ${scheduleId}`);
            const state = runningTasks.get(scheduleId);
            state.abort = true;
            return true;
        }
        return false;
    },

    getRunningFiles: () => {
        return Array.from(runningTasks.keys());
    },

    getHistoryAll: async () => {
        return withHistoryLock(async () => {
            try {
                const data = await fs.readFile(HISTORY_FILE, 'utf-8');
                return JSON.parse(data).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            } catch (err) {
                console.error('[Scheduler] Failed to read full history:', err);
                return [];
            }
        });
    },

    clearHistory: async () => {
        return withHistoryLock(async () => {
            await atomicWriteHistory([]);
            console.log('[Scheduler] History cleared.');
        });
    },

    generateCsvFromSearch: async (authInfo, cabinetId, filters) => {
        console.log(`[Scheduler] Generating on-the-fly CSV for cabinet ${cabinetId}`);
        const token = null; // Token handled by manager

        // 1. Search Documents
        const documents = await searchDocuWare(token, authInfo.url, cabinetId, filters);

        if (!documents || documents.length === 0) {
            return { csvString: '', count: 0 };
        }

        // 2. Fetch History through Process in batches
        const allRows = [];
        const dynamicFields = new Set();
        const BATCH_SIZE = 50;

        console.log(`[Scheduler] Fetching history for ${documents.length} docs in batches of ${BATCH_SIZE}...`);

        const CONCURRENCY = 5;
        for (let i = 0; i < documents.length; i += BATCH_SIZE) {
            const batch = documents.slice(i, i + BATCH_SIZE);

            // Process the batch in smaller parallel chunks to speed up but stay safe
            for (let j = 0; j < batch.length; j += CONCURRENCY) {
                const chunk = batch.slice(j, j + CONCURRENCY);
                const docIndexBase = i + j;

                const chunkResults = await Promise.all(chunk.map(async (doc, idx) => {
                    const docIndex = docIndexBase + idx + 1;
                    const docId = doc.Id;
                    console.log(`[Scheduler] Processing doc ${docIndex}/${documents.length} (ID: ${docId})...`);

                    const docFields = {};
                    if (doc.Fields) {
                        doc.Fields.forEach(f => {
                            const val = f.Item || f.Int || f.Decimal || f.Date || f.DateTime || '';
                            docFields[f.FieldName] = val;
                            dynamicFields.add(f.FieldName);
                        });
                    }

                    try {
                        const history = await getDocumentHistory(token, authInfo.url, cabinetId, docId);
                        const instances = processHistoryIntoInstances(history);
                        if (instances.length === 0) {
                            return [{
                                'Instance GUID': '', 'DOCID': docId, 'Instância': 'Sem Histórico', 'Versão': '', 'Iniciado Em': '',
                                'Atividade': '', 'Tipo Atividade': '', 'Data Início Tarefa': '', 'Decisão': '', 'Usuário': '', 'Data Decisão': '',
                                'Link Documento': getDocumentViewUrl(authInfo.url, authInfo.organizationId, cabinetId, docId), ...docFields
                            }];
                        }

                        const docRows = [];
                        instances.sort((a, b) => (b.Version || 0) - (a.Version || 0));
                        instances.forEach(instance => {
                            const steps = instance.HistorySteps || [];
                            if (steps.length === 0) {
                                docRows.push({
                                    'Instance GUID': instance.Id, 'DOCID': docId, 'Instância': instance.Name, 'Versão': instance.Version,
                                    'Iniciado Em': formatDate(instance.StartDate), 'Atividade': '(Sem passos)',
                                    'Link Documento': getDocumentViewUrl(authInfo.url, authInfo.organizationId, cabinetId, docId), ...docFields
                                });
                            } else {
                                steps.forEach(step => {
                                    const infoItem = step.Info?.Item || {};
                                    let validUser = infoItem.UserName || step.User || step.UserName || '';
                                    if (!validUser && infoItem.AssignedUsers && Array.isArray(infoItem.AssignedUsers)) validUser = infoItem.AssignedUsers.join(', ');
                                    const validDate = infoItem.DecisionDate || step.StepDate || step.TimeStamp || '';
                                    const validDecision = infoItem.DecisionName || step.DecisionLabel || '';
                                    const stepStartDate = step.StepDate || '';
                                    docRows.push({
                                        'Instance GUID': instance.Id, 'DOCID': docId, 'Instância': instance.Name, 'Versão': instance.Version,
                                        'Iniciado Em': formatDate(instance.StartDate), 'Atividade': step.ActivityName || step.Name,
                                        'Tipo Atividade': step.ActivityType, 'Data Início Tarefa': formatDate(stepStartDate),
                                        'Decisão': validDecision, 'Usuário': validUser, 'Data Decisão': formatDate(validDate),
                                        'Link Documento': getDocumentViewUrl(authInfo.url, authInfo.organizationId, cabinetId, docId), ...docFields
                                    });
                                });
                            }
                        });
                        return docRows;
                    } catch (err) {
                        console.error(`[Scheduler] Error fetching history for ${docId}:`, err.message);
                        return [{ 'DOCID': docId, 'Instância': 'ERRO AO BUSCAR HISTÓRICO', ...docFields }];
                    }
                }));

                chunkResults.forEach(res => { if (res) allRows.push(...res); });
            }
        }

        // 3. Prepare Schema
        const sortedDynamic = Array.from(dynamicFields).sort();
        const fixedHeaders = [
            'Instance GUID', 'DOCID', 'Instância', 'Versão', 'Iniciado Em',
            'Atividade', 'Tipo Atividade', 'Data Início Tarefa', 'Decisão', 'Usuário', 'Data Decisão', 'Link Documento'
        ];
        const allHeaders = [...fixedHeaders, ...sortedDynamic];

        // 4. Generate CSV String
        const escapeCsv = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(';') || str.includes('\"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
            return str;
        };

        const headerRow = allHeaders.map(escapeCsv).join(';');
        const csvRows = allRows.map(row => allHeaders.map(header => {
            let val = row[header];
            if (val && typeof val === 'string' && val.includes('/Date(')) val = formatDate(val);
            return escapeCsv(val);
        }).join(';'));

        const csvContent = '\ufeff' + [headerRow, ...csvRows].join('\n');

        return { csvString: csvContent, count: allRows.length };
    }
};

// --- CORE EXPORT LOGIC ---

async function executeExport(schedule, isManual = false) {
    // Register execution start
    const runState = { abort: false };
    runningTasks.set(schedule.id, runState);

    try {
        const { auth, cabinetId, filters, name } = schedule;

        if (!auth || !auth.refreshToken) throw new Error("Missing auth credentials (refresh token)");

        const token = null; // Token handled by manager

        // 2. Search Documents
        const documents = await searchDocuWare(token, auth.url, cabinetId, filters);

        if (!documents || documents.length === 0) {
            console.log(`[Scheduler] No documents found for ${name}.`);
            return { lineCount: 0, docCount: 0 };
        }

        console.log(`[Scheduler] Found ${documents.length} docs. Fetching history for each...`);

        // 3. Fetch History through Process in batches
        const allRows = [];
        const dynamicFields = new Set();
        const BATCH_SIZE = 50; // Aumentado de 5 para 50 para maior concorrência e velocidade

        console.log(`[Scheduler] Fetching history for ${documents.length} docs in batches of ${BATCH_SIZE}...`);

        for (let i = 0; i < documents.length; i += BATCH_SIZE) {
            if (runState.abort) throw new Error('ABORTED');

            const batch = documents.slice(i, i + BATCH_SIZE);
            console.log(`[Scheduler] Exporting docs ${i + 1} to ${Math.min(i + BATCH_SIZE, documents.length)} of ${documents.length}`);

            const batchResults = [];
            const CONCURRENCY = 5;
            for (let j = 0; j < batch.length; j += CONCURRENCY) {
                const chunk = batch.slice(j, j + CONCURRENCY);

                const chunkResults = await Promise.all(chunk.map(async (doc) => {
                    const docId = doc.Id;
                    const docFields = {};
                    if (doc.Fields) {
                        doc.Fields.forEach(f => {
                            const val = f.Item || f.Int || f.Decimal || f.Date || f.DateTime || '';
                            docFields[f.FieldName] = val;
                            dynamicFields.add(f.FieldName);
                        });
                    }
                    try {
                        const history = await getDocumentHistory(token, auth.url, cabinetId, docId);
                        const instances = processHistoryIntoInstances(history);
                        if (instances.length === 0) {
                            return [{
                                'Instance GUID': '', 'DOCID': docId, 'Instância': 'Sem Histórico', 'Versão': '', 'Iniciado Em': '',
                                'Atividade': '', 'Tipo Atividade': '', 'Data Início Tarefa': '', 'Decisão': '', 'Usuário': '', 'Data Decisão': '',
                                'Link Documento': getDocumentViewUrl(auth.url, auth.organizationId, cabinetId, docId), ...docFields
                            }];
                        }
                        const docRows = [];
                        instances.sort((a, b) => (b.Version || 0) - (a.Version || 0));
                        instances.forEach(instance => {
                            const steps = instance.HistorySteps || [];
                            if (steps.length === 0) {
                                docRows.push({
                                    'Instance GUID': instance.Id, 'DOCID': docId, 'Instância': instance.Name, 'Versão': instance.Version,
                                    'Iniciado Em': formatDate(instance.StartDate), 'Atividade': '(Sem passos)',
                                    'Link Documento': getDocumentViewUrl(auth.url, auth.organizationId, cabinetId, docId), ...docFields
                                });
                            } else {
                                steps.forEach(step => {
                                    const infoItem = step.Info?.Item || {};
                                    let validUser = infoItem.UserName || step.User || step.UserName || '';
                                    if (!validUser && infoItem.AssignedUsers && Array.isArray(infoItem.AssignedUsers)) validUser = infoItem.AssignedUsers.join(', ');
                                    const validDate = infoItem.DecisionDate || step.StepDate || step.TimeStamp || '';
                                    const validDecision = infoItem.DecisionName || step.DecisionLabel || '';
                                    const stepStartDate = step.StepDate || '';
                                    docRows.push({
                                        'Instance GUID': instance.Id, 'DOCID': docId, 'Instância': instance.Name, 'Versão': instance.Version,
                                        'Iniciado Em': formatDate(instance.StartDate), 'Atividade': step.ActivityName || step.Name,
                                        'Tipo Atividade': step.ActivityType, 'Data Início Tarefa': formatDate(stepStartDate),
                                        'Decisão': validDecision, 'Usuário': validUser, 'Data Decisão': formatDate(validDate),
                                        'Link Documento': getDocumentViewUrl(auth.url, auth.organizationId, cabinetId, docId), ...docFields
                                    });
                                });
                            }
                        });
                        return docRows;
                    } catch (err) {
                        console.error(`[Scheduler] Error fetching history for ${docId}:`, err.message);
                        return [{ 'DOCID': docId, 'Instância': 'ERRO AO BUSCAR HISTÓRICO', ...docFields }];
                    }
                }));
                chunkResults.forEach(res => { if (res) allRows.push(...res); });
            }
        }

        // --- VALIDATION (VOLUME CHECK) ---
        // Rule: If new count < 50% of last count, ABORT unless isManual is true.
        const currentCount = allRows.length;
        const lastCount = schedule.lastLineCount || 0;

        console.log(`[Scheduler] 📊 Validation: New=${currentCount}, Last=${lastCount}`);

        if (lastCount > 0 && currentCount < (lastCount * 0.5)) {
            const msg = `⚠️ Volume Validation Failed: Row count dropped from ${lastCount} to ${currentCount} (-${Math.round((1 - currentCount / lastCount) * 100)}%)`;
            if (!isManual) {
                console.error(`[Scheduler] ${msg}. Aborting automated export.`);
                throw new Error(msg); // Abort
            } else {
                console.warn(`[Scheduler] ${msg}. Proceeding due to MANUAL override.`);
                await scheduler.log(schedule.id, schedule.name, 'WARNING', msg + " (Manual Override)");
            }
        }

        // Prepare Schema
        const sortedDynamic = Array.from(dynamicFields).sort();
        const fixedHeaders = [
            'Instance GUID', 'DOCID', 'Instância', 'Versão', 'Iniciado Em',
            'Atividade', 'Tipo Atividade', 'Data Início Tarefa', 'Decisão', 'Usuário', 'Data Decisão', 'Link Documento'
        ];
        const allHeaders = [...fixedHeaders, ...sortedDynamic];

        // --- EXPORT HANDLING ---
        const isSql = schedule.storageConfig?.type === 'sqlserver';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        // Sanitize Name for folders
        const sanitize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const safeProfileName = sanitize(name);

        if (isSql) {
            console.log(`[Scheduler] 🗄️ Starting SQL Export for: ${name}`);
            const sqlConfig = schedule.storageConfig.sql;
            if (!sqlConfig || !sqlConfig.server || !sqlConfig.table) throw new Error('Invalid SQL Configuration');

            const pool = await sql.connect({
                user: sqlConfig.user, password: sqlConfig.password, server: sqlConfig.server,
                port: parseInt(sqlConfig.port) || 1433, database: sqlConfig.database,
                options: { encrypt: false, trustServerCertificate: true }
            });
            const tableName = sqlConfig.table;

            // 1. Transaction: TRUNCATE + INSERT
            const transaction = new sql.Transaction(pool);
            try {
                await transaction.begin();

                // CLEAR TABLE — usar request próprio (nunca reutilizar request entre queries distintas)
                // Usando DELETE em vez de TRUNCATE para evitar problemas de permissão (ALTER) em produção
                console.log(`[Scheduler] 🧹 Clearing table [${tableName}]...`);
                await new sql.Request(transaction).query(`DELETE FROM [${tableName}]`);

                // Prepare Columns
                // --- FILTER COLUMNS AGAINST DB SCHEMA (Fuzzy Match) ---
                // Usar request SEPARADO com parâmetro para o schema lookup
                let validHeaders = [];
                try {
                    const schemaRequest = new sql.Request(transaction);
                    schemaRequest.input('tableName', sql.VarChar, tableName);
                    const schemaResult = await schemaRequest.query(
                        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName`
                    );
                    const dbColumnsList = schemaResult.recordset.map(r => r.COLUMN_NAME);
                    const dbColumnsNormalized = new Map();
                    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
                    dbColumnsList.forEach(col => dbColumnsNormalized.set(normalize(col), col));
                    const seenSqlColumns = new Set();
                    allHeaders.forEach(h => {
                        const normH = normalize(h);
                        if (dbColumnsNormalized.has(normH)) {
                            const sqlCol = dbColumnsNormalized.get(normH);
                            if (!seenSqlColumns.has(sqlCol)) {
                                seenSqlColumns.add(sqlCol);
                                validHeaders.push({ dwField: h, sqlColumn: sqlCol });
                            }
                        }
                    });
                    if (validHeaders.length === 0) validHeaders = allHeaders.map(h => ({ dwField: h, sqlColumn: h }));
                } catch (schemaErr) {
                    console.warn(`[Scheduler] Schema lookup failed, using raw headers: ${schemaErr.message}`);
                    validHeaders = allHeaders.map(h => ({ dwField: h, sqlColumn: h }));
                }

                const columns = validHeaders.map(pair => `[${pair.sqlColumn}]`);
                const SQL_BATCH_SIZE = 100;
                let sqlScriptContent = `-- Export Date: ${new Date().toISOString()}\n-- Profile: ${name}\n-- Rows: ${allRows.length}\n\nDELETE FROM [${tableName}];\n\n`;

                for (let i = 0; i < allRows.length; i += SQL_BATCH_SIZE) {
                    if (runState.abort) throw new Error('ABORTED');
                    const batch = allRows.slice(i, i + SQL_BATCH_SIZE);
                    const valuesList = batch.map(row => {
                        const rowValues = validHeaders.map(pair => {
                            let val = row[pair.dwField];
                            if (val === null || val === undefined) return 'NULL';
                            if (typeof val === 'string') {
                                if (val.includes('/Date(')) val = formatDate(val);
                                return `'${val.replace(/'/g, "''")}'`;
                            }
                            return `'${val}'`;
                        });
                        return `(${rowValues.join(',')})`;
                    });

                    const insertQuery = `INSERT INTO [${tableName}] (${columns.join(',')}) VALUES ${valuesList.join(',')}`;
                    // Usar request NOVO para cada batch — evita estado corrompido entre execuções
                    await new sql.Request(transaction).query(insertQuery);

                    // Append to SQL Script
                    sqlScriptContent += insertQuery + ";\n";
                }

                await transaction.commit();
                console.log(`[Scheduler] ✅ SQL Transaction Committed. ${allRows.length} rows inserted.`);

                // 2. Save .sql File History
                const historyDir = path.join(EXPORTS_DIR, 'Histórico de exportações SQL', safeProfileName);
                await fs.mkdir(historyDir, { recursive: true });
                const sqlFilePath = path.join(historyDir, `export_${timestamp}.sql`);
                await fs.writeFile(sqlFilePath, sqlScriptContent, 'utf-8');
                console.log(`[Scheduler] 📜 SQL History saved: ${sqlFilePath}`);

                // 3. Cleanup Old Files (10 days)
                cleanupOldFiles(historyDir, 10);

            } catch (sqlErr) {
                // Não tentar rollback se foi cancelamento do usuário (sem queries SQL executadas)
                // ou se o SQL Server já abortou a transação internamente
                if (sqlErr.message !== 'ABORTED') {
                    try {
                        await transaction.rollback();
                        console.error('[Scheduler] ❌ SQL Transaction Rolled Back:', sqlErr.message);
                    } catch (rollbackErr) {
                        // Rollback pode falhar se a transação já foi abortada pelo servidor — logar e ignorar
                        console.error('[Scheduler] ❌ Rollback also failed (transaction already aborted):', rollbackErr.message);
                    }
                }
                throw sqlErr;
            } finally {
                try { pool.close(); } catch (_) { }
            }

            // Update stats
            schedule.lastLineCount = allRows.length;
            await scheduler.save(schedule); // Persist stats check logic

            return { lineCount: allRows.length, docCount: documents.length };

        } else {
            // CSV Export Logic (Reduced for brevity, identical to before but ensuring consistency)
            const schedules = await scheduler.getAll();
            const scheduleIndex = schedules.findIndex(s => s.id === schedule.id) + 1;
            const cabinetName = schedule.cabinetName || schedule.cabinetId || 'unknown_cabinet';
            const docType = (filters && filters.length > 0) ? (filters.find(f => f.fieldName.toLowerCase().includes('type'))?.value || filters[0].value) : 'all_docs';
            // Construct Folder Name: {Index}_{ScheduleName}_{CabinetName}_{DocumentType}
            const folderName = `${scheduleIndex}_${safeProfileName}_${sanitize(cabinetName)}_${sanitize(docType)}`;
            const scheduleDir = path.join(EXPORTS_DIR, 'Exportações CSV', folderName);
            await fs.mkdir(scheduleDir, { recursive: true });
            const filename = `${folderName}_${timestamp}.csv`;
            const filePath = path.join(scheduleDir, filename);

            const escapeCsv = (val) => {
                if (val === null || val === undefined) return '';
                const str = String(val);
                if (str.includes(';') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
                return str;
            };
            const headerRow = allHeaders.map(escapeCsv).join(';');
            const csvRows = allRows.map(row => allHeaders.map(header => {
                let val = row[header];
                if (val && typeof val === 'string' && val.includes('/Date(')) val = formatDate(val);
                return escapeCsv(val);
            }).join(';'));

            const csvContent = '\ufeff' + [headerRow, ...csvRows].join('\n');
            await fs.writeFile(filePath, csvContent, 'utf-8');

            // Update stats
            schedule.lastLineCount = allRows.length;
            await scheduler.save(schedule);

            return { lineCount: csvRows.length, docCount: documents.length };
        }
    } finally {
        runningTasks.delete(schedule.id);
    }
}

// Helper for Cleanup
async function cleanupOldFiles(dir, days) {
    try {
        const files = await fs.readdir(dir);
        const now = Date.now();
        const maxAge = days * 24 * 60 * 60 * 1000;

        for (const file of files) {
            const filePath = path.join(dir, file);
            const stats = await fs.stat(filePath);
            if (now - stats.mtimeMs > maxAge) {
                await fs.unlink(filePath);
                console.log(`[Scheduler] 🗑️ Deleted old history file: ${file}`);
            }
        }
    } catch (e) {
        console.warn(`[Scheduler] Cleanup warning: ${e.message}`);
    }
}

// --- HELPER FUNCTIONS ---

/**
 * Execute an async operation with smart retry logic for 401 errors.
 * If a 401 occurs, it attempts to refresh the token and retry the operation.
 */
async function executeWithRetry(operationName, operationFn) {
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
        try {
            return await operationFn();
        } catch (error) {
            attempt++;

            // Check for 401 Unauthorized
            const isAuthError = error.response && error.response.status === 401;

            if (isAuthError) {
                console.warn(`[Scheduler] ⚠️ 401 Unauthorized during '${operationName}'. Refreshing token (Attempt ${attempt}/${MAX_RETRIES})...`);
                try {
                    // Force a token refresh
                    await tokenManager.refreshAccessToken();
                    console.log(`[Scheduler] 🔄 Token refreshed. Retrying '${operationName}'...`);
                    continue; // Retry loop immediately
                } catch (refreshError) {
                    console.error(`[Scheduler] ❌ Failed to refresh token during retry: ${refreshError.message}`);
                    throw refreshError; // If refresh fails, we can't continue
                }
            }

            // If it's not a 401, or if we ran out of retries
            if (attempt >= MAX_RETRIES) {
                console.error(`[Scheduler] ❌ '${operationName}' failed after ${MAX_RETRIES} attempts.`);
                throw error;
            }

            // Optional: wait a bit before retrying non-auth errors?
            // For now, only retrying auth errors immediately. 
            // If we want to retry 500s, we could add logic here.
            throw error;
        }
    }
}

// Token refresh is now handled by tokenManager
// async function refreshAccessToken(auth) { ... }

async function searchDocuWare(token, baseUrl, cabinetId, filters) {
    return executeWithRetry('Search DocuWare', async () => {
        const currentToken = await tokenManager.getAccessToken();
        const headers = {
            Authorization: `Bearer ${currentToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
        };

        try {
            const dialogsRes = await axios.get(
                `${baseUrl}/DocuWare/Platform/FileCabinets/${cabinetId}/Dialogs`,
                { headers }
            );
            const searchDialog = dialogsRes.data.Dialog.find(d => d.Type === 'Search') || dialogsRes.data.Dialog[0];
            if (!searchDialog) throw new Error("No search dialog found");

            const conditions = filters.map(filter => {
                let value = Array.isArray(filter.value) ? [...filter.value] : [filter.value];
                // Handle open-ended date ranges
                if (value.length === 2) {
                    if (value[0] && !value[1]) value[1] = '2099-12-31';
                    if (!value[0] && value[1]) value[0] = '1900-01-01';
                }
                return { DBName: filter.fieldName, Value: value };
            });

            const query = { Condition: conditions, Operation: 'And' };

            // Paginate: fetch in blocks of 1000 until no more items
            const PAGE_SIZE = 1000;
            let allItems = [];
            let start = 0;

            while (true) {
                const url = `${baseUrl}/DocuWare/Platform/FileCabinets/${cabinetId}/Query/DialogExpression`
                    + `?dialogId=${searchDialog.Id}&count=${PAGE_SIZE}&start=${start}`;

                const searchRes = await axios.post(url, query, { headers });
                const items = searchRes.data.Items || [];
                allItems = allItems.concat(items);
                console.log(`[Scheduler] Search page start=${start}: got ${items.length} items (total so far: ${allItems.length})`);

                if (items.length < PAGE_SIZE) break; // Last page
                start += items.length;
            }

            return allItems;
        } catch (err) {
            if (err.response) {
                if (err.response.status !== 401) {
                    console.error('[Scheduler] Search Failed:', JSON.stringify(err.response.data));
                }
                throw err;
            }
            throw err;
        }
    });
}

/**
 * REPLACEMENT: Mimic workflowAnalyticsService.getHistoryByDocId
 * Fetches Workflow Instances explicitly, then their steps.
 */
async function getDocumentHistory(token, baseUrl, cabinetId, docId) {
    return executeWithRetry(`Get History ${docId}`, async () => {
        const currentToken = await tokenManager.getAccessToken(); // Retry safe

        try {
            // 1. Fetch Workflow Instances for this Document
            // Endpoint: /DocuWare/Platform/Workflow/Instances/DocumentHistory?fileCabinetId=...&documentId=...
            const historyUrl = `${baseUrl}/DocuWare/Platform/Workflow/Instances/DocumentHistory`;

            const response = await axios.get(historyUrl, {
                headers: { Authorization: `Bearer ${currentToken}` },
                params: {
                    fileCabinetId: cabinetId,
                    documentId: docId
                }
            });

            // The response contains "InstanceHistory" (Array)
            const instances = response.data.InstanceHistory || response.data || [];

            if (!Array.isArray(instances) || instances.length === 0) {
                return [];
            }

            // 2. For each instance, fetch the Detailed History (Steps) sequentially
            const instancesWithSteps = [];
            for (const inst of instances) {
                try {
                    // Construct Steps URL explicitly to avoid 403 errors from bad HATEOAS links
                    // We must use the base URL and the exact instance path.
                    let stepsUrl = `${baseUrl}/DocuWare/Platform/Workflow/Workflows/${inst.WorkflowId}/Instances/${inst.Id}/History`;

                    const stepsRes = await axios.get(stepsUrl, {
                        headers: { Authorization: `Bearer ${currentToken}` }
                    });

                    instancesWithSteps.push({
                        ...inst,
                        HistorySteps: stepsRes.data.HistorySteps || stepsRes.data || []
                    });
                } catch (stepErr) {
                    console.warn(`[Scheduler] Failed steps fetch for inst ${inst.Id}: ${stepErr.message}`);
                    instancesWithSteps.push({ ...inst, HistorySteps: [] });
                }
            }

            return instancesWithSteps;

        } catch (err) {
            // If 404, just means no workflow history usually
            if (err.response && err.response.status === 404) return [];
            // If 401, rethrow to trigger retry
            if (err.response && err.response.status === 401) throw err;

            console.error(`[Scheduler] Workflow History Error for ${docId}:`, err.message);
            throw err;
        }
    });
}

// Helper to structure request history (Pass-through since we now return structure from getDocumentHistory)
function processHistoryIntoInstances(historyList) {
    // The previous version tried to group a flat list.
    // The NEW getDocumentHistory returns exactly the structure we want:
    // [ { ...Instance, HistorySteps: [...] }, ... ]

    // So we just mapping fields to ensure capitalization matches what the main loop expects
    return historyList.map(inst => ({
        Id: inst.Id,
        Name: inst.WorkflowName || inst.Name || 'Workflow',
        Version: inst.WorkflowVersion || inst.Version || 1,
        StartDate: inst.StartedAt || inst.TimeStamp,
        HistorySteps: inst.HistorySteps || []
    }));
}

function formatDate(dateString) {
    if (!dateString) return null; // Return null effectively for SQL
    let d;
    if (typeof dateString === 'string' && dateString.startsWith('/Date(')) {
        const timestamp = parseInt(dateString.match(/-?\d+/)[0]);
        d = new Date(timestamp);
    } else {
        d = new Date(dateString);
    }

    if (!isNaN(d.getTime())) {
        // Filter out "min value" dates (e.g., year 1 or anything unreasonably old for this system)
        if (d.getFullYear() < 2000) return '';

        // Return ISO format YYYY-MM-DDTHH:mm:ss.sssZ which SQL Server 2008+ handles well,
        // OR return 'YYYY-MM-DD HH:mm:ss' which is safer for older SQL/configurations.
        // Let's use simple ISO string, slice off the 'Z' to avoid time zone confusion if server assumes local,
        // BUT best practice is full ISO. SQL Server 'datetime' type might choke on 'T'.
        // Safe bet: 'YYYY-MM-DD HH:mm:ss'
        return d.toISOString().replace('T', ' ').substring(0, 16);
    }
    return null;
}

function getDocumentViewUrl(baseUrl, orgId, cabinetId, docId) {
    // Basic view URL construction
    // We don't have a login token here for SSO easily without re-authenticating as user.
    // So we return the direct link.
    // Use fallback orgId if not saved?
    const validOrgId = orgId || 'bcb91903-58eb-49c6-8572-be5e3bb9611e'; // Default
    return `${baseUrl}/DocuWare/Platform/WebClient/${validOrgId}/Integration?fc=${cabinetId}&did=${docId}&p=V`;
}
