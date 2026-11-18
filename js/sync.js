// js/sync.js — Sincronização Supabase Realtime (WebSockets) + Auto-Merge Inteligente + Snapshots (v6.7.0)
import { encryptJsonAesGcm, decryptJsonAesGcm } from './crypto.js';
import { createAutoSnapshot } from './snapshots.js';

const CLOUD_KEY = 'orcamento-plus-cloud-v1';
const E2EE_SECRET_KEY = 'duofin-e2ee-secret-v1';

let ctx = null;
let cloud = {
  url: '',
  key: '',
  access_token: '',
  refresh_token: '',
  expires_at: 0,
  user: null,
  household_id: null,
  revision: null,
  dirty: false
};

let cloudSaveTimer = null;
let cloudBusy = false;

// Estado da ligação WebSocket Supabase Realtime
let rtSocket = null;
let rtHeartbeatTimer = null;
let rtReconnectTimer = null;
let rtRef = 1;
let rtState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'fallback'
let rtSubscribedHouseholdId = null;
let rtReconnectAttempts = 0;

function updateRealtimeBadge() {
  const badge = document.getElementById('realtimeBadge');
  if (!badge) return;
  if (!cloudConnected() || !cloud.household_id) {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.classList.remove('is-live', 'is-connecting', 'is-fallback');
  if (rtState === 'connected') {
    badge.classList.add('is-live');
    badge.textContent = '⚡ Tempo real ativo';
    badge.title = 'Ligado via WebSocket ao Supabase Realtime (sincronização instantânea)';
  } else if (rtState === 'connecting') {
    badge.classList.add('is-connecting');
    badge.textContent = '🔄 A ligar tempo real…';
    badge.title = 'A estabelecer ligação WebSocket ao servidor';
  } else {
    badge.classList.add('is-fallback');
    badge.textContent = '⏱️ Modo periódico (15s)';
    badge.title = 'WebSocket indisponível ou bloqueado — sincronização automática de reserva a cada 15s';
  }
}

export function disconnectRealtime() {
  if (rtHeartbeatTimer) {
    clearInterval(rtHeartbeatTimer);
    rtHeartbeatTimer = null;
  }
  if (rtReconnectTimer) {
    clearTimeout(rtReconnectTimer);
    rtReconnectTimer = null;
  }
  rtSubscribedHouseholdId = null;
  if (rtSocket) {
    try {
      rtSocket.onopen = null;
      rtSocket.onmessage = null;
      rtSocket.onerror = null;
      rtSocket.onclose = null;
      rtSocket.close();
    } catch (_) {}
    rtSocket = null;
  }
  rtState = 'disconnected';
  updateRealtimeBadge();
}

function scheduleRealtimeReconnect() {
  if (rtReconnectTimer) return;
  if (!cloudConnected() || !cloud.household_id || document.visibilityState !== 'visible') {
    rtState = 'fallback';
    updateRealtimeBadge();
    return;
  }
  rtState = 'fallback';
  updateRealtimeBadge();
  const delay = Math.min(30000, 2000 * Math.pow(1.6, rtReconnectAttempts));
  rtReconnectAttempts++;
  rtReconnectTimer = setTimeout(() => {
    rtReconnectTimer = null;
    connectRealtime();
  }, delay);
}

export async function connectRealtime() {
  if (!cloudConnected() || !cloud.household_id) {
    disconnectRealtime();
    return;
  }
  if (document.visibilityState !== 'visible') return;
  if (rtSocket && (rtSocket.readyState === WebSocket.OPEN || rtSocket.readyState === WebSocket.CONNECTING) && rtSubscribedHouseholdId === cloud.household_id) {
    return;
  }

  disconnectRealtime();
  rtState = 'connecting';
  updateRealtimeBadge();

  try {
    await refreshToken();
    const wsBase = cloud.url.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
    const wsUrl = `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(cloud.key)}&vsn=1.0.0`;
    const targetHousehold = cloud.household_id;
    const topic = `realtime:public:household_data:household_id=eq.${targetHousehold}`;

    const ws = new WebSocket(wsUrl);
    rtSocket = ws;
    rtSubscribedHouseholdId = targetHousehold;

    ws.onopen = () => {
      if (rtSocket !== ws) return;
      rtReconnectAttempts = 0;
      const joinRef = String(rtRef++);
      const joinMsg = {
        topic,
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
            postgres_changes: [
              {
                event: '*',
                schema: 'public',
                table: 'household_data',
                filter: `household_id=eq.${targetHousehold}`
              }
            ]
          },
          access_token: cloud.access_token
        },
        ref: joinRef
      };
      ws.send(JSON.stringify(joinMsg));

      rtHeartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            topic: 'phoenix',
            event: 'heartbeat',
            payload: {},
            ref: String(rtRef++)
          }));
        }
      }, 25000);
    };

    ws.onmessage = ev => {
      if (rtSocket !== ws) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === 'phx_reply' && msg.topic === topic) {
          if (msg.payload?.status === 'ok') {
            rtState = 'connected';
            updateRealtimeBadge();
          } else {
            rtState = 'fallback';
            updateRealtimeBadge();
          }
          return;
        }
        if (msg.event === 'postgres_changes' || msg.event === 'UPDATE' || msg.event === 'INSERT') {
          const rec = msg.payload?.data?.record || msg.payload?.record || null;
          const remoteRev = rec && rec.revision != null ? Number(rec.revision) : null;
          if (remoteRev !== null && cloud.revision !== null && remoteRev <= Number(cloud.revision)) {
            return; // Evento gerado por este próprio dispositivo
          }
          syncNow(false, true).then(() => {
            if (ctx && typeof ctx.showToast === 'function') {
              ctx.showToast('Atualizado em tempo real pelo outro dispositivo ⚡', { duration: 2800 });
            }
          }).catch(() => {});
        }
      } catch (_) {}
    };

    ws.onerror = () => {
      if (rtSocket !== ws) return;
      rtState = 'fallback';
      updateRealtimeBadge();
    };

    ws.onclose = () => {
      if (rtSocket !== ws) return;
      if (rtHeartbeatTimer) {
        clearInterval(rtHeartbeatTimer);
        rtHeartbeatTimer = null;
      }
      rtSocket = null;
      scheduleRealtimeReconnect();
    };
  } catch (_) {
    scheduleRealtimeReconnect();
  }
}

