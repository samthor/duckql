
import { DuckQLServer } from '../src/index';
import { print } from 'graphql';


import polka from 'polka';

const gqlServer = new DuckQLServer({
  async resolver(context) {
    if (context.operationName === 'Foo') {
      return { data: { 'hello': 'there' } };
    }

    const t = context.selection.sub['user'];

    console.debug('node recreate:');
    console.debug(print(t.node));
  },
});


polka()
  .use(gqlServer.buildMiddleware())
  .post('/graphql-other', gqlServer.httpHandle)
  .get('/', (req, res) => {
    res.end('Hi!')
  })
  .listen(3000, () => {
    console.log(`> Running on localhost:3000`);
  });

