/**
 * WorkflowHistoryAnalyzer
 * Normalizes, cleans, and analyzes document workflow execution logs.
 * Computes processing times, cleans up dates, and flags active states.
 */
export const WorkflowHistoryAnalyzer = {
    /**
     * Parses and computes metrics for chronological workflow steps
     * @param {Array} historySteps - Array of raw history steps from DocuWare
     * @returns {Array} Normalized history steps
     */
    analyze: (historySteps) => {
        if (!historySteps || !Array.isArray(historySteps)) return [];

        const parseDWDate = (dateStr) => {
            if (!dateStr) return null;
            let dateObj = null;

            if (typeof dateStr === 'string' && dateStr.startsWith('/Date(')) {
                const match = dateStr.match(/-?\d+/); // Support negative numbers
                if (match) {
                    const timestamp = parseInt(match[0]);
                    if (timestamp <= 0) return null; // Ignore placeholder dates like year 0001
                    dateObj = new Date(timestamp);
                }
            } else {
                dateObj = new Date(dateStr);
            }

            if (!dateObj || isNaN(dateObj.getTime())) return null;

            const year = dateObj.getFullYear();
            if (year < 1970 || year > 2100) return null; // Filter out invalid ranges

            return dateObj;
        };

        const steps = historySteps.map((step, index) => {
            const infoItem = step.Info?.Item || {};

            // Extract completion and start timestamps
            const completedAt = parseDWDate(infoItem.DecisionDate || step.StepDate || step.TimeStamp);
            const startedAt = parseDWDate(step.StepDate || step.TimeStamp);

            // Extract decision name / transition taken
            const decision = infoItem.DecisionName || step.DecisionLabel || '';

            // Extract processors/assignees
            let user = infoItem.UserName || step.User || step.UserName || '';
            let assignedUsers = [];
            if (infoItem.AssignedUsers && Array.isArray(infoItem.AssignedUsers)) {
                assignedUsers = infoItem.AssignedUsers;
                if (!user) user = assignedUsers.join(', ');
            }

            const stepType = step.StepType || infoItem['$type'] || '';

            return {
                stepNumber: step.StepNumber || (index + 1),
                name: step.ActivityName || step.Name,
                type: step.ActivityType,
                stepType,
                startedAt,
                completedAt,
                decision,
                user,
                assignedUsers,
                raw: step
            };
        });

        // Compute step durations and determine active flag
        for (let i = 0; i < steps.length; i++) {
            const current = steps[i];
            current.durationMs = 0;
            current.isActive = false;

            if (i < steps.length - 1) {
                // Time spent between start of this step and start of the next step
                const next = steps[i + 1];
                if (current.startedAt && next.startedAt) {
                    current.durationMs = Math.max(0, next.startedAt.getTime() - current.startedAt.getTime());
                }
            } else if (current.startedAt) {
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

                const isTaskInProgress = 
                    current.stepType.includes('InProgress') || 
                    current.stepType.includes('AssignTo') ||
                    (isTaskType(current.type) && !current.decision);

                if (isTaskInProgress) {
                    current.durationMs = Math.max(0, new Date().getTime() - current.startedAt.getTime());
                    current.isActive = true;
                }
            }

            current.durationText = WorkflowHistoryAnalyzer.formatDuration(current.durationMs);
        }

        return steps;
    },

    /**
     * Formats duration in milliseconds to readable text (e.g., "3d 4h" or "12m 5s")
     */
    formatDuration: (ms) => {
        if (!ms || ms <= 0) return '';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            const remHours = hours % 24;
            return `${days}d ${remHours}h`;
        }
        if (hours > 0) {
            const remMin = minutes % 60;
            return `${hours}h ${remMin}m`;
        }
        if (minutes > 0) {
            const remSec = seconds % 60;
            return `${minutes}m ${remSec}s`;
        }
        return `${seconds}s`;
    }
};
