import pg from 'pg';
const c = new pg.Client(process.env.DATABASE_URL);
await c.connect();
const r = await c.query(`SELECT id, email, role, supertokens_id FROM "User" WHERE email = 'mikinamateusz@gmail.com'`);
console.log(r.rows);
await c.end();
