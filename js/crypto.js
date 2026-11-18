// js/crypto.js — Encriptação AES-256-GCM (PBKDF2) e utilitários Base64
export function bufToB64(buf){
  const bytes=new Uint8Array(buf);
  let bin='';
  for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
export function b64ToBuf(b64){
  const bin=atob(b64);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return bytes;
}
export function randomBytes(len){
  const arr=new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}
export async function hashPinWithSalt(pin,saltB64){
  const enc=new TextEncoder();
  const data=enc.encode(saltB64+':'+String(pin));
  const digest=await crypto.subtle.digest('SHA-256',data);
  return bufToB64(digest);
}
export async function deriveAesKey(passphrase,saltBytes,iterations=150000){
  const enc=new TextEncoder();
  const baseKey=await crypto.subtle.importKey('raw',enc.encode(String(passphrase)),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt:saltBytes,iterations,hash:'SHA-256'},
    baseKey,
    {name:'AES-GCM',length:256},
    false,
    ['encrypt','decrypt']
  );
}
export async function encryptJsonAesGcm(obj,passphrase){
  const salt=randomBytes(16);
  const iv=randomBytes(12);
  const key=await deriveAesKey(passphrase,salt);
  const plaintext=new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext);
  return {
    __duofin_encrypted__:true,
    v:1,
    alg:'AES-256-GCM',
    kdf:'PBKDF2-SHA256',
    iter:150000,
    salt:bufToB64(salt),
    iv:bufToB64(iv),
    ct:bufToB64(ciphertext)
  };
}
export async function decryptJsonAesGcm(envelope,passphrase){
  if(!envelope||envelope.__duofin_encrypted__!==true||!envelope.ct||!envelope.iv||!envelope.salt){
    throw new Error('Formato encriptado inválido.');
  }
  const salt=b64ToBuf(envelope.salt);
  const iv=b64ToBuf(envelope.iv);
  const ct=b64ToBuf(envelope.ct);
  const iter=Number(envelope.iter)||150000;
  const key=await deriveAesKey(passphrase,salt,iter);
  const plainBuf=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

