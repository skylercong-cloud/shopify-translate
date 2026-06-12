export type Admin = {
  id: string;
  username: string;
  passwordHash: string;
};

export interface AuthRepository {
  upsertAdminPassword(passwordHash: string): Promise<Admin>;
  replaceAdminPasswordAndRevokeSessions(passwordHash: string): Promise<Admin>;
  findAdmin(): Promise<Admin | undefined>;
  deleteSessionsForUser(userId: string): Promise<void>;
}

export type StoredSession = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  user: {
    id: string;
    username: string;
  };
};

export interface SessionRepository {
  createSession(input: {
    id: string;
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }): Promise<{
    id: string;
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }>;
  findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | undefined>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
}