export function getE2eeSecret() {
  return localStorage.getItem(E2EE_SECRET_KEY) || '';
}

export function paintE2eeStatus() {
  const $ = id => document.getElementById(id);
  const hasSec = !!getE2eeSecret();
  if ($('disableE2eeBtn')) $('disableE2eeBtn').hidden = !hasSec;
  if ($('e2eeStatusText')) {
    $('e2eeStatusText').textContent = hasSec
      ? 'Ativa (AES-256-GCM): todos os dados enviados para o Supabase são cifrados localmente antes de sair deste dispositivo. Usa exatamente a mesma chave secreta no outro telemóvel.'
      : 'Desativada: os dados são enviados em JSON padrão protegidos por RLS. Se definirem a mesma chave secreta nos dois telemóveis, todo o payload é cifrado localmente em AES-256-GCM antes de sair do dispositivo.';
  }
}

async function encodeCloudPayload(plainDb) {
  const sec = getE2eeSecret();
  if (!sec) return plainDb;
  return await encryptJsonAesGcm(plainDb, sec);
}

async function decodeCloudPayload(rawPayload) {
  if (!rawPayload || rawPayload.__duofin_encrypted__ !== true) return rawPayload;
  const sec = getE2eeSecret();
  if (!sec) throw new Error('Os dados na nuvem estão cifrados (E2EE). Introduz a Chave Secreta do Casal em Dados -> Sincronização.');
  try {
    return await decryptJsonAesGcm(rawPayload, sec);
  } catch (_) {
    throw new Error('Não foi possível decifrar os dados da nuvem. Confirma se a Chave Secreta E2EE é idêntica nos dois telemóveis.');
  }
}

export function saveCloud() {
  localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud));
}

export function cloudMessage(msg, kind = 'alert') {
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.className = kind;
  el.textContent = msg;
}

export function cloudConfigured() {
  return /^https:\/\/[a-z0-9.-]+$/i.test(cloud.url) && !!cloud.key;
}

export function cloudConnected() {
  return cloudConfigured() && !!cloud.access_token && !!cloud.user;
}

