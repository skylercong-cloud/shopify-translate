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
