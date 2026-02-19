
import * as xlsx from 'xlsx';
import * as path from 'path';

const filePath = path.resolve(process.cwd(), 'RELATORIO_DTB_BRASIL_2024_MUNICIPIOS.xls');
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const data = xlsx.utils.sheet_to_json<any>(workbook.Sheets[sheetName]);

console.log("Keys:", Object.keys(data[0]));
console.log("Row 0:", data[0]);
console.log("Row 100:", data[100]);
