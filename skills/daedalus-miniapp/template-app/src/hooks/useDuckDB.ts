import { useEffect, useState, useRef } from 'react';

// DuckDB-WASM types (simplified)
interface DuckDBConnection {
  query: (sql: string) => Promise<DuckDBResult>;
  close: () => Promise<void>;
}

interface DuckDBResult {
  numRows: number;
  numCols: number;
  get: (index: number) => Record<string, unknown> | null;
  toArray: () => Record<string, unknown>[];
}

interface DuckDBInstance {
  connect: () => Promise<DuckDBConnection>;
  terminate: () => Promise<void>;
}

interface UseDuckDBReturn {
  db: DuckDBInstance | null;
  conn: DuckDBConnection | null;
  isLoading: boolean;
  error: Error | null;
  query: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;
}

/**
 * Hook for DuckDB-WASM integration
 * 
 * Optional hook for apps that need client-side SQL queries.
 * Import DuckDB-WASM in your app to use this hook:
 * 
 * ```bash
 * pnpm add @duckdb/duckdb-wasm
 * ```
 * 
 * Then update the import at the top of this file.
 */
export function useDuckDB(): UseDuckDBReturn {
  const [db, setDb] = useState<DuckDBInstance | null>(null);
  const [conn, setConn] = useState<DuckDBConnection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initDuckDB = async () => {
      try {
        setIsLoading(true);
        
        // Dynamic import of DuckDB-WASM
        const duckdb = await import('@duckdb/duckdb-wasm');
        
        // Get bundle URLs
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
        
        // Create worker
        const worker_url = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
        );
        const worker = new Worker(worker_url);
        const logger = new duckdb.ConsoleLogger();
        
        // Initialize database
        const database = new duckdb.AsyncDuckDB(logger, worker);
        await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
        
        // Create connection
        const connection = await database.connect();
        
        // Install httpfs for remote file access
        await connection.query(`INSTALL httpfs; LOAD httpfs;`);
        
        setDb(database as unknown as DuckDBInstance);
        setConn(connection as unknown as DuckDBConnection);
        setError(null);
      } catch (err) {
        console.error('Failed to initialize DuckDB:', err);
        setError(err instanceof Error ? err : new Error('Failed to initialize DuckDB'));
      } finally {
        setIsLoading(false);
      }
    };

    initDuckDB();

    return () => {
      // Cleanup on unmount
      conn?.close();
      db?.terminate();
    };
  }, []);

  const query = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    if (!conn) {
      throw new Error('DuckDB connection not ready');
    }
    
    const result = await conn.query(sql);
    const rows: T[] = [];
    
    for (let i = 0; i < result.numRows; i++) {
      const row = result.get(i);
      if (row) {
        rows.push(row as T);
      }
    }
    
    return rows;
  };

  return { db, conn, isLoading, error, query };
}

/**
 * Load a remote Parquet file into DuckDB
 * 
 * @example
 * const { conn } = useDuckDB();
 * await loadParquetTable(conn, 'my_table', 'https://minio.wheelbase.io/daedalus/data/file.parquet');
 * const results = await conn.query('SELECT * FROM my_table');
 */
export async function loadParquetTable(
  conn: DuckDBConnection,
  tableName: string,
  url: string
): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} AS 
    SELECT * FROM read_parquet('${url}')
  `);
}

/**
 * Create an in-memory table from JSON data
 */
export async function createTableFromJSON<T extends Record<string, unknown>>(
  conn: DuckDBConnection,
  tableName: string,
  data: T[]
): Promise<void> {
  if (data.length === 0) {
    throw new Error('Cannot create table from empty data');
  }
  
  // Get columns from first row
  const columns = Object.keys(data[0]);
  const columnDefs = columns.map(col => {
    const value = data[0][col];
    const type = typeof value === 'number' 
      ? (Number.isInteger(value) ? 'INTEGER' : 'DOUBLE')
      : typeof value === 'boolean' 
        ? 'BOOLEAN' 
        : 'VARCHAR';
    return `${col} ${type}`;
  }).join(', ');
  
  await conn.query(`CREATE TABLE ${tableName} (${columnDefs})`);
  
  // Insert rows
  for (const row of data) {
    const values = columns.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
      return String(val);
    }).join(', ');
    
    await conn.query(`INSERT INTO ${tableName} VALUES (${values})`);
  }
}
