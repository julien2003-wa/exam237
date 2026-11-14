// Noms des cookies de session, partagés par lib/auth.ts et le middleware
// (qui ne peut pas importer lib/auth.ts : il tourne sans les modules Node).
export const USER_COOKIE = 'ex237_user_session';
export const ADMIN_COOKIE = 'ex237_admin_session';
