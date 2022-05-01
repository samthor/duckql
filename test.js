
const request = {
  query: `
  
  query Foxo($bar: Int = 5) {
    user(id: 5) {
      firstName
      lastName {
        bar(barArg: $bar) {
          x {
            y {
              z
            }
          }
        }
      }
    }
  }
  `,
  variables: {
    'bar': 1,
  },
};

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