export function paintCloud() {
  const $ = id => document.getElementById(id);
  if (!$('cloudStatus')) return;
  $('sbUrl').value = cloud.url || '';
  $('sbKey').value = cloud.key || '';
  $('cloudLogout').hidden = !cloudConnected();
  $('authPanel').hidden = cloudConnected();
  $('householdPanel').hidden = !cloudConnected();
  if (!cloudConfigured()) cloudMessage('Ainda não configurada. Introduz o URL e a chave pública do projeto Supabase.');
  else if (!cloudConnected()) cloudMessage('Projeto configurado. Inicia sessão ou cria uma conta para ativar a sincronização.', 'alert good');
  else if (!cloud.household_id) cloudMessage('Sessão iniciada. Cria um orçamento partilhado ou associa-te com um código de convite.', 'alert good');
  else cloudMessage(cloud.dirty ? 'Existem alterações locais por enviar.' : 'Conta ligada. Orçamento partilhado: ' + cloud.household_id.slice(0, 8) + '… · revisão ' + (cloud.revision ?? '—'), 'alert good');
  $('householdInfo').textContent = cloud.household_id ? 'Orçamento partilhado ativo. Sincronização instantânea via WebSockets com fallback automático.' : 'Ainda não estás associado a um orçamento.';
  updateRealtimeBadge();
}

function saveCloudConfig() {
  const $ = id => document.getElementById(id);
  let u = $('sbUrl').value.trim().replace(/\/$/, '');
  let k = $('sbKey').value.trim();
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(u) || !k) {
    alert('Introduz um URL HTTPS válido e a chave pública do projeto.');
    return;
  }
  if ((u !== cloud.url || k !== cloud.key) && cloud.access_token) {
    if (!confirm('Alterar o projeto termina a sessão atual neste dispositivo. Continuar?')) return;
    disconnectRealtime();
    cloud.access_token = '';
    cloud.refresh_token = '';
    cloud.expires_at = 0;
    cloud.user = null;
    cloud.household_id = null;
    cloud.revision = null;
    cloud.dirty = false;
  }
  cloud.url = u;
  cloud.key = k;
  saveCloud();
  paintCloud();
}

async function authFetch(path, body) {
  const r = await fetch(cloud.url + '/auth/v1/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': cloud.key },
    body: JSON.stringify(body)
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(j.msg || j.message || j.error_description || j.error || ('Erro de autenticação (' + r.status + ')'));
  return j;
}

export async function refreshToken() {
  if (!cloud.refresh_token) return;
  if (cloud.expires_at > Date.now() + 60000) return;
  const j = await authFetch('token?grant_type=refresh_token', { refresh_token: cloud.refresh_token });
  setSession(j);
  if (rtSocket && rtSocket.readyState === WebSocket.OPEN && cloud.access_token) {
    try {
      rtSocket.send(JSON.stringify({
        topic: `realtime:public:household_data:household_id=eq.${cloud.household_id}`,
        event: 'access_token',
        payload: { access_token: cloud.access_token },
        ref: String(rtRef++)
      }));
    } catch (_) {}
  }
}

function setSession(j) {
  cloud.access_token = j.access_token;
  cloud.refresh_token = j.refresh_token || cloud.refresh_token;
  cloud.expires_at = Date.now() + (j.expires_in || 3600) * 1000;
  cloud.user = j.user || cloud.user;
  saveCloud();
}

async function api(path, opts = {}) {
  await refreshToken();
  const headers = {
    'apikey': cloud.key,
    'Authorization': 'Bearer ' + (cloud.access_token || cloud.key),
    'Content-Type': 'application/json',
    ...(opts.headers || {})
  };
  const r = await fetch(cloud.url + '/rest/v1/' + path, { ...opts, headers });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) {
    let msg = j?.message || j?.details || j?.hint || ('Erro do servidor (' + r.status + ')');
    throw new Error(msg);
  }
  return j;
}

async function rpc(name, args) {
  return api('rpc/' + name, { method: 'POST', body: JSON.stringify(args) });
}

function validPayload(p) {
  return !!(p && p.settings && Array.isArray(p.transactions));
}

function hasLocalData() {
  return JSON.stringify(ctx.db) !== JSON.stringify(ctx.fresh());
}

function setLocalData(p) {
  const n = ctx.normalizeDb(p);
  ctx.setDb(n.db);
  localStorage.setItem(ctx.KEY, JSON.stringify(n.db));
  ctx.render();
  return n.changed;
}

