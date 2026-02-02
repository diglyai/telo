import { ExecContext } from '../../types';

/**
 * HttpClient.Request executor
 * Handles HTTP requests in Pipeline steps
 */
export async function executeHttpRequest(
  _name: string,
  input: any,
  _ctx: ExecContext,
): Promise<any> {
  const { method, url, headers, body } = input;

  if (!method || !url) {
    throw new Error('HttpClient.Request requires method and url');
  }

  const options: RequestInit = {
    method: method.toUpperCase(),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  return {
    status: response.status,
    statusText: response.statusText,
    payload: data,
  };
}
