
import { GraphQLServer } from './graphql.js';
import * as http from 'http';
import { print } from 'graphql';


const gqlServer = new GraphQLServer(async (context) => {
  if (context.operationName === 'Foo') {
    return { 'hello': 'there' };
  }

  console.debug('top-level node recreate:');
  console.debug(print(context.selection.node));
});


const server = http.createServer(async (req, res) => {
  try {
    await gqlServer.httpHandle(req, res);
  } catch (e) {
    console.debug('Got unhandled server error', e);
    res.statusCode = 500;
  } finally {
    res.end();
  }
});
server.listen(8080);