export function tryMergePayloads(localRaw, remoteRaw) {
  const local = ctx.normalizeDb(JSON.parse(JSON.stringify(localRaw))).db;
  const remote = ctx.normalizeDb(JSON.parse(JSON.stringify(remoteRaw))).db;

  const delMap = new Map();
  [...(remote.deletedIds || []), ...(local.deletedIds || [])].forEach(d => {
    if (d && d.id) {
      const id = String(d.id);
      const prev = delMap.get(id);
      if (!prev || (d.at || 0) > (prev.at || 0)) delMap.set(id, { id, at: d.at || Date.now() });
    }
  });
  const deletedSet = new Set(delMap.keys());

  const txMap = new Map();
  remote.transactions.forEach(t => { if (!deletedSet.has(String(t.id))) txMap.set(String(t.id), t); });
  for (const t of local.transactions) {
    const id = String(t.id);
    if (deletedSet.has(id)) continue;
    if (!txMap.has(id)) {
      txMap.set(id, t);
    } else {
      const rTx = txMap.get(id);
      if (JSON.stringify(rTx) !== JSON.stringify(t)) {
        if (rTx.status === 'pending' && t.status !== 'pending') txMap.set(id, t);
        else if (t.status === 'pending' && rTx.status !== 'pending') txMap.set(id, rTx);
        else {
          const lTime = Number(t.updatedAt) || 0;
          const rTime = Number(rTx.updatedAt) || 0;
          if (lTime > 0 || rTime > 0) txMap.set(id, lTime >= rTime ? t : rTx);
          else return null;
        }
      }
    }
  }

  const recMap = new Map();
  (remote.recurringExpenses || []).forEach(r => { if (!deletedSet.has(String(r.id))) recMap.set(String(r.id), r); });
  for (const r of (local.recurringExpenses || [])) {
    const id = String(r.id);
    if (deletedSet.has(id)) continue;
    if (!recMap.has(id)) recMap.set(id, r);
    else {
      const rRec = recMap.get(id);
      if (JSON.stringify(rRec) !== JSON.stringify(r)) {
        const lTime = Number(r.updatedAt) || 0;
        const rTime = Number(rRec.updatedAt) || 0;
        if (lTime > 0 || rTime > 0) recMap.set(id, lTime >= rTime ? r : rRec);
        else return null;
      }
    }
  }

  const goalMap = new Map();
  (remote.savingsGoals || []).forEach(g => { if (!deletedSet.has(String(g.id))) goalMap.set(String(g.id), g); });
  for (const g of (local.savingsGoals || [])) {
    const id = String(g.id);
    if (deletedSet.has(id)) continue;
    if (!goalMap.has(id)) goalMap.set(id, g);
    else {
      const rGoal = goalMap.get(id);
      if (JSON.stringify(rGoal) !== JSON.stringify(g)) {
        const lTime = Number(g.updatedAt) || 0;
        const rTime = Number(rGoal.updatedAt) || 0;
        if (lTime > 0 || rTime > 0) goalMap.set(id, lTime >= rTime ? g : rGoal);
        else return null;
      }
    }
  }

  const rollMap = new Map();
  [...(remote.handledCycleRollovers || []), ...(local.handledCycleRollovers || [])].forEach(h => {
    if (h && h.cycleKey) {
      const prev = rollMap.get(h.cycleKey);
      if (!prev || (h.at || 0) < (prev.at || 0)) rollMap.set(h.cycleKey, h);
    }
  });

  const rulesMap = new Map();
  [...(remote.settings.categoryRules || []), ...(local.settings.categoryRules || [])].forEach(rl => {
    if (rl && rl.keyword) rulesMap.set(rl.keyword.toUpperCase(), rl);
  });
  const mergedSettings = { ...remote.settings, categoryRules: [...rulesMap.values()] };

  const catMap = new Map();
  (remote.settings.categories || []).forEach(c => catMap.set(c.name.toLocaleLowerCase('pt-PT'), { ...c }));
  (local.settings.categories || []).forEach(c => {
    const k = c.name.toLocaleLowerCase('pt-PT');
    if (!catMap.has(k)) {
      catMap.set(k, { ...c });
    } else {
      const rCat = catMap.get(k);
      const lTime = Number(c.updatedAt) || 0;
      const rTime = Number(rCat.updatedAt) || 0;
      if (lTime > rTime) catMap.set(k, { ...c });
    }
  });
  mergedSettings.categories = [...catMap.values()];

  return {
    settings: mergedSettings,
    transactions: [...txMap.values()],
    recurringExpenses: [...recMap.values()],
    savingsGoals: [...goalMap.values()],
    deletedIds: [...delMap.values()],
    handledCycleRollovers: [...rollMap.values()]
  };
}

