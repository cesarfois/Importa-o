const axios = require('axios');

const baseUrl = 'https://rcsangola.docuware.cloud';
const username = 'cesar.fois.ext@rcsangola.com';
const password = 'Siexpre$$';

async function main() {
    try {
        console.log('Logging in...');
        const loginResp = await axios.post(`${baseUrl}/DocuWare/Platform/Account/LogOn`, 
            `UserName=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&RedirectToHub=false`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            }
        );
        
        // Get cookies
        const cookies = loginResp.headers['set-cookie'];
        const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
        console.log('Logged in successfully!');

        const cabinetId = '56c20dfc-a25b-4ed7-890a-15de4b3853d7'; // From the pasted JSON
        const docId = '156506';

        console.log(`Fetching history for DocID: ${docId}...`);
        const historyResp = await axios.get(`${baseUrl}/DocuWare/Platform/Workflow/Instances/DocumentHistory`, {
            params: {
                fileCabinetId: cabinetId,
                documentId: docId
            },
            headers: {
                'Cookie': cookieHeader,
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
                    'Cookie': cookieHeader,
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
