import os
import json
import base64
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaInMemoryUpload
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML, CSS
from datetime import datetime
from google.cloud import pubsub_v1

# --- CONFIGURAÇÕES GERAIS ---
PROJECT_ID = 'faturamentoiwof'
PUB_SUB_TOPIC = 'faturamento-tarefas'
DRIVE_FOLDER_ID = '1OfxWhNmzexy9nVlMTvk2RQRR8b8lWHGY'
SERVICE_ACCOUNT_FILE = 'service-account.json'
LOGO_FILE_PATH = 'logo.png'


# --- FUNÇÕES DE AJUDA ---

def parse_brazilian_float(value_str):
    """Converte string no formato brasileiro (R$ 1.234,56) para float."""
    if value_str is None:
        return 0.0
    value_str = str(value_str).strip()
    try:
        return float(value_str.replace('R$', '').strip().replace('.', '').replace(',', '.'))
    except (ValueError, TypeError):
        return 0.0


def get_or_create_folder_id(drive_service, parent_id, folder_name):
    """Localiza ou cria uma pasta no Google Drive."""
    safe_name = folder_name.replace("'", "\\'")
    query = f"name='{safe_name}' and '{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
    response = drive_service.files().list(
        q=query, spaces='drive', fields='files(id)',
        supportsAllDrives=True, includeItemsFromAllDrives=True
    ).execute()
    files = response.get('files', [])
    if files:
        return files[0].get('id')
    else:
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }
        folder = drive_service.files().create(
            body=file_metadata, fields='id', supportsAllDrives=True
        ).execute()
        print(f"  📂 Pasta '{folder_name}' criada no Drive.")
        return folder.get('id')


def get_image_as_base64(filepath):
    """Lê um arquivo de imagem e o converte para uma string Base64 para embutir no HTML."""
    try:
        with open(filepath, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
        return f"data:image/png;base64,{encoded_string}"
    except FileNotFoundError:
        print(f"⚠️  Aviso: Arquivo de logo '{filepath}' não encontrado.")
        return ""


# ==============================================================================
# FUNÇÃO #1: MESTRE (Publicadora)
# ==============================================================================
# Recebe o payload HTTP do Next.js (disparar-gcp/route.ts) e distribui
# uma tarefa por loja via Pub/Sub.
#
# Payload esperado do Next.js:
# {
#     "nome_pasta_ciclo": "Ciclo 4",
#     "ciclo_mensal": "18/05/2026 à 24/05/2026",
#     "lote_id": "uuid",
#     "data_faturamento": "01/06/2026",
#     "lojas": [
#         {
#             "info_loja": { "LOJA": "...", "CNPJ": "...", "NF": "...", ... },
#             "itens_faturados_rows": [["Nome", "Vaga", ...], ...],
#             "faturamento_headers": ["Nome", "Vaga", "Início", ...],
#             "lista_acrescimos": [...],
#             "lista_descontos": [...],
#             "ajustes_manuais": [...]
#         },
#         ...
#     ],
#     "driveFolderId": "folder-id"
# }
# ==============================================================================

def gerar_faturas_mestre(request):
    print("🚀 Mestre iniciando: Processando payload HTTP do Next.js...")
    try:
        payload = request.get_json(silent=True)

        if not payload or 'lojas' not in payload:
            print("❌ Payload inválido ou campo 'lojas' ausente.")
            return ("Payload inválido: campo 'lojas' é obrigatório.", 400)

        lojas = payload['lojas']
        nome_pasta_ciclo = payload.get('nome_pasta_ciclo', 'Ciclo_Geral')
        ciclo_mensal = payload.get('ciclo_mensal', 'Período não definido')
        lote_id = payload.get('lote_id', '')
        data_faturamento = payload.get('data_faturamento', datetime.now().strftime('%d/%m/%Y'))
        drive_folder_id = payload.get('driveFolderId', DRIVE_FOLDER_ID)

        print(f"📊 Payload recebido: {len(lojas)} lojas | Ciclo: {nome_pasta_ciclo} | Lote: {lote_id[:8] if lote_id else 'N/A'}")

        publisher = pubsub_v1.PublisherClient()
        topic_path = publisher.topic_path(PROJECT_ID, PUB_SUB_TOPIC)
        tarefas_publicadas = 0

        for loja_data in lojas:
            info_loja = loja_data.get("info_loja", {})
            nome_loja = info_loja.get("LOJA", "Desconhecida")
            itens = loja_data.get("itens_faturados_rows", [])

            dados_tarefa = {
                "info_loja": info_loja,
                "itens_faturados_rows": itens,
                "faturamento_headers": loja_data.get("faturamento_headers", []),
                "lista_acrescimos": loja_data.get("lista_acrescimos", []),
                "lista_descontos": loja_data.get("lista_descontos", []),
                "ajustes_manuais": loja_data.get("ajustes_manuais", []),
                "ciclo_mensal": ciclo_mensal,
                "nome_pasta_ciclo": nome_pasta_ciclo,
                "lote_id": lote_id,
                "data_faturamento": data_faturamento,
                "driveFolderId": drive_folder_id
            }

            mensagem_bytes = json.dumps(dados_tarefa).encode('utf-8')
            publisher.publish(topic_path, data=mensagem_bytes)
            tarefas_publicadas += 1
            print(f"  📤 {nome_loja}: {len(itens)} itens publicados")

        resultado = f"✅ Mestre concluiu. {tarefas_publicadas} tarefas enviadas."
        print(resultado)
        return (resultado, 200)

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"❌ ERRO FATAL no Mestre: {e}")
        return (f"Erro no Mestre: {e}", 500)