async function memberships() {
  const rows = await api('household_members?select=household_id&user_id=eq.' + encodeURIComponent(cloud.user.id));
  return rows || [];
}

export async function afterLogin() {
  const ms = await memberships();
  let ids = ms.map(x => x.household_id);
  if (cloud.household_id && !ids.includes(cloud.household_id)) cloud.household_id = null;
  if (!cloud.household_id && ids.length) cloud.household_id = ids[0];
  saveCloud();
  paintCloud();
  if (cloud.household_id) {
    await syncNow(false, true);
    connectRealtime();
  }
  if (ctx.generateDueOccurrences()) ctx.render();
}

async function loginOrSignup(signup) {
  const $ = id => document.getElementById(id);
  if (!saveCloudConfigIfNeeded()) throw new Error('A configuração do projeto não foi alterada. Confirma o URL e a chave pública.');
  if (!cloudConfigured()) throw new Error('Guarda primeiro o URL e a chave pública do Supabase.');
  const email = $('cloudEmail').value.trim(), password = $('cloudPassword').value;
  if (!email || password.length < 6) throw new Error('Indica um email e uma palavra-passe com pelo menos 6 caracteres.');
  const j = await authFetch(signup ? ('signup?redirect_to=' + encodeURIComponent(location.href)) : 'token?grant_type=password', { email, password });
  if (!j.access_token) {
    cloudMessage('Conta criada. Confirma o email recebido e depois inicia sessão.', 'alert good');
    return;
  }
  setSession(j);
  await afterLogin();
}

function saveCloudConfigIfNeeded() {
  const $ = id => document.getElementById(id);
  if ($('sbUrl').value.trim() !== cloud.url || $('sbKey').value.trim() !== cloud.key) {
    saveCloudConfig();
    return $('sbUrl').value.trim().replace(/\/$/, '') === cloud.url && $('sbKey').value.trim() === cloud.key;
  }
  return true;
}

async function getCloudRow() {
  const rows = await api('household_data?select=household_id,payload,revision,updated_at&household_id=eq.' + encodeURIComponent(cloud.household_id));
  if (!rows || !rows.length) throw new Error('Não foi encontrado o registo do orçamento partilhado. Confirma a configuração SQL.');
  return rows[0];
}

export async function pushCloud(overwrite = false) {
  if (!cloudConnected() || !cloud.household_id) return;
  if (cloudBusy) return;
  cloudBusy = true;
  try {
    const row = await getCloudRow();
    const remoteDecrypted = await decodeCloudPayload(row.payload);
    if (!overwrite && cloud.revision !== null && row.revision !== cloud.revision) {
      const merged = validPayload(remoteDecrypted) ? tryMergePayloads(ctx.db, remoteDecrypted) : null;
      if (merged) {
        await createAutoSnapshot(ctx.db, 'Antes de fusão na nuvem');
        setLocalData(merged);
        if (ctx.refreshSnapshotsUI) ctx.refreshSnapshotsUI();
        cloud.revision = row.revision;
      } else {
        cloud.dirty = true;
        saveCloud();
        cloudMessage('Conflito: o outro telemóvel alterou definições ou o mesmo registo. Escolhe “Carregar versão partilhada” ou “Enviar versão deste telemóvel”.', 'alert red');
        return;
      }
    }
    if (overwrite && !confirm('Isto vai substituir a versão partilhada pela versão guardada neste telemóvel. Continuar?')) return;
    const expected = overwrite ? row.revision : (cloud.revision === null ? row.revision : cloud.revision);
    const wirePayload = await encodeCloudPayload(ctx.db);
    const result = await rpc('save_household_data', { p_household_id: cloud.household_id, p_payload: wirePayload, p_expected_revision: expected });
    const r = Array.isArray(result) ? result[0] : result;
    if (!r?.ok) {
      cloud.dirty = true;
      cloud.revision = r?.revision ?? row.revision;
      saveCloud();
      cloudMessage('Conflito de sincronização. Carrega a versão partilhada ou volta a enviar explicitamente.', 'alert red');
      return;
    }
    cloud.revision = r.revision;
    cloud.dirty = false;
    saveCloud();
    paintCloud();
  } finally {
    cloudBusy = false;
  }
}

