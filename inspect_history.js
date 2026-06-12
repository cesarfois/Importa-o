import dotenv from 'dotenv';
import axios from 'axios';
import { tokenManager } from './tokenManager.js';

dotenv.config();

const baseUrl = 'https://rcsangola.docuware.cloud';
const cabinetId = '56c20dfc-a25b-4ed7-890a-15de4b3853d7'; // From WFD Org/Cabinet
const docId = '156506';

async function main() {
    try {
        console.log('Initializing token manager...');
        await tokenManager.init();
        console.log('Fetching access token...');
        const token = await tokenManager.getAccessToken();
        console.log('Access token obtained successfully!');

        console.log(`Fetching history for DocID: ${docId}...`);
        const historyResp = await axios.get(`${baseUrl}/DocuWare/Platform/Workflow/Instances/DocumentHistory`, {
            params: {
                fileCabinetId: cabinetId,
                documentId: docId
            },
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        const instances = historyResp.data.InstanceHistory || historyResp.data || [];
        console.log(`Found ${instances.length} instances.`);

        for (const inst of instances) {
            console.log(`Instance ID: ${inst.Id}, Name: ${inst.Name}, Version: ${inst.Version}, Status: ${inst.Status}`);
            const historyUrl = `${baseUrl}/DocuWare/Platform/Workflow/Workflows/${inst.WorkflowId}/Instances/${inst.Id}/History`;
            console.log(`Fetching steps from: ${historyUrl}`);
            const stepsResp = await axios.get(historyUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });
            const steps = stepsResp.data.HistorySteps || stepsResp.data || [];
            console.log(`Steps (${steps.length}):`);
            steps.forEach((step, idx) => {
                const info = step.Info?.Item || {};
                console.log(`  [${idx}] Name: "${step.ActivityName || step.Name}", Type: "${step.ActivityType}", Decision: "${info.DecisionName || step.DecisionLabel || ''}", User: "${info.UserName || step.User || ''}"`);
            });
        }
    } catch (err) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Response status:', err.response.status);
            console.error('Response data:', err.response.data);
        }
    }
}

main();
