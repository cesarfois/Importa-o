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

        const resp = await axios.get(`${baseUrl}/DocuWare/Platform/FileCabinets/${cabinetId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        const fields = resp.data.Fields || [];
        console.log("All Fields in Cabinet:");
        fields.forEach(f => {
            console.log(`- DBFieldName: ${f.DBFieldName}, DisplayName: ${f.DisplayName}, Type: ${f.Type}`);
        });

    } catch (err) {
        console.error('Error:', err.message);
    }
}

main();
