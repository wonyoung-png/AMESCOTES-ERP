// AI 에이전트용 AWS 자체 PostgREST 클라이언트.
import crypto from 'crypto';
import { PostgrestClient } from '@supabase/postgrest-js';

const endpoint = process.env.POSTGREST_URL || 'http://postgrest:3000';
const secret = process.env.PGRST_JWT_SECRET || '';

const b64url = (value: Buffer) => value.toString('base64url');
const serviceToken = () => {
  if (!secret) throw new Error('PGRST_JWT_SECRET 환경변수가 설정되지 않았습니다.');
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({
    role: 'erp_server',
    iss: 'erp-agent',
    exp: Math.floor(Date.now() / 1000) + 60,
  })));
  const signature = b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
};

const authorizedFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${serviceToken()}`);
  return fetch(input, { ...init, headers });
};

export const db = new PostgrestClient(endpoint, { fetch: authorizedFetch });
