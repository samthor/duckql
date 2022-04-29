
const request = {
  query: `

query Foo2($bar: String = Something) {
  hero(test: 1, foo: null) {
    name
  }
}
  `,
  variables: {
    'a': 123,
  },
};

request.query = request.query.replace(/\s+/g, ' ').trim();
console.info('Sending query:', request.query);

(async () => {
  const { default: fetch } = await import('node-fetch');

  const r = await fetch('http://localhost:8080/graphql', { method: 'POST', body: JSON.stringify(request) });

  if (!r.ok) {
    const out = await r.text();
    console.debug('got err', r.status, out);
    process.exit(1);
  }

  const json = await r.json();
  console.debug(JSON.stringify(json, undefined, 2));

})();

