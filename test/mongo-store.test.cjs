const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMongoStore } = require('../mongo-store.cjs');

const tableColumns = {
  admin_credentials: ['id', 'salt', 'password_hash'],
  admin_password_resets: ['token_hash', 'expires_at', 'created_at'],
  mechanics: ['id', 'name', 'initials', 'specialty', 'description', 'skills', 'location', 'experience', 'rating', 'status'],
  inventory: ['sku', 'name', 'category', 'brand', 'qty', 'min', 'cost', 'price'],
  bookings: ['id', 'name', 'phone', 'car', 'registration', 'service', 'date', 'time', 'handover', 'note', 'status', 'price', 'mechanic_id', 'created_at'],
  mechanic_salaries: ['mechanic_id', 'monthly_salary'],
  mechanic_attendance: ['mechanic_id', 'work_date', 'check_in', 'check_out'],
  roadside_requests: ['id', 'name', 'phone', 'vehicle', 'registration', 'location', 'issue', 'details', 'mechanic', 'status', 'created_at'],
  invoices: ['id', 'customer', 'description', 'amount', 'due', 'status'],
  transactions: ['id', 'type', 'party', 'detail', 'amount', 'date'],
  offers: ['code', 'tag', 'title', 'description', 'when_text', 'active'],
  part_orders: ['id', 'name', 'phone', 'lines', 'total', 'status', 'created_at']
};

function fakeDatabase(seed = {}) {
  const rows = Object.fromEntries(Object.keys(tableColumns).map(table => [table, (seed[table] || []).map(row => ({ ...row }))]));
  return {
    rows,
    prepare(sql) {
      const select = sql.match(/^SELECT \* FROM (\w+)$/);
      if (select) return { all: () => rows[select[1]].map(row => ({ ...row })) };
      const pragma = sql.match(/^PRAGMA table_info\((\w+)\)$/);
      if (pragma) return { all: () => tableColumns[pragma[1]].map(name => ({ name })) };
      const insert = sql.match(/^INSERT INTO (\w+)\(([^)]+)\) VALUES\(([^)]+)\)$/);
      if (insert) {
        const names = insert[2].split(',');
        return { run: (...values) => { rows[insert[1]].push(Object.fromEntries(names.map((name, index) => [name, values[index]]))); return { changes: 1 }; } };
      }
      throw new Error(`Unexpected SQL in Mongo store test: ${sql}`);
    },
    exec(sql) {
      for (const [, table] of sql.matchAll(/DELETE FROM (\w+)/g)) rows[table] = [];
    }
  };
}

function fakeMongo() {
  const collections = new Map();
  const mongoDb = {
    collection(name) {
      if (!collections.has(name)) {
        const documents = new Map();
        collections.set(name, {
          documents,
          createIndex: async () => {},
          countDocuments: async () => documents.size,
          findOne: async filter => documents.get(filter._id) || null,
          find: () => ({ toArray: async () => [...documents.values()].map(document => ({ ...document })) }),
          deleteMany: async () => { documents.clear(); },
          insertMany: async values => { for (const value of values) documents.set(value._id, { ...value }); },
          insertOne: async value => { documents.set(value._id, { ...value }); },
          updateOne: async (filter, update) => { documents.set(filter._id, { _id: filter._id, ...update.$set }); }
        });
      }
      return collections.get(name);
    }
  };
  const mongoClient = { startSession: () => ({ withTransaction: async operation => operation(), endSession: async () => {} }) };
  return { mongoDb, mongoClient };
}

test('migrates existing SQLite records to Mongo and hydrates them on restart', async () => {
  const mechanic = { id: 1, name: 'Test Mechanic', initials: 'TM', specialty: 'Diagnostics', description: 'Test mechanic description', skills: 'Testing', location: 'Bengaluru', experience: 3, rating: 4.5, status: 'Available' };
  const booking = { id: 'WC-TEST-01', name: 'Test Customer', phone: '+91 98765 43210', car: 'Test Car', registration: 'KA 01 AA 0001', service: 'Routine service', date: '2026-10-01', time: '10:00 AM', handover: 'Drop-off at our workshop', note: '', status: 'Confirmed', price: 1499, mechanic_id: 1, created_at: '2026-09-29 10:00:00' };
  const mongo = fakeMongo();
  const source = fakeDatabase({ mechanics: [mechanic], bookings: [booking] });
  const sourceStore = createMongoStore({ database: source, ...mongo });

  assert.equal(await sourceStore.initialize(), 'migrated');
  assert.deepEqual(mongo.mongoDb.collection('wrench_mechanics').documents.get(1).name, mechanic.name);
  assert.deepEqual(mongo.mongoDb.collection('wrench_bookings').documents.get(booking.id).name, booking.name);

  const restored = fakeDatabase();
  const restoredStore = createMongoStore({ database: restored, ...mongo });
  assert.equal(await restoredStore.initialize(), 'loaded');
  assert.deepEqual(restored.rows.mechanics, [mechanic]);
  assert.deepEqual(restored.rows.bookings, [booking]);
});
