# DuoFin v6.10.0 — Gestão financeira a dois

Aplicação web progressiva (PWA) para gestão financeira partilhada a dois, pronta a alojar no **GitHub Pages** (ou qualquer servidor HTTPS estático) com suporte offline e sincronização opcional encriptada via **Supabase**.

## Novidades da versão v6.10.0
1. **Correção e Diagnóstico da Base de Dados Supabase (`public.household_state`):**
   - Inclui o ficheiro `supabase-setup.sql` na raiz do repositório e um botão **«Copiar SQL de configuração»** diretamente no separador *Dados → Sincronização*.
   - Novo botão **«Verificar ligação e tabelas»** que diagnostica imediatamente se o URL, a chave pública e as tabelas/funções RPC do Supabase estão ativos.
   - Auto-reparação caso o orçamento partilhado exista sem registo inicial na tabela `household_state`.
2. **Resiliência de Rede e Sincronização Automática:**
   - Controlo de *timeout* (12 segundos) nas chamadas à API REST do Supabase e sincronização imediata quando o dispositivo volta a ficar `online`.
3. **Gestão de Cartões de Crédito (Sem Dupla Contagem):**
   - Compras pagas com cartão de crédito entram imediatamente no orçamento da categoria; o pagamento posterior da fatura abate a dívida sem duplicar despesas.

## Como instalar no GitHub Pages
1. Faz upload de todos os ficheiros deste ZIP para a raiz do teu repositório GitHub (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `supabase-setup.sql` e `README.md` — mantém também a pasta `icons/` se já a tiveres no repositório).
2. No GitHub, vai a **Settings → Pages** e confirma que o branch `main` (pasta `/root`) está ativo.
3. No **Supabase** (`app.supabase.com`), abre o **SQL Editor** do teu projeto, cola o conteúdo de `supabase-setup.sql` e clica em **Run** para criar todas as tabelas, políticas de segurança (RLS) e funções RPC.
