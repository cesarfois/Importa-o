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

const evaluateActiveStage = (doc, activeTaskName, isFinished) => {
    const hasDataEntregue = !!findFieldVal(doc, ['DATA_ENTREGUE', 'DATA_ENTREGUE_RCS', 'ENTREGUE']);
    const estatutoVal = String(findFieldVal(doc, ['ESTATUTO', 'STATUS'])).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const isEstatutoConcluido = estatutoVal.includes('concluid') || estatutoVal.includes('finaliz');
    if (isFinished || hasDataEntregue || isEstatutoConcluido) return 6;
    return 0; // simplified
};

async function main() {
    try {
        await tokenManager.init();
        const token = await tokenManager.getAccessToken();

        const dialogsResp = await axios.get(`${baseUrl}/DocuWare/Platform/FileCabinets/${cabinetId}/Dialogs`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        const dialogs = dialogsResp.data.Dialog || [];
        const searchDialog = dialogs.find(d => d.Type === 'Search') || dialogs[0];

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

        const documents = resp.data.Items || [];
        console.log(`Simulating React filter on ${documents.length} docs:\n`);

        const filtered = documents.filter(doc => {
            const docNum = getDocFieldValue(doc, 'DOCUMENT_NUMBER') || getDocFieldValue(doc, 'NO_PROCESSO_IMPORTACAO');
            const prog = {}; // simulate no active workflow history loaded yet

            // Despachante
            const desp = getDocFieldValue(doc, 'DESPACHANTE') || getDocFieldValue(doc, 'DESPACHADOR');
            
            // Fornecedor
            const forn = getDocFieldValue(doc, 'FORNECEDOR') || getDocFieldValue(doc, 'EMPRESA');
            
            // Tipo de Carga
            const carga = getDocFieldValue(doc, 'TIPO_DE_CARGA') || getDocFieldValue(doc, 'TIPO_CARGA');
            
            // Via de Transporte (Modal)
            const via = getDocFieldValue(doc, 'TIPO') || getDocFieldValue(doc, 'VIA') || getDocFieldValue(doc, 'MODAL') || getDocFieldValue(doc, 'MEIO_TRANSPORTE') || getDocFieldValue(doc, 'VIA_TRANSPORTE');
            
            // Transportador
            const trans = getDocFieldValue(doc, 'TRANSPORTADOR');
            
            // Responsável
            // prog.responsible !== 'all' -> all

            // Estado do Processo
            // simulate selectedEstado = 'all'

            console.log(`Document: ${docNum} -> passed.`);
            return true;
        });

        console.log(`\nFiltered count: ${filtered.length}`);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

main();
