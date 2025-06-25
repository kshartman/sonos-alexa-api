import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiRouter } from '../../src/api-router.js';

export interface TestResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export function createMockRequest(url: string, method: string = 'GET'): IncomingMessage {
  const req = {
    method,
    url,
    headers: {},
    on: () => {},
    once: () => {},
    emit: () => {},
    removeListener: () => {}
  } as any;
  
  return req as IncomingMessage;
}

export function createMockResponse(): ServerResponse & { getResponse: () => TestResponse } {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, string> = {};
  
  const res = {
    get statusCode() { return statusCode; },
    set statusCode(code: number) { statusCode = code; },
    writeHead: (code: number, responseHeaders?: any) => {
      statusCode = code;
      if (responseHeaders) {
        Object.assign(headers, responseHeaders);
      }
    },
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    write: (chunk: any) => {
      body += chunk;
    },
    end: (chunk?: any) => {
      if (chunk) {
        body += chunk;
      }
    },
    getResponse: () => ({
      status: statusCode,
      body,
      headers
    })
  } as any;
  
  return res as ServerResponse & { getResponse: () => TestResponse };
}

export async function testEndpoint(router: ApiRouter, url: string, method: string = 'GET'): Promise<TestResponse> {
  const req = createMockRequest(url, method);
  const res = createMockResponse();
  
  await router.handleRequest(req, res);
  
  return res.getResponse();
}