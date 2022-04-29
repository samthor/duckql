
import { GraphQLRequest, SafeGraphQLServer } from './graphql.js';
import * as http from 'http';

const gqlServer = new SafeGraphQLServer(async (context) => {

  if (context.operationName === 'Foo') {
    return {'hello': 'there'};
  }

  console.debug('got selection:', context.operationName, context.selection);




});


const server = http.createServer(async (req, res) => {
  try {
    await handler(req, res);
  } catch (e) {
    console.debug('Got unhandled server error', e);
    res.statusCode = 500;
  } finally {
    res.end();
  }
});
server.listen(8080);

async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.url !== '/graphql') {
    res.statusCode = 404;
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return;
  }

  const body = await new Promise<string>((resolve, reject) => {
    const bufs: Buffer[] = [];
    req.on('data', (chunk: Buffer) => bufs.push(chunk));
    req.on('end', () => resolve(Buffer.concat(bufs).toString('utf-8')));
    req.on('error', reject);
  });


  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    res.statusCode = 400;
    return;
  }

  if (!json.query) {
    res.statusCode = 400;
    return;
  }

  const request: GraphQLRequest = {
    operationName: json.operationName || '',
    query: json.query || '',
    variables: json.variables || {},
  };
  const response = await gqlServer.handle(request);
  res.write(JSON.stringify(response));
}
