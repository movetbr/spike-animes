import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';

// Inicializar Firebase Admin SDK
let initialized = false;

function initFirebase() {
  if (initialized) return;
  
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const localKeyPath = path.join(process.cwd(), 'spike-animes-firebase-adminsdk-fbsvc-f6b938febf.json');
    
    if (serviceAccountJson) {
      // Produção: variável de ambiente com JSON string
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('🔥 Firebase Admin inicializado via Service Account (ENV)');
    } else if (fs.existsSync(localKeyPath)) {
      // Desenvolvimento: usa arquivo JSON local se existir
      admin.initializeApp({
        credential: admin.credential.cert(localKeyPath)
      });
      console.log('🔥 Firebase Admin inicializado via arquivo JSON local');
    } else {
      // Desenvolvimento: tenta Application Default
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
      console.log('🔥 Firebase Admin inicializado via Application Default Credentials');
    }
    
    initialized = true;
  } catch (error: any) {
    console.warn(`⚠️ Firebase Admin não inicializado: ${error.message}`);
    console.warn('Cache Firestore desabilitado. Rodando sem cache.');
  }
}

initFirebase();

// Instância do Firestore (pode ser null se Firebase não inicializou)
function getDb() {
  try {
    return admin.firestore();
  } catch {
    return null;
  }
}

// ===== Cache Helpers =====

interface CacheOptions {
  ttlHours?: number; // Tempo de vida em horas (default: 24)
}

/**
 * Busca item no cache do Firestore.
 * Retorna null se não encontrado ou expirado.
 */
export async function getCached<T = any>(
  collection: string, 
  docId: string, 
  ttlHours: number = 24
): Promise<T | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const doc = await db.collection(collection).doc(sanitizeDocId(docId)).get();
    
    if (!doc.exists) return null;
    
    const data = doc.data();
    if (!data) return null;

    // Verificar TTL
    let cachedAt: Date;
    if (data.cachedAt && typeof data.cachedAt.toDate === 'function') {
      cachedAt = data.cachedAt.toDate();
    } else if (data.cachedAt) {
      cachedAt = new Date(data.cachedAt);
    } else {
      cachedAt = new Date(0); // Forçar expiração se não houver data
    }

    const age = (Date.now() - cachedAt.getTime()) / (1000 * 60 * 60); // horas
    
    if (age > ttlHours) {
      console.log(`[Cache] ⏳ EXPIRED: ${collection}/${docId} (${age.toFixed(1)}h > ${ttlHours}h)`);
      return null;
    }

    console.log(`[Cache] 🎯 HIT: ${collection}/${docId} (${age.toFixed(1)}h old)`);
    return data as T;
  } catch (error: any) {
    console.error(`[Cache] Erro ao ler ${collection}/${docId}: ${error.message}`);
    return null;
  }
}

/**
 * Salva item no cache do Firestore.
 */
export async function setCache(
  collection: string, 
  docId: string, 
  data: any
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const start = Date.now();
    await db.collection(collection).doc(sanitizeDocId(docId)).set({
      ...data,
      cachedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`[Cache] ✅ SET SUCCESS: ${collection}/${docId} (took ${Date.now() - start}ms)`);
  } catch (error: any) {
    console.error(`[Cache] ❌ SET ERROR: ${collection}/${docId}: ${error.message}`);
  }
}

/**
 * Deleta item do cache.
 */
export async function deleteCache(collection: string, docId: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.collection(collection).doc(sanitizeDocId(docId)).delete();
    console.log(`[Cache] DELETE: ${collection}/${docId}`);
  } catch (error: any) {
    console.error(`[Cache] Erro ao deletar ${collection}/${docId}: ${error.message}`);
  }
}

/**
 * Sanitiza o ID do documento (Firestore não aceita '/')
 */
function sanitizeDocId(id: string): string {
  return id.replace(/\//g, '_').replace(/\s+/g, '_').toLowerCase();
}

export { admin };
