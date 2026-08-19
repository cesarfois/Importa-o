import dotenv from 'dotenv';
import axios from 'axios';
import { tokenManager } from '../tokenManager.js';

dotenv.config();

const baseUrl = 'https://rcsangola.docuware.cloud';
const cabinetId = 'c31ae087-921c-4985-bfcc-7b32de369db8'; // Importação cabinet
const docId = '1326';

async function main() {
    try {
        console.log('Initializing token manager...');
        await tokenManager.init();
        const token = await tokenManager.getAccessToken();
        console.log('Access token obtained. Fetching document metadata...');

        const resp = await axios.get(`${baseUrl}/DocuWare/Platform/FileCabinets/${cabinetId}/Documents/${docId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        console.log('Document metadata retrieved successfully:');
        const fields = resp.data.Fields || [];
        fields.forEach(f => {
            console.log(`- ${f.FieldName}: "${f.Item || f.Value || ''}" (${f.FieldLabel || ''})`);
        });
    } catch (err) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Response data:', err.response.data);
        }
    }
}

main();
