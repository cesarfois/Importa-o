import dotenv from 'dotenv';
import axios from 'axios';
import { tokenManager } from '../tokenManager.js';

dotenv.config();

const baseUrl = 'https://rcsangola.docuware.cloud';
const cabinetId = 'c31ae087-921c-4985-bfcc-7b32de369db8';

const findFieldVal = (doc, searchNames) => {
    if (!doc || !doc.Fields) return '';
    const field = doc.Fields.find(f => {
        const dbName = (f.FieldName || '').toUpperCase();
        return searchNames.some(name => dbName === name.toUpperCase() || dbName.includes(name.toUpperCase()));
    });
    if (!field) return '';
    return field.Item || field.Value || '';
};

const getDocFieldValue = (doc, fieldName) => {
    if (!doc || !doc.Fields) return '';
    const field = doc.Fields.find(f => (f.FieldName || '').toUpperCase() === fieldName.toUpperCase());
    if (!field) return '';
    return field.Item || field.Value || '';
};

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

        // 2. Query Jan 2026
        const queryBody = {
            Condition: [
                { DBName: 'DOCUMENT_TYPE', Value: ['Registo Processo de Importação'] },
                { DBName: 'DWSTOREDATETIME', Value: ['2026-01-01', '2026-01-31'] }
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
        console.log(`Testing filters on ${docs.length} documents:\n`);

        // We simulate the React filters:
        // selectedDespachante = 'all'
        // selectedFornecedor = 'all'
        // selectedTipoCarga = 'all'
        // selectedViaTransporte = 'all'
        // selectedTransportador = 'all'
        // selectedEstado = 'all'
        // selectedResponsavel = 'all'

        docs.forEach(doc => {
            const docNum = getDocFieldValue(doc, 'DOCUMENT_NUMBER') || getDocFieldValue(doc, 'NO_PROCESSO_IMPORTACAO');
            console.log(`Document: ${docNum} (ID: ${doc.Id})`);

            // Despachante filter simulation
            const desp = getDocFieldValue(doc, 'DESPACHANTE') || getDocFieldValue(doc, 'DESPACHADOR');
            // Fornecedor filter simulation
            const forn = getDocFieldValue(doc, 'FORNECEDOR') || getDocFieldValue(doc, 'EMPRESA');
            // Tipo de Carga filter simulation
            const carga = getDocFieldValue(doc, 'TIPO_DE_CARGA') || getDocFieldValue(doc, 'TIPO_CARGA');
            // Via de transporte
            const via = getDocFieldValue(doc, 'TIPO') || getDocFieldValue(doc, 'VIA') || getDocFieldValue(doc, 'MODAL') || getDocFieldValue(doc, 'MEIO_TRANSPORTE') || getDocFieldValue(doc, 'VIA_TRANSPORTE');
            // Transportador
            const trans = getDocFieldValue(doc, 'TRANSPORTADOR');

            console.log(`  - Despachante: "${desp}"`);
            console.log(`  - Fornecedor: "${forn}"`);
            console.log(`  - Tipo Carga: "${carga}"`);
            console.log(`  - Via: "${via}"`);
            console.log(`  - Transportador: "${trans}"`);
            
            // Check if any filter is null/undefined or fails inside getDWFieldVal:
            const fMerc = findFieldVal(doc, ['MONTANTE_FACTURA', 'VALOR_FOB', 'FOB', 'VALOR_MERCADORIA', 'VALOR']);
            console.log(`  - fMerc: "${fMerc}"`);
            console.log(`-----------------------------------`);
        });

    } catch (err) {
        console.error('Error:', err.message);
    }
}

main();
