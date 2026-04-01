import * as msw from 'msw';
console.log('msw keys:', Object.keys(msw));
console.log('msw.http keys:', msw.http ? Object.keys(msw.http) : 'no-http');
console.log('msw.graphql keys:', msw.graphql ? Object.keys(msw.graphql) : 'no-graphql');
