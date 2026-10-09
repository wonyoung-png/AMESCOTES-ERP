declare module 'compression' {
  import type { RequestHandler } from 'express';
  export default function compression(): RequestHandler;
}