# ==============================================================================
# FUNÇÃO #2: TRABALHADORA (Assinante Pub/Sub)
# ==============================================================================
# Recebe a mensagem publicada pela Mestre, gera o PDF via template
# Jinja2/WeasyPrint e faz upload para o Google Drive.
#
# Estrutura de pastas no Drive (compatível com consumer-disparo-emails):
#   DRIVE_ROOT / ano / mês / empresa / ciclo / PDF
# ==============================================================================

def processar_fatura_individual(event, context):
    dados_tarefa_json = base64.b64decode(event['data']).decode('utf-8')
    dados_tarefa = json.loads(dados_tarefa_json)

    info_loja = dados_tarefa["info_loja"]
    itens_faturados_rows = dados_tarefa["itens_faturados_rows"]
    faturamento_headers = dados_tarefa.get("faturamento_headers", [])
    ciclo_mensal = dados_tarefa.get("ciclo_mensal", "Período não definido")
    nome_pasta_ciclo = dados_tarefa.get("nome_pasta_ciclo", "Ciclo_Geral")
    drive_folder_id = dados_tarefa.get("driveFolderId", DRIVE_FOLDER_ID)

    nome_empresa_original = info_loja.get("LOJA", "Desconhecida")
    print(f"👷 Trabalhadora recebeu: {nome_empresa_original} ({len(itens_faturados_rows)} itens)")

    try:
        creds = Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE,
            scopes=['https://www.googleapis.com/auth/drive']
        )
        drive_service = build('drive', 'v3', credentials=creds)

        # ─── Mapeamento de colunas ───────────────────────────────────
        # O Next.js envia faturamento_headers e itens_faturados_rows
        # onde cada row é um array indexado na mesma ordem dos headers.
        # Exemplo de headers: ["Nome", "Vaga", "Início", "Término",
        #                       "Valor IWOF", "Fração de hora computada",
        #                       "Iniciado por"]
        col_map = {header: i for i, header in enumerate(faturamento_headers)}
        nome_idx = col_map.get('Nome', 0)
        vaga_idx = col_map.get('Vaga', 1)
        inicio_idx = col_map.get('Início', 2)
        termino_idx = col_map.get('Término', 3)
        valor_iwof_idx = col_map.get('Valor IWOF', 4)
        fracao_hora_idx = col_map.get('Fração de hora computada', 5)
        iniciador_idx = col_map.get('Iniciado por', 6)

        # ─── Valores financeiros do info_loja ────────────────────────
        # Chaves novas enviadas pelo Next.js (disparar-gcp/route.ts)
        # com fallback para chaves legadas da planilha.
        valor_bruto = parse_brazilian_float(info_loja.get('VALOR_BRUTO'))
        acrescimo = parse_brazilian_float(info_loja.get('ACRESCIMO'))
        desconto = parse_brazilian_float(info_loja.get('DESCONTO'))
        irrf = parse_brazilian_float(info_loja.get('IRRF'))
        valor_nf = parse_brazilian_float(info_loja.get('NF'))
        valor_nc = parse_brazilian_float(info_loja.get('NC'))
        valor_liquido = parse_brazilian_float(
            info_loja.get('VALOR_LIQUIDO') or info_loja.get('BOLETO')
        )
        valor_total_pdf = parse_brazilian_float(
            info_loja.get('VALOR_TOTAL_FATURA_PDF') or info_loja.get('BOLETO')
        )
        periodo = info_loja.get('PERIODO', ciclo_mensal)

        # Subtotal = bruto + acréscimos (compatível com template legado)
        subtotal_val = (valor_bruto + acrescimo) if valor_bruto else (valor_liquido + desconto)

        # ─── Helper seguro de acesso a colunas ───────────────────────
        def safe_col(row, idx, fallback="-"):
            return row[idx] if len(row) > idx else fallback

        # ─── Contexto do Template ────────────────────────────────────
        logo_base64_src = get_image_as_base64(LOGO_FILE_PATH)

        fmt = lambda v: f"{v:.2f}".replace('.', ',')

        template_context = {
            # Cabeçalho
            "logo_src": logo_base64_src,
            "nome_cliente": nome_empresa_original,
            "cnpj_cliente": info_loja.get('CNPJ', 'N/A'),
            "numero_fatura": info_loja.get('Nº NF', 'N/A'),
            "ciclo_mensal": periodo,

            # Tabela de itens — cada agendamento individual vira uma linha
            "itens_faturados": [
                {
                    "profissional": safe_col(item, nome_idx, "N/A"),
                    "funcao": safe_col(item, vaga_idx),
                    "inicio": safe_col(item, inicio_idx),
                    "termino": safe_col(item, termino_idx),
                    "valor": fmt(parse_brazilian_float(safe_col(item, valor_iwof_idx, "0"))),
                    "fracao_hora": safe_col(item, fracao_hora_idx),
                    "iniciador": safe_col(item, iniciador_idx),
                }
                for item in itens_faturados_rows
            ],

            # Resumo financeiro (chaves antigas para compatibilidade com template)
            "subtotal": fmt(subtotal_val),
            "descontos": fmt(desconto),
            "NF": fmt(valor_nf),
            "NC": fmt(valor_nc),
            "total_geral": fmt(valor_total_pdf),

            # Chaves novas (para templates atualizados)
            "valor_bruto": fmt(valor_bruto),
            "acrescimos": fmt(acrescimo),
            "irrf": fmt(irrf),
            "valor_liquido": fmt(valor_liquido),
            "periodo": periodo,

            # Listas detalhadas de ajustes
            "lista_acrescimos": dados_tarefa.get("lista_acrescimos", []),
            "lista_descontos": dados_tarefa.get("lista_descontos", []),
            "ajustes_manuais": dados_tarefa.get("ajustes_manuais", []),

            # Flags
            "exibir_aviso_desconto": info_loja.get("exibir_aviso_desconto_informativo", False),
            "boleto_unificado": info_loja.get("boleto_unificado", True),
        }

        # ─── Renderização do PDF ─────────────────────────────────────
        env = Environment(loader=FileSystemLoader('.'))
        template = env.get_template('template.html')
        stylesheet = CSS('style.css')

        html_final = template.render(template_context)
        pdf_bytes = HTML(string=html_final).write_pdf(stylesheets=[stylesheet])

        # ─── Upload para o Google Drive ──────────────────────────────
        # Estrutura: DRIVE_ROOT / ano / mês / empresa / ciclo / PDF
        # (compatível com consumer-disparo-emails que busca PDFs nesta hierarquia)
        hoje = datetime.now()
        ano_str = str(hoje.year)
        mes_str = hoje.strftime('%m')

        root_folder = drive_folder_id or DRIVE_FOLDER_ID
        ano_folder_id = get_or_create_folder_id(drive_service, root_folder, ano_str)
        mes_folder_id = get_or_create_folder_id(drive_service, ano_folder_id, mes_str)
        empresa_folder_id = get_or_create_folder_id(drive_service, mes_folder_id, nome_empresa_original)
        ciclo_folder_id = get_or_create_folder_id(drive_service, empresa_folder_id, nome_pasta_ciclo)

        nome_arquivo_pdf = f"Fatura_{nome_empresa_original}_{ano_str}-{mes_str}.pdf"
        media = MediaInMemoryUpload(pdf_bytes, mimetype='application/pdf', resumable=True)
        file_metadata = {'name': nome_arquivo_pdf, 'parents': [ciclo_folder_id]}
        drive_service.files().create(
            body=file_metadata, media_body=media, fields='id', supportsAllDrives=True
        ).execute()

        print(f"✅ Concluído: {nome_empresa_original} — {len(itens_faturados_rows)} itens no PDF ✔")

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"❌ ERRO ao processar '{nome_empresa_original}': {e}")
        raise e
