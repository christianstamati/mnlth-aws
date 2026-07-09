import { Client } from "pg"

// Creates the per-preview-stage database on the shared RDS instance.
// Runs inside the VPC; invoked once per `sst deploy` of a preview stage.
export async function handler(event: { database: string }) {
  const database = event.database
  if (!/^[a-z0-9_]+$/.test(database)) {
    throw new Error(`invalid database name: ${database}`)
  }

  // Connect to the production database only to reach the server; the
  // CREATE DATABASE statement is server-level
  const client = new Client({
    connectionString: `${process.env.POSTGRES_URL}/mnlth`,
  })
  await client.connect()
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database]
    )
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${database}"`)
      return { created: true, database }
    }
    return { created: false, database }
  } finally {
    await client.end()
  }
}
