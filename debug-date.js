import fs from 'fs/promises';
import axios from 'axios';
import path from 'path';

async function run() {
    try {
        const schedules = JSON.parse(await fs.readFile('schedules.json', 'utf-8'));
        const tokens = JSON.parse(await fs.readFile('tokens.json', 'utf-8'));
        const schedule = schedules[0];
        
        if (!schedule) { console.log("No schedule"); return; }
        
        const token = tokens.accessToken;
        const { cabinetId, filters, auth } = schedule;
        
        console.log("Searching...");
        
        // Search
        const dialogsRes = await axios.get(`${auth.url}/DocuWare/Platform/FileCabinets/${cabinetId}/Dialogs`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const searchDialog = dialogsRes.data.Dialog.find(d => d.Type === 'Search') || dialogsRes.data.Dialog[0];
        
        const conditions = filters.map(filter => ({
            DBName: filter.fieldName,
            Value: Array.isArray(filter.value) ? filter.value : [filter.value]
        }));

        const query = {
            Condition: conditions,
            Operation: 'And'
        };

        const searchRes = await axios.post(
            `${auth.url}/DocuWare/Platform/FileCabinets/${cabinetId}/Query/DialogExpression?dialogId=${searchDialog.Id}&count=10`,
            query,
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
        );
        
        const docs = searchRes.data.Items || [];
        console.log(`Found ${docs.length} docs`);
        
        const results = [];
        
        for (const doc of docs) {
            console.log(`Fetching history for ${doc.Id}`);
            const historyUrl = `${auth.url}/DocuWare/Platform/Workflow/Instances/DocumentHistory?fileCabinetId=${cabinetId}&documentId=${doc.Id}`;
            try {
                const res = await axios.get(historyUrl, { headers: { Authorization: `Bearer ${token}` } });
                const instances = res.data.InstanceHistory || res.data || [];
                
                for (const inst of instances) {
                     let stepsUrl = null;
                     const selfLink = (inst.Links || []).find(l => l.Rel === 'self' || l.rel === 'self');
                     if (selfLink && selfLink.Href) {
                            if (selfLink.Href.startsWith('http')) {
                                stepsUrl = selfLink.Href;
                            } else {
                                stepsUrl = `${auth.url}${selfLink.Href.startsWith('/') ? '' : '/'}${selfLink.Href}`;
                            }
                     } else {
                        // Fallback construction
                        stepsUrl = `${auth.url}/DocuWare/Platform/Workflow/Workflows/${inst.WorkflowId}/Instances/${inst.Id}/History`;
                     }
                     
                     if(stepsUrl) {
                         const stepsRes = await axios.get(stepsUrl, { headers: { Authorization: `Bearer ${token}` } });
                         inst.HistorySteps = stepsRes.data.HistorySteps || stepsRes.data || [];
                     }
                }
                results.push({ docId: doc.Id, instances });
            } catch(e) {
                console.error(`Error for doc ${doc.Id}: ${e.message}`);
            }
        }
        
        await fs.writeFile('debug_output.json', JSON.stringify(results, null, 2));
        console.log("Done");
    } catch (err) {
        console.error("Script failed:", err);
    }
}

run();
