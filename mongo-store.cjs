const tables = [
  { table: 'admin_credentials', collection: 'wrench_admin_credentials', primary: 'id' },
  { table: 'admin_password_resets', collection: 'wrench_admin_password_resets', primary: 'token_hash' },
  { table: 'customers', collection: 'wrench_customers', primary: 'phone_key' },
  { table: 'login_events', collection: 'wrench_login_events', primary: 'id' },
  { table: 'mechanics', collection: 'wrench_mechanics', primary: 'id' },
  { table: 'inventory', collection: 'wrench_inventory', primary: 'sku' },
  { table: 'bookings', collection: 'wrench_bookings', primary: 'id' },
  { table: 'mechanic_salaries', collection: 'wrench_mechanic_salaries', primary: 'mechanic_id' },
  { table: 'mechanic_attendance', collection: 'wrench_mechanic_attendance', primary: 'mechanic_id', secondary: 'work_date' },
  { table: 'roadside_requests', collection: 'wrench_roadside_requests', primary: 'id' },
  { table: 'invoices', collection: 'wrench_invoices', primary: 'id' },
  { table: 'transactions', collection: 'wrench_transactions', primary: 'id' },
  { table: 'offers', collection: 'wrench_offers', primary: 'code' },
  { table: 'part_orders', collection: 'wrench_part_orders', primary: 'id' }
];

function createMongoStore({ database, mongoDb, mongoClient }) {
  const metadata = mongoDb.collection('wrench_metadata');

  function documentsFor({ table, primary, secondary }) {
    return database.prepare(`SELECT * FROM ${table}`).all().map(row => {
      const document = Object.fromEntries(Object.entries(row));
      if (table === 'part_orders') {
        try { document.lines = JSON.parse(document.lines); }
        catch { document.lines = []; }
      }
      document._id = secondary ? `${row[primary]}:${row[secondary]}` : row[primary];
      return document;
    });
  }

  async function persist() {
    const session = mongoClient.startSession();
    try {
      await session.withTransaction(async () => {
        for (const definition of tables) {
          const collection = mongoDb.collection(definition.collection);
          const documents = documentsFor(definition);
          await collection.deleteMany({}, { session });
          if (documents.length) await collection.insertMany(documents, { session, ordered: true });
        }
        await metadata.updateOne(
          { _id: 'sqlite-mirror-v1' },
          { $set: { updatedAt: new Date(), schemaVersion: 1 } },
          { upsert: true, session }
        );
      });
    } finally {
      await session.endSession();
    }
  }

  async function loadIntoSqlite() {
    const definitions = await Promise.all(tables.map(async definition => ({
      ...definition,
      documents: await mongoDb.collection(definition.collection).find({}).toArray()
    })));
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec('DELETE FROM mechanic_attendance; DELETE FROM mechanic_salaries; DELETE FROM bookings; DELETE FROM roadside_requests; DELETE FROM part_orders; DELETE FROM inventory; DELETE FROM mechanics; DELETE FROM invoices; DELETE FROM transactions; DELETE FROM offers; DELETE FROM admin_password_resets; DELETE FROM admin_credentials;');
      for (const definition of definitions) {
        const columns = database.prepare(`PRAGMA table_info(${definition.table})`).all().map(column => column.name);
        for (const document of definition.documents) {
          const row = Object.fromEntries(columns.filter(column => document[column] !== undefined).map(column => [column, document[column]]));
          if (definition.table === 'mechanic_attendance') row.work_date = document.work_date;
          if (definition.table === 'part_orders') {
            row.lines = Array.isArray(document.lines) ? JSON.stringify(document.lines) : document.lines;
            const phoneKey = String(document.phone || '').replace(/\D/g, '');
            row.customer_id = document.customer_id || phoneKey || null;
            if (phoneKey && document.name && document.phone) {
              database.prepare('INSERT INTO customers(phone_key,name,phone) VALUES(?,?,?) ON CONFLICT(phone_key) DO NOTHING').run(phoneKey, document.name, document.phone);
            }
          }
          const names = Object.keys(row);
          if (!names.length) continue;
          database.prepare(`INSERT INTO ${definition.table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).run(...names.map(name => row[name]));
        }
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  async function initialize() {
    const bookings = mongoDb.collection('wrench_bookings');
    await mongoDb.collection('wrench_mechanics').createIndex({ name: 1 }, { unique: true });
    await mongoDb.collection('wrench_customers').createIndex({ phone_key: 1 }, { unique: true });
    await mongoDb.collection('wrench_login_events').createIndex({ role: 1, created_at: -1 });
    await mongoDb.collection('wrench_part_orders').createIndex({ customer_id: 1, created_at: -1 });
    await mongoDb.collection('wrench_roadside_requests').createIndex({ created_at: -1 });
    await bookings.createIndex({ date: 1, time: 1 }, {
      unique: true,
      partialFilterExpression: { status: { $in: ['Awaiting confirmation', 'Confirmed', 'In progress', 'Completed'] } }
    });

    const marker = await metadata.findOne({ _id: 'sqlite-mirror-v1' });
    const counts = await Promise.all(tables.map(({ collection }) => mongoDb.collection(collection).countDocuments()));
    if (marker) {
      if (counts.every(count => count === 0)) throw new Error('MongoDB has a migration marker but no workshop records; refusing to overwrite the empty database.');
      await loadIntoSqlite();
      return 'loaded';
    }
    if (counts.some(count => count > 0)) {
      await loadIntoSqlite();
      await metadata.insertOne({ _id: 'sqlite-mirror-v1', updatedAt: new Date(), schemaVersion: 1 });
      return 'loaded';
    }
    await persist();
    return 'migrated';
  }

  return { initialize, persist };
}

module.exports = { createMongoStore };
