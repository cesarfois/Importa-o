import dotenv from 'dotenv';
import axios from 'axios';
import { tokenManager } from '../tokenManager.js';

dotenv.config();

const baseUrl = 'https://rcsangola.docuware.cloud';
const cabinetId = 'c31ae087-921c-4985-bfcc-7b32de369db8';

async function main() {
    try {
        await tokenManager.init();
        const token = await tokenManager.getAccessToken();

        // 1. Get search dialog ID
        const dialogsResp = await axios.get(`${baseUrl}/DocuWare/Platform/FileCabinets/${cabinetId}/Dialogs`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        const dialogs = dialogsResp.data.Dialog || [];
        const searchDialog = dialogs.find(d => d.Type === 'Search') || dialogs[0];
        console.log(`Search dialog ID: ${searchDialog.Id}`);

        // 2. Query Jan 2026
        const queryBody = {
            Condition: [
                { DBName: 'DOCUMENT_TYPE', Value: ['Registo Processo de Importação'] },
                { DBName: 'DATE', Value: ['2026-01-01', '2026-01-31'] }
            ],
            Operation: 'And'
        };

        const resp = await axios.post(`${baseUrl}/DocuWare/Platform/FileCabinets/${cabinetId}/Query/DialogExpression`, queryBody, {
            params: { dialogId: searchDialog.Id, count: 1000 },
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const docs = resp.data.Items || [];
        console.log(`Total documents found: ${docs.length}`);
        docs.forEach(doc => {
            const getField = (name) => {
                const f = doc.Fields.find(x => x.FieldName === name);
                return f ? f.Item || f.Value || '' : '';
            };
            console.log(`- ID: ${doc.Id}, Num: ${getField('DOCUMENT_NUMBER') || getField('NO_PROCESSO_IMPORTACAO')}, Date: ${getField('DATE')}, Company: ${getField('COMPANY')}`);
        });

    } catch (err) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Response data:', err.response.data);
        }
    }
}

main();
