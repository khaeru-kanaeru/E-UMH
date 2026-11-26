import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth } from 'firebase/auth';
import {
  Firestore,
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId || '(default)';
export const FIRESTORE_CONSOLE_RULES_URL = `https://console.firebase.google.com/project/${encodeURIComponent(FIREBASE_PROJECT_ID)}/firestore/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID === '(default)' ? '-default-' : FIRESTORE_DATABASE_ID)}/rules`;

function createFirestoreInstance(databaseId?: string): Firestore {
  try {
    return initializeFirestore(
      app,
      { experimentalAutoDetectLongPolling: true },
      databaseId
    );
  } catch {
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
}

export const db = createFirestoreInstance(firebaseConfig.firestoreDatabaseId);

let cachedLegacyDefaultDb: Firestore | null | undefined;
export function getLegacyDefaultDb(): Firestore | null {
  if (FIRESTORE_DATABASE_ID === '(default)') return null;
  if (cachedLegacyDefaultDb === undefined) {
    cachedLegacyDefaultDb = createFirestoreInstance('(default)');
  }
  return cachedLegacyDefaultDb;
}

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
