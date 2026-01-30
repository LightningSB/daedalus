/**
 * Daedalus API Client
 * 
 * Helper functions for interacting with the Daedalus API
 * for user data persistence and app catalog access.
 */

const API_BASE = 'https://api.daedalus.wheelbase.io/api';

export interface AppCatalogEntry {
  id: string;
  name: string;
  icon: string;
  description: string;
  path: string;
  featured?: boolean;
  created_at?: string;
}

export interface Session {
  session_key: string;
  app_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

/**
 * Fetch the app catalog
 */
export async function fetchCatalog(): Promise<AppCatalogEntry[]> {
  const response = await fetch(`${API_BASE}/catalog`);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get user's sessions
 */
export async function listSessions(tgUserId: string): Promise<Session[]> {
  const response = await fetch(`${API_BASE}/users/${encodeURIComponent(tgUserId)}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new session for the user
 */
export async function createSession(tgUserId: string, appId: string): Promise<{ session_key: string }> {
  const response = await fetch(`${API_BASE}/users/${encodeURIComponent(tgUserId)}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get messages for a session
 */
export async function getMessages(
  tgUserId: string,
  sessionKey: string,
  options?: { limit?: number; offset?: number }
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  
  const url = `${API_BASE}/users/${encodeURIComponent(tgUserId)}/sessions/${sessionKey}/messages?${params}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to get messages: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Append messages to a session
 */
export async function appendMessages(
  tgUserId: string,
  sessionKey: string,
  messages: Message[]
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/users/${encodeURIComponent(tgUserId)}/sessions/${sessionKey}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to append messages: ${response.statusText}`);
  }
}

/**
 * Delete a session
 */
export async function deleteSession(tgUserId: string, sessionKey: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/users/${encodeURIComponent(tgUserId)}/sessions/${sessionKey}`,
    { method: 'DELETE' }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to delete session: ${response.statusText}`);
  }
}

/**
 * Simple key-value storage using sessions API
 * Stores JSON data as a single message in a dedicated session
 */
export async function saveUserData<T>(
  tgUserId: string,
  appId: string,
  data: T
): Promise<void> {
  // Use a predictable session key format for data storage
  const sessionKey = `data-${appId}`;
  
  // Try to append, create session if it doesn't exist
  try {
    await appendMessages(tgUserId, sessionKey, [
      {
        role: 'system',
        content: JSON.stringify(data),
        timestamp: Date.now(),
      },
    ]);
  } catch {
    // Session might not exist, create it first
    await createSession(tgUserId, appId);
    await appendMessages(tgUserId, sessionKey, [
      {
        role: 'system',
        content: JSON.stringify(data),
        timestamp: Date.now(),
      },
    ]);
  }
}

/**
 * Load user data from storage
 */
export async function loadUserData<T>(
  tgUserId: string,
  appId: string
): Promise<T | null> {
  const sessionKey = `data-${appId}`;
  
  try {
    const messages = await getMessages(tgUserId, sessionKey, { limit: 1 });
    if (messages.length > 0 && messages[0].content) {
      return JSON.parse(messages[0].content) as T;
    }
  } catch {
    // Session doesn't exist or no data
  }
  
  return null;
}
