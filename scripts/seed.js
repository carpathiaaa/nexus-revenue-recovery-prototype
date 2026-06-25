// Destructive reset: drop everything, recreate the schema, and insert the demo
// opportunities. Run with `npm run seed`. For the non-destructive boot-time seed
// used in deploys, see seedIfEmpty() in lib/seedData.js.
const { db, initSchema } = require("../lib/db");
const { rows, insertRows } = require("../lib/seedData");

db.exec(`
  DROP TABLE IF EXISTS events;
  DROP TABLE IF EXISTS opportunities;
`);

initSchema();
insertRows();

console.log(`Seeded ${rows.length} opportunities into data.db`);
