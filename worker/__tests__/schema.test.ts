declare const process: {
  getBuiltinModule(moduleName: 'fs'): {
    readFileSync(path: string, encoding: 'utf8'): string
  }
}

const { readFileSync } = process.getBuiltinModule('fs')

describe('D1 schema', () => {
  it('defines all required tables', () => {
    const sql = readFileSync('migrations/0001_init.sql', 'utf8')
    for (const table of ['users', 'sessions', 'trips', 'memberships', 'invites', 'share_links', 'trip_snapshots', 'trip_events']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })

  it('defines unique trip event versions', () => {
    const sql = readFileSync('migrations/0001_init.sql', 'utf8')
    expect(sql).toContain('UNIQUE (trip_id, version)')
  })

  it('preserves trip events when actor users are deleted', () => {
    const sql = readFileSync('migrations/0001_init.sql', 'utf8')
    expect(sql).toContain('actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL')
    expect(sql).not.toContain('actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE')
  })
})

describe('Wrangler config', () => {
  it('creates TripRoom with the SQLite Durable Object backend', () => {
    const config = readFileSync('wrangler.toml', 'utf8')
    expect(config).toContain('new_sqlite_classes = ["TripRoom"]')
    expect(config).not.toContain('new_classes = ["TripRoom"]')
  })
})
