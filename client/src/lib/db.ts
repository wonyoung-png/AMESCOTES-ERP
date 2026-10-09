import { PostgrestClient } from '@supabase/postgrest-js';

const endpoint = `${window.location.origin}/rest/v1`;

const authorizedFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem('erp_token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: 'include' });
};

/** AWS의 자체 PostgREST. 서버 DB 클라우드·키와 무관하다. */
export const db = new PostgrestClient(endpoint, { fetch: authorizedFetch });
