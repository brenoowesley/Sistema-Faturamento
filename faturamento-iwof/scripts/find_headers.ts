
import * as xlsx from 'xlsx';
import * as path from 'path';

const filePath = path.resolve(process.cwd(), 'RELATORIO_DTB_BRASIL_2024_MUNICIPIOS.xls');
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json<any>(sheet, { header: 1 }); // Read as array of arrays

for (let i = 0; i < 20; i++) {
    console.log(`Row ${i}:`, data[i]);
    if (data[i] && data[i].includes("Nome_UF")) {
        console.log(`🎯 FOUND HEADERS AT ROW ${i}`);
    }
}
