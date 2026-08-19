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

        const dialogsResp = await axios.get(`${baseUrl}/DocuWare/Platform/FileCabinets/${cabinetId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        const fields = dialogsResp.data.Fields || [];
        const dateFields = fields.filter(f => f.DWFieldType === 'Date' || f.DWFieldType === 'DateTime');
        
        console.log('All Date fields found:');
        dateFields.forEach(f => {
            console.log(`- DBFieldName: ${f.DBFieldName}, FieldName: ${f.FieldName}, DisplayName: ${f.DisplayName}`);
        });

        const systemStoreField = fields.find(f => {
            const name = (f.DBFieldName || f.FieldName || '').toUpperCase();
            return name === 'DWSTOREDATETIME' || name === 'DWSTOREDATE';
        });
        
        const dateF = systemStoreField || fields.find(f => {
            const name = (f.DBFieldName || f.FieldName || '').toLowerCase();
            const disp = (f.DisplayName || '').toLowerCase();
            const dateKeywords = ['dwstoredate', 'dwstoredatetime', 'storedate', 'armazenado', 'data', 'date'];
            return dateKeywords.some(kw => name.includes(kw) || disp.includes(kw));
        }) || dateFields[0];

        console.log('\nSelected Date Field by app logic:');
        console.log(`- DBFieldName: ${dateF?.DBFieldName}, FieldName: ${dateF?.FieldName}, DisplayName: ${dateF?.DisplayName}`);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

main();
