# DuoFin v6.7.0 — Fase 3: Inteligência Financeira & Copiloto

## Novidades incluídas nesta versão (v6.7.0)
1. **Orçamento Diário Disponível (Burn Rate):**
   - No cartão de **Saldo do ciclo** do *Resumo*, calcula automaticamente quanto o casal pode gastar por dia até ao fecho estimado do ciclo atual, já descontando despesas pendentes, prestações agendadas e regras recorrentes previstas.
2. **Alertas de Anomalias em Faturas & Despesas Variáveis:**
   - Monitoriza despesas recorrentes ou categorias variáveis (ex.: *Água, luz e gás*, *Supermercado*, *Telecomunicações*, *Combustível*) e alerta automaticamente no *Resumo* quando o valor atual ou última fatura desvia **mais de 20%** face à média dos últimos 3 ciclos.
3. **Deteção Automática de Subscrições na Importação (PDF/CSV):**
   - Ao carregar extratos bancários, identifica padrões repetidos (valores iguais/semelhantes em datas recorrentes ou serviços de subscrição) e permite criar regras de **Despesa Recorrente** com um clique antes ou depois da importação.
4. **Simulador de Impacto ("E se...?"):**
   - Novo painel interativo no separador *Orçamento* (com atalho rápido a partir do *Resumo*) para testar uma compra a pronto ou em prestações antes de a registar, mostrando o impacto no saldo previsto do ciclo atual, nos ciclos seguintes, no *burn rate* diário e nos prazos dos objetivos de poupança ativos.

## Ficheiros incluídos no ZIP
- `index.html`
- `styles.css`
- `app.js`
- `sw.js`
- `manifest.webmanifest`
- `README.md`
