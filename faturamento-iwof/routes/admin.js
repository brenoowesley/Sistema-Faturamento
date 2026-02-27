const express = require('express');
const router = express.Router();
const multer = require('multer');
const googleDriveService = require('../services/googleDriveService');
const emailService = require('../services/emailService');
// Assumindo que este service existe em algum lugar:
// const googleSheetsService = require('../services/googleSheetsService');

// Multer in-memory storage config
const upload = multer({ storage: multer.memoryStorage() });

// 1. GET /admin/triagem-boletos
router.get('/triagem-boletos', async (req, res) => {
    try {
        // Fallback p/ mock se googleSheetsService não existir
        let clientesLista = ['Cliente A', 'Cliente B', 'Tech Solucoes', 'Empresa iWof'];
        /* 
        try {
            const clientesRaw = await googleSheetsService.getClientes();
            clientesLista = clientesRaw.map(c => c.nome); 
        } catch(e) { console.error(e) } 
        */
        
        res.render('admin/triagem-boletos', {
            clientes: clientesLista
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Erro interno');
    }
});

// 2. GET /admin/triagem-nfs
router.get('/triagem-nfs', (req, res) => {
    res.render('admin/triagem-nfs');
});

// 3. GET /admin/api/notas-mapeamento
router.get('/api/notas-mapeamento', (req, res) => {
    // Retorna um objeto JSON mapeando números de notas a nomes de clientes
    const mockMapeamento = {
        "19770": "Cliente A",
        "19771": "Embalagens Silva",
        "12345": "Tech Solucoes"
    };
    res.json(mockMapeamento);
});

// 4. POST /admin/api/drive/upload-documento
router.post('/api/drive/upload-documento', upload.array('documentos'), async (req, res) => {
    try {
        const files = req.files;
        const clientes = req.body.clientes; // pode ser string ou array
        const ciclos = req.body.ciclos; // pode ser string ou array

        if (!files || files.length === 0) {
            return res.status(400).send('Nenhum arquivo enviado.');
        }

        const clientesArr = Array.isArray(clientes) ? clientes : [clientes];
        const ciclosArr = Array.isArray(ciclos) ? ciclos : [ciclos];

        for (let i = 0; i < files.length; i++) {
            const buffer = files[i].buffer;
            const fileName = files[i].originalname;
            const clienteNome = clientesArr[i];
            const ciclo = ciclosArr[i];

            await googleDriveService.uploadDocumento(buffer, fileName, clienteNome, ciclo);
        }

        res.status(200).send({ success: true, message: 'Arquivos enviados para o Drive' });
    } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, error: error.message });
    }
});

// 5. POST /admin/api/faturamento/disparar-ciclo
router.post('/api/faturamento/disparar-ciclo', async (req, res) => {
    try {
        const { ano, mes, ciclo } = req.body;
        if (!ano || !mes || !ciclo) {
            return res.status(400).send('Faltam parâmetros.');
        }

        // Simulação do fluxo
        // 1. googleDriveService.varrerPastaCiclo(ano, mes, ciclo) -> retorna clientes que têm Boleto & NF
        // 2. Para cada cliente: 
        //    buffers = googleDriveService.baixarPdfsParaMemoria(...)
        //    email = googleSheetsService.getEmail(cliente)
        //    emailService.enviarFatura(email, cc, dados, buffers)
        
        // Exemplo Mockado:
        const logs = [
            { cliente: 'Cliente A', status: 'Sucesso' },
            { cliente: 'Tech Solucoes', status: 'Falha - E-mail não encontrado' }
        ];

        res.json({ success: true, logs });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Erro ao disparar faturas' });
    }
});

module.exports = router;
