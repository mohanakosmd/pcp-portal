// API routes use the Firestore REST client in `firestore-rest.ts` because the
// Firebase JS SDK hangs on gRPC inside Next.js dev mode. This file is kept as
// a single place to share the collection name across routes.

export const PCP_USERS_COLLECTION = "pcp_users";