export async function syncNow(forcePull = false, silent = false) {
  if (!cloudConnected() || !cloud.household_id) return;
  try {
    const row = await getCloudRow();
    const remotePayload = await decodeCloudPayload(row.payload);
    if (!validPayload(remotePayload)) {
      cloud.revision = row.revision;
      cloud.dirty = true;
      saveCloud();
      await pushCloud(false);
      return;
    }
    if (forcePull) {
      if (hasLocalData() && !confirm('Carregar a versão partilhada vai substituir os dados locais deste telemóvel. Continuar?')) return;
      if (hasLocalData()) {
        await createAutoSnapshot(ctx.db, 'Antes de carregar da nuvem');
      }
      const migrated = setLocalData(remotePayload);
      if (ctx.refreshSnapshotsUI) ctx.refreshSnapshotsUI();
      cloud.revision = row.revision;
      cloud.dirty = migrated;
      saveCloud();
      paintCloud();
      if (migrated) await pushCloud(false);
      if (ctx.generateDueOccurrences()) ctx.render();
      return;
    }
    if (cloud.revision === null) {
      if (hasLocalData()) {
        cloud.revision = row.revision;
        cloud.dirty = true;
        saveCloud();
        cloudMessage('Este telemóvel já tem dados locais. Exporta uma cópia e escolhe qual versão deve prevalecer.', 'alert red');
        return;
      }
      const migrated = setLocalData(remotePayload);
      cloud.revision = row.revision;
      cloud.dirty = migrated;
      saveCloud();
      paintCloud();
      if (migrated) await pushCloud(false);
      if (ctx.generateDueOccurrences()) ctx.render();
      return;
    }
    if (row.revision !== cloud.revision) {
      if (cloud.dirty) {
        const merged = tryMergePayloads(ctx.db, remotePayload);
        if (merged) {
          await createAutoSnapshot(ctx.db, 'Antes de fusão simultânea');
          setLocalData(merged);
          if (ctx.refreshSnapshotsUI) ctx.refreshSnapshotsUI();
          cloud.revision = row.revision;
          cloud.dirty = true;
          saveCloud();
          await pushCloud(false);
          if (!silent) cloudMessage('Alterações simultâneas fundidas com sucesso. Revisão ' + cloud.revision + '.', 'alert good');
          return;
        }
        cloudMessage('Conflito: existem alterações incompatíveis neste telemóvel e na versão partilhada. Escolhe uma das duas ações.', 'alert red');
        return;
      }
      if (hasLocalData()) {
        await createAutoSnapshot(ctx.db, 'Antes de atualização remota');
      }
      const migrated = setLocalData(remotePayload);
      if (ctx.refreshSnapshotsUI) ctx.refreshSnapshotsUI();
      cloud.revision = row.revision;
      cloud.dirty = migrated;
      saveCloud();
      paintCloud();
      if (migrated) await pushCloud(false);
      if (ctx.generateDueOccurrences()) ctx.render();
      return;
    }
    if (cloud.dirty) await pushCloud(false);
    else if (!silent) cloudMessage('Tudo sincronizado. Revisão ' + cloud.revision + '.', 'alert good');
  } catch (e) {
    if (!silent) cloudMessage('Não foi possível sincronizar: ' + e.message, 'alert red');
  }
}

export function queueCloudSave() {
  if (!cloudConnected() || !cloud.household_id) return;
  cloud.dirty = true;
  saveCloud();
  paintCloud();
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => pushCloud(false).catch(e => cloudMessage(e.message, 'alert red')), 900);
}

