import { useEffect, useState, useRef } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';

interface UseDuckDBReturn {
  db: duckdb.AsyncDuckDB | null;
  conn: duckdb.AsyncDuckDBConnection | null;
  isLoading: boolean;
  error: Error | null;
}

export function useDuckDB(): UseDuckDBReturn {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initDuckDB = async () => {
      try {
        setIsLoading(true);

        // DuckDB WASM bundle URLs
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        
        // Select the best bundle based on browser capabilities
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
        
        // Create a new worker
        const worker_url = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
        );
        
        const worker = new Worker(worker_url);
        const logger = new duckdb.ConsoleLogger();
        
        // Create the database
        const database = new duckdb.AsyncDuckDB(logger, worker);
        await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
        
        // Create a connection
        const connection = await database.connect();
        
        // Create the history table if it doesn't exist
        await connection.query(`
          CREATE TABLE IF NOT EXISTS vin_history (
            vin VARCHAR PRIMARY KEY,
            make VARCHAR,
            model VARCHAR,
            year VARCHAR,
            data VARCHAR,
            timestamp BIGINT
          )
        `);

        setDb(database);
        setConn(connection);
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
      // Cleanup
      if (conn) {
        conn.close();
      }
      if (db) {
        db.terminate();
      }
    };
  }, []);

  return { db, conn, isLoading, error };
}
