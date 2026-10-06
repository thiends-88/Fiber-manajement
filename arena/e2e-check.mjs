import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const PUB = 'sb_publishable_test';
const SVC = 'arena-service-role-secret';

const svcFetch = (key) => (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('apikey', key);
  return fetch(input, { ...init, headers });
};

const fail = (m) => { console.error('FAIL:', m); process.exit(1); };

// 1. Login
const client = createClient(URL, PUB, { global: { fetch: svcFetch(PUB) }, auth: { persistSession: false } });
const { data: sess, error: e1 } = await client.auth.signInWithPassword({ email: 'admin@arena.test', password: 'Arena123!' });
if (e1) fail('login: ' + e1.message);
console.log('OK login', sess.user.email);

// 2. getClaims (dipakai middleware requireSupabaseAuth)
const { data: claims, error: e2 } = await client.auth.getClaims(sess.access_token);
if (e2 || !claims?.claims?.sub) fail('getClaims: ' + e2?.message);
console.log('OK getClaims sub=', claims.claims.sub.slice(0, 8));

// 3. rpc has_role
const { data: isAdmin } = await client.rpc('has_role', { _user_id: claims.claims.sub, _role: 'admin' });
if (isAdmin !== true) fail('has_role bukan true');
console.log('OK rpc has_role =', isAdmin);

// 4. count exact head
const { count } = await client.from('olts').select('id', { count: 'exact', head: true });
if (count !== 2) fail('count olts = ' + count);
console.log('OK count olts =', count);

// 5. insert .select("id").single()
const { data: odc, error: e5 } = await client.from('odcs').insert({ olt_id: null, name: 'ODC-E2E', location: 'x', cable_type: '24_core_4_tube' }).select('id').single();
if (e5) fail('insert odc: ' + e5.message);
console.log('OK insert odcs ->', odc.id.slice(0, 8));

// 6. upsert profiles merge-duplicates (flow createUser)
const admin = createClient(URL, SVC, { global: { fetch: svcFetch(SVC) }, auth: { persistSession: false } });
const { data: created, error: e6 } = await admin.auth.admin.createUser({ email: 'e2e@arena.test', password: 'E2e12345!', email_confirm: true, user_metadata: { full_name: 'E2E User' } });
if (e6) fail('admin.createUser: ' + e6.message);
const { error: e7 } = await client.from('profiles').upsert({ id: created.user.id, email: 'e2e@arena.test', full_name: 'E2E User' });
if (e7) fail('profiles upsert: ' + e7.message);
const { error: e8 } = await client.from('user_roles').insert({ user_id: created.user.id, role: 'operator' });
if (e8) fail('insert role: ' + e8.message);
const { data: roles } = await client.from('user_roles').select('role').eq('user_id', created.user.id);
console.log('OK createUser flow, roles =', roles.map(r => r.role));

// 7. update + deleteUserById flow
const { error: e9 } = await admin.auth.admin.updateUserById(created.user.id, { email: 'e2e2@arena.test', email_confirm: true, user_metadata: { full_name: 'E2E Dua' } });
if (e9) fail('updateUserById: ' + e9.message);
console.log('OK admin.updateUserById');

// 8. in() filter + is null + order
const { data: ports } = await client.from('olt_ports').select('id,port_number').in('card_id', ['nonexistent-1', 'nonexistent-2']).order('port_number');
const { data: cores } = await client.from('core_assignments').select('core_number').eq('source', 'olt_to_odc').is('odp_id', null).order('core_number');
console.log('OK in() rows =', ports.length, '| is(null) cores =', cores.map(c => c.core_number).join(','));

// 9. refresh token
const { data: refreshed, error: e10 } = await client.auth.refreshSession(sess.refresh_token);
if (e10) fail('refresh: ' + e10.message);
console.log('OK refresh -> new token beda:', refreshed.session.access_token !== sess.access_token);

// 10. getUser + signOut
const authed = createClient(URL, PUB, { global: { fetch: svcFetch(PUB) }, auth: { persistSession: false } });
await authed.auth.setSession({ access_token: refreshed.session.access_token, refresh_token: refreshed.session.refresh_token });
const { data: u } = await authed.auth.getUser();
if (u.user?.email !== 'admin@arena.test') fail('getUser email salah');
const { error: e11 } = await authed.auth.signOut();
if (e11) fail('signOut: ' + e11.message);
console.log('OK getUser + signOut');

console.log('\nSEMUA E2E LULUS ✅');