export function initSyncModule(context, dbNeedsSync = false) {
  ctx = context;
  const $ = id => document.getElementById(id);

  try {
    cloud = { ...cloud, ...JSON.parse(localStorage.getItem(CLOUD_KEY) || '{}') };
  } catch (e) {}

  if (dbNeedsSync) {
    cloud.dirty = true;
    localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud));
  }

  if ($('saveE2eeBtn')) $('saveE2eeBtn').onclick = async () => {
    const val = ($('e2eePassphrase')?.value || '').trim();
    if (val.length < 6) {
      alert('A chave secreta E2EE deve ter pelo menos 6 caracteres.');
      return;
    }
    localStorage.setItem(E2EE_SECRET_KEY, val);
    $('e2eePassphrase').value = '';
    paintE2eeStatus();
    ctx.showToast('Chave E2EE guardada. A sincronizar dados cifrados...', { type: 'success' });
    if (cloudConnected() && cloud.household_id) {
      cloud.dirty = true;
      saveCloud();
      await pushCloud(false).catch(() => {});
    }
  };

  if ($('disableE2eeBtn')) $('disableE2eeBtn').onclick = async () => {
    if (!confirm('Desativar a encriptação ponta-a-ponta neste dispositivo?')) return;
    localStorage.removeItem(E2EE_SECRET_KEY);
    paintE2eeStatus();
    ctx.showToast('Encriptação ponta-a-ponta desativada.');
  };

  paintE2eeStatus();

  if ($('saveCloudConfig')) $('saveCloudConfig').onclick = saveCloudConfig;
  if ($('cloudLogin')) $('cloudLogin').onclick = async () => {
    try { await loginOrSignup(false); cloudMessage('Sessão iniciada.', 'alert good'); }
    catch (e) { cloudMessage(e.message, 'alert red'); }
  };
  if ($('cloudSignup')) $('cloudSignup').onclick = async () => {
    try { await loginOrSignup(true); }
    catch (e) { cloudMessage(e.message, 'alert red'); }
  };
  if ($('cloudLogout')) $('cloudLogout').onclick = async () => {
    disconnectRealtime();
    try {
      if (cloud.access_token) await fetch(cloud.url + '/auth/v1/logout', { method: 'POST', headers: { 'apikey': cloud.key, 'Authorization': 'Bearer ' + cloud.access_token } });
    } catch (e) {}
    cloud.access_token = '';
    cloud.refresh_token = '';
    cloud.expires_at = 0;
    cloud.user = null;
    cloud.household_id = null;
    cloud.revision = null;
    cloud.dirty = false;
    saveCloud();
    paintCloud();
    cloudMessage('Sessão terminada. Os dados locais continuam neste telemóvel.', 'alert good');
  };
  if ($('createHousehold')) $('createHousehold').onclick = async () => {
    try {
      const name = $('householdName').value.trim() || 'Orçamento do casal';
      const id = await rpc('create_household', { p_name: name });
      cloud.household_id = typeof id === 'string' ? id : id?.id;
      cloud.revision = 0;
      cloud.dirty = true;
      saveCloud();
      paintCloud();
      await pushCloud(false);
      connectRealtime();
      cloudMessage('Orçamento criado e primeira cópia enviada. Agora gera um convite para o outro adulto.', 'alert good');
    } catch (e) {
      cloudMessage(e.message, 'alert red');
    }
  };
  if ($('createInvite')) $('createInvite').onclick = async () => {
    try {
      if (!cloud.household_id) throw new Error('Cria ou associa primeiro um orçamento.');
      const code = await rpc('create_invite', { p_household_id: cloud.household_id });
      $('inviteResult').hidden = false;
      $('inviteResult').textContent = 'Código de convite (válido durante 48 horas e para uma utilização): ' + String(code).replace(/^"|"$/g, '');
    } catch (e) {
      cloudMessage(e.message, 'alert red');
    }
  };
  if ($('joinHousehold')) $('joinHousehold').onclick = async () => {
    try {
      const code = $('inviteCode').value.trim();
      if (!code) throw new Error('Introduz o código de convite.');
      const id = await rpc('join_household', { p_code: code });
      cloud.household_id = typeof id === 'string' ? id : id?.id;
      cloud.revision = null;
      cloud.dirty = false;
      saveCloud();
      paintCloud();
      await syncNow(true, true);
      connectRealtime();
      cloudMessage('Telemóvel associado. Confirma o estado da sincronização acima.', 'alert good');
    } catch (e) {
      cloudMessage(e.message, 'alert red');
    }
  };

  if ($('syncNow')) $('syncNow').onclick = () => syncNow(false, false);
  if ($('cloudPull')) $('cloudPull').onclick = () => syncNow(true, false);
  if ($('cloudPush')) $('cloudPush').onclick = () => pushCloud(true).catch(e => cloudMessage(e.message, 'alert red'));

  // Polling de reserva inteligente (15s quando WebSocket não está ligado, 60s apenas de segurança quando WebSocket está ativo)
  setInterval(() => {
    if (document.visibilityState === 'visible' && cloudConnected() && cloud.household_id) {
      if (rtState !== 'connected') {
        syncNow(false, true);
        if (!rtSocket) connectRealtime();
      }
    }
  }, 15000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cloudConnected() && cloud.household_id) {
      syncNow(false, true);
      connectRealtime();
    }
  });

  paintCloud();
}

